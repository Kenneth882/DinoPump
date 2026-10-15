import { verifyFinalResult, RoundIntegrityError } from "./results.js";
import { publicMarketView, readQuoteUpdatedAtMs } from "./market-view.js";
import { orderOutcome } from "./orders.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  frozenRoundSchema,
  engineStateSchema,
  type EngineState,
  type EngineBatch,
  newsItemSchema,
  orderSubmitSchema,
  orderResultSchema,
} from "@dinopump/contracts";
import { startEngineRound, reduceEngineBatch } from "@dinopump/engine";
import { newsFromBatch, narrationInput } from "./news.js";
import { insertRoundBaseline } from "./rounds.js";

/** Called only inside the owned room transaction. Returns no public payload. */
export async function persistRoundOpening(
  client: PoolClient,
  initialization: unknown,
) {
  const round = await insertRoundBaseline(client, initialization);
  const opened = startEngineRound(round);
  if (!opened.ok) throw new Error("Invalid round opening");
  await persistEngineBatch(client, opened.state, opened.batch);
  return opened.state;
}

/** Caller owns the transaction; the whole batch is a single commit unit. */
export async function persistEngineBatch(
  client: PoolClient,
  state: EngineState,
  batch: EngineBatch,
) {
  const ids = new Map<number, string>();
  for (const event of batch.events) {
    const eventId = randomUUID();
    ids.set(event.sequence, eventId);
    await client.query(
      `INSERT INTO game_events (round_id,sequence,event_id,schema_version,type,payload,cause_id,occurred_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        event.roundId,
        event.sequence,
        eventId,
        event.schemaVersion,
        event.type,
        event.payload,
        event.causeId,
        event.occurredAtMs,
      ],
    );
  }
  const view = publicMarketView(
    state,
    batch,
    await readQuoteUpdatedAtMs(client, state),
  );
  await client.query(
    "INSERT INTO round_batches (round_id,end_sequence,batch,public_view) VALUES ($1,$2,$3,$4)",
    [state.round.roundId, state.sequence, batch, view],
  );
  await client.query(
    "UPDATE round_projections SET sequence=$2,state=$3 WHERE round_id=$1",
    [state.round.roundId, state.sequence, state],
  );
  return ids;
}

/** Internal recovery read: immutable history is authoritative; projections must agree. */
export async function readOpenedRound(
  db: Pool | PoolClient,
  roundId: string,
): Promise<EngineState | null> {
  return readRoundHistory(db, roundId, true);
}

/** Only the room owner may replace a projection, inside its serialized transaction.
 * Verify all immutable evidence first; a damaged stream must never be repaired.
 */
export async function recoverOpenedRound(client: PoolClient, roundId: string) {
  const state = await readRoundHistory(client, roundId, false);
  if (state)
    await client.query(
      `INSERT INTO round_projections(round_id,sequence,schema_version,state) VALUES ($1,$2,1,$3)
       ON CONFLICT (round_id) DO UPDATE SET sequence=EXCLUDED.sequence,schema_version=EXCLUDED.schema_version,state=EXCLUDED.state
       WHERE round_projections.sequence IS DISTINCT FROM EXCLUDED.sequence
         OR round_projections.schema_version IS DISTINCT FROM EXCLUDED.schema_version
         OR round_projections.state IS DISTINCT FROM EXCLUDED.state`,
      [roundId, state.sequence, state],
    );
  return state;
}

async function readRoundHistory(
  db: Pool | PoolClient,
  roundId: string,
  verifyProjection: boolean,
): Promise<EngineState | null> {
  frozenRoundSchema.shape.roundId.parse(roundId);
  const result = await db.query(
    `SELECT baseline,
    (SELECT jsonb_agg(batch ORDER BY end_sequence) FROM round_batches WHERE round_id=r.round_id) AS batches,
    (SELECT jsonb_agg(jsonb_build_object('schemaVersion',schema_version,'roundId',round_id,'sequence',sequence,'type',type,'payload',payload,'causeId',cause_id::text,'occurredAtMs',occurred_at_ms) ORDER BY sequence) FROM game_events WHERE round_id=r.round_id AND sequence>1) AS events,
    (SELECT jsonb_build_object('roundId',round_id,'sequence',sequence,'eventId',event_id,'schemaVersion',schema_version,'type',type,'payload',payload,'causeId',cause_id,'occurredAtMs',occurred_at_ms)
      FROM game_events WHERE round_id=r.round_id AND sequence=1) AS initialized,
    (SELECT jsonb_agg(jsonb_build_object('item',n.item,'input',j.input,'sourceSequence',e.sequence) ORDER BY e.sequence)
      FROM news_items n JOIN game_events e ON e.event_id=n.source_event_id
      LEFT JOIN commentary_jobs j USING(source_event_id) WHERE n.round_id=r.round_id) AS news,
    (SELECT jsonb_agg(jsonb_build_object('playerId',player_id,'request',request,'outcome',outcome,'sequence',committed_sequence,'atMs',processed_at_ms)) FROM orders WHERE round_id=r.round_id) AS orders,
    (SELECT jsonb_agg(jsonb_build_object('sequence',sequence,'playerId',player_id,'requestId',request_id,'fill',fill) ORDER BY sequence) FROM trades WHERE round_id=r.round_id) AS trades,
    (SELECT jsonb_agg(public_view ORDER BY end_sequence) FROM round_batches WHERE round_id=r.round_id) AS views,
    (SELECT state FROM round_projections WHERE round_id=r.round_id) AS projection,
    (SELECT sequence FROM round_projections WHERE round_id=r.round_id) AS projection_sequence
    FROM rounds r WHERE round_id=$1`,
    [roundId],
  );
  const row = result.rows[0];
  if (!row) return null;
  try {
    const round = frozenRoundSchema.parse(row.baseline);
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error("Invalid opening");
    let state = opened.state;
    const states = new Map<number, EngineState>([[state.sequence, state]]);
    const expectedTrades: unknown[] = [];
    let view = publicMarketView(state, opened.batch);
    const batches = row.batches as EngineBatch[];
    if (!isDeepStrictEqual(batches[0], opened.batch))
      throw new Error("Opening history disagrees");
    for (const [index, batch] of batches.entries()) {
      if (index) {
        const reduced = reduceEngineBatch(state, batch);
        if (!reduced.ok) throw new Error("Round history failed replay");
        state = reduced.state;
        states.set(state.sequence, state);
        view = publicMarketView(state, batch, view.quoteUpdatedAtMs);
      }
      // Older writers used opensAtMs when settlement followed a batch with no
      // public view. Validate that exact historical encoding in full, without
      // rewriting it or allowing any other public field/timestamp discrepancy.
      const legacySettlementView =
        batch.command.type === "SettleRound" &&
        index > 0 &&
        row.views[index - 1] === null
          ? { ...view, quoteUpdatedAtMs: round.opensAtMs }
          : null;
      if (
        row.views[index] !== null &&
        !isDeepStrictEqual(row.views[index], view) &&
        !isDeepStrictEqual(row.views[index], legacySettlementView)
      )
        throw new Error("Public view disagrees with history");
      if (batch.command.type === "SubmitOrder") {
        const owner = batch.command.order.playerId;
        for (const event of batch.events)
          if (event.type === "TradeExecuted")
            expectedTrades.push({
              sequence: event.sequence,
              playerId: owner,
              requestId: batch.command.order.requestId,
              fill: event.payload,
            });
      }
    }
    const replayed = { state };
    if (!isDeepStrictEqual(row.trades ?? [], expectedTrades))
      throw new Error("Trade records disagree with history");
    const orders = row.orders ?? [];
    const identities = new Set<string>();
    for (const record of orders) {
      const request = orderSubmitSchema.parse(record.request);
      const outcome = orderResultSchema.parse(record.outcome);
      const anchor = states.get(Number(record.sequence));
      if (!anchor || request.roundId !== roundId)
        throw new Error("Invalid order anchor");
      const receipt =
        anchor.receipts.find(
          (r) =>
            r.command.playerId === record.playerId &&
            r.command.requestId === request.requestId,
        ) ?? null;
      if (receipt) {
        const originalBatch = batches.find(
          (b) =>
            b.command.type === "SubmitOrder" &&
            b.command.order.playerId === record.playerId &&
            b.command.order.requestId === request.requestId,
        );
        if (
          !originalBatch ||
          originalBatch.command.atMs !== Number(record.atMs) ||
          originalBatch.events.at(-1)?.sequence !== Number(record.sequence) ||
          !isDeepStrictEqual(
            orderSubmitSchema.parse({
              roundId: receipt.command.roundId,
              requestId: receipt.command.requestId,
              symbol: receipt.command.symbol,
              side: receipt.command.side,
              quantity: receipt.command.quantity,
              protectionPriceCents: receipt.command.protectionPriceCents,
            }),
            request,
          )
        )
          throw new Error("Order identity disagrees with history");
      } else if (
        Number(record.atMs) < round.closesAtMs ||
        outcome.rejectionCode !== "MARKET_CLOSED"
      )
        throw new Error("Order has no committed receipt");
      if (
        !isDeepStrictEqual(
          outcome,
          orderOutcome(anchor, request, record.playerId, receipt),
        )
      )
        throw new Error("Order result disagrees with history");
      identities.add(`${record.playerId}:${request.requestId}`);
    }
    if (
      state.receipts.some(
        (r) => !identities.has(`${r.command.playerId}:${r.command.requestId}`),
      )
    )
      throw new Error("Missing durable order");
    // Stored textual causes preserve both UUID opening and scheduled logical identities.
    const facts = (row.batches as { events: unknown[] }[]).flatMap(
      (batch) => batch.events,
    );
    if (
      !isDeepStrictEqual(row.initialized, {
        roundId: round.roundId,
        sequence: 1,
        eventId: round.roundId,
        schemaVersion: 1,
        type: "RoundInitialized",
        payload: round,
        causeId: round.roundId,
        occurredAtMs: round.createdAtMs,
      }) ||
      !isDeepStrictEqual(row.events, facts)
    ) {
      throw new Error("Round event history disagrees with replay");
    }
    const scheduled = (row.batches as EngineBatch[]).filter(
      (batch) => batch.command.type === "ApplyScheduledEvent",
    );
    const newsRows: {
      item: unknown;
      input: unknown;
      sourceSequence: number;
    }[] = row.news ?? [];
    if (newsRows.length !== scheduled.length)
      throw new Error("Missing scheduled news");
    scheduled.forEach((batch, index) => {
      const newsRow = newsRows[index]!;
      const item = newsItemSchema.parse(newsRow.item);
      const expected = newsFromBatch(batch, item.sourceEventId);
      if (
        !isDeepStrictEqual(item, expected) ||
        Number(newsRow.sourceSequence) !== item.sequence ||
        !isDeepStrictEqual(newsRow.input, narrationInput(expected))
      )
        throw new Error("Scheduled news or job disagrees with history");
    });
    await verifyFinalResult(db, replayed.state);
    if (
      verifyProjection &&
      (!isDeepStrictEqual(engineStateSchema.parse(row.projection), state) ||
        Number(row.projection_sequence) !== state.sequence)
    )
      throw new Error("Round projection disagrees with replay");
    return replayed.state;
  } catch (error) {
    // PostgreSQL failures have a code; unavailable storage is not corrupt history.
    if (error instanceof Error && "code" in error) throw error;
    throw new RoundIntegrityError(
      roundId,
      error instanceof Error ? error.message : "Unverifiable history",
    );
  }
}
