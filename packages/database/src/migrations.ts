import type { Pool } from "pg";

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE rounds (
        round_id uuid PRIMARY KEY,
        initialization jsonb NOT NULL,
        baseline jsonb NOT NULL,
        CHECK (baseline->>'roundId' = round_id::text)
      );
      CREATE FUNCTION reject_frozen_round_change() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          RAISE EXCEPTION 'Round baseline is immutable';
        END $$;
      CREATE TRIGGER frozen_round BEFORE UPDATE OR DELETE ON rounds
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();

      CREATE TABLE game_events (
        round_id uuid NOT NULL REFERENCES rounds(round_id),
        sequence bigint NOT NULL CHECK (sequence > 0),
        event_id uuid NOT NULL UNIQUE,
        schema_version integer NOT NULL CHECK (schema_version > 0),
        type text NOT NULL,
        payload jsonb NOT NULL,
        cause_id uuid NOT NULL,
        occurred_at_ms bigint NOT NULL CHECK (occurred_at_ms >= 0),
        PRIMARY KEY (round_id, sequence)
      );
      CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON game_events
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();

      CREATE TABLE round_projections (
        round_id uuid PRIMARY KEY REFERENCES rounds(round_id),
        sequence bigint NOT NULL,
        schema_version integer NOT NULL CHECK (schema_version > 0),
        state jsonb NOT NULL,
        FOREIGN KEY (round_id, sequence) REFERENCES game_events(round_id, sequence)
      );
    `,
  },
];

/** Apply ordered migrations atomically; serialize concurrent migration runners. */
export async function migrate(pool: Pool): Promise<number[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(18473, 1)");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = await client.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    const versions = existing.rows.map((row) => row.version);
    if (
      versions.some((version, index) => version !== migrations[index]?.version)
    ) {
      throw new Error("Unsupported database migration history");
    }
    const applied: number[] = [];
    for (const migration of migrations.slice(versions.length)) {
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [migration.version],
      );
      applied.push(migration.version);
    }
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
