import { describe, expect, it } from "vitest";
import {
  buildRoundBaseline,
  loadBaseline,
} from "../../game-content/src/index.js";
import {
  botQuoteResultSchema,
  type BotQuoteResult,
  type BotQuoteState,
} from "../../contracts/src/index.js";
import { initializeBotQuotes, rebuildBotQuotes } from "../src/index.js";

function success(result: BotQuoteResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

function currentState() {
  return success(initializeBotQuotes(frozenRound())).state;
}

function frozenRound() {
  return buildRoundBaseline({
    roundId: "00000000-0000-4000-8000-000000000003",
    seed: 3,
    configVersion: "1.0",
    participantIds: [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
    createdAtMs: 0,
    opensAtMs: 5_000,
    config: loadBaseline(),
  });
}

describe("covered bot quotes (AC-02, AC-08, AC-16 engine evidence)", () => {
  it("rounds large quote products exactly while returning safe JSON numbers", () => {
    const state = currentState();
    state.rules.prices.maxCents = Number.MAX_SAFE_INTEGER;
    state.rules.orders.maxQuantity = 1;
    state.rules.bot.quoteOffsetsBps = [1, 2, 3];
    state.rules.bot.unitsPerLevel = 1;
    state.bot.cashCents = Number.MAX_SAFE_INTEGER;
    state.assets.find((a) => a.symbol === "AMBR")!.referencePriceCents =
      4_503_599_627_370_495;
    const result = success(rebuildBotQuotes(state));
    // Decimal worked examples: intermediates exceed 2^53, final prices do not.
    expect(
      result.quotes
        .filter((q) => q.symbol === "AMBR")
        .map((q) => [q.side, q.priceCents]),
    ).toEqual([
      ["bid", 4_503_149_267_407_757],
      ["bid", 4_502_698_907_445_020],
      ["ask", 4_504_049_987_333_233],
      ["ask", 4_504_500_347_295_970],
      ["ask", 4_504_950_707_258_707],
    ]);
    expect(
      botQuoteResultSchema.parse(JSON.parse(JSON.stringify(result))),
    ).toEqual(result);
    state.assets.forEach((a) => {
      a.referencePriceCents = Number.MAX_SAFE_INTEGER;
    });
    expect(
      success(rebuildBotQuotes(state)).quotes.some((q) => q.side === "ask"),
    ).toBe(false);
  });

  it("covers huge configured depth without overflowing hypothetical full-level costs", () => {
    const state = currentState();
    state.rules.bot.unitsPerLevel = Number.MAX_SAFE_INTEGER;
    state.bot.cashCents = Number.MAX_SAFE_INTEGER;
    state.bot.holdings.AMBR = Number.MAX_SAFE_INTEGER;
    const result = success(rebuildBotQuotes(state));
    const bids = result.quotes.filter((q) => q.side === "bid");
    const cash = bids.reduce(
      (sum, q) => sum + BigInt(q.priceCents) * BigInt(q.quantity),
      0n,
    );
    expect(cash).toBeLessThanOrEqual(BigInt(state.bot.cashCents));
    expect(BigInt(result.reservations.cashCents)).toBe(cash);
    expect(
      result.quotes
        .filter((q) => q.symbol === "AMBR" && q.side === "ask")
        .map((q) => q.quantity),
    ).toEqual([Number.MAX_SAFE_INTEGER]);
    expect(botQuoteResultSchema.safeParse(result).success).toBe(true);
  });

  it("preserves covered reservations and unchanged ledgers across 500 seeded rebuilds", () => {
    let seed = 0xd1_003;
    const next = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };
    let state = currentState();
    for (let sample = 0; sample < 500; sample += 1) {
      state.bot.cashCents = next() % 5_000_000;
      state.rules.bot.unitsPerLevel = (next() % 500) + 1;
      state.rules.bot.quoteOffsetsBps =
        sample % 2 ? [1, 2, 3] : [100, 200, 300];
      for (const asset of state.assets) {
        asset.referencePriceCents =
          sample % 10 === 0
            ? 100
            : sample % 10 === 1
              ? 1_000_000
              : 100 + (next() % 999_901);
        state.bot.holdings[asset.symbol] = next() % 600;
      }
      const before = structuredClone(state);
      const result = success(rebuildBotQuotes(state));
      expect(state).toEqual(before);
      expect(result.state.bot).toEqual(before.bot);
      expect(result.state.rules).toEqual(before.rules);
      expect(result.state.assets.map((a) => a.referencePriceCents)).toEqual(
        before.assets.map((a) => a.referencePriceCents),
      );
      expect(result).toEqual(rebuildBotQuotes(before));
      expect(botQuoteResultSchema.safeParse(result).success).toBe(true);
      const cash = result.quotes
        .filter((q) => q.side === "bid")
        .reduce(
          (total, q) => total + BigInt(q.priceCents) * BigInt(q.quantity),
          0n,
        );
      expect(cash).toBeLessThanOrEqual(BigInt(state.bot.cashCents));
      expect(BigInt(result.reservations.cashCents)).toBe(cash);
      expect(new Set(result.quotes.map((q) => q.id)).size).toBe(
        result.quotes.length,
      );
      expect(result.quotes.map((q) => q.creationSequence)).toEqual(
        result.quotes.map((q) => q.creationSequence).sort((a, b) => a - b),
      );
      for (const asset of state.assets) {
        const bids = result.quotes.filter(
          (q) => q.symbol === asset.symbol && q.side === "bid",
        );
        const asks = result.quotes.filter(
          (q) => q.symbol === asset.symbol && q.side === "ask",
        );
        const units = asks.reduce((total, q) => total + q.quantity, 0);
        expect(units).toBeLessThanOrEqual(state.bot.holdings[asset.symbol]);
        expect(result.reservations.holdings[asset.symbol]).toBe(units);
        expect(bids.map((q) => q.priceCents)).toEqual(
          bids.map((q) => q.priceCents).sort((a, b) => b - a),
        );
        expect(asks.map((q) => q.priceCents)).toEqual(
          asks.map((q) => q.priceCents).sort((a, b) => a - b),
        );
        if (bids.length && asks.length)
          expect(bids[0]!.priceCents).toBeLessThan(asks[0]!.priceCents);
        for (const quote of [...bids, ...asks]) {
          expect(quote.quantity).toBeGreaterThan(0);
          expect(quote.quantity).toBeLessThanOrEqual(
            state.rules.bot.unitsPerLevel,
          );
          expect(quote.priceCents).toBeGreaterThanOrEqual(100);
          expect(quote.priceCents).toBeLessThanOrEqual(1_000_000);
          expect(quote.generation).toBe(asset.quoteGeneration + 1);
        }
      }
      state = result.state;
    }
  });
  it("replaces reservations rather than accumulating them, and reproduces retry IDs", () => {
    let state = currentState();
    state.bot = {
      cashCents: 7_000,
      holdings: { AMBR: 1, BONE: 0, FERN: 0, VOLC: 0 },
    };
    const first = success(rebuildBotQuotes(state));
    const funding = structuredClone(state.bot);
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const before = structuredClone(state);
      const result = success(rebuildBotQuotes(state));
      expect(result).toEqual(rebuildBotQuotes(structuredClone(state)));
      expect(
        botQuoteResultSchema.parse(JSON.parse(JSON.stringify(result))),
      ).toEqual(result);
      expect(result.state.bot).toEqual(funding);
      expect(result.reservations).toEqual(first.reservations);
      expect(
        result.quotes.map(({ symbol, side, priceCents, quantity }) => ({
          symbol,
          side,
          priceCents,
          quantity,
        })),
      ).toEqual(
        first.quotes.map(({ symbol, side, priceCents, quantity }) => ({
          symbol,
          side,
          priceCents,
          quantity,
        })),
      );
      expect(result.state.assets.map((a) => a.quoteGeneration)).toEqual([
        iteration + 2,
        iteration + 2,
        iteration + 2,
        iteration + 2,
      ]);
      expect(state).toEqual(before);
      if (iteration > 0)
        expect(result.quotes.map((q) => q.id)).not.toEqual(
          first.quotes.map((q) => q.id),
        );
      state = result.state;
    }
  });

  it("preserves original levels and creation priority when configured offsets round to equal prices", () => {
    const state = currentState();
    state.rules.bot.quoteOffsetsBps = [1, 2, 3];
    state.assets.forEach((a) => {
      a.referencePriceCents = 101;
    });
    state.assets.reverse();
    const result = success(rebuildBotQuotes(state));
    expect(
      result.quotes
        .slice(0, 6)
        .map((q) => [q.side, q.priceCents, q.level, q.creationSequence, q.id]),
    ).toEqual([
      ["bid", 100, 1, 0, `${state.roundId}:AMBR:2:bid:1`],
      ["bid", 100, 2, 1, `${state.roundId}:AMBR:2:bid:2`],
      ["bid", 100, 3, 2, `${state.roundId}:AMBR:2:bid:3`],
      ["ask", 102, 1, 3, `${state.roundId}:AMBR:2:ask:1`],
      ["ask", 102, 2, 4, `${state.roundId}:AMBR:2:ask:2`],
      ["ask", 102, 3, 5, `${state.roundId}:AMBR:2:ask:3`],
    ]);
    expect(result).toEqual(
      rebuildBotQuotes({ ...state, assets: [...state.assets].reverse() }),
    );
    expect(new Set(result.quotes.map((q) => q.id)).size).toBe(24);
    const otherRound = success(
      rebuildBotQuotes({
        ...state,
        roundId: "00000000-0000-4000-8000-000000000004",
      }),
    );
    expect(
      otherRound.quotes.some((q) =>
        result.quotes.some((old) => old.id === q.id),
      ),
    ).toBe(false);
  });

  it("keeps empty rebuilds valid and advances generations without replenishing resources", () => {
    const state = currentState();
    state.bot = {
      cashCents: 0,
      holdings: { AMBR: 0, BONE: 0, FERN: 0, VOLC: 0 },
    };
    const result = success(rebuildBotQuotes(state));
    expect(result.quotes).toEqual([]);
    expect(result.reservations).toEqual(state.bot);
    expect(result.state.assets.map((a) => a.quoteGeneration)).toEqual([
      2, 2, 2, 2,
    ]);
    expect(success(rebuildBotQuotes(result.state)).state.bot).toEqual(
      state.bot,
    );
  });

  it("continues to cheaper levels and later symbols when an earlier quote cannot afford one unit", () => {
    const state = currentState();
    state.bot.cashCents = 7_300;
    const result = success(rebuildBotQuotes(state));
    expect(
      result.quotes
        .filter((q) => q.side === "bid")
        .map((q) => [q.symbol, q.level, q.quantity, q.creationSequence]),
    ).toEqual([["AMBR", 3, 1, 2]]);
    state.bot.cashCents = 2_475;
    expect(
      success(rebuildBotQuotes(state))
        .quotes.filter((q) => q.side === "bid")
        .map((q) => [q.symbol, q.level, q.quantity]),
    ).toEqual([["BONE", 1, 1]]);
  });

  it("uses frozen custom funding, offsets and level sizes rather than authored defaults", () => {
    const round = frozenRound();
    round.config.rules.bot.startingCashCents = 0;
    round.config.rules.bot.startingUnitsPerAsset = 5;
    round.config.rules.bot.unitsPerLevel = 2;
    round.config.rules.bot.quoteOffsetsBps = [1, 2, 3];
    round.initialState.bot = {
      cashCents: 0,
      holdings: { AMBR: 5, BONE: 5, FERN: 5, VOLC: 5 },
    };
    const result = success(initializeBotQuotes(round));
    expect(
      result.quotes
        .filter((q) => q.symbol === "AMBR")
        .map((q) => [q.side, q.priceCents, q.quantity]),
    ).toEqual([
      ["ask", 7501, 2],
      ["ask", 7502, 2],
      ["ask", 7503, 1],
    ]);
    expect(result.state.bot).toEqual(round.initialState.bot);
    expect(
      success(initializeBotQuotes(frozenRound())).state.bot.cashCents,
    ).toBe(1_000_000_000);
  });

  const invalidStates: [
    string,
    (state: BotQuoteState) => unknown,
    (string | number)[],
  ][] = [
    [
      "negative cash",
      (s) => ({ ...s, bot: { ...s.bot, cashCents: -1 } }),
      ["bot", "cashCents"],
    ],
    [
      "fractional holdings",
      (s) => ({
        ...s,
        bot: { ...s.bot, holdings: { ...s.bot.holdings, AMBR: 0.5 } },
      }),
      ["bot", "holdings", "AMBR"],
    ],
    [
      "missing holdings",
      (s) => ({ ...s, bot: { ...s.bot, holdings: {} } }),
      ["bot", "holdings", "AMBR"],
    ],
    [
      "unsafe cash",
      (s) => ({
        ...s,
        bot: { ...s.bot, cashCents: Number.MAX_SAFE_INTEGER + 1 },
      }),
      ["bot", "cashCents"],
    ],
    [
      "NaN cash",
      (s) => ({ ...s, bot: { ...s.bot, cashCents: NaN } }),
      ["bot", "cashCents"],
    ],
    [
      "infinite cash",
      (s) => ({ ...s, bot: { ...s.bot, cashCents: Infinity } }),
      ["bot", "cashCents"],
    ],
    ["missing asset", (s) => ({ ...s, assets: s.assets.slice(1) }), ["assets"]],
    [
      "duplicate asset",
      (s) => ({
        ...s,
        assets: [s.assets[0], s.assets[0], ...s.assets.slice(2)],
      }),
      ["assets"],
    ],
    [
      "unknown asset",
      (s) => ({
        ...s,
        assets: [{ ...s.assets[0], symbol: "TREX" }, ...s.assets.slice(1)],
      }),
      ["assets", 0, "symbol"],
    ],
    [
      "fractional reference",
      (s) => ({
        ...s,
        assets: [
          { ...s.assets[0], referencePriceCents: 100.5 },
          ...s.assets.slice(1),
        ],
      }),
      ["assets", 0, "referencePriceCents"],
    ],
    [
      "reference below bounds",
      (s) => ({
        ...s,
        assets: [
          { ...s.assets[0], referencePriceCents: 99 },
          ...s.assets.slice(1),
        ],
      }),
      ["assets", 0, "referencePriceCents"],
    ],
    [
      "reference above bounds",
      (s) => ({
        ...s,
        assets: [
          { ...s.assets[0], referencePriceCents: 1_000_001 },
          ...s.assets.slice(1),
        ],
      }),
      ["assets", 0, "referencePriceCents"],
    ],
    [
      "negative generation",
      (s) => ({
        ...s,
        assets: [{ ...s.assets[0], quoteGeneration: -1 }, ...s.assets.slice(1)],
      }),
      ["assets", 0, "quoteGeneration"],
    ],
    [
      "unsupported rules",
      (s) => ({ ...s, rulesVersion: "1.0" }),
      ["rulesVersion"],
    ],
    [
      "invalid offsets",
      (s) => ({
        ...s,
        rules: {
          ...s.rules,
          bot: { ...s.rules.bot, quoteOffsetsBps: [3, 2, 1] },
        },
      }),
      ["rules", "bot", "quoteOffsetsBps"],
    ],
  ];
  it.each(invalidStates)(
    "rejects %s with a stable code and field path",
    (_name, change, path) => {
      const input = change(currentState());
      const before = structuredClone(input);
      const result = rebuildBotQuotes(input);
      expect(result).toMatchObject({ ok: false, code: "INVALID_QUOTE_STATE" });
      if (result.ok) throw new Error("Expected rejection");
      expect(result.issues.map((issue) => issue.path)).toContainEqual(path);
      expect(botQuoteResultSchema.parse(result)).toEqual(result);
      expect(input).toEqual(before);
    },
  );

  it("rejects inconsistent frozen funding and old rules without upgrading the snapshot", () => {
    const round = frozenRound();
    round.initialState.bot.cashCents = 1;
    expect(initializeBotQuotes(round)).toMatchObject({
      ok: false,
      code: "INVALID_FROZEN_ROUND",
    });
    const old = frozenRound();
    old.rulesVersion = "1.0";
    old.config.rulesVersion = "1.0";
    expect(initializeBotQuotes(old)).toMatchObject({
      ok: false,
      code: "INVALID_QUOTE_STATE",
      issues: [{ path: ["rulesVersion"] }],
    });
    expect(old.rulesVersion).toBe("1.0");
  });
  it("rejects an exhausted generation counter without mutating any asset", () => {
    const state = currentState();
    state.assets.reverse();
    const asset = state.assets[2]!;
    asset.quoteGeneration = Number.MAX_SAFE_INTEGER;
    const before = structuredClone(state);
    expect(rebuildBotQuotes(state)).toMatchObject({
      ok: false,
      code: "QUOTE_GENERATION_EXHAUSTED",
      issues: [{ path: ["assets", 2, "quoteGeneration"] }],
    });
    expect(state).toEqual(before);
  });
  it("discards out-of-bounds levels without clamping or renumbering survivors", () => {
    const state = currentState();
    const references = { AMBR: 100, BONE: 1_000_000, FERN: 102, VOLC: 980_000 };
    for (const asset of state.assets)
      asset.referencePriceCents = references[asset.symbol];
    const result = success(rebuildBotQuotes(state));
    expect(
      result.quotes.map((q) => [q.symbol, q.side, q.level, q.priceCents]),
    ).toEqual([
      ["AMBR", "ask", 1, 101],
      ["AMBR", "ask", 2, 102],
      ["AMBR", "ask", 3, 103],
      ["BONE", "bid", 1, 990_000],
      ["BONE", "bid", 2, 980_000],
      ["BONE", "bid", 3, 970_000],
      ["FERN", "bid", 1, 100],
      ["FERN", "ask", 1, 104],
      ["FERN", "ask", 2, 105],
      ["FERN", "ask", 3, 106],
      ["VOLC", "bid", 1, 970_200],
      ["VOLC", "bid", 2, 960_400],
      ["VOLC", "bid", 3, 950_600],
      ["VOLC", "ask", 1, 989_800],
      ["VOLC", "ask", 2, 999_600],
    ]);
    expect(result.quotes.map((q) => q.creationSequence)).toEqual([
      3, 4, 5, 6, 7, 8, 12, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });
  it("allocates scarce resources by symbol then best price, including partial levels", () => {
    const state = currentState();
    state.bot = {
      cashCents: 2_459_400,
      holdings: { AMBR: 101, BONE: 0, FERN: 2, VOLC: 0 },
    };
    const before = structuredClone(state);
    const result = success(rebuildBotQuotes(state));
    expect(
      result.quotes
        .filter((q) => q.side === "bid")
        .map((q) => [q.symbol, q.priceCents, q.quantity]),
    ).toEqual([
      ["AMBR", 7425, 100],
      ["AMBR", 7350, 100],
      ["AMBR", 7275, 100],
      ["BONE", 2475, 100],
      ["BONE", 2450, 2],
    ]);
    expect(
      result.quotes
        .filter((q) => q.side === "ask")
        .map((q) => [q.symbol, q.priceCents, q.quantity]),
    ).toEqual([
      ["AMBR", 7575, 100],
      ["AMBR", 7650, 1],
      ["FERN", 4040, 2],
    ]);
    expect(result.reservations).toEqual({
      cashCents: 2_457_400,
      holdings: { AMBR: 101, BONE: 0, FERN: 2, VOLC: 0 },
    });
    expect(result.state.bot).toEqual(before.bot);
    expect(state).toEqual(before);
  });
  it("initializes all four executable ladders from the frozen round without changing funding", () => {
    const round = frozenRound();
    const before = structuredClone(round);
    const result = initializeBotQuotes(round);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected quote initialization");
    expect(result.state.bot).toEqual({
      cashCents: 1_000_000_000,
      holdings: { AMBR: 100_000, BONE: 100_000, FERN: 100_000, VOLC: 100_000 },
    });
    expect(
      result.quotes.map((q) => [q.symbol, q.side, q.priceCents, q.quantity]),
    ).toEqual([
      ["AMBR", "bid", 7425, 100],
      ["AMBR", "bid", 7350, 100],
      ["AMBR", "bid", 7275, 100],
      ["AMBR", "ask", 7575, 100],
      ["AMBR", "ask", 7650, 100],
      ["AMBR", "ask", 7725, 100],
      ["BONE", "bid", 2475, 100],
      ["BONE", "bid", 2450, 100],
      ["BONE", "bid", 2425, 100],
      ["BONE", "ask", 2525, 100],
      ["BONE", "ask", 2550, 100],
      ["BONE", "ask", 2575, 100],
      ["FERN", "bid", 3960, 100],
      ["FERN", "bid", 3920, 100],
      ["FERN", "bid", 3880, 100],
      ["FERN", "ask", 4040, 100],
      ["FERN", "ask", 4080, 100],
      ["FERN", "ask", 4120, 100],
      ["VOLC", "bid", 9900, 100],
      ["VOLC", "bid", 9800, 100],
      ["VOLC", "bid", 9700, 100],
      ["VOLC", "ask", 10100, 100],
      ["VOLC", "ask", 10200, 100],
      ["VOLC", "ask", 10300, 100],
    ]);
    expect(result.reservations).toEqual({
      cashCents: 7_056_000,
      holdings: { AMBR: 300, BONE: 300, FERN: 300, VOLC: 300 },
    });
    expect(result.state.assets.map((a) => a.quoteGeneration)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(round).toEqual(before);
  });
});
