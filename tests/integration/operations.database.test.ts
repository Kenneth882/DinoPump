import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { LobbyStore, migrate } from "../../packages/database/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";
import { CommentaryWorker } from "../../apps/commentary-worker/src/worker.js";
import { createWorkerServer } from "../../apps/commentary-worker/src/server.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let server: ReturnType<typeof createGameServer>;
let origin: string;
let now: number;
const sockets: Socket[] = [];
const webOrigin = "http://127.0.0.1:3000";
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
  store = await LobbyStore.open(database.pool, () => now);
  server = createGameServer(undefined, {
    store,
    webOrigin,
    secureCookies: false,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store?.close();
  await database?.close();
  vi.restoreAllMocks();
});
const metrics = async () => (await fetch(`${origin}/metrics`)).json();
async function post(path: string, body: unknown, cookie = "") {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Origin: webOrigin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
}
async function session(displayName: string) {
  const response = await post("/api/session", { displayName, avatar: "trex" });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
async function connect(cookie: string, code: string) {
  const socket = io(origin, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Origin: webOrigin, Cookie: cookie },
    auth: { code },
  });
  sockets.push(socket);
  const snapshot = new Promise((resolve) =>
    socket.once("room:snapshot", resolve),
  );
  socket.connect();
  await snapshot;
  return socket;
}
async function openRound() {
  const host = await session("Host"),
    guest = await session("Guest");
  const { code } = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${code}/join`, {}, guest);
  const first = await connect(host, code),
    second = await connect(guest, code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  let roundId = "";
  await vi.waitFor(async () => {
    const response = await first
      .timeout(2000)
      .emitWithAck("room:resync", { roundId: null, lastSequence: 0 });
    expect(response.snapshot.status).toBe("OPEN");
    roundId = response.snapshot.round.roundId;
  });
  return { first, second, host, code, roundId };
}

it("measures receipt through acknowledgement, client-confirmed commit delivery and snapshots without secret logs (AC-05/08/10/18)", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const { first, second, host, code, roundId } = await openRound();
  await connect(host, code);
  first.on("market:batch", (_batch, ack) => {
    if (typeof ack === "function") setTimeout(ack, 60);
  });
  second.on("market:batch", (_batch, ack) => {
    if (typeof ack === "function") ack();
  });
  const order = {
    roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 1,
    protectionPriceCents: 5000,
  };
  const result = await first.timeout(2000).emitWithAck("order:submit", order);
  expect(result.status).toBe("FILLED");
  await vi.waitFor(async () =>
    expect((await metrics()).histograms.commit_to_client_ms?.count).toBe(2),
  );
  const measured = await metrics();
  expect(measured.gauges).toMatchObject({
    connected_players: 2,
    connected_sockets: 3,
  });
  expect(measured.histograms).toMatchObject({
    order_ack_ms: { count: 1 },
    snapshot_ms: { count: expect.any(Number) },
    commit_to_client_ms: { count: 2, max: expect.any(Number) },
  });
  expect(measured.histograms.commit_to_client_ms.max).toBeGreaterThanOrEqual(
    50,
  );
  // The 10-token player budget is shared by sockets; retries cannot duplicate fills.
  for (let index = 0; index < 9; index++)
    expect(
      await first.timeout(2000).emitWithAck("order:submit", order),
    ).toEqual(result);
  const before = await first
    .timeout(2000)
    .emitWithAck("room:resync", { roundId, lastSequence: result.sequence });
  const excess = await sockets[2]!
    .timeout(2000)
    .emitWithAck("order:submit", { ...order, requestId: randomUUID() });
  expect(excess.error).toBe("RATE_LIMITED");
  const secret = "synthetic-secret-cookie-provider-key";
  for (let index = 0; index < 50; index++)
    expect(
      (
        await first.timeout(2000).emitWithAck("order:submit", {
          requestId: secret,
          cookie: secret,
          apiKey: secret,
        })
      ).error,
    ).toBe("INVALID_REQUEST");
  const after = await first
    .timeout(2000)
    .emitWithAck("room:resync", { roundId, lastSequence: result.sequence });
  expect(after.snapshot.round.sequence).toBe(before.snapshot.round.sequence);
  expect(await metrics()).toMatchObject({
    counters: {
      orders_received: 61,
      orders_rejected: 51,
      orders_invalid: 50,
      orders_rate_limited: 1,
    },
    histograms: { order_ack_ms: { count: 61 } },
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  expect(JSON.stringify(log.mock.calls)).not.toContain(host.slice(13));
  const rejected = log.mock.calls.filter(
    ([line]) => JSON.parse(String(line)).event === "order.rejected",
  );
  expect(rejected).toHaveLength(1);
  expect(JSON.stringify(log.mock.calls)).toContain(order.requestId);
});

it("keeps process health separate from ownership readiness and fails writes closed (AC-05/14/15)", async () => {
  expect((await fetch(`${origin}/readyz`)).status).toBe(200);
  const owner = await database.pool.query(
    "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=18474 AND granted AND objid=(hashtext(current_schema())::bigint & 4294967295)::oid",
  );
  await database.pool.query("SELECT pg_terminate_backend($1)", [
    owner.rows[0].pid,
  ]);
  expect((await fetch(`${origin}/readyz`)).status).toBe(503);
  expect((await fetch(`${origin}/healthz`)).status).toBe(200);
  const response = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: webOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Fern", avatar: "trex" }),
  });
  expect(response.status).toBe(503);
  expect(await metrics()).toMatchObject({
    gauges: { ready: 0, ownership: 0 },
    counters: { database_failures: 1 },
  });
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  // A new owner recovers; the failed service must stay unready until replaced.
  expect((await fetch(`${origin}/readyz`)).status).toBe(503);
});

it("keeps provider failures separate from database readiness and a running scheduler (AC-15/18)", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const { first, roundId } = await openRound();
  now += 60_000;
  await vi.waitFor(async () => {
    const { snapshot } = await first
      .timeout(2000)
      .emitWithAck("room:resync", { roundId, lastSequence: 0 });
    expect(snapshot.round.news).toHaveLength(1);
  });
  let fail: (error: Error) => void = () => {};
  let entered: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const worker = new CommentaryWorker(
    database.pool,
    {
      provider: "synthetic",
      model: "stub",
      promptVersion: "v1",
      narrate: () =>
        new Promise((_, reject) => {
          fail = reject;
          entered();
        }),
    },
    () => now,
  );
  const attempt = worker.processOne();
  await started;
  // The optional call is still pending when the next scheduled effect commits.
  now += 60_250;
  await vi.waitFor(async () => {
    const { snapshot } = await first
      .timeout(2000)
      .emitWithAck("room:resync", { roundId, lastSequence: 0 });
    expect(snapshot.round.news).toHaveLength(2);
  });
  fail(new Error("synthetic-provider-secret-cookie-database-url"));
  expect(await attempt).toBe(true);
  expect(worker.operations.snapshot()).toMatchObject({
    gauges: { ready: 1 },
    counters: { narration_failures: 1 },
    histograms: { narration_ms: { count: 1 } },
  });
  expect((await fetch(`${origin}/readyz`)).status).toBe(200);
  expect(await metrics()).toMatchObject({
    histograms: { scheduler_lag_ms: { count: 2, max: 250 } },
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(
    "synthetic-provider-secret-cookie-database-url",
  );
});

it("reports worker startup, storage failure and successful polling recovery independently of provider configuration", async () => {
  const worker = new CommentaryWorker(database.pool, undefined, () => now);
  const probe = createWorkerServer(worker.operations);
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("No worker listener");
  const endpoint = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(`${endpoint}/healthz`)).status).toBe(200);
    expect((await fetch(`${endpoint}/readyz`)).status).toBe(503);
    expect(await worker.processOne()).toBe(false);
    expect((await fetch(`${endpoint}/readyz`)).status).toBe(200);
    await database.pool.query(
      "ALTER FUNCTION claim_commentary(bigint,uuid) RENAME TO unavailable_claim",
    );
    await expect(worker.processOne()).rejects.toThrow();
    expect((await fetch(`${endpoint}/healthz`)).status).toBe(200);
    expect((await fetch(`${endpoint}/readyz`)).status).toBe(503);
    expect(await (await fetch(`${endpoint}/metrics`)).json()).toMatchObject({
      counters: { database_failures: 1 },
    });
    await database.pool.query(
      "ALTER FUNCTION unavailable_claim(bigint,uuid) RENAME TO claim_commentary",
    );
    expect(await worker.processOne()).toBe(false);
    expect((await fetch(`${endpoint}/readyz`)).status).toBe(200);
  } finally {
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  }
});

it("records ownership loss and never publishes rolled-back trades or commit latency (AC-05/08/14)", async () => {
  const { first, roundId } = await openRound();
  const before = await metrics();
  await database.pool
    .query(`CREATE FUNCTION lose_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    PERFORM pg_advisory_unlock(18474,hashtext(current_schema())); RETURN NEW;
    END $$; CREATE TRIGGER lose_owner BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION lose_owner()`);
  expect(
    await first.timeout(2000).emitWithAck("order:submit", {
      roundId,
      requestId: randomUUID(),
      symbol: "FERN",
      side: "buy",
      quantity: 1,
      protectionPriceCents: 5000,
    }),
  ).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
  expect((await fetch(`${origin}/readyz`)).status).toBe(503);
  const after = await metrics();
  expect(after).toMatchObject({
    gauges: { ownership: 0, ready: 0 },
    counters: { ownership_losses: 1, orders_rejected: 1 },
  });
  expect(after.histograms.commit_to_client_ms).toEqual(
    before.histograms.commit_to_client_ms,
  );
});
