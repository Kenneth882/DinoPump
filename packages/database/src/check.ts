import { Client } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Set DATABASE_URL in the root .env before checking the database",
  );
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
});

try {
  await client.connect();
  await client.query("SELECT 1");
  console.info("PostgreSQL connection verified");
} finally {
  await client.end();
}
