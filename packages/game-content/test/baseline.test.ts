import { describe, expect, it } from "vitest";
import {
  baselineSchema,
  catalogEventSchema,
  marketBaselineResponseSchema,
  type Baseline,
} from "../../contracts/src/index.js";
import { loadBaseline } from "../src/index.js";

describe("baseline 1.0 (supporting AC-02, AC-05, AC-09, AC-13)", () => {
  it("pins the canonical assets, prices, versions and all gameplay defaults", () => {
    const baseline = loadBaseline();
    expect(baseline.contentVersion).toBe("1.0");
    expect(baseline.rulesVersion).toBe("1.0");
    expect(
      baseline.assets.map(({ symbol, name, initialPriceCents }) => [
        symbol,
        name,
        initialPriceCents,
      ]),
    ).toEqual([
      ["FERN", "Fern Farms", 4_000],
      ["AMBR", "Amber Works", 7_500],
      ["VOLC", "Volcano Energy", 10_000],
      ["BONE", "Fossil Finds", 2_500],
    ]);
    expect(baseline.rules).toEqual({
      room: {
        minPlayers: 2,
        maxPlayers: 8,
        countdownMs: 5_000,
        hostDisconnectGraceMs: 15_000,
        emptyLobbyExpiryMs: 300_000,
      },
      round: { durationMs: 600_000, eventIntervalMs: 60_000 },
      player: { startingCashCents: 1_000_000, startingUnitsPerAsset: 0 },
      prices: { minCents: 100, maxCents: 1_000_000, tickCents: 1 },
      orders: {
        minQuantity: 1,
        maxQuantity: 500,
        feeBps: 0,
        defaultProtectionBps: 500,
      },
      bot: {
        startingCashCents: 1_000_000_000,
        startingUnitsPerAsset: 100_000,
        quoteOffsetsBps: [100, 200, 300],
        unitsPerLevel: 100,
        referenceImpactBpsPerFilledOrder: 10,
      },
      events: { minShockBps: -1_500, maxShockBps: 1_500 },
    });
    expect(baseline.eventCatalog.map(({ effects }) => effects)).toEqual([
      [{ symbol: "FERN", referenceChangeBps: 500 }],
      [{ symbol: "AMBR", referenceChangeBps: 500 }],
      [{ symbol: "VOLC", referenceChangeBps: -500 }],
      [{ symbol: "BONE", referenceChangeBps: 500 }],
    ]);
  });

  const malformed: [string, (baseline: Baseline) => unknown][] = [
    ["missing asset", (b) => ({ ...b, assets: b.assets.slice(1) })],
    [
      "duplicate asset",
      (b) => ({ ...b, assets: [b.assets[0], ...b.assets.slice(0, 3)] }),
    ],
    [
      "unknown symbol",
      (b) => ({
        ...b,
        assets: b.assets.map((a) => ({ ...a, symbol: "TREX" })),
      }),
    ],
    [
      "fractional cents",
      (b) => ({
        ...b,
        assets: b.assets.map((a) => ({ ...a, initialPriceCents: 4000.5 })),
      }),
    ],
    [
      "price below bounds",
      (b) => ({
        ...b,
        assets: b.assets.map((a) => ({ ...a, initialPriceCents: 99 })),
      }),
    ],
    [
      "unsafe integer",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          player: {
            ...b.rules.player,
            startingCashCents: Number.MAX_SAFE_INTEGER + 1,
          },
        },
      }),
    ],
    [
      "string cash",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          player: { ...b.rules.player, startingCashCents: "1000000" },
        },
      }),
    ],
    [
      "negative units",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          bot: { ...b.rules.bot, startingUnitsPerAsset: -1 },
        },
      }),
    ],
    [
      "inverted prices",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          prices: { ...b.rules.prices, minCents: 2_000_000 },
        },
      }),
    ],
    [
      "unsafe maximum order value",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          orders: { ...b.rules.orders, maxQuantity: Number.MAX_SAFE_INTEGER },
        },
      }),
    ],
    [
      "event at close",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          round: { ...b.rules.round, eventIntervalMs: 600_000 },
        },
      }),
    ],
    [
      "unsorted offsets",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          bot: { ...b.rules.bot, quoteOffsetsBps: [100, 300, 200] },
        },
      }),
    ],
    [
      "duplicate offsets",
      (b) => ({
        ...b,
        rules: {
          ...b.rules,
          bot: { ...b.rules.bot, quoteOffsetsBps: [100, 100, 300] },
        },
      }),
    ],
    ["missing version", (b) => ({ ...b, rulesVersion: undefined })],
    ["empty catalog", (b) => ({ ...b, eventCatalog: [] })],
    [
      "duplicate event ID",
      (b) => ({ ...b, eventCatalog: [...b.eventCatalog, b.eventCatalog[0]] }),
    ],
    [
      "effect beyond configured range",
      (b) => ({
        ...b,
        rules: { ...b.rules, events: { minShockBps: -100, maxShockBps: 100 } },
      }),
    ],
  ];
  it.each(malformed)(
    "rejects %s instead of salvaging partial content",
    (_label, change) => {
      expect(baselineSchema.safeParse(change(loadBaseline())).success).toBe(
        false,
      );
    },
  );

  it.each(["TREX", "fern", "", null])(
    "rejects an unknown event symbol %s",
    (symbol) => {
      expect(
        catalogEventSchema.safeParse({
          ...loadBaseline().eventCatalog[0],
          effects: [{ symbol, referenceChangeBps: 500 }],
        }).success,
      ).toBe(false);
    },
  );
  it.each([-1501, 1501, 0.5, NaN, Infinity, "500"])(
    "rejects an invalid effect %s",
    (referenceChangeBps) => {
      expect(
        catalogEventSchema.safeParse({
          ...loadBaseline().eventCatalog[0],
          effects: [{ symbol: "FERN", referenceChangeBps }],
        }).success,
      ).toBe(false);
    },
  );
  it("accepts shock boundaries and multi-symbol events", () => {
    expect(
      catalogEventSchema.safeParse({
        ...loadBaseline().eventCatalog[0],
        effects: [
          { symbol: "FERN", referenceChangeBps: -1500 },
          { symbol: "AMBR", referenceChangeBps: 1500 },
        ],
      }).success,
    ).toBe(true);
  });
  it("rejects duplicate effects, missing facts/templates and unknown icons", () => {
    const event = loadBaseline().eventCatalog[0];
    expect(
      catalogEventSchema.safeParse({
        ...event,
        effects: [
          { symbol: "FERN", referenceChangeBps: 500 },
          { symbol: "FERN", referenceChangeBps: 100 },
        ],
      }).success,
    ).toBe(false);
    for (const patch of [
      { facts: " " },
      { template: undefined },
      { template: { headline: "", commentary: "" } },
      { iconId: "missing" },
    ]) {
      expect(catalogEventSchema.safeParse({ ...event, ...patch }).success).toBe(
        false,
      );
    }
  });
  it("returns independent copies so callers cannot alter future defaults", () => {
    const first = loadBaseline();
    first.rules.player.startingCashCents = 1;
    first.assets.pop();
    first.eventCatalog.pop();
    expect(loadBaseline().rules.player.startingCashCents).toBe(1_000_000);
    expect(loadBaseline().assets).toHaveLength(4);
    expect(loadBaseline().eventCatalog).toHaveLength(4);
  });
  it("rejects incompatible public contracts and unexpected internal fields", () => {
    const { contentVersion, rulesVersion, assets, rules } = loadBaseline();
    const response = { schemaVersion: 1, contentVersion, rulesVersion, assets };
    expect(marketBaselineResponseSchema.safeParse(response).success).toBe(true);
    expect(
      marketBaselineResponseSchema.safeParse({ ...response, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      marketBaselineResponseSchema.safeParse({ ...response, rules }).success,
    ).toBe(false);
  });
});
