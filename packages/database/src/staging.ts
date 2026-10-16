import type { Pool } from "pg";
import { migrate } from "./migrations.js";

type StagingSetup = {
  id: string;
  schema: string;
  gameRole: string;
  auditRole: string;
  gamePassword: string;
  auditPassword: string;
};

/** Explicit operator-only setup of a NEW synthetic schema; never resets data. */
export async function prepareStaging(pool: Pool, setup: StagingSetup) {
  const { id, schema, gameRole, auditRole } = setup;
  if (
    !/^[a-f0-9]{32}$/.test(id) ||
    schema !== `staging_${id}` ||
    gameRole !== `game_${id}` ||
    auditRole !== `audit_${id}` ||
    !setup.gamePassword ||
    !setup.auditPassword
  )
    throw new Error(
      "Expected a unique staging identity and separate passwords",
    );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // No IF NOT EXISTS: selecting used identities must fail without mutation.
    await client.query(`CREATE SCHEMA ${schema}`);
    for (const [role, password] of [
      [gameRole, setup.gamePassword],
      [auditRole, setup.auditPassword],
    ]) {
      const quoted = (
        await client.query("SELECT quote_literal($1) AS value", [password])
      ).rows[0].value as string;
      await client.query(
        `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${quoted}`,
      );
      await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  // Migrations own their transaction. Pin their search_path on every checkout
  // by using the same pool configuration supplied by the operator.
  const current = (await pool.query("SELECT current_schema() AS name")).rows[0]
    .name;
  if (current !== schema)
    throw new Error("Operator pool must select the new staging schema");
  await migrate(pool);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${gameRole}`,
  );
  await pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${gameRole}`,
  );
  await pool.query(
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC`,
  );
  // Identity is read-only even for the game login and is not part of gameplay.
  await pool.query(
    "CREATE TABLE deployment_identity (id text PRIMARY KEY, purpose text NOT NULL CHECK (purpose = 'synthetic-staging'))",
  );
  await pool.query(
    "INSERT INTO deployment_identity VALUES ($1, 'synthetic-staging')",
    [id],
  );
  await pool.query(`GRANT SELECT ON deployment_identity TO ${gameRole}`);
  await pool.query(
    `GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${auditRole}`,
  );
}
