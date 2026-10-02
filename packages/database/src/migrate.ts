import { Pool } from "pg";
import { migrate } from "./migrations.js";

if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL in the root .env before migrating");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
});
try {
  const applied = await migrate(pool);
  console.info(
    applied.length
      ? `Applied migrations: ${applied.join(", ")}`
      : "Database migrations are current",
  );
} finally {
  await pool.end();
}
