import { publicMarketView, readQuoteUpdatedAtMs } from "./market-view.js";
import type { PoolClient } from "pg";
import {
  engineBatchSchema,
  marketBatchSchema,
  newsItemSchema,
  type EngineState,
} from "@dinopump/contracts";
import { startEngineRound, reduceEngineBatch } from "@dinopump/engine";

function tradePricePoints(batch: import("@dinopump/contracts").EngineBatch) {
  return batch.events.flatMap((event) =>
    event.type === "TradeExecuted"
      ? [
          {
            sequence: event.sequence,
            atMs: event.occurredAtMs,
            symbol: event.payload.symbol,
            priceCents: event.payload.priceCents,
          },
        ]
      : [],
  );
}

/** The caller has already verified history and authorized the snapshot owner. */
export async function readMarketUpdates(
  client: PoolClient,
  verified: EngineState,
  afterSequence: number,
  serverTime: number,
) {
  const current = await client.query(
    "SELECT batch,public_view FROM round_batches WHERE round_id=$1 AND end_sequence>$2 ORDER BY end_sequence",
    [verified.round.roundId, afterSequence],
  );
  if (current.rows.every((row) => row.public_view)) {
    const news = (
      await client.query(
        "SELECT item FROM news_items WHERE round_id=$1 AND (item->>'sequence')::bigint>$2",
        [verified.round.roundId, afterSequence],
      )
    ).rows.map((row) => newsItemSchema.parse(row.item));
    const quoteUpdatedAtMs = current.rows.some(
      (row) => row.batch.command.type === "SettleRound",
    )
      ? await readQuoteUpdatedAtMs(client, verified)
      : undefined;
    return current.rows.map((row) => {
      const batch = engineBatchSchema.parse(row.batch);
      const startSequence = batch.events[0]!.sequence;
      const endSequence = batch.events.at(-1)!.sequence;
      return marketBatchSchema.parse({
        roundId: verified.round.roundId,
        startSequence,
        endSequence,
        serverTime,
        ...row.public_view,
        priceHistory: tradePricePoints(batch),
        ...(batch.command.type === "SettleRound" ? { quoteUpdatedAtMs } : {}),
        news: news.filter(
          (item) =>
            item.sequence >= startSequence && item.sequence <= endSequence,
        ),
      });
    });
  }
  // Pre-migration histories have no materialized public view; reconstruct on recovery.
  const rows = await client.query(
    "SELECT batch,public_view FROM round_batches WHERE round_id=$1 ORDER BY end_sequence",
    [verified.round.roundId],
  );
  const news = (
    await client.query("SELECT item FROM news_items WHERE round_id=$1", [
      verified.round.roundId,
    ])
  ).rows.map((row) => newsItemSchema.parse(row.item));
  const opening = startEngineRound(verified.round);
  if (!opening.ok) throw new Error("Invalid opening");
  let state = opening.state;
  const updates = [];
  let view = publicMarketView(state, opening.batch);
  for (const row of rows.rows.slice(1)) {
    const batch = engineBatchSchema.parse(row.batch);
    const reduced = reduceEngineBatch(state, batch);
    if (!reduced.ok) throw new Error("Invalid market batch");
    state = reduced.state;
    view = publicMarketView(state, batch, view.quoteUpdatedAtMs);
    if (state.sequence <= afterSequence) continue;
    const startSequence = batch.events[0]!.sequence;
    updates.push(
      marketBatchSchema.parse({
        roundId: state.round.roundId,
        startSequence,
        endSequence: state.sequence,
        serverTime,
        ...view,
        priceHistory: tradePricePoints(batch),
        news: news.filter(
          (item) =>
            item.sequence >= startSequence && item.sequence <= state.sequence,
        ),
      }),
    );
  }
  return updates;
}
