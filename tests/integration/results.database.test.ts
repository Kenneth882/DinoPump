import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import {
  LobbyStore,
  migrate,
  readOpenedRound,
} from "../../packages/database/src/index.js";
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let now: number;
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
  store = await LobbyStore.open(database.pool, () => now);
});
afterEach(async () => {
  await store?.close();
  await database?.close();
});
async function openRound() {
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
  for (const p of [host, guest]) {
    await store.connect(p.secret, code);
    await store.ready(p.secret, code, { requestId: randomUUID(), ready: true });
  }
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  return {
    host,
    guest,
    code,
    round: (await store.snapshot(host.secret, code)).round!,
  };
}
it("settles at the exact deadline once, freezes initial marks and shared ranks, and stays ready (AC-09/11/12/15)", async () => {
  const { host, guest, code, round } = await openRound();
  now = round.closesAt - 1;
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).status).toBe("OPEN");
  now++;
  await Promise.all([store.processDue(), store.processDue()]);
  const snapshot = await store.snapshot(host.secret, code);
  expect(snapshot.status).toBe("FINISHED");
  expect(snapshot.terminal).toMatchObject({
    status: "FINISHED",
    marks: { FERN: 4000 },
    rankings: [
      { playerId: host.player.playerId, rank: 1, portfolioValueCents: 1000000 },
      {
        playerId: guest.player.playerId,
        rank: 1,
        portfolioValueCents: 1000000,
      },
    ],
    portfolio: { cashCents: 1000000, holdings: { FERN: 0 } },
  });
  expect(snapshot.round?.news).toHaveLength(9);
  const result = await store.results(host.secret, round.roundId);
  now += 10000;
  await store.processDue();
  expect(await store.results(host.secret, round.roundId)).toEqual(result);
  expect(await store.isReady()).toBe(true);
  expect(
    (await readOpenedRound(database.pool, round.roundId))?.finalResult
      ?.settlementSequence,
  ).toBe(snapshot.round?.sequence);
});
it("retains owned final portfolios after host reset and a fresh second round, without granting new guests access (AC-01/02/11)", async () => {
  const { host, guest, code, round } = await openRound();
  const request = {
    roundId: round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const bought = await store.submitOrder(host.secret, code, request);
  await store.disconnect(guest.player.playerId, code);
  now = round.closesAt;
  const closed = await store.submitOrder(host.secret, code, {
    ...request,
    requestId: randomUUID(),
  });
  expect(closed.rejectionCode).toBe("MARKET_CLOSED");
  expect(await store.submitOrder(host.secret, code, request)).toEqual(bought);
  const result = await store.results(host.secret, round.roundId);
  expect(result).toMatchObject({
    status: "FINISHED",
    marks: { FERN: 4080 },
    rankings: [
      {
        playerId: host.player.playerId,
        rank: 1,
        portfolioValueCents: 1004000,
        profitCents: 4000,
        returnPercent: 0.4,
      },
      { playerId: guest.player.playerId, rank: 2 },
    ],
    portfolio: { cashCents: 392000, holdings: { FERN: 150 } },
  });
  expect(await store.results(guest.secret, round.roundId)).toMatchObject({
    portfolio: { cashCents: 1000000, holdings: { FERN: 0 } },
  });
  const reset = { roundId: round.roundId, requestId: randomUUID() };
  await expect(
    store.returnToLobby(guest.secret, code, reset),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const ack = await store.returnToLobby(host.secret, code, reset);
  expect(await store.snapshot(host.secret, code)).toMatchObject({
    status: "LOBBY",
    round: null,
    terminal: null,
    players: [{ ready: false }, { ready: false }],
  });
  const newcomer = await store.createSession({
    displayName: "New guest",
    avatar: "trex",
  });
  await store.join(newcomer.secret, code);
  await expect(
    store.results(newcomer.secret, round.roundId),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await store.connect(guest.secret, code);
  for (const p of [host, guest])
    await store.ready(p.secret, code, { requestId: randomUUID(), ready: true });
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const next = (await store.snapshot(host.secret, code)).round!;
  expect(next.roundId).not.toBe(round.roundId);
  expect(next.portfolio).toMatchObject({
    cashCents: 1000000,
    holdings: { FERN: 0 },
  });
  expect(await store.returnToLobby(host.secret, code, reset)).toEqual(ack);
  expect((await store.snapshot(host.secret, code)).round?.roundId).toBe(
    next.roundId,
  );
  await expect(
    store.returnToLobby(host.secret, code, {
      ...reset,
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "INVALID_ROOM_STATE" });
  await expect(
    store.returnToLobby(host.secret, code, { ...reset, roundId: next.roundId }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect(await store.results(host.secret, round.roundId)).toEqual(result);
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.results(host.secret, round.roundId)).toEqual(result);
});
it("rolls back settlement before commit and recovers one frozen result after restart without delivery (AC-14/15)", async () => {
  const { host, guest, code, round } = await openRound();
  await store.disconnect(host.player.playerId, code);
  await store.disconnect(guest.player.playerId, code);
  now = round.closesAt;
  await database.pool.query(
    `CREATE FUNCTION fail_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic result failure'; END $$; CREATE TRIGGER fail_result BEFORE INSERT ON round_results FOR EACH ROW EXECUTE FUNCTION fail_result()`,
  );
  await expect(store.processDue()).rejects.toThrow("synthetic result failure");
  expect((await store.snapshot(host.secret, code)).status).toBe("OPEN");
  expect((await readOpenedRound(database.pool, round.roundId))?.sequence).toBe(
    3,
  );
  await database.pool.query("DROP TRIGGER fail_result ON round_results");
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  const original = await store.results(host.secret, round.roundId);
  await store.close();
  store = await LobbyStore.open(database.pool, () => now + 1000);
  expect(await store.results(host.secret, round.roundId)).toEqual(original);
  await expect(
    database.pool.query("UPDATE round_results SET portfolios='{}'"),
  ).rejects.toThrow("immutable");
  await expect(
    database.pool.query("DELETE FROM round_results"),
  ).rejects.toThrow("immutable");
});
it("records a safe abort for unverifiable history, allows reset, and never invents a winner (AC-11/12)", async () => {
  const { host, code, round } = await openRound();
  await database.pool.query(
    "UPDATE round_projections SET state=jsonb_set(state,'{trading,humans,0,cashCents}','0') WHERE round_id=$1",
    [round.roundId],
  );
  await expect(store.processDue()).rejects.toThrow();
  const snapshot = await store.snapshot(host.secret, code);
  expect(snapshot).toMatchObject({
    status: "ABORTED",
    round: null,
    terminal: { status: "ABORTED", roundId: round.roundId },
  });
  expect(snapshot.terminal).not.toHaveProperty("rankings");
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.results(host.secret, round.roundId)).toEqual(
    snapshot.terminal,
  );
  expect(await store.isReady()).toBe(true);
  await store.returnToLobby(host.secret, code, {
    roundId: round.roundId,
    requestId: randomUUID(),
  });
  expect((await store.snapshot(host.secret, code)).status).toBe("LOBBY");
});
it("does not write an abort when ownership is lost during integrity recovery", async () => {
  const { host, code, round } = await openRound();
  await database.pool.query(
    "UPDATE round_projections SET state=jsonb_set(state,'{trading,humans,0,cashCents}','0') WHERE round_id=$1",
    [round.roundId],
  );
  await database.pool.query(
    `CREATE FUNCTION lose_abort_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_unlock(18474,hashtext(current_schema())); RETURN NEW; END $$; CREATE TRIGGER lose_abort_owner BEFORE INSERT ON round_aborts FOR EACH ROW EXECUTE FUNCTION lose_abort_owner()`,
  );
  await expect(store.processDue()).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  await expect(store.snapshot(host.secret, code)).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  await database.pool.query("DROP TRIGGER lose_abort_owner ON round_aborts");
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.snapshot(host.secret, code)).toMatchObject({
    status: "ABORTED",
    terminal: { status: "ABORTED" },
  });
});
it("preserves an existing valid final result when a later projection cannot be verified", async () => {
  const { host, code, round } = await openRound();
  now = round.closesAt;
  await store.processDue();
  const original = await store.results(host.secret, round.roundId);
  const verified = await readOpenedRound(database.pool, round.roundId);
  await database.pool.query(
    "UPDATE round_projections SET state=jsonb_set(state,'{trading,humans,0,cashCents}','0') WHERE round_id=$1",
    [round.roundId],
  );
  expect(await store.isReady()).toBe(false);
  await expect(store.snapshot(host.secret, code)).rejects.toThrow();
  await expect(
    database.pool.query(
      "INSERT INTO round_aborts(round_id,public_view) VALUES ($1,$2)",
      [round.roundId, { roundId: round.roundId, status: "ABORTED" }],
    ),
  ).rejects.toThrow("immutable");
  // Test-owned repair demonstrates preservation; automatic projection rebuilding
  // remains Ticket 13, and this service stays unready while verification fails.
  await database.pool.query(
    "UPDATE round_projections SET state=$2 WHERE round_id=$1",
    [round.roundId, verified],
  );
  expect(await store.results(host.secret, round.roundId)).toEqual(original);
  expect((await store.snapshot(host.secret, code)).status).toBe("FINISHED");
});
