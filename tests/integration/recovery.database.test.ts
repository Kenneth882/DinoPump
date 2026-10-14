import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";
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
  for (const player of [host, guest]) {
    await store.connect(player.secret, code);
    await store.ready(player.secret, code, {
      requestId: randomUUID(),
      ready: true,
    });
  }
  await store.start(host.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const round = (await store.snapshot(host.secret, code)).round!;
  const request = {
    roundId: round.roundId,
    requestId: randomUUID(),
    symbol: "FERN",
    side: "buy",
    quantity: 150,
    protectionPriceCents: 4100,
  };
  const outcome = await store.submitOrder(host.secret, code, request);
  return { host, guest, code, round, request, outcome };
}
it("rebuilds a discarded projection from committed trades without refunding or losing original outcomes (AC-07/12)", async () => {
  const { host, code, round, request, outcome } = await openRound();
  const original = await readOpenedRound(database.pool, round.roundId);
  await store.close();
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  const changedDefaults = loadBaseline();
  changedDefaults.rules.player.startingCashCents = 2000000;
  changedDefaults.rules.bot.startingUnitsPerAsset = 200000;
  store = await LobbyStore.open(
    database.pool,
    () => now,
    changedDefaults.rules.room,
    changedDefaults,
  );
  expect(await store.isReady()).toBe(true);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(original);
  expect(await store.submitOrder(host.secret, code, request)).toEqual(outcome);
  expect((await store.snapshot(host.secret, code)).round?.portfolio).toEqual(
    outcome.portfolio,
  );
});
it("rebuilds historical finished projections after lobby reset while preserving immutable private results (AC-11/12/15)", async () => {
  const { host, code, round } = await openRound();
  now = round.closesAt;
  await store.processDue();
  const original = await store.results(host.secret, round.roundId);
  const state = await readOpenedRound(database.pool, round.roundId);
  await store.returnToLobby(host.secret, code, {
    roundId: round.roundId,
    requestId: randomUUID(),
  });
  await store.close();
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.results(host.secret, round.roundId)).toEqual(original);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(state);
  expect((await store.snapshot(host.secret, code)).status).toBe("LOBBY");
});
it("aborts unverifiable committed outcomes on startup without replacing evidence or serving a false retry balance (AC-07/12)", async () => {
  const { host, code, round, request } = await openRound();
  await store.close();
  await database.pool.query(
    "ALTER TABLE orders DISABLE TRIGGER immutable_order",
  );
  await database.pool.query(
    "UPDATE orders SET outcome=jsonb_set(outcome,'{portfolio,cashCents}','0') WHERE round_id=$1",
    [round.roundId],
  );
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  const snapshot = await store.snapshot(host.secret, code);
  expect(snapshot).toMatchObject({
    status: "ABORTED",
    round: null,
    terminal: { status: "ABORTED" },
  });
  expect(snapshot.terminal).not.toHaveProperty("rankings");
  await expect(readOpenedRound(database.pool, round.roundId)).rejects.toThrow(
    "Order result disagrees",
  );
  await expect(
    store.submitOrder(host.secret, code, request),
  ).rejects.toMatchObject({ code: "MARKET_CLOSED" });
});
it("refuses an unsupported initialization event version instead of rebuilding a plausible projection (AC-12)", async () => {
  const { host, code, round } = await openRound();
  await store.close();
  await database.pool.query(
    "ALTER TABLE game_events DISABLE TRIGGER immutable_event",
  );
  await database.pool.query(
    "UPDATE game_events SET schema_version=2 WHERE round_id=$1 AND sequence=1",
    [round.roundId],
  );
  await database.pool.query("DELETE FROM round_projections WHERE round_id=$1", [
    round.roundId,
  ]);
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.snapshot(host.secret, code)).toMatchObject({
    status: "ABORTED",
    terminal: { status: "ABORTED" },
  });
});
it("repairs a malformed stale projection on an owned read before returning cash, quotes or rankings (AC-12/16)", async () => {
  const { host, code, round } = await openRound();
  const original = await store.snapshot(host.secret, code);
  const state = await readOpenedRound(database.pool, round.roundId);
  await database.pool.query(
    "UPDATE round_projections SET sequence=1,schema_version=99,state='{}' WHERE round_id=$1",
    [round.roundId],
  );
  expect(await store.snapshot(host.secret, code)).toEqual(original);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(state);
});
