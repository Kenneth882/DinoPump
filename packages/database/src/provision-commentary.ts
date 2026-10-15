import { Pool } from "pg";

// Explicit operator command. Passwords stay in memory and never appear in output.
const target = process.env.COMMENTARY_DATABASE_URL;
const owner = process.env.DATABASE_URL;
if (!owner || !target)
  throw new Error("Set DATABASE_URL and COMMENTARY_DATABASE_URL");
const worker = new URL(target);
const admin = new URL(owner);
if (
  worker.host !== admin.host ||
  worker.pathname !== admin.pathname ||
  worker.username === admin.username ||
  !worker.password
)
  throw new Error("Worker must use a separate login on the same database");
const pool = new Pool({ connectionString: owner });
try {
  const name = decodeURIComponent(worker.username);
  const password = decodeURIComponent(worker.password);
  const quoting = (
    await pool.query(
      "SELECT quote_ident($1) AS name,quote_literal($2) AS password",
      [name, password],
    )
  ).rows[0];
  const existing = await pool.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
    name,
  ]);
  if (!existing.rowCount)
    await pool.query(
      `CREATE ROLE ${quoting.name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${quoting.password}`,
    );
  await pool.query(`GRANT dinopump_commentary TO ${quoting.name}`);
  console.info("Restricted commentary login provisioned");
} catch {
  throw new Error(
    "Commentary role provisioning failed; check the migration and operator privileges",
  );
} finally {
  await pool.end();
}
