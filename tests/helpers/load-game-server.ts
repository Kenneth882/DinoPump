import { Pool } from "pg";
import { LobbyStore, Operations } from "../../packages/database/dist/index.js";
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
// Numeric query classes only: never retain SQL, parameters or credentials.
const operations = new Operations();
pool.on("connect", (client) => {
  const query = client.query;
  client.query = new Proxy(query, {
    apply(target, receiver, args: unknown[]) {
      const sql = typeof args[0] === "string" ? args[0].trimStart() : "";
      const name = /^SELECT/i.test(sql)
        ? "db_read_ms"
        : /^(INSERT|UPDATE|DELETE|WITH saved_events)/i.test(sql)
          ? "db_write_ms"
          : sql === "COMMIT"
            ? "db_commit_ms"
            : "db_other_ms";
      const start = performance.now();
      const result = Reflect.apply(target, receiver, args);
      if (result instanceof Promise)
        return result.finally(() =>
          operations.observe(name, performance.now() - start),
        );
      return result;
    },
  });
});
const store = await LobbyStore.open(
  pool,
  undefined,
  undefined,
  undefined,
  operations,
);
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
