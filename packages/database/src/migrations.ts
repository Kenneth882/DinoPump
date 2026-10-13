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
  {
    version: 4,
    sql: `
      -- Preserve UUID causes verbatim while supporting recorded schedule IDs.
      ALTER TABLE game_events ALTER COLUMN cause_id TYPE text USING cause_id::text;
      ALTER TABLE game_events ADD UNIQUE (round_id, event_id);
      CREATE TABLE news_items (
        source_event_id uuid PRIMARY KEY REFERENCES game_events(event_id),
        round_id uuid NOT NULL REFERENCES rounds(round_id),
        scheduled_event_id text NOT NULL,
        item jsonb NOT NULL,
        UNIQUE (round_id, scheduled_event_id),
        FOREIGN KEY (round_id,source_event_id) REFERENCES game_events(round_id,event_id),
        CHECK (item->>'sourceEventId' = source_event_id::text),
        CHECK (item->>'roundId' = round_id::text),
        CHECK (item->>'scheduledEventId' = scheduled_event_id)
      );
      CREATE TRIGGER immutable_news BEFORE UPDATE OR DELETE ON news_items
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();
      CREATE TABLE commentary_jobs (
        source_event_id uuid PRIMARY KEY REFERENCES news_items(source_event_id),
        input jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','completed','failed')),
        attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at_ms bigint NOT NULL CHECK (next_attempt_at_ms >= 0),
        lease_id uuid,
        lease_expires_at_ms bigint,
        CHECK ((lease_id IS NULL) = (lease_expires_at_ms IS NULL))
      );
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE round_batches ADD COLUMN public_view jsonb;
      CREATE TABLE orders (
        round_id uuid NOT NULL REFERENCES rounds(round_id),
        player_id uuid NOT NULL REFERENCES guest_sessions(player_id),
        request_id uuid NOT NULL,
        request jsonb NOT NULL,
        outcome jsonb NOT NULL,
        committed_sequence bigint NOT NULL,
        processed_at_ms bigint NOT NULL CHECK (processed_at_ms >= 0),
        PRIMARY KEY (round_id,player_id,request_id),
        FOREIGN KEY (round_id,committed_sequence) REFERENCES game_events(round_id,sequence),
        CHECK (request->>'roundId'=round_id::text),
        CHECK (request->>'requestId'=request_id::text),
        CHECK (outcome->>'roundId'=round_id::text),
        CHECK (outcome->>'requestId'=request_id::text),
        CHECK ((outcome->>'sequence')::bigint=committed_sequence)
      );
      CREATE TRIGGER immutable_order BEFORE UPDATE OR DELETE ON orders
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();
      CREATE TABLE trades (
        round_id uuid NOT NULL,
        sequence bigint NOT NULL,
        player_id uuid NOT NULL,
        request_id uuid NOT NULL,
        fill jsonb NOT NULL,
        PRIMARY KEY (round_id,sequence),
        FOREIGN KEY (round_id,sequence) REFERENCES game_events(round_id,sequence),
        FOREIGN KEY (round_id,player_id,request_id) REFERENCES orders(round_id,player_id,request_id)
      );
      CREATE TRIGGER immutable_trade BEFORE UPDATE OR DELETE ON trades
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE round_aborts (
        round_id uuid PRIMARY KEY REFERENCES rounds(round_id),
        public_view jsonb NOT NULL,
        CHECK (public_view->>'roundId'=round_id::text AND public_view->>'status'='ABORTED')
      );
      CREATE TRIGGER immutable_abort BEFORE UPDATE OR DELETE ON round_aborts
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();
      CREATE TABLE round_results (
        round_id uuid PRIMARY KEY REFERENCES rounds(round_id),
        settlement_sequence bigint NOT NULL,
        public_result jsonb NOT NULL,
        portfolios jsonb NOT NULL DEFAULT '{}',
        FOREIGN KEY (round_id,settlement_sequence) REFERENCES game_events(round_id,sequence),
        CHECK (public_result->>'roundId'=round_id::text),
        CHECK (public_result->>'status'='FINISHED' AND (public_result->>'settlementSequence')::bigint=settlement_sequence)
      );
      CREATE TRIGGER immutable_result BEFORE UPDATE OR DELETE ON round_results
        FOR EACH ROW EXECUTE FUNCTION reject_frozen_round_change();
      CREATE FUNCTION reject_terminal_conflict() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF (TG_TABLE_NAME='round_aborts' AND EXISTS(SELECT 1 FROM round_results WHERE round_id=NEW.round_id))
            OR (TG_TABLE_NAME='round_results' AND EXISTS(SELECT 1 FROM round_aborts WHERE round_id=NEW.round_id)) THEN
            RAISE EXCEPTION 'Round terminal outcome is immutable';
          END IF;
          RETURN NEW;
        END $$;
      CREATE TRIGGER terminal_abort_guard BEFORE INSERT ON round_aborts
        FOR EACH ROW EXECUTE FUNCTION reject_terminal_conflict();
      CREATE TRIGGER terminal_result_guard BEFORE INSERT ON round_results
        FOR EACH ROW EXECUTE FUNCTION reject_terminal_conflict();
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
