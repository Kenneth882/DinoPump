import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  commentaryResultSchema,
  narrationInputSchema,
  newsItemSchema,
} from "@dinopump/contracts";

/** Worker access goes through fenced, database-enforced functions only. */
export async function claimCommentary(pool: Pool, now: number) {
  const result = await pool.query("SELECT claim_commentary($1,$2) AS job", [
    now,
    randomUUID(),
  ]);
  const job = result.rows[0]?.job;
  if (!job) return null;
  return {
    sourceEventId: job.sourceEventId as string,
    leaseId: job.leaseId as string,
    input: narrationInputSchema.safeParse(job.input),
    attempts: job.attempts as number,
  };
}
export async function finishCommentary(
  pool: Pool,
  job: { sourceEventId: string; leaseId: string },
  result: unknown,
  now: number,
) {
  const parsed = commentaryResultSchema.parse(result);
  const response = await pool.query(
    "SELECT finish_commentary($1,$2,$3,$4) AS saved",
    [job.sourceEventId, job.leaseId, parsed, now],
  );
  return response.rows[0]?.saved === true;
}

/** The room owner publishes durable worker output without touching engine history. */
export async function publishCommentary(client: PoolClient) {
  const rows =
    await client.query(`SELECT j.source_event_id,j.output,j.input,n.item FROM commentary_jobs j JOIN news_items n USING(source_event_id)
    WHERE j.status IN ('completed','failed') AND j.output IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commentary_publications p WHERE p.source_event_id=j.source_event_id) ORDER BY n.round_id,(n.item->>'sequence')::bigint`);
  let publishedCount = 0;
  for (const row of rows.rows) {
    const result = commentaryResultSchema.safeParse(row.output);
    if (!result.success) continue;
    const item = newsItemSchema.parse(row.item);
    const input = narrationInputSchema.safeParse(row.input);
    const published = newsItemSchema.parse({
      ...item,
      narrationStatus:
        result.data.status === "accepted" && input.success
          ? "published"
          : "fallback",
      narrationProvenance: result.data.provenance,
      ...(result.data.status === "accepted" && input.success
        ? {
            narration: {
              headline: result.data.headline,
              commentary: result.data.commentary,
              capturedAtMs: input.data.context.capturedAtMs,
              elapsedMs: input.data.context.elapsedMs,
            },
          }
        : {}),
    });
    await client.query(
      "INSERT INTO commentary_publications(source_event_id,item) VALUES ($1,$2)",
      [item.sourceEventId, published],
    );
    await client.query(
      "UPDATE rooms SET sequence=sequence+1 WHERE current_round_id=$1",
      [item.roundId],
    );
    publishedCount++;
  }
  return publishedCount;
}
