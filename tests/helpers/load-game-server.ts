import { Pool } from "pg";
import { LobbyStore } from "../../packages/database/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";

// Dedicated synthetic schema, real wall clock, no .env or provider configuration.
const target = new URL(process.env.TEST_DATABASE_URL ?? "");
const schema = process.env.DINOPUMP_LOAD_SCHEMA ?? "";
if (
  target.hostname !== "127.0.0.1" ||
  target.port !== (process.env.DINOPUMP_TEST_PORT ?? "55433") ||
  target.pathname !== "/dinopump_test" ||
  !/^test_[a-f0-9]{32}$/.test(schema)
)
  throw new Error("Expected the isolated load database");
const pool = new Pool({
  connectionString: target.href,
  options: `-c search_path=${schema}`,
});
const store = await LobbyStore.open(pool);
const server = createGameServer(undefined, {
  store,
  webOrigin: "http://127.0.0.1:3000",
  secureCookies: false,
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string")
    process.send?.({ port: address.port });
});
process.once("SIGTERM", () =>
  server.close(() => {
    void store
      .close()
      .then(() => pool.end())
      .then(() => process.disconnect());
  }),
);
