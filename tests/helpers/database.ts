import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export async function isolatedDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("Run pnpm db:verify");
  const target = new URL(connectionString);
  if (
    target.hostname !== "127.0.0.1" ||
    target.port !== "55433" ||
    target.pathname !== "/dinopump_test"
  ) {
    throw new Error("Refusing to test outside the isolated synthetic database");
  }
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
