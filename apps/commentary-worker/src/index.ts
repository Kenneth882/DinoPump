import { Pool } from "pg";
import { CommentaryWorker } from "./worker.js";
import { configuredNarrator } from "./openai.js";
import { createWorkerServer } from "./server.js";

// Core gameplay never imports this entry point or waits for this process.
const connectionString = process.env.COMMENTARY_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set COMMENTARY_DATABASE_URL to the restricted worker login; see docs/commentary.md",
  );
const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: 5000,
  statement_timeout: 5000,
  max: 2,
});
try {
  const access =
    await pool.query(`SELECT pg_has_role(current_user,'dinopump_commentary','MEMBER') AS member,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS excessive`);
  if (!access.rows[0]?.member || access.rows[0]?.excessive)
    throw new Error("Expected restricted worker role");
} catch {
  await pool.end();
  throw new Error(
    "Worker database access check failed; see docs/commentary.md",
  );
}
const narrator = configuredNarrator(process.env);
const worker = new CommentaryWorker(pool, narrator);
pool.on("error", () => {
  worker.operations.gauge("ready", 0);
  worker.operations.count("database_failures");
  worker.operations.log("storage.unavailable");
});
const port = Number(process.env.COMMENTARY_HEALTH_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error(
    "COMMENTARY_HEALTH_PORT must be an integer between 1 and 65535",
  );
const server = createWorkerServer(worker.operations);
server.listen(port, "127.0.0.1");
let stopped = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopped = true;
    wake?.();
  });
console.info(
  JSON.stringify({
    event: "commentary.started",
    provider: narrator?.provider ?? "disabled",
  }),
);
try {
  while (!stopped) {
    try {
      if (await worker.processOne()) continue;
    } catch {
      /* processOne records bounded, credential-free storage telemetry. */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}
