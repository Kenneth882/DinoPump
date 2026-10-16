import { RoundIntegrityError } from "./results.js";
import type { PoolClient } from "pg";
import { processEngineCommand } from "@dinopump/engine";
import type { EngineState } from "@dinopump/contracts";
import { persistEngineBatch } from "./opened-round.js";
import {
  newsFromBatch,
  narrationFromActivity,
  type NarrationActivity,
} from "./news.js";

/** Drain due effects inside the caller's owned transaction, before market commands. */
export async function applyDueEvents(
  client: PoolClient,
  initial: EngineState,
  now: number,
) {
  let state = initial;
  while (state.trading.status === "OPEN") {
    const next = state.round.schedule[state.nextScheduledEvent];
    if (!next || next.dueAtMs > now || next.dueAtMs >= state.round.closesAtMs)
      break;
    const result = processEngineCommand(state, {
      type: "ApplyScheduledEvent",
      atMs: now,
      scheduledEventId: next.scheduledEventId,
    });
    if (!result.ok || !result.batch)
      throw new RoundIntegrityError(
        state.round.roundId,
        "Due event could not be applied",
      );
    const ids = await persistEngineBatch(client, result.state, result.batch);
    const source = result.batch.events[0]!;
    const news = newsFromBatch(result.batch, ids.get(source.sequence)!);
    await client.query(
      "INSERT INTO news_items(source_event_id,round_id,scheduled_event_id,item) VALUES ($1,$2,$3,$4)",
      [news.sourceEventId, news.roundId, news.scheduledEventId, news],
    );
    // Read the current activity window plus one earlier execution per affected
    // asset, preserving last price without loading every historical batch.
    const prior = (
      await client.query<{ occurred_at_ms: string; end_sequence: string }>(
        `SELECT e.occurred_at_ms,
          (SELECT min(end_sequence) FROM round_batches
            WHERE round_id=$1 AND end_sequence>=e.sequence) AS end_sequence
        FROM news_items n JOIN game_events e ON e.event_id=n.source_event_id
        WHERE n.round_id=$1 AND e.sequence<$2
        ORDER BY e.sequence DESC LIMIT 1`,
        [news.roundId, news.sequence],
      )
    ).rows[0];
    const previous = prior && {
      sequence: Number(prior.end_sequence),
      atMs: Number(prior.occurred_at_ms),
    };
    const trades = (
      await client.query<{
        sequence: string;
        fill: NarrationActivity["trades"][number]["payload"];
      }>(
        `SELECT sequence,fill FROM trades
          WHERE round_id=$1 AND sequence>$2 AND sequence<$3
        UNION ALL
        SELECT earlier.sequence,earlier.fill
        FROM unnest($4::text[]) AS symbol(value)
        CROSS JOIN LATERAL (
          SELECT sequence,fill FROM trades
          WHERE round_id=$1 AND sequence<=$2 AND fill->>'symbol'=symbol.value
          ORDER BY sequence DESC LIMIT 1
        ) earlier
        ORDER BY sequence`,
        [
          news.roundId,
          previous?.sequence ?? 0,
          news.sequence,
          news.effects.map((effect) => effect.symbol),
        ],
      )
    ).rows.map((row) => ({
      sequence: Number(row.sequence),
      payload: row.fill,
    }));
    await client.query(
      "INSERT INTO commentary_jobs(source_event_id,input,next_attempt_at_ms) VALUES ($1,$2,$3)",
      [
        news.sourceEventId,
        narrationFromActivity(news, state.round, { previous, trades }),
        now,
      ],
    );
    state = result.state;
  }
  return state;
}
