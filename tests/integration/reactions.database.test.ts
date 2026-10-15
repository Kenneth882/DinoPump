import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { LobbyStore, migrate } from "../../packages/database/dist/index.js";
import { createGameServer } from "../../apps/game-server/src/server.js";
import { reactionPublishedSchema } from "../../packages/contracts/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let server: ReturnType<typeof createGameServer>;
let origin: string;
let now: number;
const sockets: Socket[] = [];
const webOrigin = "http://127.0.0.1:3000";
beforeEach(async () => {
  // Keep the service scheduler fixed; advance the authoritative clock explicitly.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  now = 1800000000000;
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
  vi.useRealTimers();
});
async function connect(secret: string, code: string) {
  const socket = io(origin, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { code },
    extraHeaders: { Origin: webOrigin, Cookie: `dino_session=${secret}` },
  });
  sockets.push(socket);
  const ready = new Promise((resolve) => socket.once("room:snapshot", resolve));
  socket.connect();
  await ready;
  return socket;
}
async function roomMembers() {
  const host = await store.createSession({
    displayName: "Rex",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Fern",
    avatar: "stegosaurus",
  });
  const { code } = await store.createRoom(host.secret);
  await store.join(guest.secret, code);
  return {
    host,
    guest,
    code,
    first: await connect(host.secret, code),
    second: await connect(guest.secret, code),
  };
}
const send = (socket: Socket, reactionId = "big-roar") =>
  socket
    .timeout(1000)
    .emitWithAck("reaction:send", { requestId: randomUUID(), reactionId });

it("acknowledges an approved reaction and publishes only authenticated public facts to peers (AC-05/10)", async () => {
  const { host, first, second, code } = await roomMembers();
  const received = new Promise<unknown>((resolve) =>
    second.once("reaction:published", resolve),
  );
  const requestId = randomUUID();
  const ack = await first
    .timeout(1000)
    .emitWithAck("reaction:send", { requestId, reactionId: "big-roar" });
  expect(ack).toEqual({ requestId, publishedId: expect.any(String) });
  const raw = await received;
  expect(reactionPublishedSchema.parse(raw)).toEqual({
    id: ack.publishedId,
    code,
    roundId: null,
    playerId: host.player.playerId,
    reactionId: "big-roar",
    serverTime: now,
  });
});

it("enforces an exact player-wide second across sockets and reconnects without extending rejected cooldowns (AC-05)", async () => {
  const { host, first, second, code } = await roomMembers();
  const extra = await connect(host.secret, code);
  const events: unknown[] = [];
  second.on("reaction:published", (raw) => events.push(raw));
  const simultaneous = await Promise.all([send(first), send(extra)]);
  expect(
    simultaneous.filter((outcome) => "publishedId" in outcome),
  ).toHaveLength(1);
  expect(
    simultaneous.filter((outcome) => outcome.error === "RATE_LIMITED"),
  ).toHaveLength(1);
  expect(await send(second, "meteor-incoming")).toHaveProperty("publishedId");
  first.disconnect();
  extra.disconnect();
  const restored = await connect(host.secret, code);
  now += 999;
  expect(await send(restored)).toMatchObject({ error: "RATE_LIMITED" });
  now++;
  expect(await send(restored, "tiny-arms-big-gains")).toHaveProperty(
    "publishedId",
  );
  await second
    .timeout(1000)
    .emitWithAck("room:resync", { code, requestId: randomUUID() });
  expect(events).toHaveLength(3);
});

it("rejects forged/free-text commands and revalidates sender, recipients and membership (AC-05/10)", async () => {
  const { host, guest, first, second, code } = await roomMembers();
  const received: unknown[] = [];
  second.on("reaction:published", (raw) => received.push(raw));
  for (const fields of [
    { reactionId: "free text" },
    { reactionId: "big-roar", playerId: guest.player.playerId },
    { reactionId: "big-roar", text: "hello" },
  ]) {
    const requestId = randomUUID();
    expect(
      await first
        .timeout(1000)
        .emitWithAck("reaction:send", { requestId, ...fields }),
    ).toMatchObject({ error: "INVALID_REQUEST", requestId });
  }
  // Synthetic authorization revocation, before the periodic publication notices it.
  await database.pool.query(
    "UPDATE guest_sessions SET expires_at_ms=$1 WHERE player_id=$2",
    [now, guest.player.playerId],
  );
  expect(await send(first)).toHaveProperty("publishedId");
  expect(await send(second)).toMatchObject({ error: "UNAUTHENTICATED" });
  expect(received).toEqual([]);
  await database.pool.query(
    "DELETE FROM room_members WHERE code=$1 AND player_id=$2",
    [code, host.player.playerId],
  );
  expect(await send(first)).toMatchObject({ error: "FORBIDDEN" });
});

it("does not publish in an expired room or after database ownership is lost (AC-05/10)", async () => {
  const { first, second, code } = await roomMembers();
  const received: unknown[] = [];
  second.on("reaction:published", (raw) => received.push(raw));
  await database.pool.query("UPDATE rooms SET status='EXPIRED' WHERE code=$1", [
    code,
  ]);
  expect(await send(first)).toMatchObject({ error: "ROOM_NOT_FOUND" });
  await database.pool.query("UPDATE rooms SET status='LOBBY' WHERE code=$1", [
    code,
  ]);
  await database.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=18474 AND objid=(hashtext(current_schema())::bigint & 4294967295)::oid AND granted`,
  );
  expect(await send(first)).toMatchObject({ error: "SERVICE_UNAVAILABLE" });
  expect(received).toEqual([]);
});

it("keeps market history, private resources and frozen results unchanged before and after close (AC-10/11)", async () => {
  const { host, guest, first, second, code } = await roomMembers();
  for (const socket of [first, second])
    await socket
      .timeout(1000)
      .emitWithAck("room:ready", { ready: true, requestId: randomUUID() });
  await first
    .timeout(1000)
    .emitWithAck("round:start", { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const opening = (await store.snapshot(host.secret, code)).round!;
  await first.timeout(1000).emitWithAck("order:submit", {
    roundId: opening.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  });
  // The public service/snapshot seam checks values; the database seam also checks
  // that this transient command cannot append otherwise invisible market history.
  const read = () =>
    Promise.all([
      store.snapshot(host.secret, code),
      store.snapshot(guest.secret, code),
      ...[
        "game_events",
        "round_batches",
        "orders",
        "trades",
        "round_results",
        "round_projections",
        "room_lifecycle",
        "room_commands",
      ].map((table) =>
        database.pool
          .query(
            `SELECT COALESCE(jsonb_agg(t ORDER BY to_jsonb(t)::text), '[]'::jsonb) AS rows FROM ${table} t`,
          )
          .then((result) => result.rows[0].rows),
      ),
    ]);
  const before = await read();
  expect(await send(first)).toHaveProperty("publishedId");
  expect(await send(second)).toHaveProperty("publishedId");
  expect(await read()).toEqual(before);
  now = opening.closesAt;
  await store.processDue();
  const frozen = await read();
  const results = await Promise.all([
    store.results(host.secret, opening.roundId),
    store.results(guest.secret, opening.roundId),
  ]);
  expect(await send(first, "meteor-incoming")).toHaveProperty("publishedId");
  expect(await send(second, "tiny-arms-big-gains")).toHaveProperty(
    "publishedId",
  );
  expect(await read()).toEqual(frozen);
  expect(
    await Promise.all([
      store.results(host.secret, opening.roundId),
      store.results(guest.secret, opening.roundId),
    ]),
  ).toEqual(results);
});
