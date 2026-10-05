import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "../packages/database/dist/index.js";

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited unsuccessfully`);
}
const nextEnvPath = new URL("../apps/web/next-env.d.ts", import.meta.url);
const nextEnv = await readFile(nextEnvPath);
const compose = ["compose", "-f", "compose.test.yaml"];
const connectionString =
  "postgresql://dinopump_test:synthetic_test_only@127.0.0.1:55433/dinopump_test";
const schema = `e2e_${randomUUID().replaceAll("-", "")}`;
try {
  run("docker", [...compose, "up", "-d", "--wait"]);
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }
  const url = new URL(connectionString);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const pool = new Pool({ connectionString: url.href });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
  run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
    ...process.env,
    DATABASE_URL: url.href,
    WEB_ORIGIN: "http://127.0.0.1:3100",
  });
} finally {
  await writeFile(nextEnvPath, nextEnv);
  run("docker", [...compose, "down"]);
}
