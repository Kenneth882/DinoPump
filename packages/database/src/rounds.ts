import type { Pool } from "pg";
import {
  frozenRoundSchema,
  roundInitializationSchema,
  roundRecoverySchema,
  type FrozenRound,
} from "@dinopump/contracts";
import { buildRoundBaseline } from "@dinopump/game-content";

export class RoundInitializationConflict extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
  constructor() {
    super("Round ID already has a different initialization");
  }
}

/** Internal server API. Never expose a frozen schedule or private resources publicly. */
export async function createRoundBaseline(
  pool: Pool,
  value: unknown,
): Promise<FrozenRound> {
  const input = roundInitializationSchema.parse(value);
  const baseline = buildRoundBaseline(input);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      "INSERT INTO rounds (round_id, initialization, baseline) VALUES ($1, $2, $3) ON CONFLICT (round_id) DO NOTHING RETURNING round_id",
      [input.roundId, input, baseline],
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<{
        baseline: unknown;
        matches: boolean;
      }>(
        "SELECT baseline, initialization = $2::jsonb AS matches FROM rounds WHERE round_id = $1",
        [input.roundId, input],
      );
      const row = existing.rows[0];
      if (!row?.matches) throw new RoundInitializationConflict();
      const original = frozenRoundSchema.parse(row.baseline);
      await client.query("COMMIT");
      return original;
    }
    await client.query(
      `INSERT INTO game_events
      (round_id, sequence, event_id, schema_version, type, payload, cause_id, occurred_at_ms)
      VALUES ($1, 1, $1, 1, 'RoundInitialized', $2, $1, $3)`,
      [input.roundId, baseline, input.createdAtMs],
    );
    await client.query(
      "INSERT INTO round_projections (round_id, sequence, schema_version, state) VALUES ($1, 1, 1, $2)",
      [input.roundId, baseline.initialState],
    );
    await client.query("COMMIT");
    return baseline;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function readRoundBaseline(
  pool: Pool,
  roundId: string,
): Promise<FrozenRound | null> {
  roundInitializationSchema.shape.roundId.parse(roundId);
  const result = await pool.query<{ baseline: unknown }>(
    "SELECT baseline FROM rounds WHERE round_id = $1",
    [roundId],
  );
  const row = result.rows[0];
  return row ? frozenRoundSchema.parse(row.baseline) : null;
}

/** Baseline recovery only. Later market slices extend the event/projection contracts. */
export async function readRoundRecovery(pool: Pool, roundId: string) {
  roundInitializationSchema.shape.roundId.parse(roundId);
  // One statement takes one MVCC snapshot, including the event stream and projection.
  const result = await pool.query<{ events: unknown; projection: unknown }>(
    `
    SELECT
      (SELECT jsonb_agg(jsonb_build_object(
        'roundId', e.round_id, 'sequence', e.sequence, 'eventId', e.event_id,
        'schemaVersion', e.schema_version, 'type', e.type, 'payload', e.payload,
        'causeId', e.cause_id, 'occurredAtMs', e.occurred_at_ms
      ) ORDER BY e.sequence) FROM game_events e WHERE e.round_id = r.round_id) AS events,
      (SELECT jsonb_build_object('roundId', p.round_id, 'sequence', p.sequence,
        'schemaVersion', p.schema_version, 'state', p.state)
        FROM round_projections p WHERE p.round_id = r.round_id) AS projection
    FROM rounds r WHERE r.round_id = $1`,
    [roundId],
  );
  const row = result.rows[0];
  return row ? roundRecoverySchema.parse(row) : null;
}
