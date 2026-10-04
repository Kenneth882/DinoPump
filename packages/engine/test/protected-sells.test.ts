import { describe, expect, it } from "vitest";
import {
  buildRoundBaseline,
  loadBaseline,
} from "../../game-content/src/index.js";
import {
  executeBuy,
  executeSell,
  initializeBotQuotes,
  rebuildBotQuotes,
} from "../src/index.js";
import {
  assetSymbolSchema,
  sellResultSchema,
  buyResultSchema,
  type BuyState,
} from "../../contracts/src/index.js";

const playerId = "00000000-0000-4000-8000-000000000001";
const roundId = "00000000-0000-4000-8000-000000000003";

function fixture() {
  const round = buildRoundBaseline({
    roundId,
    seed: 3,
    configVersion: "1.0",
    participantIds: [playerId, "00000000-0000-4000-8000-000000000002"],
    createdAtMs: 0,
    opensAtMs: 5_000,
    config: loadBaseline(),
  });
  const quotes = initializeBotQuotes(round);
  if (!quotes.ok) throw new Error(JSON.stringify(quotes));
  return {
    market: quotes.state,
    quotes: quotes.quotes,
    reservations: quotes.reservations,
    status: "OPEN" as const,
    humans: round.initialState.humans,
    lastPrices: { AMBR: 7500, BONE: 2500, FERN: 4000, VOLC: 10000 },
  };
}

function command() {
  return {
    roundId,
    requestId: "00000000-0000-4000-8000-000000000004",
    playerId,
    side: "sell" as const,
    symbol: "FERN" as const,
    quantity: 150,
    protectionPriceCents: 3900,
  };
}

function replaceQuotes(state: BuyState) {
  const replacement = rebuildBotQuotes(state.market);
  if (!replacement.ok) throw new Error(JSON.stringify(replacement));
  state.market = replacement.state;
  state.quotes = replacement.quotes;
  state.reservations = replacement.reservations;
}

