import { Pool } from "pg";
import { loadBaseline } from "@dinopump/game-content";
import { LobbyStore, databaseConnection } from "@dinopump/database";
import { createGameServer } from "./server.js";

const port = Number(process.env.PORT ?? process.env.GAME_SERVER_PORT ?? 3001);
const host = process.env.GAME_SERVER_HOST ?? "127.0.0.1";
if (!["127.0.0.1", "0.0.0.0"].includes(host))
  throw new Error("GAME_SERVER_HOST must be 127.0.0.1 or 0.0.0.0");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("GAME_SERVER_PORT must be an integer between 1 and 65535");
const webOrigin = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3000";
const secureCookies = process.env.NODE_ENV === "production";
const url = new URL(webOrigin);
if (
  url.origin !== webOrigin ||
  (secureCookies
    ? url.protocol !== "https:"
    : !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
) {
  throw new Error(
    "WEB_ORIGIN must be an exact HTTPS production origin or a loopback development origin",
  );
}
const pool = process.env.DATABASE_URL
  ? new Pool(databaseConnection())
  : undefined;
let deployment:
  | { id: string; purpose: string; sourceCommit: string; webOrigin: string }
  | undefined;
if (process.env.DINOPUMP_DEPLOYMENT_ID) {
  const id = process.env.DINOPUMP_DEPLOYMENT_ID;
  const sourceCommit =
    process.env.RENDER_GIT_COMMIT ?? process.env.SOURCE_COMMIT ?? "";
  if (
    !/^[a-f0-9]{32}$/.test(id) ||
    !/^[a-f0-9]{40}$/.test(sourceCommit) ||
    !pool
  )
    throw new Error("Invalid staging deployment identity");
  try {
    const marker = await pool.query(
      "SELECT id, purpose FROM deployment_identity",
    );
    if (
      marker.rows.length !== 1 ||
      marker.rows[0].id !== id ||
      marker.rows[0].purpose !== "synthetic-staging"
    )
      throw new Error("Mismatch");
  } catch {
    await pool.end();
    throw new Error("Staging database identity verification failed");
  }
  deployment = { id, purpose: "synthetic-staging", sourceCommit, webOrigin };
}
const baseline = loadBaseline();
const store = pool
  ? await LobbyStore.open(pool, Date.now, baseline.rules.room, baseline).catch(
      async () => {
        // Database connection failures must not print URLs, credentials or driver errors.
        console.error(JSON.stringify({ event: "service.start_failed" }));
        await pool.end();
        process.exit(1);
      },
    )
  : undefined;
const server = createGameServer(
  baseline,
  store ? { store, webOrigin, secureCookies } : undefined,
  deployment,
);
server.listen(port, host, () =>
  console.info(JSON.stringify({ event: "service.listening", host, port })),
);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () =>
    server.close(() => {
      void (async () => {
        await store?.close();
        await pool?.end();
      })();
    }),
  );
}
