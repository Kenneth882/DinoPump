import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { migrate, LobbyStore } from "../../packages/database/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let now = 1_800_000_000_000;
beforeEach(async () => {
  database = await isolatedDatabase();
  await migrate(database.pool);
  store = await LobbyStore.open(database.pool, () => now);
});
afterEach(async () => {
  await store?.close();
  await database?.close();
});

it("creates a normalized guest with a hashed, expiring credential (AC-05)", async () => {
  const session = await store.createSession({
    displayName: "  Fern   Fan  ",
    avatar: "trex",
  });
  expect(session.player.displayName).toBe("Fern Fan");
  expect(await store.authenticate(session.secret)).toEqual(session.player);
  const stored = await database.pool.query(
    "SELECT secret_hash, expires_at_ms FROM guest_sessions",
  );
  expect(stored.rows[0].secret_hash).not.toBe(session.secret);
  expect(Number(stored.rows[0].expires_at_ms)).toBe(now + 86_400_000);
  await expect(store.authenticate("unknown")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  now += 86_400_000;
  await expect(store.authenticate(session.secret)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

const guest = (name: string) =>
  store.createSession({ displayName: name, avatar: "trex" });
it("creates one durable active room atomically under concurrent creates and authorizes snapshots (AC-01/05)", async () => {
  const [a, b] = await Promise.all([guest("Alpha"), guest("Bravo")]);
  const outcomes = await Promise.allSettled([
    store.createRoom(a.secret),
    store.createRoom(b.secret),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")[0]).toMatchObject({
    reason: { code: "ACTIVE_ROOM_EXISTS" },
  });
  const winner = outcomes[0]?.status === "fulfilled" ? a : b;
  const loser = winner === a ? b : a;
  const result = outcomes.find((r) => r.status === "fulfilled");
  if (result?.status !== "fulfilled") throw new Error("No room");
  const snapshot = result.value;
  expect(snapshot.players).toEqual([{ ...winner.player, connected: false }]);
  expect(await store.snapshot(winner.secret, snapshot.code)).toMatchObject({
    hostId: winner.player.playerId,
  });
  await expect(
    store.snapshot(loser.secret, snapshot.code),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.snapshot(winner.secret, snapshot.code)).toMatchObject({
    hostId: winner.player.playerId,
  });
});

it("admits at most eight guests with unique normalized names, and reconnects existing members after joining locks (AC-01)", async () => {
  const host = await guest("Host");
  const room = await store.createRoom(host.secret);
  const duplicate = await guest(" ＨＯＳＴ ");
  await expect(store.join(duplicate.secret, room.code)).rejects.toMatchObject({
    code: "NAME_TAKEN",
  });
  for (let i = 0; i < 6; i++)
    await store.join((await guest(`Guest ${i}`)).secret, room.code);
  const a = await guest("Last A"),
    b = await guest("Last B");
  const last = await Promise.allSettled([
    store.join(a.secret, room.code),
    store.join(b.secret, room.code),
  ]);
  expect(last.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(last.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "ROOM_FULL" },
  });
  expect((await store.join(host.secret, room.code)).players).toHaveLength(8);
  for (const status of ["COUNTDOWN", "OPEN"]) {
    await database.pool.query("UPDATE rooms SET status=$1 WHERE code=$2", [
      status,
      room.code,
    ]);
    await expect(store.join(duplicate.secret, room.code)).rejects.toMatchObject(
      { code: "JOIN_LOCKED" },
    );
    expect((await store.join(host.secret, room.code)).players).toHaveLength(8);
  }
});

it("transfers the host at 15 seconds to the earliest connected player, with reconnect and duplicate-timer guards", async () => {
  const host = await guest("Host"),
    early = await guest("Early"),
    late = await guest("Late");
  const room = await store.createRoom(host.secret);
  await store.join(late.secret, room.code);
  await store.join(early.secret, room.code);
  await store.connect(host.secret, room.code);
  await store.connect(early.secret, room.code);
  now += 10;
  await store.connect(late.secret, room.code);
  await store.disconnect(host.player.playerId, room.code);
  now += 14_999;
  await store.processDue();
  expect((await store.snapshot(early.secret, room.code)).hostId).toBe(
    host.player.playerId,
  );
  await store.connect(host.secret, room.code);
  now++;
  await store.processDue();
  expect((await store.snapshot(early.secret, room.code)).hostId).toBe(
    host.player.playerId,
  );
  await store.disconnect(host.player.playerId, room.code);
  now += 15_000;
  await Promise.all([store.processDue(), store.processDue()]);
  expect((await store.snapshot(early.secret, room.code)).hostId).toBe(
    early.player.playerId,
  );
  expect(
    (
      await database.pool.query(
        "SELECT * FROM room_lifecycle WHERE type='HostTransferred'",
      )
    ).rowCount,
  ).toBe(1);
});
it("expires empty lobbies at five minutes, survives restart, and releases the active slot", async () => {
  const host = await guest("Host");
  const room = await store.createRoom(host.secret);
  now += 15_000;
  await store.processDue(); // No connected host candidate.
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  now += 284_999;
  await store.processDue();
  expect((await store.snapshot(host.secret, room.code)).hostId).toBe(
    host.player.playerId,
  );
  now++;
  await Promise.all([store.processDue(), store.processDue()]);
  await expect(store.join(host.secret, room.code)).rejects.toMatchObject({
    code: "ROOM_NOT_FOUND",
  });
  expect((await store.createRoom(host.secret)).code).not.toBe(room.code);
});
it("rechecks empty expiry after a reconnect and refuses a second service owner", async () => {
  const host = await guest("Host");
  const room = await store.createRoom(host.secret);
  await expect(LobbyStore.open(database.pool)).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  now += 300_000;
  await Promise.all([
    store.connect(host.secret, room.code),
    store.processDue(),
  ]);
  expect((await store.snapshot(host.secret, room.code)).expiresAt).toBeNull();
});
it("rolls back creation if the lifecycle record cannot commit", async () => {
  const host = await guest("Host");
  await database.pool.query(
    `CREATE FUNCTION fail_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER fail_lifecycle BEFORE INSERT ON room_lifecycle FOR EACH ROW EXECUTE FUNCTION fail_lifecycle()`,
  );
  await expect(store.createRoom(host.secret)).rejects.toThrow(
    "synthetic failure",
  );
  await database.pool.query("DROP TRIGGER fail_lifecycle ON room_lifecycle");
  expect((await store.createRoom(host.secret)).players).toHaveLength(1);
});

it("fails closed after the database ownership connection is lost, then recovers under a new owner", async () => {
  const host = await guest("Host");
  const room = await store.createRoom(host.secret);
  await store.connect(host.secret, room.code);
  // Terminate only this synthetic schema's lock holder, not another test's pool.
  await database.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=18474 AND objid=(hashtext(current_schema())::bigint & 4294967295)::oid AND granted`,
  );
  await expect(store.createRoom(host.secret)).rejects.toThrow();
  await expect(store.snapshot(host.secret, room.code)).rejects.toThrow();
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect((await store.snapshot(host.secret, room.code)).players).toEqual([
    { ...host.player, connected: false },
  ]);
  expect((await store.connect(host.secret, room.code)).players).toHaveLength(1);
});
