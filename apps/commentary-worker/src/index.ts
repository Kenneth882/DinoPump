import { Pool } from "pg";
import { CommentaryWorker } from "./worker.js";
import { configuredNarrator } from "./openai.js";

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
      console.error(
        JSON.stringify({ event: "commentary.storage_unavailable" }),
      );
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
  await pool.end();
}
