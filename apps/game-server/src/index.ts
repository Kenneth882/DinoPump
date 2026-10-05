import { Pool } from "pg";
import { loadBaseline } from "@dinopump/game-content";
import { LobbyStore } from "@dinopump/database";
import { createGameServer } from "./server.js";

const port = Number(process.env.GAME_SERVER_PORT ?? 3001);
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
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    })
  : undefined;
const baseline = loadBaseline();
const store = pool
  ? await LobbyStore.open(pool, Date.now, baseline.rules.room, baseline)
  : undefined;
const server = createGameServer(
  baseline,
  store ? { store, webOrigin, secureCookies } : undefined,
);
server.listen(port, "127.0.0.1", () =>
  console.info(`DinoPump service listening on http://127.0.0.1:${port}`),
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