describe("protected sells (AC-04, AC-05, AC-06, AC-08, AC-16 engine evidence)", () => {
  it("preserves conservation, nonnegative balances, covered reservations and determinism across 1000 seeded mixed orders (AC-08, AC-16)", () => {
    let state: BuyState = fixture();
    state.humans.forEach((human) => {
      human.cashCents = 100000000;
    });
    state.market.bot.cashCents = 0;
    state.market.bot.holdings = {
      AMBR: 4000,
      BONE: 3000,
      FERN: 2000,
      VOLC: 1000,
    };
    replaceQuotes(state);
    let seed = 5;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 8;
    };
    const outcomes = new Set<string>();
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const symbol = assetSymbolSchema.options[next() % 4]!;
      const side = next() % 2 === 0 ? "buy" : "sell";
      const reference = state.market.assets.find(
        (a) => a.symbol === symbol,
      )!.referencePriceCents;
      const order = {
        ...command(),
        side,
        symbol,
        playerId: state.humans[next() % 2]!.playerId,
        quantity: 1 + (next() % 500),
        protectionPriceCents: Math.max(
          100,
          Math.min(1000000, reference + (next() % 1000) - 500),
        ),
      };
      const execute = side === "buy" ? executeBuy : executeSell;
      const before = structuredClone(state);
      const result = execute(state, order);
      expect(result).toEqual(
        execute(structuredClone(state), structuredClone(order)),
      );
      expect(state).toEqual(before);
      const schema = side === "buy" ? buyResultSchema : sellResultSchema;
      expect(schema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
      outcomes.add(
        side + ":" + (result.ok ? result.outcome.status : result.code),
      );
      if (!result.ok) continue;
      state = result.state;
      expect(
        state.humans.reduce(
          (sum, h) => sum + BigInt(h.cashCents),
          BigInt(state.market.bot.cashCents),
        ),
      ).toBe(200000000n);
      for (const ledger of [...state.humans, state.market.bot]) {
        expect(ledger.cashCents).toBeGreaterThanOrEqual(0);
        for (const units of Object.values(ledger.holdings))
          expect(units).toBeGreaterThanOrEqual(0);
      }
      for (const asset of assetSymbolSchema.options) {
        expect(
          state.humans.reduce(
            (sum, h) => sum + BigInt(h.holdings[asset]),
            BigInt(state.market.bot.holdings[asset]),
          ),
        ).toBe(
          BigInt({ AMBR: 4000, BONE: 3000, FERN: 2000, VOLC: 1000 }[asset]),
        );
        const reserved = state.quotes
          .filter((q) => q.symbol === asset && q.side === "ask")
          .reduce((sum, q) => sum + BigInt(q.quantity), 0n);
        expect(reserved).toBe(BigInt(state.reservations.holdings[asset]));
        expect(reserved).toBeLessThanOrEqual(
          BigInt(state.market.bot.holdings[asset]),
        );
      }
      const reservedCash = state.quotes
        .filter((q) => q.side === "bid")
        .reduce(
          (sum, q) => sum + BigInt(q.quantity) * BigInt(q.priceCents),
          0n,
        );
      expect(reservedCash).toBe(BigInt(state.reservations.cashCents));
      expect(reservedCash).toBeLessThanOrEqual(
        BigInt(state.market.bot.cashCents),
      );
      expect(
        result.fills.every((f) =>
          side === "buy"
            ? f.priceCents <= order.protectionPriceCents
            : f.priceCents >= order.protectionPriceCents,
        ),
      ).toBe(true);
      expect(result.fills.reduce((sum, f) => sum + f.totalValueCents, 0)).toBe(
        result.outcome.totalValueCents,
      );
    }
    for (const side of ["buy", "sell"])
      for (const status of [
        "FILLED",
        "PARTIALLY_FILLED",
        "NO_LIQUIDITY_WITHIN_PROTECTION",
      ])
        expect(outcomes).toContain(side + ":" + status);
    expect(outcomes).toContain("sell:INSUFFICIENT_HOLDINGS");
  });

  it("keeps stale sell protection fixed after bids move below it", () => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 150;
    state.market.assets.find((a) => a.symbol === "FERN")!.referencePriceCents =
      3000;
    replaceQuotes(state);
    const result = executeSell(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.command.protectionPriceCents).toBe(3900);
    expect(result.outcome.status).toBe("NO_LIQUIDITY_WITHIN_PROTECTION");
    expect(result.state.humans).toEqual(state.humans);
    expect(result.state.market.bot).toEqual(state.market.bot);
    expect(result.state.lastPrices).toEqual(state.lastPrices);
  });

  it("buys then sells owned units using committed state and exact proceeds (AC-04)", () => {
    const initial = fixture();
    const bought = executeBuy(initial, {
      ...command(),
      side: "buy",
      protectionPriceCents: 4100,
    });
    expect(bought.ok).toBe(true);
    if (!bought.ok) throw new Error(JSON.stringify(bought));
    const sold = executeSell(bought.state, command());
    expect(sold.ok).toBe(true);
    if (!sold.ok) throw new Error(JSON.stringify(sold));
    expect(sold.fills.map((f) => [f.quantity, f.priceCents])).toEqual([
      [100, 3963],
      [50, 3923],
    ]);
    expect(sold.outcome.totalValueCents).toBe(592450);
    expect(sold.state.humans[0]).toMatchObject({
      cashCents: 984450,
      holdings: { FERN: 0 },
    });
    expect(sold.state.market.bot).toMatchObject({
      cashCents: 1000015550,
      holdings: { FERN: 100000 },
    });
    expect(
      sold.state.market.assets.find((a) => a.symbol === "FERN")!
        .referencePriceCents,
    ).toBe(4000);
  });

  const corruptions: [
    string,
    (state: BuyState) => void,
    (string | number)[],
  ][] = [
    [
      "uncovered asks",
      (s) => {
        s.market.bot.holdings.FERN = 1;
      },
      ["reservations", "holdings", "FERN"],
    ],
    [
      "uncovered bids",
      (s) => {
        s.market.bot.cashCents = 0;
      },
      ["reservations", "cashCents"],
    ],
    [
      "inconsistent reservations",
      (s) => {
        s.reservations.holdings.FERN = 0;
      },
      ["reservations", "holdings", "FERN"],
    ],
    [
      "duplicate quote",
      (s) => {
        s.quotes[1] = structuredClone(s.quotes[0]!);
      },
      ["quotes", 1, "id"],
    ],
    [
      "wrong quote generation",
      (s) => {
        s.quotes[0]!.generation = 2;
      },
      ["quotes", 0, "generation"],
    ],
    [
      "quote outside bounds",
      (s) => {
        s.quotes[0]!.priceCents = 99;
      },
      ["quotes", 0, "priceCents"],
    ],
    [
      "oversized level",
      (s) => {
        s.quotes[0]!.quantity = 101;
      },
      ["quotes", 0, "quantity"],
    ],
    [
      "duplicate human",
      (s) => {
        s.humans[1]!.playerId = s.humans[0]!.playerId;
      },
      ["humans"],
    ],
    [
      "invalid mark",
      (s) => {
        s.lastPrices.FERN = 1000001;
      },
      ["lastPrices", "FERN"],
    ],
    [
      "negative holdings",
      (s) => {
        s.humans[0]!.holdings.FERN = -1;
      },
      ["humans", 0, "holdings", "FERN"],
    ],
  ];
  it.each(corruptions)(
    "rejects %s without leaking a partial transition",
    (_name, corrupt, path) => {
      const state = fixture();
      corrupt(state);
      const before = structuredClone(state);
      const result = executeSell(state, command());
      expect(result).toMatchObject({ ok: false, code: "INVALID_SELL_STATE" });
      if (result.ok) throw new Error("Expected rejection");
      expect(result.issues.map((issue) => issue.path)).toContainEqual(path);
      expect(sellResultSchema.parse(result)).toEqual(result);
      expect(state).toEqual(before);
    },
  );

  it("returns no partial transition when a post-order rebuild cannot advance its generation", () => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 150;
    state.market.assets.find(
      (asset) => asset.symbol === "FERN",
    )!.quoteGeneration = Number.MAX_SAFE_INTEGER;
    state.quotes
      .filter((quote) => quote.symbol === "FERN")
      .forEach((quote) => {
        quote.generation = Number.MAX_SAFE_INTEGER;
      });
    const before = structuredClone(state);
    expect(executeSell(state, command())).toMatchObject({
      ok: false,
      code: "QUOTE_GENERATION_EXHAUSTED",
    });
    expect(state).toEqual(before);
  });

  it("settles large safe values with exact intermediate arithmetic and JSON-compatible output", () => {
    const state = fixture();
    state.market.rules.prices.maxCents = 4503599627370495;
    state.market.rules.orders.maxQuantity = 2;
    state.market.rules.bot.quoteOffsetsBps = [1, 2, 3];
    state.market.rules.bot.unitsPerLevel = 1;
    state.market.bot.cashCents = Number.MAX_SAFE_INTEGER;
    state.market.assets.find((a) => a.symbol === "AMBR")!.referencePriceCents =
      4503599627370495;
    state.humans[0]!.cashCents = 0;
    state.humans[0]!.holdings.AMBR = 2;
    replaceQuotes(state);
    const result = executeSell(state, {
      ...command(),
      symbol: "AMBR",
      quantity: 2,
      protectionPriceCents: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.fills.map((f) => f.priceCents)).toEqual([
      4503149267407757, 4502698907445020,
    ]);
    expect(result.outcome.totalValueCents).toBe(9005848174852777);
    expect(result.state.humans[0]!.cashCents).toBe(9005848174852777);
    expect(result.state.market.bot.cashCents).toBe(1351079888214);
    expect(
      result.state.market.assets.find((a) => a.symbol === "AMBR")!
        .referencePriceCents,
    ).toBe(4499096027743125);
    expect(sellResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });

  it.each([
    [1499, 10, 1498],
    [1500, 10, 1499],
    [1501, 10, 1499],
    [101, 200, 100],
    [1000000, 10, 999000],
  ])(
    "rounds reference %s half-up with frozen impact %s then clamps to %s",
    (reference, impact, expected) => {
      const state = fixture();
      state.humans[0]!.holdings.FERN = 2;
      state.market.rules.bot.quoteOffsetsBps = [1, 2, 3];
      state.market.rules.bot.unitsPerLevel = 1;
      state.market.rules.orders.maxQuantity = 2;
      state.market.rules.bot.referenceImpactBpsPerFilledOrder = impact;
      state.market.assets.find(
        (a) => a.symbol === "FERN",
      )!.referencePriceCents = reference;
      replaceQuotes(state);
      expect(executeSell(state, { ...command(), quantity: 3 })).toMatchObject({
        ok: false,
        code: "INVALID_ORDER",
      });
      const result = executeSell(state, {
        ...command(),
        quantity: 2,
        protectionPriceCents: 100,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.fills).toHaveLength(2);
      expect(
        result.state.market.assets.find((a) => a.symbol === "FERN")!
          .referencePriceCents,
      ).toBe(expected);
      expect(sellResultSchema.parse(result)).toEqual(result);
      if (expected === 100)
        expect(
          result.state.quotes.filter(
            (q) => q.symbol === "FERN" && q.side === "bid",
          ),
        ).toEqual([]);
    },
  );

  it.each(["cash", "holdings"])(
    "rejects overflow of the receiving %s without exposing a partial transition",
    (resource) => {
      const state = fixture();
      state.humans[0]!.holdings.FERN = 150;
      if (resource === "cash")
        state.humans[0]!.cashCents = Number.MAX_SAFE_INTEGER;
      else state.market.bot.holdings.FERN = Number.MAX_SAFE_INTEGER;
      const before = structuredClone(state);
      const result = executeSell(state, command());
      expect(result).toMatchObject({
        ok: false,
        code: "UNSAFE_SETTLEMENT",
        issues: [
          {
            path:
              resource === "cash"
                ? ["humans", 0, "cashCents"]
                : ["market", "bot", "holdings", "FERN"],
          },
        ],
      });
      expect(result).not.toHaveProperty("state");
      expect(result).not.toHaveProperty("fills");
      expect(state).toEqual(before);
    },
  );

  it("exhausts finite bot cash without borrowing, replenishment or matching replacement bids (AC-16)", () => {
    const state = fixture();
    state.market.bot.cashCents = 926250;
    state.humans[0]!.holdings.AMBR = 150;
    replaceQuotes(state);
    const order = { ...command(), symbol: "AMBR", protectionPriceCents: 7300 };
    const result = executeSell(state, order);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.fills.map((fill) => [fill.quantity, fill.priceCents]),
    ).toEqual([
      [100, 7425],
      [25, 7350],
    ]);
    expect(result.outcome).toMatchObject({
      status: "PARTIALLY_FILLED",
      filledQuantity: 125,
      remainingQuantity: 25,
      totalValueCents: 926250,
    });
    expect(result.state.market.bot).toMatchObject({
      cashCents: 0,
      holdings: { AMBR: 100125 },
    });
    expect(result.state.humans[0]).toMatchObject({
      cashCents: 1926250,
      holdings: { AMBR: 25 },
    });
    expect(result.state.reservations.cashCents).toBe(0);
    expect(result.state.quotes.filter((q) => q.side === "bid")).toEqual([]);
    const next = executeSell(result.state, { ...order, quantity: 25 });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(JSON.stringify(next));
    expect(next.outcome.status).toBe("NO_LIQUIDITY_WITHIN_PROTECTION");
    expect(next.state.market.bot).toEqual(result.state.market.bot);
    expect(next.state.humans).toEqual(result.state.humans);
  });

  it.each([
    [1, 3960, "FILLED", 1, 0, 3960],
    [150, 3960, "PARTIALLY_FILLED", 100, 50, 396000],
    [500, 3880, "PARTIALLY_FILLED", 300, 200, 1176000],
    [150, 3961, "NO_LIQUIDITY_WITHIN_PROTECTION", 0, 150, 0],
  ])(
    "completes IOC quantity %s above protection %s (AC-06)",
    (
      quantity,
      protectionPriceCents,
      status,
      filledQuantity,
      remainingQuantity,
      totalValueCents,
    ) => {
      const state = fixture();
      state.humans[0]!.holdings.FERN = 500;
      const before = structuredClone(state);
      const result = executeSell(state, {
        ...command(),
        quantity,
        protectionPriceCents,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.outcome).toMatchObject({
        status,
        filledQuantity,
        remainingQuantity,
        totalValueCents,
      });
      expect(
        result.fills.every((fill) => fill.priceCents >= protectionPriceCents),
      ).toBe(true);
      expect(result.state.humans[0]!.holdings.FERN).toBe(500 - filledQuantity);
      if (filledQuantity === 0) {
        expect(result.fills).toEqual([]);
        expect(result.outcome.averagePrice).toBeNull();
        expect(result.state.humans).toEqual(state.humans);
        expect(result.state.market.bot).toEqual(state.market.bot);
        expect(result.state.lastPrices).toEqual(state.lastPrices);
        expect(
          result.state.market.assets.map((a) => [
            a.referencePriceCents,
            a.quoteGeneration,
          ]),
        ).toEqual([
          [7500, 2],
          [2500, 2],
          [4000, 2],
          [10000, 2],
        ]);
      }
      expect(sellResultSchema.parse(result)).toEqual(result);
      expect(state).toEqual(before);
    },
  );

  it("uses creation sequence then stable ID for equal bids regardless of array order", () => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 250;
    state.market.rules.bot.quoteOffsetsBps = [1, 2, 3];
    state.market.assets.find((a) => a.symbol === "FERN")!.referencePriceCents =
      101;
    replaceQuotes(state);
    const bids = state.quotes.filter(
      (q) => q.symbol === "FERN" && q.side === "bid",
    );
    bids[0]!.creationSequence = 14;
    bids[1]!.creationSequence = 13;
    bids[2]!.creationSequence = 13;
    state.quotes.reverse();
    const order = { ...command(), quantity: 250, protectionPriceCents: 100 };
    const result = executeSell(state, order);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.fills.map((fill) => [
        fill.quoteId,
        fill.quantity,
        fill.priceCents,
      ]),
    ).toEqual([
      [bids[1]!.id, 100, 100],
      [bids[2]!.id, 100, 100],
      [bids[0]!.id, 50, 100],
    ]);
    expect(
      executeSell({ ...state, quotes: [...state.quotes].reverse() }, order),
    ).toEqual(result);
  });

  it("returns reference/last-price changes and rebuilt covered quotes as one complete transition", () => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 150;
    const result = executeSell(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.state.lastPrices).toEqual({
      AMBR: 7500,
      BONE: 2500,
      FERN: 3920,
      VOLC: 10000,
    });
    expect(
      result.state.market.assets.map((a) => [
        a.symbol,
        a.referencePriceCents,
        a.quoteGeneration,
      ]),
    ).toEqual([
      ["AMBR", 7500, 2],
      ["BONE", 2500, 2],
      ["FERN", 3996, 2],
      ["VOLC", 10000, 2],
    ]);
    expect(
      result.state.quotes
        .filter((q) => q.symbol === "FERN" && q.side === "bid")
        .map((q) => [q.priceCents, q.quantity]),
    ).toEqual([
      [3956, 100],
      [3916, 100],
      [3876, 100],
    ]);
    expect(result.state.reservations).toEqual({
      cashCents: 7054800,
      holdings: { AMBR: 300, BONE: 300, FERN: 300, VOLC: 300 },
    });
    expect(sellResultSchema.parse(result)).toEqual(result);
    expect(executeSell(state, command())).toEqual(result);
  });

  it.each(["LOBBY", "COUNTDOWN", "SETTLING", "FINISHED", "ABORTED"])(
    "rejects orders during %s (AC-05)",
    (status) => {
      const state = { ...fixture(), status };
      state.humans[0]!.holdings.FERN = 150;
      const before = structuredClone(state);
      expect(executeSell(state, command())).toMatchObject({
        ok: false,
        code: "MARKET_CLOSED",
        issues: [{ path: ["status"] }],
      });
      expect(state).toEqual(before);
    },
  );

  it.each([
    ["quantity", 0, "INVALID_ORDER"],
    ["quantity", -1, "INVALID_ORDER"],
    ["quantity", 1.5, "INVALID_ORDER"],
    ["quantity", 501, "INVALID_ORDER"],
    ["quantity", Number.MAX_SAFE_INTEGER + 1, "INVALID_ORDER"],
    ["quantity", NaN, "INVALID_ORDER"],
    ["quantity", Infinity, "INVALID_ORDER"],
    ["quantity", "150", "INVALID_ORDER"],
    ["symbol", "TREX", "INVALID_ORDER"],
    ["side", "buy", "INVALID_ORDER"],
    ["protectionPriceCents", 99, "INVALID_ORDER"],
    ["protectionPriceCents", 1000001, "INVALID_ORDER"],
    ["protectionPriceCents", 3900.5, "INVALID_ORDER"],
    ["protectionPriceCents", NaN, "INVALID_ORDER"],
    ["protectionPriceCents", Infinity, "INVALID_ORDER"],
    ["requestId", "", "INVALID_ORDER"],
    ["playerId", "system:bot", "INVALID_ORDER"],
    ["playerId", roundId, "PLAYER_NOT_IN_ROUND"],
    ["roundId", playerId, "ROUND_MISMATCH"],
  ])("rejects %s = %s with stable code %s (AC-05)", (field, value, code) => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 500;
    const before = structuredClone(state);
    const result = executeSell(state, { ...command(), [field]: value });
    expect(result).toMatchObject({
      ok: false,
      code,
      issues: [{ path: [field] }],
    });
    expect(sellResultSchema.parse(result)).toEqual(result);
    expect(state).toEqual(before);
  });

  it("requires holdings for the entire request even if only a partial fill is available (AC-04)", () => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 100;
    const before = structuredClone(state);
    const result = executeSell(state, {
      ...command(),
      protectionPriceCents: 3960,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_HOLDINGS",
      issues: [{ path: ["quantity"] }],
    });
    expect(result).not.toHaveProperty("fills");
    expect(result).not.toHaveProperty("state");
    expect(state).toEqual(before);
    expect(executeSell(fixture(), command())).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_HOLDINGS",
    });
  });

  it("sells owned units at highest resting bids with exact multi-level proceeds (AC-04)", () => {
    const state = fixture();
    state.humans[0]!.holdings.FERN = 150;
    state.quotes.reverse();
    const before = structuredClone(state);
    const result = executeSell(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.fills.map((fill) => [
        fill.buyerId,
        fill.sellerId,
        fill.quantity,
        fill.priceCents,
        fill.totalValueCents,
      ]),
    ).toEqual([
      ["system:bot", playerId, 100, 3960, 396000],
      ["system:bot", playerId, 50, 3920, 196000],
    ]);
    expect(result.outcome).toEqual({
      status: "FILLED",
      filledQuantity: 150,
      remainingQuantity: 0,
      totalValueCents: 592000,
      averagePrice: { numeratorCents: 592000, denominatorUnits: 150 },
    });
    expect(result.state.humans[0]).toMatchObject({
      cashCents: 1592000,
      holdings: { FERN: 0 },
    });
    expect(result.state.market.bot).toMatchObject({
      cashCents: 999408000,
      holdings: { FERN: 100150 },
    });
    expect(result.state.humans[1]).toEqual(state.humans[1]);
    expect(state).toEqual(before);
    expect(sellResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });
});
