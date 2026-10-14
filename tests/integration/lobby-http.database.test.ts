import { io as socketClient, type Socket } from "socket.io-client";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { migrate, LobbyStore } from "../../packages/database/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";
import {
  lobbySnapshotSchema,
  marketBatchSchema,
  type LobbySnapshot,
  type MarketBatch,
} from "../../packages/contracts/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let server: ReturnType<typeof createGameServer>;
let origin: string;
const sockets: Socket[] = [];
let now = 1_800_000_000_000;
let runningSince: number | null = null;
const webOrigin = "http://127.0.0.1:3000";
beforeEach(async () => {
  now = 1_800_000_000_000;
  runningSince = null;
  database = await isolatedDatabase();
  await migrate(database.pool);
  store = await LobbyStore.open(
    database.pool,
    () =>
      now +
      (runningSince === null
        ? 0
        : Math.floor(performance.now() - runningSince)),
  );
  server = createGameServer(undefined, {
    store,
    webOrigin,
    secureCookies: true,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected listener");
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.disconnect());
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await store?.close();
  await database?.close();
});
const post = (path: string, body: unknown, cookie = "") =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: webOrigin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });

it("acknowledges ready commands and publishes authorized readiness to peers (AC-05/10)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const connected: Socket[] = [];
  for (const cookie of [host, guest]) {
    const socket = socketClient(origin, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: { Origin: webOrigin, Cookie: cookie },
      auth: { code: room.code },
    });
    sockets.push(socket);
    const snapshot = new Promise((resolve) =>
      socket.once("room:snapshot", resolve),
    );
    socket.connect();
    await snapshot;
    connected.push(socket);
  }
  const requestId = randomUUID();
  const observed = new Promise((resolve) =>
    connected[1]!.once("room:snapshot", resolve),
  );
  expect(
    await connected[0]!
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId }),
  ).toMatchObject({ requestId, status: "LOBBY" });
  expect(await observed).toMatchObject({
    players: [{ ready: true }, { ready: false }],
  });
  expect(
    await connected[0]!
      .timeout(2000)
      .emitWithAck("room:ready", { ready: false, requestId }),
  ).toMatchObject({ requestId, error: "IDEMPOTENCY_CONFLICT" });
  const forgedId = randomUUID();
  expect(
    await connected[0]!.timeout(2000).emitWithAck("room:ready", {
      ready: true,
      requestId: forgedId,
      playerId: randomUUID(),
    }),
  ).toMatchObject({ requestId: forgedId, error: "INVALID_REQUEST" });
});

it("creates a guest through a private HttpOnly cookie and rejects forged inputs (AC-05)", async () => {
  const response = await post("/api/session", {
    displayName: " Fern ",
    avatar: "trex",
  });
  expect(response.status).toBe(201);
  expect(response.headers.get("set-cookie")).toMatch(
    /HttpOnly; SameSite=Strict/,
  );
  expect(await response.json()).toEqual({
    player: {
      playerId: expect.any(String),
      displayName: "Fern",
      avatar: "trex",
    },
  });
  for (const body of [
    { displayName: "x", avatar: "trex" },
    { displayName: "Fern", avatar: "unknown" },
    { displayName: "Fern", avatar: "trex", playerId: "forged" },
  ]) {
    expect((await post("/api/session", body)).status).toBe(400);
  }
});

