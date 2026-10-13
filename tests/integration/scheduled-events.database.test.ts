import { processEngineCommand } from "../../packages/engine/src/index.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolatedDatabase } from "../helpers/database.js";
import {
  LobbyStore,
  migrate,
  readOpenedRound,
} from "../../packages/database/src/index.js";
import { loadBaseline } from "../../packages/game-content/src/index.js";

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let store: LobbyStore;
let now: number;
beforeEach(async () => {
  now = 1_800_000_000_000;
  database = await isolatedDatabase();
  await migrate(database.pool);
  const baseline = loadBaseline();
  // A single authored source makes independent expected prices unambiguous.
  baseline.eventCatalog = [
    baseline.eventCatalog.find((event) => event.id === "fern-herd")!,
  ];
  store = await LobbyStore.open(
    database.pool,
    () => now,
    baseline.rules.room,
    baseline,
  );
});
afterEach(async () => {
  await store?.close();
  await database?.close();
});
async function openRound() {
  const host = await store.createSession({
    displayName: "Host",
    avatar: "trex",
  });
  const guest = await store.createSession({
    displayName: "Guest",
    avatar: "stegosaurus",
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
  const snapshot = await store.snapshot(host.secret, code);
  return { host, guest, code, opening: snapshot.round! };
}

it("applies a due reference shock and immediate template exactly once while idle marks stay fixed (AC-09/13)", async () => {
  const { host, code, opening } = await openRound();
  now += 59_999;
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).round).toEqual(opening);
  now += 1;
  await store.processDue();
  const round = (await store.snapshot(host.secret, code)).round!;
  expect(round.assets.find((asset) => asset.symbol === "FERN")).toEqual({
    symbol: "FERN",
    referencePriceCents: 4200,
    lastPriceCents: 4000,
  });
  expect(round).toMatchObject({
    news: [
      {
        scheduledEventId: `${opening.roundId}:1`,
        dueAtMs: now,
        appliedAtMs: now,
        narrationStatus: "pending",
        effects: [
          {
            symbol: "FERN",
            beforeCents: 4000,
            afterCents: 4200,
            changeBps: 500,
          },
        ],
      },
    ],
  });
  expect(round.portfolio).toEqual(opening.portfolio);
  await Promise.all([store.processDue(), store.processDue()]);
  expect((await store.snapshot(host.secret, code)).round).toEqual(round);
  expect(await readOpenedRound(database.pool, opening.roundId)).toMatchObject({
    nextScheduledEvent: 1,
  });
});

it("rolls back effects and news when job insertion fails, then retries once (AC-14)", async () => {
  const { host, code, opening } = await openRound();
  await database.pool.query(
    `CREATE FUNCTION fail_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic job failure'; END $$; CREATE TRIGGER fail_job BEFORE INSERT ON commentary_jobs FOR EACH ROW EXECUTE FUNCTION fail_job()`,
  );
  now += 60000;
  await expect(store.processDue()).rejects.toThrow("synthetic job failure");
  expect((await store.snapshot(host.secret, code)).round).toEqual(opening);
  await database.pool.query("DROP TRIGGER fail_job ON commentary_jobs");
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(1);
});

it("catches up all nine frozen events without connections or a close-time event and replays after restart (AC-09/15)", async () => {
  const { host, guest, code, opening } = await openRound();
  await store.disconnect(host.player.playerId, code);
  await store.disconnect(guest.player.playerId, code);
  await store.close();
  now += 180000;
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.isReady()).toBe(true);
  const caughtUp = (await store.snapshot(host.secret, code)).round!;
  expect(caughtUp.news.map((item) => item.scheduledEventId)).toEqual(
    [1, 2, 3].map((n) => `${opening.roundId}:${n}`),
  );
  expect(
    caughtUp.assets.find((asset) => asset.symbol === "FERN")
      ?.referencePriceCents,
  ).toBe(4631);
  await store.close();
  now = opening.closesAt + 30000;
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.isReady()).toBe(true);
  const final = (await store.snapshot(host.secret, code)).round!;
  expect(final.news).toHaveLength(9);
  expect(final.news.map((item) => item.dueAtMs - opening.opensAt)).toEqual([
    60000, 120000, 180000, 240000, 300000, 360000, 420000, 480000, 540000,
  ]);
  expect(final.news.every((item) => item.dueAtMs < opening.closesAt)).toBe(
    true,
  );
  expect(final.closesAt).toBe(opening.closesAt);
  expect(final.portfolio).toEqual(opening.portfolio);
  await store.processDue();
  expect((await store.snapshot(host.secret, code)).round).toEqual(final);
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect((await store.snapshot(host.secret, code)).round).toEqual(final);
});

