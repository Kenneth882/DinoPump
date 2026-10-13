import { RoundIntegrityError } from "./results.js";
import type { PoolClient } from "pg";
import { processEngineCommand } from "@dinopump/engine";
import type { EngineState } from "@dinopump/contracts";
import { persistEngineBatch } from "./opened-round.js";
import { newsFromBatch, narrationInput } from "./news.js";

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
    await client.query(
      "INSERT INTO commentary_jobs(source_event_id,input,next_attempt_at_ms) VALUES ($1,$2,$3)",
      [news.sourceEventId, narrationInput(news), now],
    );
    state = result.state;
  }
  return state;
}