async function session(name: string) {
  const response = await post("/api/session", {
    displayName: name,
    avatar: "trex",
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Missing session");
  return cookie;
}
async function connectGuest(cookie: string, code: string) {
  const socket = socketClient(origin, {
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
it("resynchronizes by round and sequence, validates requests and keeps membership authoritative (AC-05/10)", async () => {
  const host = await session("Host");
  const room = await (await post("/api/rooms", {}, host)).json();
  const socket = await connectGuest(host, room.code);
  const requestId = randomUUID();
  const payload = { roundId: null, lastSequence: 0, requestId };
  const result = await socket.timeout(2000).emitWithAck("room:resync", payload);
  expect(result).toMatchObject({
    requestId,
    snapshot: { code: room.code, status: "LOBBY", round: null },
  });
  // An obsolete cursor requests current state; it cannot select someone else's round.
  expect(
    await socket.timeout(2000).emitWithAck("room:resync", {
      roundId: randomUUID(),
      lastSequence: 999999,
    }),
  ).toMatchObject({ snapshot: { code: room.code, status: "LOBBY" } });
  for (const invalid of [
    { ...payload, lastSequence: -1 },
    { ...payload, lastSequence: -1, requestId: requestId.toUpperCase() },
    { ...payload, lastSequence: 1.5 },
    { ...payload, playerId: randomUUID() },
    { ...payload, code: room.code },
  ])
    expect(
      await socket.timeout(2000).emitWithAck("room:resync", invalid),
    ).toMatchObject({ requestId, error: "INVALID_REQUEST" });
});
it("delivers a snapshot at N before a competing committed batch and filters every recipient (AC-05/10/14)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const first = await connectGuest(host, room.code),
    second = await connectGuest(guest, room.code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const opening = (await store.snapshot(host.slice(13), room.code)).round!;
  for (const socket of [first, second])
    await socket.timeout(2000).emitWithAck("room:resync", {
      roundId: opening.roundId,
      lastSequence: 0,
    });
  const delivered: (LobbySnapshot | MarketBatch)[] = [];
  first.on("room:snapshot", (x) =>
    delivered.push(lobbySnapshotSchema.parse(x)),
  );
  first.on("market:batch", (x) => delivered.push(marketBatchSchema.parse(x)));
  const privatePeer: unknown[] = [];
  second.on("order:result", (x) => privatePeer.push(x));
  const request = {
    roundId: opening.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const capture = store.snapshot.bind(store);
  const competingCommit = vi
    .spyOn(store, "snapshot")
    .mockImplementationOnce(async (...args) => {
      const snapshot = await capture(...args);
      // Commit at the persistence boundary while the captured snapshot awaits delivery.
      await store.submitOrder(host.slice(13), room.code, request);
      return snapshot;
    });
  try {
    const resynced = await first.timeout(2000).emitWithAck("room:resync", {
      roundId: opening.roundId,
      lastSequence: opening.sequence,
      requestId: randomUUID(),
    });
    expect(resynced.snapshot.round.sequence).toBe(3);
    await expect
      .poll(() => delivered.filter((x) => "startSequence" in x).length)
      .toBe(1);
    expect(delivered[0]).toMatchObject({
      round: { sequence: 3, portfolio: { cashCents: 1000000 } },
    });
    const batch = delivered.find(
      (x): x is MarketBatch => "startSequence" in x,
    )!;
    expect(batch).toMatchObject({
      startSequence: 4,
      trades: [
        { quantity: 100, priceCents: 4040 },
        { quantity: 50, priceCents: 4080 },
      ],
    });
    expect(JSON.stringify(batch)).not.toMatch(
      /requestId|protectionPriceCents|holdings|cashCents|secret/,
    );
    const owner = await first.timeout(2000).emitWithAck("room:resync", {
      roundId: opening.roundId,
      lastSequence: batch.endSequence,
    });
    const peer = await second.timeout(2000).emitWithAck("room:resync", {
      roundId: opening.roundId,
      lastSequence: batch.endSequence,
    });
    expect(owner.snapshot.round).toMatchObject({
      sequence: batch.endSequence,
      portfolio: { cashCents: 392000 },
      recentOrders: [{ requestId: request.requestId }],
    });
    expect(peer.snapshot.round).toMatchObject({
      sequence: batch.endSequence,
      assets: batch.assets,
      quotes: batch.quotes,
      portfolio: { cashCents: 1000000 },
      recentOrders: [],
    });
    expect(privatePeer).toEqual([]);
  } finally {
    competingCommit.mockRestore();
  }
});
it("keeps liveness separate from readiness and fails closed on live-connection ownership loss", async () => {
  expect((await fetch(`${origin}/healthz`)).status).toBe(200);
  expect((await fetch(`${origin}/readyz`)).status).toBe(200);
  const host = await session("Host");
  const room = await (await post("/api/rooms", {}, host)).json();
  const socket = await connectGuest(host, room.code);
  await database.pool.query(
    `CREATE FUNCTION lose_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_unlock(18474,hashtext(current_schema())); RETURN NEW; END $$; CREATE TRIGGER lose_owner BEFORE UPDATE ON room_members FOR EACH ROW EXECUTE FUNCTION lose_owner()`,
  );
  const requestId = randomUUID();
  expect(
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId }),
  ).toMatchObject({ requestId, error: "SERVICE_UNAVAILABLE" });
  expect((await fetch(`${origin}/readyz`)).status).toBe(503);
  expect((await fetch(`${origin}/healthz`)).status).toBe(200);
  expect((await post("/api/rooms", {}, host)).status).toBe(503);
  await database.pool.query("DROP TRIGGER lose_owner ON room_members");
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(
    (await store.snapshot(host.slice(13), room.code)).players[0]?.ready,
  ).toBe(false);
});
it("acknowledges host-only start and delivers one complete opening to both clients (AC-02/05/10)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const first = await connectGuest(host, room.code),
    second = await connectGuest(guest, room.code);
  const snapshots: { status: string; round: unknown }[] = [];
  first.on("room:snapshot", (value) => snapshots.push(value));
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  expect(
    await second
      .timeout(2000)
      .emitWithAck("round:start", { requestId: randomUUID() }),
  ).toMatchObject({ error: "FORBIDDEN" });
  const requestId = randomUUID();
  const started = await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId });
  expect(started).toMatchObject({
    requestId,
    status: "COUNTDOWN",
    roundId: expect.any(String),
  });
  now += 5000;
  await expect.poll(() => snapshots.at(-1)?.status).toBe("OPEN");
  const other = await second
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  expect(other.snapshot.round).toEqual(snapshots.at(-1)?.round);
  expect(
    await first.timeout(2000).emitWithAck("round:start", { requestId }),
  ).toEqual(started);
  expect(
    snapshots
      .filter((snapshot) => snapshot.status === "OPEN")
      .every((snapshot) => snapshot.round !== null),
  ).toBe(true);
});
it("authenticates create, join and snapshot and rejects forged identities (AC-01/05)", async () => {
  expect((await post("/api/rooms", {})).status).toBe(401);
  const host = await session("Host"),
    guest = await session("Guest");
  const created = await post("/api/rooms", {}, host);
  expect(created.status).toBe(201);
  const room = await created.json();
  expect(
    (
      await fetch(`${origin}/api/rooms/${room.code}/snapshot`, {
        headers: { Cookie: guest },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await post(
        `/api/rooms/${room.code}/join`,
        { playerId: room.hostId },
        guest,
      )
    ).status,
  ).toBe(400);
  expect((await post(`/api/rooms/${room.code}/join`, {}, guest)).status).toBe(
    200,
  );
  const snapshot = await fetch(`${origin}/api/rooms/${room.code}/snapshot`, {
    headers: { Cookie: guest },
  });
  expect((await snapshot.json()).players).toHaveLength(2);
});

it("authenticates realtime membership, sends committed joins, and counts multiple tabs (AC-10)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  const first = socketClient(origin, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Origin: webOrigin, Cookie: host },
    auth: { code: room.code },
  });
  sockets.push(first);
  const snapshot = new Promise<unknown>((resolve) =>
    first.once("room:snapshot", resolve),
  );
  first.connect();
  expect(await snapshot).toMatchObject({ players: [{ connected: true }] });
  const joined = new Promise<unknown>((resolve) =>
    first.once("room:snapshot", resolve),
  );
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  expect(await joined).toMatchObject({
    players: [{ displayName: "Host" }, { displayName: "Guest" }],
  });
  const second = socketClient(origin, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Origin: webOrigin, Cookie: host },
    auth: { code: room.code },
  });
  sockets.push(second);
  const ready = new Promise((resolve) => second.once("room:snapshot", resolve));
  second.connect();
  await ready;
  first.disconnect();
  const ack = await second.timeout(2000).emitWithAck("room:resync", {
    code: room.code,
    requestId: "00000000-0000-4000-8000-000000000001",
  });
  expect(ack.snapshot.players[0].connected).toBe(true);
});