it("reports commit lag from the recorded deadline and becomes ready after due processing", async () => {
  const { opening } = await openRound();
  now += 60500;
  expect(await store.isReady()).toBe(false);
  expect(await store.processDue()).toMatchObject([
    { roundId: opening.roundId, dueAtMs: opening.opensAt + 60000, lagMs: 500 },
  ]);
  expect(await store.isReady()).toBe(true);
  expect(await store.processDue()).toEqual([]);
});

it("applies each boundary once, including a multi-symbol effect, without creating units or changing marks", async () => {
  await store.close();
  const baseline = loadBaseline();
  const event = baseline.eventCatalog[0]!;
  event.effects.push({ symbol: "AMBR", referenceChangeBps: -500 });
  baseline.eventCatalog = [event];
  store = await LobbyStore.open(
    database.pool,
    () => now,
    baseline.rules.room,
    baseline,
  );
  const { host, code, opening } = await openRound();
  for (let count = 1; count <= 9; count++) {
    now = opening.opensAt + count * 60000 - 1;
    await store.processDue();
    expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(
      count - 1,
    );
    now++;
    await Promise.all([store.processDue(), store.processDue()]);
    const round = (await store.snapshot(host.secret, code)).round!;
    expect(round.news).toHaveLength(count);
    expect(round.portfolio).toEqual(opening.portfolio);
    expect(round.assets.map((asset) => asset.lastPriceCents)).toEqual(
      opening.assets.map((asset) => asset.lastPriceCents),
    );
    if (count === 1) {
      expect(round.news[0]?.effects).toEqual([
        { symbol: "FERN", beforeCents: 4000, afterCents: 4200, changeBps: 500 },
        {
          symbol: "AMBR",
          beforeCents: 7500,
          afterCents: 7125,
          changeBps: -500,
        },
      ]);
    }
  }
  now = opening.closesAt;
  expect(await store.processDue()).toEqual([]);
  expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(9);
});

it("rolls back a due event if ownership is lost inside the transaction", async () => {
  const { opening } = await openRound();
  await database.pool.query(
    `CREATE FUNCTION lose_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_unlock(18474,hashtext(current_schema())); RETURN NEW; END $$; CREATE TRIGGER lose_owner BEFORE INSERT ON news_items FOR EACH ROW EXECUTE FUNCTION lose_owner()`,
  );
  now += 60000;
  await expect(store.processDue()).rejects.toMatchObject({
    code: "SERVICE_UNAVAILABLE",
  });
  expect(await store.isReady()).toBe(false);
  expect(await readOpenedRound(database.pool, opening.roundId)).toMatchObject({
    sequence: 3,
    nextScheduledEvent: 0,
  });
});

it("rejects narration inputs tampered independently of committed market history", async () => {
  const { opening } = await openRound();
  now += 60000;
  await store.processDue();
  await database.pool.query("UPDATE commentary_jobs SET input='{}'::jsonb");
  await expect(readOpenedRound(database.pool, opening.roundId)).rejects.toThrow(
    "Scheduled news or job disagrees with history",
  );
  expect(await store.isReady()).toBe(false);
});

it.each([true, false])(
  "serializes a due tick racing a synthetic command (command first: %s)",
  async (commandFirst) => {
    const { host, code, opening } = await openRound();
    now += 60000;
    const command = () =>
      store.withMarketRound(opening.roundId, async (_client, state, atMs) =>
        processEngineCommand(state, {
          type: "SubmitOrder",
          atMs,
          order: {
            roundId: opening.roundId,
            playerId: host.player.playerId,
            requestId: randomUUID(),
            symbol: "FERN",
            side: "buy",
            quantity: 1,
            protectionPriceCents: 4300,
          },
        }),
      );
    const outcome = commandFirst
      ? await Promise.all([command(), store.processDue()])
      : await Promise.all([store.processDue(), command()]);
    expect(outcome[commandFirst ? 0 : 1]).toMatchObject({
      ok: true,
      receipt: { result: { ok: true, outcome: { totalValueCents: 4242 } } },
    });
    const round = (await store.snapshot(host.secret, code)).round!;
    expect(round.news).toHaveLength(1);
    expect(await readOpenedRound(database.pool, opening.roundId)).toMatchObject(
      { nextScheduledEvent: 1 },
    );
    // The callback demonstrates ordering only; order persistence remains ticket #10.
    expect(round.portfolio).toEqual(opening.portfolio);
  },
);
