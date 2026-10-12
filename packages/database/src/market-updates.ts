import { publicMarketView } from "./market-view.js";
import type { PoolClient } from "pg";
import {
  engineBatchSchema,
  marketBatchSchema,
  newsItemSchema,
  type EngineState,
} from "@dinopump/contracts";
import { startEngineRound, reduceEngineBatch } from "@dinopump/engine";

/** The caller has already verified history and authorized the snapshot owner. */
export async function readMarketUpdates(
  client: PoolClient,
  verified: EngineState,
  afterSequence: number,
  serverTime: number,
) {
  const rows = await client.query(
    "SELECT batch FROM round_batches WHERE round_id=$1 ORDER BY end_sequence",
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
  for (const row of rows.rows.slice(1)) {
    const batch = engineBatchSchema.parse(row.batch);
    const reduced = reduceEngineBatch(state, batch);
    if (!reduced.ok) throw new Error("Invalid market batch");
    state = reduced.state;
    if (state.sequence <= afterSequence) continue;
    const startSequence = batch.events[0]!.sequence;
    updates.push(
      marketBatchSchema.parse({
        roundId: state.round.roundId,
        startSequence,
        endSequence: state.sequence,
        serverTime,
        ...publicMarketView(state),
        news: news.filter(
          (item) =>
            item.sequence >= startSequence && item.sequence <= state.sequence,
        ),
      }),
    );
  }
  return updates;
}