it("rejects foreign origins, missing/expired cookies, and unauthorized realtime snapshots (AC-05)", async () => {
  const host = await session("Host"),
    stranger = await session("Stranger");
  const room = await (await post("/api/rooms", {}, host)).json();
  const badPost = await fetch(`${origin}/api/rooms`, {
    method: "POST",
    headers: { Origin: "https://evil.example", Cookie: host },
    body: "{}",
  });
  expect(badPost.status).toBe(403);
  for (const [cookie, originHeader] of [
    ["", webOrigin],
    [stranger, webOrigin],
    [host, "https://evil.example"],
  ]) {
    const socket = socketClient(origin, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Cookie: cookie!, Origin: originHeader! },
      auth: { code: room.code },
    });
    sockets.push(socket);
    const error = new Promise((resolve) =>
      socket.once("connect_error", resolve),
    );
    socket.connect();
    await error;
    expect(socket.connected).toBe(false);
  }
  now += 86_400_000;
  expect((await post(`/api/rooms/${room.code}/join`, {}, host)).status).toBe(
    401,
  );
  expect(
    (
      await fetch(`${origin}/api/rooms/${room.code}/snapshot`, {
        headers: { Cookie: host },
      })
    ).status,
  ).toBe(401);
});
it("revalidates a connected socket at expiry and on resync, without publishing private credentials", async () => {
  const host = await session("Host");
  const room = await (await post("/api/rooms", {}, host)).json();
  const socket = socketClient(origin, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Cookie: host, Origin: webOrigin },
    auth: { code: room.code },
  });
  sockets.push(socket);
  const first = new Promise((resolve) => socket.once("room:snapshot", resolve));
  socket.connect();
  expect(JSON.stringify(await first)).not.toContain(host.slice(13));
  now += 86_400_000;
  const ack = await socket.timeout(2000).emitWithAck("room:resync", {
    code: room.code,
    requestId: "00000000-0000-4000-8000-000000000001",
  });
  expect(ack.error).toBe("UNAUTHENTICATED");
  expect(ack.requestId).toBe("00000000-0000-4000-8000-000000000001");
  await new Promise((resolve) => socket.once("disconnect", resolve));
  expect(socket.connected).toBe(false);
});
it("serializes subscription with a competing join and never publishes a rolled-back join", async () => {
  const host = await session("Host"),
    guest = await session("Guest"),
    failed = await session("Failed");
  const room = await (await post("/api/rooms", {}, host)).json();
  const socket = socketClient(origin, {
    autoConnect: false,
    transports: ["websocket"],
    extraHeaders: { Cookie: host, Origin: webOrigin },
    auth: { code: room.code },
  });
  sockets.push(socket);
  const snapshots: { sequence: number; players: { displayName: string }[] }[] =
    [];
  socket.on("room:snapshot", (snapshot) => snapshots.push(snapshot));
  socket.connect();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  await expect.poll(() => snapshots.at(-1)?.players.length).toBe(2);
  await database.pool.query(
    `CREATE FUNCTION fail_join() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private details'; END $$; CREATE TRIGGER fail_join BEFORE INSERT ON room_lifecycle FOR EACH ROW EXECUTE FUNCTION fail_join()`,
  );
  const rejected = await post(`/api/rooms/${room.code}/join`, {}, failed);
  expect(rejected.status).toBe(503);
  expect(await rejected.json()).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
  const ack = await socket.timeout(2000).emitWithAck("room:resync", {
    code: room.code,
    requestId: "00000000-0000-4000-8000-000000000001",
  });
  expect(ack.snapshot.players).toHaveLength(2);
  expect(
    snapshots.every((snapshot) =>
      snapshot.players.every((player) => player.displayName !== "Failed"),
    ),
  ).toBe(true);
});

