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
  baseline.eventCatalog = [
    baseline.eventCatalog.find((e) => e.id === "fern-herd")!,
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
async function openRound(count = 2) {
  const players = [];
  for (let i = 0; i < count; i++)
    players.push(
      await store.createSession({ displayName: `Player ${i}`, avatar: "trex" }),
    );
  const { code } = await store.createRoom(players[0]!.secret);
  for (const [i, player] of players.entries()) {
    if (i) await store.join(player.secret, code);
    await store.connect(player.secret, code);
    await store.ready(player.secret, code, {
      ready: true,
      requestId: randomUUID(),
    });
  }
  await store.start(players[0]!.secret, code, { requestId: randomUUID() });
  now += 5000;
  await store.processDue();
  const round = (await store.snapshot(players[0]!.secret, code)).round!;
  return { players, host: players[0]!, code, round };
}
const order = (roundId: string, changes = {}) => ({
  roundId,
  requestId: randomUUID(),
  symbol: "FERN",
  side: "buy",
  quantity: 150,
  protectionPriceCents: 4100,
  ...changes,
});
it("commits AC-03 once and returns the original balances after retries, later trades and restart (AC-07/12/14)", async () => {
  const { host, code, round } = await openRound();
  const payload = order(round.roundId);
  const result = await store.submitOrder(host.secret, code, payload);
  expect(result).toMatchObject({
    status: "FILLED",
    filledQuantity: 150,
    totalValueCents: 608000,
    averagePrice: { numeratorCents: 608000, denominatorUnits: 150 },
    portfolio: { cashCents: 392000, holdings: { FERN: 150 } },
  });
  expect(result.fills.map((f) => [f.quantity, f.priceCents])).toEqual([
    [100, 4040],
    [50, 4080],
  ]);
  expect(
    await Promise.all([
      store.submitOrder(host.secret, code, payload),
      store.submitOrder(host.secret, code, {
        ...payload,
        requestId: payload.requestId.toUpperCase(),
      }),
    ]),
  ).toEqual([result, result]);
  await expect(
    store.submitOrder(host.secret, code, { ...payload, quantity: 1 }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await store.submitOrder(
    host.secret,
    code,
    order(round.roundId, {
      side: "sell",
      quantity: 10,
      protectionPriceCents: 3800,
    }),
  );
  const updated = (await store.snapshot(host.secret, code)).round!;
  expect(updated.portfolio.holdings.FERN).toBe(140);
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.submitOrder(host.secret, code, payload)).toEqual(result);
  expect((await store.snapshot(host.secret, code)).round).toEqual(updated);
  expect(await readOpenedRound(database.pool, round.roundId)).toMatchObject({
    receipts: [
      { command: { requestId: payload.requestId } },
      expect.anything(),
    ],
  });
});
it("preserves protection for partial and zero fills and persists resource rejections (AC-04/06/07)", async () => {
  const { host, code, round } = await openRound();
  const partial = await store.submitOrder(
    host.secret,
    code,
    order(round.roundId, { protectionPriceCents: 4040 }),
  );
  expect(partial).toMatchObject({
    status: "PARTIALLY_FILLED",
    filledQuantity: 100,
    remainingQuantity: 50,
    totalValueCents: 404000,
    portfolio: { cashCents: 596000, holdings: { FERN: 100 } },
  });
  const zero = await store.submitOrder(
    host.secret,
    code,
    order(round.roundId, { quantity: 1, protectionPriceCents: 4000 }),
  );
  expect(zero).toMatchObject({
    status: "NO_LIQUIDITY_WITHIN_PROTECTION",
    filledQuantity: 0,
    totalValueCents: 0,
    averagePrice: null,
    portfolio: partial.portfolio,
  });
  for (const change of [
    { quantity: 200, protectionPriceCents: 4100 },
    { side: "sell", quantity: 101, protectionPriceCents: 3800 },
    { quantity: 1001 },
    { protectionPriceCents: 1 },
  ]) {
    const payload = order(round.roundId, change);
    const result = await store.submitOrder(host.secret, code, payload);
    expect(result).toMatchObject({
      status: "REJECTED",
      fills: [],
      portfolio: partial.portfolio,
    });
    expect(await store.submitOrder(host.secret, code, payload)).toEqual(result);
  }
  now += 200;
  const sell = await store.submitOrder(
    host.secret,
    code,
    order(round.roundId, {
      side: "sell",
      quantity: 100,
      protectionPriceCents: 3900,
    }),
  );
  expect(sell).toMatchObject({
    status: "FILLED",
    filledQuantity: 100,
    totalValueCents: 396300,
    portfolio: { cashCents: 992300, holdings: { FERN: 0 } },
  });
});
it.each([true, false])(
  "drains due effects before matching in either scheduler queue order (%s)",
  async (commandFirst) => {
    const { host, code, round } = await openRound();
    now += 60000;
    const payload = order(round.roundId, {
      quantity: 1,
      protectionPriceCents: 4300,
    });
    const command = () => store.submitOrder(host.secret, code, payload);
    const results = commandFirst
      ? await Promise.all([command(), store.processDue()])
      : await Promise.all([store.processDue(), command()]);
    expect(results[commandFirst ? 0 : 1]).toMatchObject({
      status: "FILLED",
      totalValueCents: 4242,
      protectionPriceCents: 4300,
    });
    expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(
      1,
    );
  },
);
it("makes closing rejections durable without rolling back due work or losing original outcomes (AC-05/07/11 subset)", async () => {
  const { host, code, round } = await openRound();
  now = round.closesAt - 1;
  const before = order(round.roundId, {
    quantity: 1,
    protectionPriceCents: 100,
  });
  const original = await store.submitOrder(host.secret, code, before);
  expect(original.status).toBe("NO_LIQUIDITY_WITHIN_PROTECTION");
  now++;
  const at = order(round.roundId, { quantity: 1 });
  const closed = await store.submitOrder(host.secret, code, at);
  expect(closed).toMatchObject({
    status: "REJECTED",
    rejectionCode: "MARKET_CLOSED",
    fills: [],
  });
  now += 100;
  expect(await store.submitOrder(host.secret, code, at)).toEqual(closed);
  expect(await store.submitOrder(host.secret, code, before)).toEqual(original);
  expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(9);
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await store.submitOrder(host.secret, code, at)).toEqual(closed);
  expect(await store.isReady()).toBe(false);
});
it("uses a ten-token burst and exact five-per-second refill for a player across concurrent requests, including retries", async () => {
  const { host, code, round } = await openRound();
  const payload = order(round.roundId, {
    quantity: 1,
    protectionPriceCents: 100,
  });
  const original = await store.submitOrder(host.secret, code, payload);
  for (let i = 1; i < 10; i++)
    expect(await store.submitOrder(host.secret, code, payload)).toEqual(
      original,
    );
  await expect(
    store.submitOrder(host.secret, code, payload),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  now += 199;
  await expect(
    store.submitOrder(host.secret, code, payload),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  now++;
  expect(await store.submitOrder(host.secret, code, payload)).toEqual(original);
  const stable = (await store.snapshot(host.secret, code)).round!;
  expect(stable.sequence).toBe(original.sequence);
  now += 2000;
  const outcomes = await Promise.allSettled(
    Array.from({ length: 11 }, () =>
      store.submitOrder(host.secret, code, payload),
    ),
  );
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(10);
});
it("rejects malformed, forged, expired, nonmember and wrong-round requests without market changes", async () => {
  const { host, players, code, round } = await openRound();
  const stranger = await store.createSession({
    displayName: "Stranger",
    avatar: "trex",
  });
  const payload = order(round.roundId);
  for (const changed of [
    { playerId: players[1]!.player.playerId },
    { quantity: 1.1 },
    { symbol: "USD" },
    { extra: true },
  ])
    await expect(
      store.submitOrder(host.secret, code, { ...payload, ...changed }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(store.submitOrder("bad", code, payload)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  await expect(
    store.submitOrder(stranger.secret, code, payload),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    store.submitOrder(host.secret, code, { ...payload, roundId: randomUUID() }),
  ).rejects.toMatchObject({ code: "ROUND_MISMATCH" });
  await database.pool.query(
    "UPDATE guest_sessions SET expires_at_ms=$1 WHERE player_id=$2",
    [now, host.player.playerId],
  );
  await expect(
    store.submitOrder(host.secret, code, payload),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect((await store.snapshot(players[1]!.secret, code)).round).toEqual(round);
});
it("rolls back fills, identities, ledgers and due news before commit, then succeeds once (AC-14)", async () => {
  const { host, code, round } = await openRound();
  const payload = order(round.roundId, {
    quantity: 1,
    protectionPriceCents: 4300,
  });
  now += 60000;
  await database.pool.query(
    `CREATE FUNCTION fail_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic order failure'; END $$; CREATE TRIGGER fail_order BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION fail_order()`,
  );
  await expect(store.submitOrder(host.secret, code, payload)).rejects.toThrow(
    "synthetic order failure",
  );
  expect((await store.snapshot(host.secret, code)).round).toEqual(round);
  await database.pool.query("DROP TRIGGER fail_order ON orders");
  expect(await store.submitOrder(host.secret, code, payload)).toMatchObject({
    status: "FILLED",
    totalValueCents: 4242,
  });
  expect((await store.snapshot(host.secret, code)).round?.news).toHaveLength(1);
});
it("prevents success if ownership is lost after order insertion", async () => {
  const { host, code, round } = await openRound();
  await database.pool.query(
    `CREATE FUNCTION lose_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_unlock(18474,hashtext(current_schema())); RETURN NEW; END $$; CREATE TRIGGER lose_owner BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION lose_owner()`,
  );
  await expect(
    store.submitOrder(host.secret, code, order(round.roundId)),
  ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  expect(await readOpenedRound(database.pool, round.roundId)).toMatchObject({
    sequence: 3,
    receipts: [],
  });
  expect(await store.isReady()).toBe(false);
});
it("serializes eight participants and replays conserved finite ledgers (AC-08/16)", async () => {
  const { players, code, round } = await openRound(8);
  const buys = await Promise.all(
    players.map((p) =>
      store.submitOrder(
        p.secret,
        code,
        order(round.roundId, { quantity: 10, protectionPriceCents: 4500 }),
      ),
    ),
  );
  expect(buys.every((r) => r.status === "FILLED")).toBe(true);
  now += 1000;
  await Promise.all(
    players.map((p) =>
      store.submitOrder(
        p.secret,
        code,
        order(round.roundId, {
          side: "sell",
          quantity: 10,
          protectionPriceCents: 3800,
        }),
      ),
    ),
  );
  let seed = 410;
  for (let cycle = 0; cycle < 4; cycle++) {
    now += 1000;
    const quantities = players.map(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed % 5) + 1;
    });
    await Promise.all(
      players.map((player, index) =>
        store.submitOrder(
          player.secret,
          code,
          order(round.roundId, {
            quantity: quantities[index],
            protectionPriceCents: 4500,
          }),
        ),
      ),
    );
    now += 1000;
    await Promise.all(
      players.map((player, index) =>
        store.submitOrder(
          player.secret,
          code,
          order(round.roundId, {
            side: "sell",
            quantity: quantities[index],
            protectionPriceCents: 3800,
          }),
        ),
      ),
    );
  }
  const state = await readOpenedRound(database.pool, round.roundId);
  expect(state?.receipts).toHaveLength(80);
  expect(
    state?.trading.humans.every(
      (h) => h.holdings.FERN === 0 && h.cashCents >= 0,
    ),
  ).toBe(true);
  await store.close();
  store = await LobbyStore.open(database.pool, () => now);
  expect(await readOpenedRound(database.pool, round.roundId)).toEqual(state);
}, 20000);
it("rejects derived outcome damage during replay rather than accepting private false balances", async () => {
  const { host, code, round } = await openRound();
  await store.submitOrder(host.secret, code, order(round.roundId));
  await database.pool.query(
    "ALTER TABLE orders DISABLE TRIGGER immutable_order",
  );
  await database.pool.query(
    "UPDATE orders SET outcome=jsonb_set(outcome,'{portfolio,cashCents}','0')",
  );
  await expect(readOpenedRound(database.pool, round.roundId)).rejects.toThrow(
    "Order result disagrees",
  );
  expect(await store.isReady()).toBe(false);
});
it("persists exhausted finite bot liquidity without replenishing cash or units", async () => {
  await store.close();
  const baseline = loadBaseline();
  baseline.rules.bot.startingCashCents = 0;
  baseline.rules.bot.startingUnitsPerAsset = 2;
  store = await LobbyStore.open(
    database.pool,
    () => now,
    baseline.rules.room,
    baseline,
  );
  const { host, players, code, round } = await openRound();
  const first = await store.submitOrder(
    host.secret,
    code,
    order(round.roundId, { quantity: 3 }),
  );
  expect(first).toMatchObject({
    status: "PARTIALLY_FILLED",
    filledQuantity: 2,
    remainingQuantity: 1,
    totalValueCents: 8080,
  });
  const other = await store.submitOrder(
    players[1]!.secret,
    code,
    order(round.roundId, { quantity: 1 }),
  );
  expect(other).toMatchObject({
    status: "NO_LIQUIDITY_WITHIN_PROTECTION",
    fills: [],
  });
  expect(await readOpenedRound(database.pool, round.roundId)).toMatchObject({
    trading: {
      market: {
        bot: {
          cashCents: 8080,
          holdings: { FERN: 0, AMBR: 2, BONE: 2, VOLC: 2 },
        },
      },
    },
  });
});
