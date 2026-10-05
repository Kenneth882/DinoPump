import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  frozenRoundSchema,
  engineStateSchema,
  type EngineState,
} from "@dinopump/contracts";
import { startEngineRound, replayEngine } from "@dinopump/engine";
import { insertRoundBaseline } from "./rounds.js";

/** Called only inside the owned room transaction. Returns no public payload. */
export async function persistRoundOpening(
  client: PoolClient,
  initialization: unknown,
) {
  const round = await insertRoundBaseline(client, initialization);
  const opened = startEngineRound(round);
  if (!opened.ok) throw new Error("Invalid round opening");
  for (const event of opened.batch.events) {
    await client.query(
      `INSERT INTO game_events (round_id,sequence,event_id,schema_version,type,payload,cause_id,occurred_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        event.roundId,
        event.sequence,
        randomUUID(),
        event.schemaVersion,
        event.type,
        event.payload,
        round.roundId,
        event.occurredAtMs,
      ],
    );
  }
  await client.query("INSERT INTO round_batches VALUES ($1,$2,$3)", [
    round.roundId,
    opened.state.sequence,
    opened.batch,
  ]);
  await client.query(
    "UPDATE round_projections SET sequence=$2,state=$3 WHERE round_id=$1",
    [round.roundId, opened.state.sequence, opened.state],
  );
  return opened.state;
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
  // Opening facts have UUID logical causes. Later adapters must map other causes explicitly.
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
  return replayed.state;
}