it("publishes complete public event batches and immediate news to both guests (AC-09/10/13)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const { code } = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${code}/join`, {}, guest);
  const first = await connectGuest(host, code),
    second = await connectGuest(guest, code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await expect
    .poll(async () => (await store.snapshot(host.slice(13), code)).status)
    .toBe("OPEN");
  // Ensure both subscribers have received the complete opening before the event.
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:resync", { code, requestId: randomUUID() });
  const batches: unknown[][] = [[], []],
    news: unknown[][] = [[], []];
  [first, second].forEach((socket, index) => {
    socket.on("market:batch", (batch) => batches[index]!.push(batch));
    socket.on("news:update", (item) => news[index]!.push(item));
  });
  now += 60000;
  await expect.poll(() => batches[0]!.length).toBe(1);
  await expect.poll(() => batches[1]!.length).toBe(1);
  expect(batches[1]).toEqual(batches[0]);
  expect(batches[0]![0]).toMatchObject({
    startSequence: 4,
    endSequence: 6,
    news: [{ narrationStatus: "pending" }],
  });
  expect(news[0]).toHaveLength(1);
  expect(news[1]).toEqual(news[0]);
  expect(JSON.stringify(batches)).not.toMatch(
    /secret|holdings|cashCents|catalogEvent"|initialState|receipts/,
  );
  const synced = await second
    .timeout(2000)
    .emitWithAck("room:resync", { code, requestId: randomUUID() });
  expect(synced.snapshot.round.news).toEqual(news[0]);
  expect(synced.snapshot.round.sequence).toBe(6);
});

