import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  frozenRoundSchema,
  engineStateSchema,
  type EngineState,
  type EngineBatch,
  newsItemSchema,
} from "@dinopump/contracts";
import { startEngineRound, replayEngine } from "@dinopump/engine";
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
  await client.query("INSERT INTO round_batches VALUES ($1,$2,$3)", [
    state.round.roundId,
    state.sequence,
    batch,
  ]);
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
  frozenRoundSchema.shape.roundId.parse(roundId);
  const result = await db.query(
    `SELECT baseline,
    (SELECT jsonb_agg(batch ORDER BY end_sequence) FROM round_batches WHERE round_id=r.round_id) AS batches,
    (SELECT jsonb_agg(jsonb_build_object('schemaVersion',schema_version,'roundId',round_id,'sequence',sequence,'type',type,'payload',payload,'causeId',cause_id::text,'occurredAtMs',occurred_at_ms) ORDER BY sequence) FROM game_events WHERE round_id=r.round_id AND sequence>1) AS events,
    (SELECT payload FROM game_events WHERE round_id=r.round_id AND sequence=1 AND type='RoundInitialized') AS initialized,
    (SELECT jsonb_agg(jsonb_build_object('item',n.item,'input',j.input,'sourceSequence',e.sequence) ORDER BY e.sequence)
      FROM news_items n JOIN game_events e ON e.event_id=n.source_event_id
      LEFT JOIN commentary_jobs j USING(source_event_id) WHERE n.round_id=r.round_id) AS news,
    (SELECT state FROM round_projections WHERE round_id=r.round_id) AS projection,
    (SELECT sequence FROM round_projections WHERE round_id=r.round_id) AS projection_sequence
    FROM rounds r WHERE round_id=$1`,
    [roundId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const round = frozenRoundSchema.parse(row.baseline);
  const replayed = replayEngine(round, row.batches);
  if (!replayed.ok) throw new Error("Round history failed replay");
  const projection = engineStateSchema.parse(row.projection);
  // Stored textual causes preserve both UUID opening and scheduled logical identities.
  const facts = (row.batches as { events: unknown[] }[]).flatMap(
    (batch) => batch.events,
  );
  if (
    !isDeepStrictEqual(row.initialized, round) ||
    !isDeepStrictEqual(row.events, facts) ||
    !isDeepStrictEqual(projection, replayed.state) ||
    Number(row.projection_sequence) !== replayed.state.sequence
  ) {
    throw new Error("Round projection or event history disagrees with replay");
  }
  const scheduled = (row.batches as EngineBatch[]).filter(
    (batch) => batch.command.type === "ApplyScheduledEvent",
  );
  const newsRows: { item: unknown; input: unknown; sourceSequence: number }[] =
    row.news ?? [];
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
  return replayed.state;
}
