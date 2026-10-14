import { Pool } from "pg";
import { LobbyStore } from "../../packages/database/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";

// A test-only process entrypoint: never load .env or expose clock/fault HTTP routes.
const target = new URL(process.env.TEST_DATABASE_URL ?? "");
const schema = process.env.DINOPUMP_RECOVERY_SCHEMA ?? "";
if (
  target.hostname !== "127.0.0.1" ||
  target.port !== (process.env.DINOPUMP_TEST_PORT ?? "55433") ||
  target.pathname !== "/dinopump_test" ||
  !/^test_[a-f0-9]{32}$/.test(schema)
)
  throw new Error("Expected the isolated recovery database");
let now = Number(process.env.DINOPUMP_RECOVERY_TIME);
if (!Number.isSafeInteger(now)) throw new Error("Expected a synthetic clock");
const pool = new Pool({
  connectionString: target.href,
  options: `-c search_path=${schema}`,
  application_name: `recovery_${schema}_${process.pid}`,
  connectionTimeoutMillis: 2000,
});
pool.on("error", () => {});
try {
  const store = await LobbyStore.open(pool, () => now);
  if (process.env.DINOPUMP_RECOVERY_FAULT === "after-order-commit") {
    const submit = store.submitOrder.bind(store);
    store.submitOrder = async (...args) => {
      const result = await submit(...args);
      process.send?.({ type: "committed" });
      // Stop at the service/store boundary before the real transport publishes.
      await new Promise<void>(() => {});
      return result;
    };
  }
  const server = createGameServer(undefined, {
    store,
    webOrigin: "http://127.0.0.1:3100",
    secureCookies: false,
  });
  process.on("message", (message: { type: string; now: number }) => {
    if (message.type === "clock" && Number.isSafeInteger(message.now)) {
      now = message.now;
      process.send?.({ type: "clock" });
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string")
      process.send?.({ type: "listening", port: address.port });
  });
} catch {
  // Do not send credentials or internal database errors to the parent/logs.
  process.send?.({ type: "unavailable" });
  await pool.end();
  process.disconnect();
}