it("keeps scheduling without sockets and records healthy due-to-commit lag below one second", async () => {
  const host = await store.createSession({
    displayName: "Host",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Guest",
    avatar: "trex",
  });
  const { code } = await store.createRoom(host.secret);
  await store.join(guest.secret, code);
  for (const player of [host, guest]) {
    await store.connect(player.secret, code);
    await store.ready(player.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  }
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  await store.disconnect(host.player.playerId, code);
  await store.disconnect(guest.player.playerId, code);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    now += 59500;
    runningSince = performance.now();
    await expect.poll(() => log.mock.calls.length).toBe(1);
    const entry = JSON.parse(String(log.mock.calls[0]![0]));
    expect(entry).toMatchObject({
      event: "scheduler.applied",
      dueAtMs: 1800000065000,
    });
    expect(entry.lagMs).toBeGreaterThanOrEqual(0);
    expect(entry.lagMs).toBeLessThanOrEqual(1000);
    expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(
      1,
    );
  } finally {
    log.mockRestore();
  }
});
it("delivers complete committed trades to peers and private original outcomes only to the owner's sessions (AC-03/07/10)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const first = await connectGuest(host, room.code),
    otherOwner = await connectGuest(host, room.code),
    second = await connectGuest(guest, room.code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  const read = () =>
    first
      .timeout(2000)
      .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  await expect.poll(async () => (await read()).snapshot.status).toBe("OPEN");
  const opening = (await read()).snapshot.round;
  const publicFirst: unknown[] = [],
    publicSecond: unknown[] = [],
    own: unknown[] = [],
    ownTab: unknown[] = [],
    foreign: unknown[] = [];
  first.on("market:batch", (x) => publicFirst.push(x));
  second.on("market:batch", (x) => publicSecond.push(x));
  first.on("order:result", (x) => own.push(x));
  otherOwner.on("order:result", (x) => ownTab.push(x));
  second.on("order:result", (x) => foreign.push(x));
  const payload = {
    roundId: opening.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const result = await first.timeout(2000).emitWithAck("order:submit", payload);
  expect(result).toMatchObject({
    requestId: payload.requestId,
    status: "FILLED",
    totalValueCents: 608000,
    portfolio: { cashCents: 392000 },
  });
  await expect.poll(() => ownTab.length).toBe(1);
  await expect.poll(() => publicSecond.length).toBe(1);
  expect(own).toEqual([result]);
  expect(ownTab).toEqual([result]);
  expect(foreign).toEqual([]);
  expect(publicSecond).toEqual(publicFirst);
  expect(publicFirst[0]).toMatchObject({
    startSequence: 4,
    endSequence: result.sequence,
    trades: [
      { quantity: 100, priceCents: 4040 },
      { quantity: 50, priceCents: 4080 },
    ],
    totals: expect.any(Array),
  });
  expect(JSON.stringify(publicFirst)).not.toMatch(
    /protectionPriceCents|holdings|requestId/,
  );
  expect(
    await otherOwner.timeout(2000).emitWithAck("order:submit", payload),
  ).toEqual(result);
  expect(publicFirst).toHaveLength(1);
  const peer = await second
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  expect(peer.snapshot.round.portfolio.cashCents).toBe(1000000);
  expect(peer.snapshot.round.recentOrders).toEqual([]);
  expect(
    await first
      .timeout(2000)
      .emitWithAck("order:submit", { ...payload, playerId: room.hostId }),
  ).toMatchObject({ error: "INVALID_REQUEST", requestId: payload.requestId });
});
it("recovers a committed order after delivery failure and restart without a second execution (AC-14 subset)", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  let first = await connectGuest(host, room.code);
  const second = await connectGuest(guest, room.code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  await expect
    .poll(
      async () =>
        (
          await first.timeout(2000).emitWithAck("room:resync", {
            code: room.code,
            requestId: randomUUID(),
          })
        ).snapshot.status,
    )
    .toBe("OPEN");
  const view = await first
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  const payload = {
    roundId: view.snapshot.round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const submit = store.submitOrder.bind(store);
  // Persistence is the service's external I/O seam: lose the response after its commit.
  const loss = vi
    .spyOn(store, "submitOrder")
    .mockImplementationOnce(async (...args) => {
      await submit(...args);
      throw new Error("synthetic postcommit delivery loss");
    });
  expect(
    await first.timeout(2000).emitWithAck("order:submit", payload),
  ).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
  loss.mockRestore();
  sockets.splice(0).forEach((socket) => socket.disconnect());
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  server = createGameServer(undefined, {
    store,
    webOrigin,
    secureCookies: true,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing listener");
  origin = `http://127.0.0.1:${address.port}`;
  first = await connectGuest(host, room.code);
  const restored = await first
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  const original = restored.snapshot.round.recentOrders[0];
  expect(original).toMatchObject({
    requestId: payload.requestId,
    totalValueCents: 608000,
  });
  const trades: unknown[] = [];
  first.on("market:batch", (x) => trades.push(x));
  expect(
    await first.timeout(2000).emitWithAck("order:submit", payload),
  ).toEqual(original);
  expect(trades).toEqual([]);
  expect(restored.snapshot.round.trades).toHaveLength(2);
});
it("shares one player's order burst across two authenticated sockets", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const first = await connectGuest(host, room.code),
    tab = await connectGuest(host, room.code),
    second = await connectGuest(guest, room.code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  await expect
    .poll(
      async () =>
        (
          await first.timeout(2000).emitWithAck("room:resync", {
            code: room.code,
            requestId: randomUUID(),
          })
        ).snapshot.status,
    )
    .toBe("OPEN");
  const view = await first
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  const payload = {
    roundId: view.snapshot.round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 1,
    protectionPriceCents: 100,
  };
  for (let i = 0; i < 10; i++)
    expect(
      await (i % 2 ? tab : first)
        .timeout(2000)
        .emitWithAck("order:submit", payload),
    ).toMatchObject({ status: "NO_LIQUIDITY_WITHIN_PROTECTION" });
  expect(
    await tab.timeout(2000).emitWithAck("order:submit", payload),
  ).toMatchObject({ error: "RATE_LIMITED", requestId: payload.requestId });
  now += 200;
  expect(
    await tab.timeout(2000).emitWithAck("order:submit", payload),
  ).toMatchObject({ status: "NO_LIQUIDITY_WITHIN_PROTECTION" });
});
it("measures eight-client acknowledgements, delivery, snapshots and scheduler lag as trade history grows", async () => {
  const cookies = [];
  for (let i = 0; i < 8; i++) cookies.push(await session(`Player ${i}`));
  const room = await (await post("/api/rooms", {}, cookies[0])).json();
  const clients: Socket[] = [];
  for (const [i, cookie] of cookies.entries()) {
    if (i) await post(`/api/rooms/${room.code}/join`, {}, cookie);
    clients.push(await connectGuest(cookie, room.code));
  }
  for (const client of clients)
    await client
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await clients[0]!
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  await expect
    .poll(
      async () =>
        (
          await clients[0]!.timeout(2000).emitWithAck("room:resync", {
            code: room.code,
            requestId: randomUUID(),
          })
        ).snapshot.status,
    )
    .toBe("OPEN");
  const view = await clients[0]!
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  const deliveries: number[] = [];
  const started = new Map<number, number>();
  clients[0]!.on("market:batch", (batch) => {
    const at = started.get(batch.endSequence);
    if (at !== undefined) deliveries.push(performance.now() - at);
  });
  const submit = store.submitOrder.bind(store);
  const timing = vi
    .spyOn(store, "submitOrder")
    .mockImplementation(async (...args) => {
      const result = await submit(...args);
      started.set(result.sequence, performance.now());
      return result;
    });
  const report = [];
  for (let window = 0; window < 3; window++) {
    const latencies: number[] = [];
    for (let epoch = 0; epoch < 10; epoch++) {
      now += 200;
      const results = await Promise.all(
        clients.map(async (client) => {
          const start = performance.now();
          const result = await client
            .timeout(5000)
            .emitWithAck("order:submit", {
              roundId: view.snapshot.round.roundId,
              requestId: randomUUID(),
              symbol: "FERN",
              side: epoch % 2 ? "sell" : "buy",
              quantity: 1,
              protectionPriceCents: epoch % 2 ? 100 : 10000,
            });
          latencies.push(performance.now() - start);
          return result;
        }),
      );
      expect(results.every((result) => result.status === "FILLED")).toBe(true);
    }
    latencies.sort((a, b) => a - b);
    const snapshotStart = performance.now();
    const snapshot = await clients[0]!
      .timeout(5000)
      .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
    report.push({
      orders: (window + 1) * 80,
      ackP95Ms: Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]!),
      snapshotMs: Math.round(performance.now() - snapshotStart),
      sequence: snapshot.snapshot.round.sequence,
    });
  }
  timing.mockRestore();
  deliveries.sort((a, b) => a - b);
  now = view.snapshot.round.opensAt + 60000;
  const lag = await store.processDue();
  // The real service timer may drain the same deadline first. Verify the
  // committed event once, regardless of which owned scheduler call wins.
  const appliedNews = (await store.snapshot(cookies[0]!.slice(13), room.code))
    .round!.news;
  expect(appliedNews).toHaveLength(1);
  expect(appliedNews[0]?.scheduledEventId).toBe(
    `${view.snapshot.round.roundId}:1`,
  );
  const scheduledLagMs =
    lag[0]?.lagMs ??
    Math.max(0, appliedNews[0]!.appliedAtMs - appliedNews[0]!.dueAtMs);
  expect(scheduledLagMs).toBe(0);
  const schedulerStart = performance.now();
  await store.processDue();
  console.info(
    JSON.stringify({
      event: "trading.local_measurement",
      report,
      deliveryP95Ms: Math.round(
        deliveries[Math.ceil(deliveries.length * 0.95) - 1]!,
      ),
      schedulerNoopMs: Math.round(performance.now() - schedulerStart),
      scheduledLagMs,
    }),
  );
}, 60000);
it("publishes no trade or successful result when a fill write rolls back", async () => {
  const host = await session("Host"),
    guest = await session("Guest");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const first = await connectGuest(host, room.code),
    second = await connectGuest(guest, room.code);
  for (const socket of [first, second])
    await socket
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  await expect
    .poll(
      async () =>
        (
          await first.timeout(2000).emitWithAck("room:resync", {
            code: room.code,
            requestId: randomUUID(),
          })
        ).snapshot.status,
    )
    .toBe("OPEN");
  const view = await first
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  const payload = {
    roundId: view.snapshot.round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const batches: unknown[] = [],
    results: unknown[] = [];
  first.on("market:batch", (x) => batches.push(x));
  first.on("order:result", (x) => results.push(x));
  await database.pool.query(
    `CREATE FUNCTION fail_trade() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic fill failure'; END $$; CREATE TRIGGER fail_trade BEFORE INSERT ON trades FOR EACH ROW EXECUTE FUNCTION fail_trade()`,
  );
  expect(
    await first.timeout(2000).emitWithAck("order:submit", payload),
  ).toMatchObject({
    error: "SERVICE_UNAVAILABLE",
    requestId: payload.requestId,
  });
  expect(batches).toEqual([]);
  expect(results).toEqual([]);
  const unchanged = await first
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  expect(unchanged.snapshot.round).toEqual(view.snapshot.round);
  await database.pool.query("DROP TRIGGER fail_trade ON trades");
  expect(
    await first.timeout(2000).emitWithAck("order:submit", payload),
  ).toMatchObject({ status: "FILLED" });
  expect(batches).toHaveLength(1);
  expect(results).toHaveLength(1);
});
it("delivers private terminal results and host reset through real HTTP and sockets (AC-05/11/17)", async () => {
  const host = await session("Host"),
    guest = await session("Guest"),
    outsider = await session("Outsider");
  const room = await (await post("/api/rooms", {}, host)).json();
  await post(`/api/rooms/${room.code}/join`, {}, guest);
  const a = await connectGuest(host, room.code),
    b = await connectGuest(guest, room.code);
  for (const s of [a, b])
    await s
      .timeout(2000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  const start = await a
    .timeout(2000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  await a
    .timeout(2000)
    .emitWithAck("room:resync", { code: room.code, requestId: randomUUID() });
  await a.timeout(2000).emitWithAck("order:submit", {
    roundId: start.roundId,
    requestId: randomUUID(),
    side: "buy",
    symbol: "FERN",
    quantity: 150,
    protectionPriceCents: 4100,
  });
  const endedA = new Promise((resolve) => a.once("round:ended", resolve));
  const endedB = new Promise((resolve) => b.once("round:ended", resolve));
  now += 600000;
  const [resultA, resultB] = await Promise.all([endedA, endedB]);
  expect(resultA).toMatchObject({
    status: "FINISHED",
    portfolio: { cashCents: 392000, holdings: { FERN: 150 } },
  });
  expect(resultB).toMatchObject({
    status: "FINISHED",
    portfolio: { cashCents: 1000000, holdings: { FERN: 0 } },
  });
  const response = await fetch(
    `${origin}/api/rounds/${start.roundId}/results`,
    { headers: { Cookie: host } },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(resultA);
  expect(
    (
      await fetch(`${origin}/api/rounds/${start.roundId}/results`, {
        headers: { Cookie: outsider },
      })
    ).status,
  ).toBe(403);
  expect(
    (await fetch(`${origin}/api/rounds/${start.roundId}/results`)).status,
  ).toBe(401);
  const reset = { roundId: start.roundId, requestId: randomUUID() };
  expect(
    await b.timeout(2000).emitWithAck("room:return-to-lobby", reset),
  ).toMatchObject({ error: "FORBIDDEN", requestId: reset.requestId });
  expect(
    await a.timeout(2000).emitWithAck("room:return-to-lobby", reset),
  ).toMatchObject({ status: "LOBBY", roundId: null });
}, 10000);
