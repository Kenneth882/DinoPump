import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import {
  migrate,
  LobbyStore,
  readRoundBaseline,
  readOpenedRound,
} from "../../packages/database/src/index.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let now = 1_800_000_000_000;
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
  store = await LobbyStore.open(database.pool, () => now);
});

it("recovers a committed opening before any snapshot delivery and reports unready when scheduled work is overdue (AC-14 subset)", async () => {
  const { host, guest, code } = await lobby();
  for (const member of [host, guest])
    await store.ready(member.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  const started = await store.start(host.secret, code, {
    requestId: randomUUID(),
  });
  now += 5000;
  await store.processDue();
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.isReady()).toBe(true);
  expect((await store.snapshot(host.secret, code)).round).toMatchObject({
    roundId: started.roundId,
    sequence: 3,
    portfolio: { cashCents: 1000000 },
  });
  now += 60000;
  expect(await store.isReady()).toBe(false);
  expect((await store.snapshot(host.secret, code)).status).toBe("OPEN");
});

it("freezes configured countdown, duration and resources before opening, and cancels a restarted countdown safely", async () => {
  await store.close();
  const config = loadBaseline();
  config.rules.room.countdownMs = 7000;
  config.rules.round.durationMs = 900000;
  config.rules.player.startingCashCents = 2000000;
  store = await LobbyStore.open(
    database.pool,
    () => now,
    config.rules.room,
    config,
  );
  const { host, guest, code } = await lobby();
  for (const member of [host, guest])
    await store.ready(member.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  const requestId = randomUUID();
  const first = await store.start(host.secret, code, { requestId });
  expect((await store.snapshot(host.secret, code)).countdown).toMatchObject({
    opensAt: now + 7000,
    closesAt: now + 907000,
  });
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.snapshot(host.secret, code)).toMatchObject({
    status: "LOBBY",
    countdown: null,
  });
  expect(
    (await store.snapshot(host.secret, code)).players.every(
      (member) => !member.ready,
    ),
  ).toBe(true);
  expect(await store.start(host.secret, code, { requestId })).toEqual(first);
  expect(await readRoundBaseline(database.pool, first.roundId!)).toBeNull();
  await store.close();
  store = await LobbyStore.open(
    database.pool,
    () => now,
    config.rules.room,
    config,
  );
  for (const member of [host, guest]) {
    await store.connect(member.secret, code);
    await store.ready(member.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  }
  const second = await store.start(host.secret, code, {
    requestId: randomUUID(),
  });
  config.rules.player.startingCashCents = 3000000;
  now += 7000;
  await store.processDue();
  expect(second.roundId).not.toBe(first.roundId);
  expect(
    (await store.snapshot(host.secret, code)).round?.portfolio.cashCents,
  ).toBe(2000000);
});

it("counts expired sessions as disconnected at countdown boundaries", async () => {
  const { host, guest, code } = await lobby();
  now += 86399000;
  for (const member of [host, guest])
    await store.ready(member.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  const started = await store.start(host.secret, code, {
    requestId: randomUUID(),
  });
  now += 1000;
  await store.processDue();
  expect(await readRoundBaseline(database.pool, started.roundId!)).toBeNull();
  const late = await store.createSession({
    displayName: "Late",
    avatar: "trex",
  });
  expect((await store.join(late.secret, code)).status).toBe("LOBBY");
});

it("rolls back all opening writes before commit and retries the recorded round without refunding or extending it (AC-14)", async () => {
  const { host, guest, code } = await lobby();
  for (const member of [host, guest])
    await store.ready(member.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  const started = await store.start(host.secret, code, {
    requestId: randomUUID(),
  });
  await database.pool.query(
    `CREATE FUNCTION fail_open() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='RoundOpened' THEN RAISE EXCEPTION 'synthetic opening failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_open BEFORE INSERT ON room_lifecycle FOR EACH ROW EXECUTE FUNCTION fail_open()`,
  );
  now += 6000;
  await expect(store.processDue()).rejects.toThrow("synthetic opening failure");
  expect(await readRoundBaseline(database.pool, started.roundId!)).toBeNull();
  expect((await store.snapshot(host.secret, code)).status).toBe("COUNTDOWN");
  await database.pool.query("DROP TRIGGER fail_open ON room_lifecycle");
  await store.processDue();
  const recovered = await readOpenedRound(database.pool, started.roundId!);
  expect(recovered).toMatchObject({
    sequence: 3,
    round: { opensAtMs: now - 1000, closesAtMs: now + 599000 },
  });
  expect(recovered!.trading.humans).toHaveLength(2);
  await store.processDue();
  expect(await readOpenedRound(database.pool, started.roundId!)).toEqual(
    recovered,
  );
});

it("atomically opens once with exact resources and restores private snapshots after ownership takeover (AC-02/10/14)", async () => {
  const { host, guest, code } = await lobby();
  const offline = await store.createSession({
    displayName: "Offline",
    avatar: "trex",
  });
  await store.join(offline.secret, code);
  for (const member of [host, guest])
    await store.ready(member.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  const requestId = randomUUID();
  const started = await store.start(host.secret, code, { requestId });
  now += 5000;
  await store.processDue();
  const first = await store.snapshot(host.secret, code);
  expect(first).toMatchObject({
    status: "OPEN",
    countdown: null,
    round: {
      roundId: started.roundId,
      sequence: 3,
      opensAt: now,
      closesAt: now + 600000,
      portfolio: {
        cashCents: 1000000,
        holdings: { FERN: 0, AMBR: 0, VOLC: 0, BONE: 0 },
      },
    },
  });
  expect(first.round!.assets.map((asset) => asset.symbol).sort()).toEqual([
    "AMBR",
    "BONE",
    "FERN",
    "VOLC",
  ]);
  expect(first.round!.quotes).toHaveLength(24);
  expect(
    first
      .round!.quotes.filter(
        (quote) => quote.symbol === "FERN" && quote.side === "ask",
      )
      .map((quote) => quote.priceCents),
  ).toEqual([4040, 4080, 4120]);
  const baseline = await readRoundBaseline(database.pool, started.roundId!);
  expect(baseline!.initialState.bot).toEqual({
    cashCents: 1000000000,
    holdings: { FERN: 100000, AMBR: 100000, VOLC: 100000, BONE: 100000 },
  });
  expect(
    baseline!.initialState.humans.map((player) => player.playerId),
  ).toEqual([
    host.player.playerId,
    guest.player.playerId,
    offline.player.playerId,
  ]);
  expect(baseline!.schedule).toHaveLength(9);
  expect(JSON.stringify(first)).not.toMatch(
    /catalogEvent|secret_hash|initialization|receipts/,
  );
  expect((await store.snapshot(guest.secret, code)).round).toEqual(first.round);
  const newcomer = await store.createSession({
    displayName: "Newcomer",
    avatar: "trex",
  });
  await expect(store.join(newcomer.secret, code)).rejects.toMatchObject({
    code: "JOIN_LOCKED",
  });
  expect((await store.join(offline.secret, code)).round).toEqual(first.round);
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).round).toEqual(first.round);
  expect(await store.start(host.secret, code, { requestId })).toEqual(started);
  await store.disconnect(host.player.playerId, code);
  await store.disconnect(guest.player.playerId, code);
  now += 300000;
  await store.processDue();
  expect((await store.snapshot(offline.secret, code)).status).toBe("OPEN");
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  await store.connect(host.secret, code);
  expect((await store.snapshot(host.secret, code)).round).toEqual(first.round);
  expect(await store.start(host.secret, code, { requestId })).toEqual(started);
});
afterEach(async () => {
  await store?.close();
  await database?.close();
});
async function lobby() {
  const host = await store.createSession({
    displayName: "Host",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Guest",
    avatar: "stegosaurus",
  });
  const room = await store.createRoom(host.secret);
  await store.join(guest.secret, room.code);
  await store.connect(host.secret, room.code);
  await store.connect(guest.secret, room.code);
  return { host, guest, code: room.code };
}

it("persists authorized readiness and returns the original outcome on retry (AC-05)", async () => {
  const { host, guest, code } = await lobby();
  const requestId = randomUUID();
  const result = await store.ready(host.secret, code, {
    ready: true,
    requestId,
  });
  expect(result).toMatchObject({ requestId });
  expect((await store.snapshot(guest.secret, code)).players[0]).toMatchObject({
    ready: true,
  });
  await store.ready(host.secret, code, {
    ready: false,
    requestId: randomUUID(),
  });
  expect(
    await store.ready(host.secret, code, { ready: true, requestId }),
  ).toEqual(result);
  expect((await store.snapshot(guest.secret, code)).players[0]).toMatchObject({
    ready: false,
  });
  await expect(
    store.ready(host.secret, code, { ready: false, requestId }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    store.ready(host.secret, code, {
      ready: true,
      requestId: randomUUID(),
      playerId: guest.player.playerId,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    store.ready("forged", code, { ready: true, requestId: randomUUID() }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});

it("locks every lobby member once under concurrent host starts and cancels when connectivity drops", async () => {
  const { host, guest, code } = await lobby();
  const offline = await store.createSession({
    displayName: "Offline",
    avatar: "trex",
  });
  await store.join(offline.secret, code);
  await expect(
    store.start(host.secret, code, { requestId: randomUUID() }),
  ).rejects.toMatchObject({ code: "NOT_ENOUGH_READY_PLAYERS" });
  await store.ready(host.secret, code, {
    ready: true,
    requestId: randomUUID(),
  });
  await store.ready(guest.secret, code, {
    ready: true,
    requestId: randomUUID(),
  });
  await expect(
    store.start(guest.secret, code, { requestId: randomUUID() }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const requestId = randomUUID();
  const outcomes = await Promise.allSettled([
    store.start(host.secret, code, { requestId }),
    store.start(host.secret, code, { requestId: randomUUID() }),
  ]);
  expect(outcomes.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  const result = outcomes[0];
  if (result?.status !== "fulfilled") throw new Error("Expected host start");
  const countdown = await store.snapshot(host.secret, code);
  expect(countdown).toMatchObject({
    status: "COUNTDOWN",
    countdown: {
      roundId: result.value.roundId,
      opensAt: now + 5000,
      closesAt: now + 605000,
      participantIds: [
        host.player.playerId,
        guest.player.playerId,
        offline.player.playerId,
      ],
    },
  });
  expect(await store.start(host.secret, code, { requestId })).toEqual(
    result.value,
  );
  const late = await store.createSession({
    displayName: "Late",
    avatar: "trex",
  });
  await expect(store.join(late.secret, code)).rejects.toMatchObject({
    code: "JOIN_LOCKED",
  });
  await expect(
    store.ready(guest.secret, code, { ready: false, requestId: randomUUID() }),
  ).rejects.toMatchObject({ code: "INVALID_ROOM_STATE" });
  now += 4999;
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).status).toBe("COUNTDOWN");
  await store.disconnect(guest.player.playerId, code);
  const cancelled = await store.snapshot(host.secret, code);
  expect(cancelled).toMatchObject({ status: "LOBBY", countdown: null });
  expect(cancelled.players.every((player) => !player.ready)).toBe(true);
  now += 1;
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).status).toBe("LOBBY");
  await store.join(late.secret, code);
  expect(await store.start(host.secret, code, { requestId })).toEqual(
    result.value,
  );
});
