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
  {
    version: 2,
    sql: `
      CREATE TABLE guest_sessions (
        player_id uuid PRIMARY KEY,
        display_name text NOT NULL,
        normalized_name text NOT NULL,
        avatar text NOT NULL,
        secret_hash text NOT NULL UNIQUE,
        expires_at_ms bigint NOT NULL
      );
      CREATE TABLE rooms (
        code text PRIMARY KEY,
        host_id uuid NOT NULL REFERENCES guest_sessions(player_id),
        status text NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY','COUNTDOWN','OPEN','SETTLING','FINISHED','ABORTED','EXPIRED')),
        current_round_id uuid REFERENCES rounds(round_id),
        sequence integer NOT NULL DEFAULT 1,
        host_transfer_at bigint,
        expires_at bigint
      );
      CREATE UNIQUE INDEX one_active_room ON rooms ((true)) WHERE status <> 'EXPIRED';
      CREATE TABLE room_members (
        code text NOT NULL REFERENCES rooms(code),
        player_id uuid NOT NULL REFERENCES guest_sessions(player_id),
        normalized_name text NOT NULL,
        join_order integer NOT NULL CHECK (join_order BETWEEN 0 AND 7),
        connected_at bigint,
        PRIMARY KEY (code, player_id),
        UNIQUE (code, normalized_name),
        UNIQUE (code, join_order)
      );
      CREATE TABLE room_lifecycle (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        code text NOT NULL REFERENCES rooms(code),
        type text NOT NULL,
        player_id uuid REFERENCES guest_sessions(player_id),
        occurred_at_ms bigint NOT NULL
      );
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE room_members ADD COLUMN ready boolean NOT NULL DEFAULT false;
      CREATE TABLE room_countdowns (
        code text PRIMARY KEY REFERENCES rooms(code),
        initialization jsonb NOT NULL
      );
      CREATE TABLE round_batches (
        round_id uuid NOT NULL REFERENCES rounds(round_id),
        end_sequence bigint NOT NULL,
        batch jsonb NOT NULL,
        PRIMARY KEY (round_id, end_sequence),
        FOREIGN KEY (round_id, end_sequence) REFERENCES game_events(round_id, sequence)
      );
      CREATE TRIGGER immutable_batch BEFORE UPDATE OR DELETE ON round_batches
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();
      CREATE TABLE room_commands (
        code text NOT NULL REFERENCES rooms(code),
        player_id uuid NOT NULL REFERENCES guest_sessions(player_id),
        request_id uuid NOT NULL,
        command jsonb NOT NULL,
        outcome jsonb NOT NULL,
        PRIMARY KEY (code, player_id, request_id)
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
