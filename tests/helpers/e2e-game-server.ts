import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { LobbyStore } from "../../packages/database/dist/index.js";
import { loadBaseline } from "../../packages/game-content/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";

// Test-owned clock only; production service entrypoint never imports this file.
const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
const clockPath = process.env.DINOPUMP_E2E_CLOCK;
if (
  !clockPath ||
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.port !== "55433" ||
  databaseUrl.pathname !== "/dinopump_test" ||
  !databaseUrl.searchParams.get("options")?.startsWith("-c search_path=e2e_")
)
  throw new Error("Expected an isolated E2E database and clock");
const pool = new Pool({ connectionString: databaseUrl.href });
const baseline = loadBaseline();
const clock = () => Date.now() + Number(readFileSync(clockPath, "utf8"));
const store = await LobbyStore.open(pool, clock, baseline.rules.room, baseline);
const server = createGameServer(baseline, {
  store,
  webOrigin: "http://127.0.0.1:3100",
  secureCookies: false,
});
server.listen(3101, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () =>
    server.close(() => {
      void store.close().then(() => pool.end());
    }),
  );
