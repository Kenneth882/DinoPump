import { io as socketClient, type Socket } from "socket.io-client";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { migrate, LobbyStore } from "../../packages/database/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let server: ReturnType<typeof createGameServer>;
let origin: string;
const sockets: Socket[] = [];
let now = 1_800_000_000_000;
const webOrigin = "http://127.0.0.1:3000";
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
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
