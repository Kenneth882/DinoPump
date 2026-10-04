import { describe, expect, it } from "vitest";
import { executeBuy } from "../src/index.js";
import {
  assetSymbolSchema,
  buyResultSchema,
  type BuyState,
} from "../../contracts/src/index.js";

import { fixture, playerId, roundId, replaceQuotes } from "./order-fixture.js";

function command() {
  return {
    roundId,
    requestId: "00000000-0000-4000-8000-000000000004",
    playerId,
    side: "buy" as const,
    symbol: "FERN" as const,
    quantity: 150,
    protectionPriceCents: 4100,
  };
}

describe("protected buys (AC-03, AC-05, AC-06, AC-08, AC-16 engine evidence)", () => {
  it("exhausts finite inventory without replenishment and never executes replacement quotes during the order", () => {
    const state = fixture();
    state.market.bot.cashCents = 0;
    state.market.bot.holdings.FERN = 125;
    replaceQuotes(state);
    const result = executeBuy(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.fills.map((fill) => [fill.quantity, fill.priceCents]),
    ).toEqual([
      [100, 4040],
      [25, 4080],
    ]);
    expect(result.outcome).toMatchObject({
      status: "PARTIALLY_FILLED",
      filledQuantity: 125,
      remainingQuantity: 25,
      totalValueCents: 506000,
    });
    expect(result.state.market.bot).toMatchObject({
      cashCents: 506000,
      holdings: { FERN: 0 },
    });
    expect(result.state.reservations.holdings.FERN).toBe(0);
    expect(
      result.state.quotes.filter(
        (q) => q.symbol === "FERN" && q.side === "ask",
      ),
    ).toEqual([]);
    const next = executeBuy(result.state, { ...command(), quantity: 1 });
    expect(next.ok && next.outcome.status).toBe(
      "NO_LIQUIDITY_WITHIN_PROTECTION",
    );
  });

  it("settles large safe integers and rounds reference impact with exact intermediate arithmetic", () => {
    const state = fixture();
    state.market.rules.prices.maxCents = Number.MAX_SAFE_INTEGER;
    state.market.rules.orders.maxQuantity = 1;
    state.market.rules.bot.quoteOffsetsBps = [1, 2, 3];
    state.market.rules.bot.unitsPerLevel = 1;
    state.market.bot.cashCents = 0;
    state.market.bot.holdings.FERN = 1;
    state.market.assets.find(
      (asset) => asset.symbol === "FERN",
    )!.referencePriceCents = 4503599627370495;
    state.humans[0]!.cashCents = Number.MAX_SAFE_INTEGER;
    replaceQuotes(state);
    const result = executeBuy(state, {
      ...command(),
      quantity: 1,
      protectionPriceCents: Number.MAX_SAFE_INTEGER,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.outcome.totalValueCents).toBe(4504049987333233);
    expect(result.state.humans[0]!.cashCents).toBe(4503149267407758);
    expect(
      result.state.market.assets.find((asset) => asset.symbol === "FERN")!
        .referencePriceCents,
    ).toBe(4508103226997865);
    expect(buyResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
  });

  it("obeys custom frozen order bounds, reference impact and level sizes", () => {
    const state = fixture();
    state.market.rules.orders.maxQuantity = 2;
    state.market.rules.bot.unitsPerLevel = 1;
    state.market.rules.bot.referenceImpactBpsPerFilledOrder = 25;
    replaceQuotes(state);
    expect(executeBuy(state, command())).toMatchObject({
      ok: false,
      code: "INVALID_ORDER",
    });
    const result = executeBuy(state, { ...command(), quantity: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.outcome.totalValueCents).toBe(8120);
    expect(
      result.state.market.assets.find((asset) => asset.symbol === "FERN")!
        .referencePriceCents,
    ).toBe(4010);
  });

  it("preserves conservation, coverage, determinism and immutable inputs through 500 seeded commands", () => {
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
    let seed = 4;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 8;
    };
    const outcomes = new Set<string>();
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const symbol = assetSymbolSchema.options[next() % 4]!;
      const reference = state.market.assets.find(
        (asset) => asset.symbol === symbol,
      )!.referencePriceCents;
      const order = {
        ...command(),
        symbol,
        playerId: state.humans[next() % 2]!.playerId,
        quantity: 1 + (next() % 500),
        protectionPriceCents: Math.min(
          1000000,
          reference + (next() % 1000) - 100,
        ),
      };
      const before = structuredClone(state);
      const result = executeBuy(state, order);
      expect(result).toEqual(
        executeBuy(structuredClone(state), structuredClone(order)),
      );
      expect(state).toEqual(before);
      expect(buyResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
        result,
      );
      if (!result.ok) {
        outcomes.add(result.code);
        continue;
      }
      outcomes.add(result.outcome.status);
      state = result.state;
      expect(
        state.humans.reduce(
          (sum, human) => sum + BigInt(human.cashCents),
          BigInt(state.market.bot.cashCents),
        ),
      ).toBe(200000000n);
      for (const asset of assetSymbolSchema.options) {
        const total = state.humans.reduce(
          (sum, human) => sum + BigInt(human.holdings[asset]),
          BigInt(state.market.bot.holdings[asset]),
        );
        expect(total).toBe(
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
        result.fills.every(
          (fill) => fill.priceCents <= order.protectionPriceCents,
        ),
      ).toBe(true);
      expect(
        result.fills.reduce((sum, fill) => sum + fill.totalValueCents, 0),
      ).toBe(result.outcome.totalValueCents);
    }
    expect(outcomes).toContain("FILLED");
    expect(outcomes).toContain("PARTIALLY_FILLED");
    expect(outcomes).toContain("NO_LIQUIDITY_WITHIN_PROTECTION");
    for (const human of state.humans) {
      for (const symbol of assetSymbolSchema.options)
        expect(human.holdings[symbol]).toBeGreaterThan(0);
    }
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
      const result = executeBuy(state, command());
      expect(result).toMatchObject({ ok: false, code: "INVALID_BUY_STATE" });
      if (result.ok) throw new Error("Expected rejection");
      expect(result.issues.map((issue) => issue.path)).toContainEqual(path);
      expect(buyResultSchema.parse(result)).toEqual(result);
      expect(state).toEqual(before);
    },
  );

  it.each(["cash", "holdings"])(
    "rejects a settlement that would overflow receiving %s",
    (resource) => {
      const state = fixture();
      if (resource === "cash") {
        state.market.bot.cashCents = Number.MAX_SAFE_INTEGER;
        replaceQuotes(state);
      } else state.humans[0]!.holdings.FERN = Number.MAX_SAFE_INTEGER;
      const before = structuredClone(state);
      expect(executeBuy(state, command())).toMatchObject({
        ok: false,
        code: "UNSAFE_SETTLEMENT",
      });
      expect(state).toEqual(before);
    },
  );

  it("returns last/reference changes and all rebuilt covered quotes in the same transition", () => {
    const state = fixture();
    const result = executeBuy(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.state.lastPrices).toEqual({
      AMBR: 7500,
      BONE: 2500,
      FERN: 4080,
      VOLC: 10000,
    });
    expect(
      result.state.market.assets.map((asset) => [
        asset.symbol,
        asset.referencePriceCents,
        asset.quoteGeneration,
      ]),
    ).toEqual([
      ["AMBR", 7500, 2],
      ["BONE", 2500, 2],
      ["FERN", 4004, 2],
      ["VOLC", 10000, 2],
    ]);
    expect(
      result.state.quotes
        .filter((q) => q.symbol === "FERN" && q.side === "ask")
        .map((q) => [q.priceCents, q.quantity]),
    ).toEqual([
      [4045, 100],
      [4085, 100],
      [4125, 100],
    ]);
    expect(result.state.reservations).toEqual({
      cashCents: 7056900,
      holdings: { AMBR: 300, BONE: 300, FERN: 300, VOLC: 300 },
    });
    expect(buyResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(
      result,
    );
    expect(executeBuy(state, command())).toEqual(result);
    const next = executeBuy(result.state, { ...command(), quantity: 1 });
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error(JSON.stringify(next));
    expect(next.state.humans[0]!.cashCents).toBe(387955);
  });

  it.each([
    [1499, 1500],
    [1500, 1502],
    [999500, 1000000],
  ])(
    "rounds reference %s half-up then clamps to %s once per order",
    (reference, expected) => {
      const state = fixture();
      state.market.rules.bot.quoteOffsetsBps = [1, 2, 3];
      state.market.assets.find(
        (asset) => asset.symbol === "FERN",
      )!.referencePriceCents = reference;
      replaceQuotes(state);
      const result = executeBuy(state, {
        ...command(),
        quantity: 1,
        protectionPriceCents: 1000000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(
        result.state.market.assets.find((asset) => asset.symbol === "FERN")!
          .referencePriceCents,
      ).toBe(expected);
    },
  );

  it("rebuilds after a completed zero-fill order without changing marks, references or ledgers", () => {
    const state = fixture();
    const result = executeBuy(state, {
      ...command(),
      protectionPriceCents: 4000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
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
    expect(result.state.humans).toEqual(state.humans);
    expect(result.state.market.bot).toEqual(state.market.bot);
  });

  it("returns no partial transition when a post-order rebuild cannot advance its generation", () => {
    const state = fixture();
    state.market.assets.find(
      (asset) => asset.symbol === "FERN",
    )!.quoteGeneration = Number.MAX_SAFE_INTEGER;
    state.quotes
      .filter((quote) => quote.symbol === "FERN")
      .forEach((quote) => {
        quote.generation = Number.MAX_SAFE_INTEGER;
      });
    const before = structuredClone(state);
    expect(executeBuy(state, command())).toMatchObject({
      ok: false,
      code: "QUOTE_GENERATION_EXHAUSTED",
    });
    expect(state).toEqual(before);
  });

  it.each([
    [1, 4040, "FILLED", 1, 0, 4040],
    [150, 4040, "PARTIALLY_FILLED", 100, 50, 404000],
    [500, 4120, "PARTIALLY_FILLED", 300, 200, 1224000],
    [150, 4039, "NO_LIQUIDITY_WITHIN_PROTECTION", 0, 150, 0],
  ])(
    "completes IOC quantity %s under protection %s",
    (
      quantity,
      protectionPriceCents,
      status,
      filledQuantity,
      remainingQuantity,
      totalValueCents,
    ) => {
      const state = fixture();
      state.humans[0]!.cashCents = 3000000;
      const before = structuredClone(state);
      const result = executeBuy(state, {
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
        result.fills.every((fill) => fill.priceCents <= protectionPriceCents),
      ).toBe(true);
      if (filledQuantity === 0) {
        expect(result.fills).toEqual([]);
        expect(result.outcome.averagePrice).toBeNull();
        expect(result.state.humans).toEqual(before.humans);
        expect(result.state.market.bot).toEqual(before.market.bot);
      }
      expect(state).toEqual(before);
    },
  );

  it("keeps stale submitted protection fixed when current asks moved above it", () => {
    const state = fixture();
    state.market.assets.find(
      (asset) => asset.symbol === "FERN",
    )!.referencePriceCents = 5000;
    replaceQuotes(state);
    const result = executeBuy(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.command.protectionPriceCents).toBe(4100);
    expect(result.outcome.status).toBe("NO_LIQUIDITY_WITHIN_PROTECTION");
    expect(result.state.humans).toEqual(state.humans);
  });

  it("orders asks by price, creation sequence, then stable ID independently of array order", () => {
    const state = fixture();
    state.market.rules.bot.quoteOffsetsBps = [1, 2, 3];
    state.market.assets.find(
      (asset) => asset.symbol === "FERN",
    )!.referencePriceCents = 100;
    replaceQuotes(state);
    const asks = state.quotes.filter(
      (quote) => quote.symbol === "FERN" && quote.side === "ask",
    );
    asks[0]!.creationSequence = 17;
    asks[1]!.creationSequence = 16;
    asks[2]!.creationSequence = 16;
    state.quotes.reverse();
    const result = executeBuy(state, {
      ...command(),
      quantity: 250,
      protectionPriceCents: 101,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.fills.map((fill) => [
        fill.quoteId,
        fill.quantity,
        fill.priceCents,
      ]),
    ).toEqual([
      [asks[1]!.id, 100, 101],
      [asks[2]!.id, 100, 101],
      [asks[0]!.id, 50, 101],
    ]);
    const reordered = executeBuy(
      { ...state, quotes: [...state.quotes].reverse() },
      { ...command(), quantity: 250, protectionPriceCents: 101 },
    );
    expect(reordered.ok && reordered.fills).toEqual(result.fills);
  });

  it.each([
    ["quantity", 0],
    ["quantity", -1],
    ["quantity", 1.5],
    ["quantity", 501],
    ["quantity", Number.MAX_SAFE_INTEGER + 1],
    ["quantity", NaN],
    ["quantity", Infinity],
    ["quantity", "150"],
    ["symbol", "TREX"],
    ["side", "sell"],
    ["protectionPriceCents", 99],
    ["protectionPriceCents", 1000001],
    ["protectionPriceCents", 4100.5],
    ["protectionPriceCents", NaN],
    ["protectionPriceCents", Infinity],
    ["requestId", ""],
    ["playerId", "system:bot"],
  ])("rejects invalid %s = %s without changing state", (field, value) => {
    const state = fixture();
    const before = structuredClone(state);
    const result = executeBuy(state, { ...command(), [field]: value });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_ORDER",
      issues: [{ path: [field] }],
    });
    expect(buyResultSchema.parse(result)).toEqual(result);
    expect(state).toEqual(before);
  });

  it("rejects mismatched rounds, nonparticipants and every non-OPEN status", () => {
    const state = fixture();
    const before = structuredClone(state);
    expect(
      executeBuy(state, { ...command(), roundId: playerId }),
    ).toMatchObject({ ok: false, code: "ROUND_MISMATCH" });
    expect(
      executeBuy(state, { ...command(), playerId: roundId }),
    ).toMatchObject({ ok: false, code: "PLAYER_NOT_IN_ROUND" });
    for (const status of [
      "LOBBY",
      "COUNTDOWN",
      "SETTLING",
      "FINISHED",
      "ABORTED",
    ]) {
      expect(executeBuy({ ...state, status }, command())).toMatchObject({
        ok: false,
        code: "MARKET_CLOSED",
      });
    }
    expect(state).toEqual(before);
  });

  it("requires the entire protected spend even when actual or partial fills would be affordable (AC-04)", () => {
    const state = fixture();
    state.humans[0]!.cashCents = 614999;
    const before = structuredClone(state);
    expect(executeBuy(state, command())).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_CASH",
    });
    expect(executeBuy(state, { ...command(), quantity: 500 })).toMatchObject({
      ok: false,
      code: "INSUFFICIENT_CASH",
    });
    expect(state).toEqual(before);
    state.humans[0]!.cashCents = 615000;
    const exact = executeBuy(state, command());
    expect(exact.ok).toBe(true);
    if (!exact.ok) throw new Error(JSON.stringify(exact));
    expect(exact.state.humans[0]!.cashCents).toBe(7000);
  });

  it("settles AC-03's 150 units at the resting asks with exact buyer and bot transfers", () => {
    const state = fixture();
    state.quotes.reverse();
    const before = structuredClone(state);
    const result = executeBuy(state, command());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.fills.map((fill) => [
        fill.quantity,
        fill.priceCents,
        fill.totalValueCents,
      ]),
    ).toEqual([
      [100, 4040, 404000],
      [50, 4080, 204000],
    ]);
    expect(result.outcome).toEqual({
      status: "FILLED",
      filledQuantity: 150,
      remainingQuantity: 0,
      totalValueCents: 608000,
      averagePrice: { numeratorCents: 608000, denominatorUnits: 150 },
    });
    expect(result.state.humans[0]).toMatchObject({
      cashCents: 392000,
      holdings: { FERN: 150 },
    });
    expect(result.state.market.bot).toMatchObject({
      cashCents: 1000608000,
      holdings: { FERN: 99850 },
    });
    expect(result.state.humans[1]).toEqual(before.humans[1]);
    expect(state).toEqual(before);
  });
});
