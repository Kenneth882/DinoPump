import { describe, expect, it, vi } from "vitest";
import {
  buildRoundBaseline,
  loadBaseline,
} from "../../game-content/src/index.js";
import {
  startEngineRound,
  processEngineCommand,
  getPortfolioRankings,
  replayEngine,
} from "../src/index.js";
import {
  engineStateSchema,
  engineBatchSchema,
  type EngineState,
  type EngineBatch,
} from "../../contracts/src/index.js";
import { playerId, roundId } from "./order-fixture.js";

function frozenRound() {
  return buildRoundBaseline({
    roundId,
    seed: 3,
    configVersion: "1.0",
    participantIds: [playerId, "00000000-0000-4000-8000-000000000002"],
    createdAtMs: 0,
    opensAtMs: 5000,
    config: loadBaseline(),
  });
}

describe("round commands and replay (AC-07–09, AC-11–12, AC-16)", () => {
  it("records a complete buy and returns its original receipt on retry without additional fills", () => {
    const opened = startEngineRound(frozenRound());
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const command = {
      type: "SubmitOrder",
      atMs: 6000,
      order: {
        roundId,
        playerId,
        requestId: "00000000-0000-4000-8000-000000000004",
        side: "buy",
        symbol: "FERN",
        quantity: 150,
        protectionPriceCents: 4100,
      },
    };
    const result = processEngineCommand(opened.state, command);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.receipt).toMatchObject({
      result: { ok: true, outcome: { totalValueCents: 608000 } },
    });
    expect(result.state.trading.humans[0]!.cashCents).toBe(392000);
    expect(result.batch?.events.map((e) => e.type)).toEqual([
      "OrderAccepted",
      "TradeExecuted",
      "TradeExecuted",
      "ReferencePriceAdjusted",
      "QuotesRebuilt",
      "OrderCompleted",
    ]);
    const retry = processEngineCommand(result.state, {
      ...command,
      atMs: 7000,
    });
    expect(retry).toEqual({
      ok: true,
      state: result.state,
      batch: null,
      receipt: result.receipt,
    });
    expect(
      processEngineCommand(result.state, {
        ...command,
        order: { ...command.order, quantity: 1 },
      }),
    ).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("records rejected attempts and reuses their outcomes even after the balance changes", () => {
    const opened = startEngineRound(frozenRound());
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const command = {
      type: "SubmitOrder",
      atMs: 6000,
      order: {
        roundId,
        playerId,
        requestId: "00000000-0000-4000-8000-000000000005",
        side: "sell",
        symbol: "FERN",
        quantity: 1,
        protectionPriceCents: 100,
      },
    };
    const result = processEngineCommand(opened.state, command);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.receipt).toMatchObject({
      result: { ok: false, code: "INSUFFICIENT_HOLDINGS" },
    });
    expect(result.batch?.events.map((e) => e.type)).toEqual(["OrderRejected"]);
    expect(result.state.trading).toEqual(opened.state.trading);
    const buy = processEngineCommand(result.state, {
      ...command,
      order: {
        ...command.order,
        requestId: "00000000-0000-4000-8000-000000000006",
        side: "buy",
        protectionPriceCents: 4100,
      },
    });
    if (!buy.ok) throw new Error(JSON.stringify(buy));
    expect(processEngineCommand(buy.state, command)).toEqual({
      ok: true,
      state: buy.state,
      batch: null,
      receipt: result.receipt,
    });
  });

  it("applies each recorded shock once, leaving idle marks and all ledgers unchanged", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    let state = opened.state;
    for (const event of round.schedule) {
      const before = structuredClone(state);
      const command = {
        type: "ApplyScheduledEvent",
        atMs: event.dueAtMs,
        scheduledEventId: event.scheduledEventId,
      };
      const result = processEngineCommand(state, command);
      if (!result.ok) throw new Error(JSON.stringify(result));
      expect(result.batch?.events.map((e) => e.type)).toContain(
        "MarketEventApplied",
      );
      expect(result.state.trading.lastPrices).toEqual(
        opened.state.trading.lastPrices,
      );
      expect(result.state.trading.humans).toEqual(opened.state.trading.humans);
      expect(result.state.trading.market.bot).toEqual(
        opened.state.trading.market.bot,
      );
      for (const asset of result.state.trading.market.assets) {
        expect(asset.quoteGeneration).toBe(
          before.trading.market.assets[0]!.quoteGeneration + 1,
        );
        if (!event.catalogEvent.effects.some((e) => e.symbol === asset.symbol))
          expect(asset.referencePriceCents).toBe(
            before.trading.market.assets.find((a) => a.symbol === asset.symbol)!
              .referencePriceCents,
          );
      }
      expect(processEngineCommand(result.state, command)).toEqual({
        ok: true,
        state: result.state,
        batch: null,
        receipt: null,
      });
      expect(state).toEqual(before);
      state = result.state;
    }
    expect(state.nextScheduledEvent).toBe(9);
  });

  it("values holdings at last trades and shares ranks without using join order as a tiebreak", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const initial = getPortfolioRankings(opened.state);
    if (!initial.ok) throw new Error(JSON.stringify(initial));
    expect(
      initial.rankings.map((r) => [r.playerId, r.rank, r.portfolioValueCents]),
    ).toEqual([
      [round.initialState.humans[0]!.playerId, 1, 1000000],
      [round.initialState.humans[1]!.playerId, 1, 1000000],
    ]);
    const bought = processEngineCommand(opened.state, {
      type: "SubmitOrder",
      atMs: 6000,
      order: {
        roundId,
        playerId,
        requestId: "00000000-0000-4000-8000-000000000007",
        side: "buy",
        symbol: "FERN",
        quantity: 150,
        protectionPriceCents: 4100,
      },
    });
    if (!bought.ok) throw new Error(JSON.stringify(bought));
    const ranked = getPortfolioRankings(bought.state);
    if (!ranked.ok) throw new Error(JSON.stringify(ranked));
    expect(
      ranked.rankings.map((r) => [
        r.rank,
        r.portfolioValueCents,
        r.profitCents,
        r.returnPercent,
      ]),
    ).toEqual([
      [1, 1004000, 4000, 0.4],
      [2, 1000000, 0, 0],
    ]);
  });

  it("settles once after all due effects and prevents abort or new orders from changing results", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    let state = opened.state;
    expect(
      processEngineCommand(state, {
        type: "SettleRound",
        atMs: round.closesAtMs - 1,
      }),
    ).toMatchObject({ ok: false, code: "ROUND_NOT_CLOSED" });
    expect(
      processEngineCommand(state, {
        type: "SettleRound",
        atMs: round.closesAtMs,
      }),
    ).toMatchObject({ ok: false, code: "EVENTS_DUE" });
    for (const event of round.schedule) {
      const result = processEngineCommand(state, {
        type: "ApplyScheduledEvent",
        atMs: round.closesAtMs,
        scheduledEventId: event.scheduledEventId,
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      state = result.state;
    }
    const settled = processEngineCommand(state, {
      type: "SettleRound",
      atMs: round.closesAtMs,
    });
    if (!settled.ok) throw new Error(JSON.stringify(settled));
    expect(settled.state.trading.status).toBe("FINISHED");
    expect(settled.state.finalResult).toMatchObject({
      marks: { FERN: 4000, AMBR: 7500, VOLC: 10000, BONE: 2500 },
      rankings: [
        { rank: 1, portfolioValueCents: 1000000 },
        { rank: 1, portfolioValueCents: 1000000 },
      ],
      settlementSequence: settled.state.sequence,
    });
    expect(settled.batch?.events.map((e) => e.type)).toEqual(["RoundSettled"]);
    expect(
      processEngineCommand(settled.state, {
        type: "SettleRound",
        atMs: round.closesAtMs + 100,
      }),
    ).toEqual({ ok: true, state: settled.state, batch: null, receipt: null });
    expect(
      processEngineCommand(settled.state, {
        type: "AbortRound",
        atMs: round.closesAtMs,
        reason: "integrity",
      }),
    ).toMatchObject({ ok: false, code: "MARKET_CLOSED" });
    const aborted = processEngineCommand(opened.state, {
      type: "AbortRound",
      atMs: 6000,
      reason: "integrity",
    });
    if (!aborted.ok) throw new Error(JSON.stringify(aborted));
    expect(aborted.state.trading.status).toBe("ABORTED");
    expect(aborted.state.finalResult).toBeNull();
    expect(
      processEngineCommand(aborted.state, {
        type: "SettleRound",
        atMs: round.closesAtMs,
      }),
    ).toMatchObject({ ok: false, code: "MARKET_CLOSED" });
  });

  it("replays recorded batches, restores retry receipts, and rejects incomplete or corrupted batches atomically", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const command = {
      type: "SubmitOrder",
      atMs: 6000,
      order: {
        roundId,
        playerId,
        requestId: "00000000-0000-4000-8000-000000000008",
        side: "buy",
        symbol: "FERN",
        quantity: 150,
        protectionPriceCents: 4100,
      },
    };
    const bought = processEngineCommand(opened.state, command);
    if (!bought.ok || !bought.batch) throw new Error(JSON.stringify(bought));
    const log = JSON.parse(JSON.stringify([opened.batch, bought.batch]));
    const replay = replayEngine(JSON.parse(JSON.stringify(round)), log);
    expect(replay).toEqual({ ok: true, state: bought.state });
    if (!replay.ok) throw new Error(JSON.stringify(replay));
    expect(processEngineCommand(replay.state, command)).toEqual({
      ok: true,
      state: replay.state,
      batch: null,
      receipt: bought.receipt,
    });
    const incomplete = structuredClone(bought.batch);
    incomplete.events.pop();
    expect(replayEngine(round, [opened.batch, incomplete])).toMatchObject({
      ok: false,
      code: "INVALID_REPLAY",
    });
    const corrupted = structuredClone(bought.batch);
    const fill = corrupted.events.find((e) => e.type === "TradeExecuted")!;
    fill.payload.priceCents += 1;
    expect(replayEngine(round, [opened.batch, corrupted])).toMatchObject({
      ok: false,
      code: "INVALID_REPLAY",
    });
    expect(
      replayEngine(round, [opened.batch, bought.batch, bought.batch]),
    ).toMatchObject({ ok: false, code: "INVALID_REPLAY" });
  });

  it("rejects inconsistent projections before executing a command", () => {
    const opened = startEngineRound(frozenRound());
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const damaged = structuredClone(opened.state);
    damaged.trading.humans[0]!.cashCents += 1;
    expect(engineStateSchema.safeParse(damaged).success).toBe(false);
    expect(
      processEngineCommand(damaged, {
        type: "AbortRound",
        atMs: 6000,
        reason: "integrity",
      }),
    ).toMatchObject({ ok: false, code: "INVALID_ENGINE_STATE" });
    const changedRules = structuredClone(opened.state);
    changedRules.trading.market.rules.bot.referenceImpactBpsPerFilledOrder = 500;
    expect(engineStateSchema.safeParse(changedRules).success).toBe(false);
  });

  it("records closed-round rejections after settlement without changing frozen results", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    let state = opened.state;
    for (const event of round.schedule) {
      const next = processEngineCommand(state, {
        type: "ApplyScheduledEvent",
        atMs: round.closesAtMs,
        scheduledEventId: event.scheduledEventId,
      });
      if (!next.ok) throw new Error(JSON.stringify(next));
      state = next.state;
    }
    const settled = processEngineCommand(state, {
      type: "SettleRound",
      atMs: round.closesAtMs,
    });
    if (!settled.ok) throw new Error(JSON.stringify(settled));
    const command = {
      type: "SubmitOrder",
      atMs: round.closesAtMs,
      order: {
        roundId,
        playerId,
        requestId: "00000000-0000-4000-8000-000000000009",
        side: "buy",
        symbol: "FERN",
        quantity: 1,
        protectionPriceCents: 4100,
      },
    };
    const rejected = processEngineCommand(settled.state, command);
    if (!rejected.ok) throw new Error(JSON.stringify(rejected));
    expect(rejected.receipt).toMatchObject({
      result: { ok: false, code: "MARKET_CLOSED" },
    });
    expect(rejected.state.finalResult).toEqual(settled.state.finalResult);
    expect(processEngineCommand(rejected.state, command)).toEqual({
      ok: true,
      state: rejected.state,
      batch: null,
      receipt: rejected.receipt,
    });
  });

  it("rounds recorded multi-symbol shocks half-up, clamps both bounds, and ignores mutable authored defaults", () => {
    const config = loadBaseline();
    for (const asset of config.assets)
      asset.initialPriceCents = {
        FERN: 3335,
        AMBR: 1005,
        BONE: 100,
        VOLC: 1000000,
      }[asset.symbol];
    config.eventCatalog = [
      {
        ...config.eventCatalog[0]!,
        effects: [
          { symbol: "FERN", referenceChangeBps: 1000 },
          { symbol: "AMBR", referenceChangeBps: -1000 },
          { symbol: "BONE", referenceChangeBps: -1500 },
          { symbol: "VOLC", referenceChangeBps: 1500 },
        ],
      },
    ];
    const round = buildRoundBaseline({
      roundId,
      seed: 3,
      configVersion: "1.0",
      participantIds: [playerId, "00000000-0000-4000-8000-000000000002"],
      createdAtMs: 0,
      opensAtMs: 5000,
      config,
    });
    config.eventCatalog[0]!.effects[0]!.referenceChangeBps = -1500;
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const applied = processEngineCommand(opened.state, {
      type: "ApplyScheduledEvent",
      atMs: round.schedule[0]!.dueAtMs,
      scheduledEventId: round.schedule[0]!.scheduledEventId,
    });
    if (!applied.ok) throw new Error(JSON.stringify(applied));
    expect(
      Object.fromEntries(
        applied.state.trading.market.assets.map((a) => [
          a.symbol,
          a.referencePriceCents,
        ]),
      ),
    ).toEqual({ FERN: 3669, AMBR: 905, BONE: 100, VOLC: 1000000 });
    expect(applied.state.trading.lastPrices).toEqual({
      FERN: 3335,
      AMBR: 1005,
      BONE: 100,
      VOLC: 1000000,
    });
  });

  it.each([
    [
      {
        type: "ApplyScheduledEvent",
        atMs: 65000,
        scheduledEventId: `${roundId}:2`,
      },
      "INVALID_SCHEDULED_EVENT",
    ],
    [
      {
        type: "ApplyScheduledEvent",
        atMs: 64999,
        scheduledEventId: `${roundId}:1`,
      },
      "EVENT_NOT_DUE",
    ],
    [
      {
        type: "ApplyScheduledEvent",
        atMs: 65000,
        scheduledEventId: "invented",
      },
      "INVALID_SCHEDULED_EVENT",
    ],
    [{ type: "AbortRound", atMs: 4999, reason: "integrity" }, "INVALID_TIME"],
    [{ type: "CommentaryPublished", atMs: 6000 }, "INVALID_COMMAND"],
  ])(
    "rejects out-of-order, early and unsupported inputs: %j",
    (command, code) => {
      const opened = startEngineRound(frozenRound());
      if (!opened.ok) throw new Error(JSON.stringify(opened));
      const before = structuredClone(opened.state);
      expect(processEngineCommand(opened.state, command)).toMatchObject({
        ok: false,
        code,
      });
      expect(opened.state).toEqual(before);
    },
  );

  it("replays 300 seeded mixed commands, all nine effects and final rankings with exact conserved resources", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    let state: EngineState = opened.state;
    const batches: EngineBatch[] = [opened.batch];
    const advance = (command: unknown) => {
      const before = structuredClone(state);
      const result = processEngineCommand(state, command);
      if (!result.ok || !result.batch) throw new Error(JSON.stringify(result));
      expect(state).toEqual(before);
      expect(
        engineBatchSchema.parse(JSON.parse(JSON.stringify(result.batch))),
      ).toEqual(result.batch);
      state = result.state;
      batches.push(result.batch);
      expect(engineStateSchema.safeParse(state).success).toBe(true);
      expect(
        state.trading.humans.reduce(
          (sum, h) => sum + BigInt(h.cashCents),
          BigInt(state.trading.market.bot.cashCents),
        ),
      ).toBe(1002000000n);
      for (const symbol of ["FERN", "AMBR", "BONE", "VOLC"] as const) {
        expect(
          state.trading.humans.reduce(
            (sum, h) => sum + BigInt(h.holdings[symbol]),
            BigInt(state.trading.market.bot.holdings[symbol]),
          ),
        ).toBe(100000n);
        expect(state.trading.reservations.holdings[symbol]).toBeLessThanOrEqual(
          state.trading.market.bot.holdings[symbol],
        );
      }
      expect(state.trading.reservations.cashCents).toBeLessThanOrEqual(
        state.trading.market.bot.cashCents,
      );
    };
    let seed = 47;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 8;
    };
    for (let i = 0; i < 300; i++) {
      const atMs = 5000 + (i + 1) * 1900;
      while (
        round.schedule[state.nextScheduledEvent] &&
        round.schedule[state.nextScheduledEvent]!.dueAtMs <= atMs
      )
        advance({
          type: "ApplyScheduledEvent",
          atMs,
          scheduledEventId:
            round.schedule[state.nextScheduledEvent]!.scheduledEventId,
        });
      const symbol = (["FERN", "AMBR", "BONE", "VOLC"] as const)[next() % 4]!;
      const reference = state.trading.market.assets.find(
        (a) => a.symbol === symbol,
      )!.referencePriceCents;
      advance({
        type: "SubmitOrder",
        atMs,
        order: {
          roundId,
          playerId: round.initialState.humans[next() % 2]!.playerId,
          requestId: `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`,
          side: next() % 2 ? "buy" : "sell",
          symbol,
          quantity: (next() % 400) + 1,
          protectionPriceCents: Math.max(
            100,
            Math.min(1000000, reference + (next() % 1500) - 750),
          ),
        },
      });
    }
    advance({ type: "SettleRound", atMs: round.closesAtMs });
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Replay read wall clock");
    });
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Replay used randomness");
    });
    try {
      expect(
        replayEngine(
          JSON.parse(JSON.stringify(round)),
          JSON.parse(JSON.stringify(batches)),
        ),
      ).toEqual({ ok: true, state });
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
    const ranked = getPortfolioRankings(state);
    if (!ranked.ok) throw new Error(JSON.stringify(ranked));
    expect(state.finalResult?.rankings).toEqual(ranked.rankings);
    expect(state.receipts).toHaveLength(300);
    expect(state.nextScheduledEvent).toBe(9);
    expect(
      new Set(
        state.receipts.map((r) =>
          r.result.ok ? r.result.outcome.status : r.result.code,
        ),
      ),
    ).toEqual(
      new Set([
        "FILLED",
        "PARTIALLY_FILLED",
        "NO_LIQUIDITY_WITHIN_PROTECTION",
        "INSUFFICIENT_CASH",
        "INSUFFICIENT_HOLDINGS",
      ]),
    );
  });

  it("validates batch envelope continuity and rejects unsupported versions", () => {
    const opened = startEngineRound(frozenRound());
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const gap = structuredClone(opened.batch);
    gap.events[1]!.sequence += 1;
    expect(engineBatchSchema.safeParse(gap).success).toBe(false);
    const foreign = structuredClone(opened.batch);
    foreign.events[1]!.roundId = playerId;
    expect(engineBatchSchema.safeParse(foreign).success).toBe(false);
    const time = structuredClone(opened.batch);
    time.events[1]!.occurredAtMs += 1;
    expect(engineBatchSchema.safeParse(time).success).toBe(false);
    expect(
      engineBatchSchema.safeParse({ ...opened.batch, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(replayEngine(frozenRound(), [gap])).toMatchObject({
      ok: false,
      code: "INVALID_REPLAY",
    });
  });

  it("checks due and closing boundaries before allowing a new order, but retries return original receipts", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const order = {
      roundId,
      playerId,
      requestId: "00000000-0000-4000-8000-000000000010",
      side: "buy",
      symbol: "FERN",
      quantity: 1,
      protectionPriceCents: 4100,
    };
    const command = { type: "SubmitOrder", atMs: 6000, order };
    const result = processEngineCommand(opened.state, command);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      processEngineCommand(opened.state, {
        ...command,
        atMs: round.schedule[0]!.dueAtMs,
      }),
    ).toMatchObject({ ok: false, code: "EVENTS_DUE" });
    expect(
      processEngineCommand(opened.state, {
        ...command,
        atMs: round.closesAtMs,
      }),
    ).toMatchObject({ ok: false, code: "MARKET_CLOSED" });
    expect(
      processEngineCommand(result.state, {
        ...command,
        atMs: round.closesAtMs,
      }),
    ).toEqual({
      ok: true,
      state: result.state,
      batch: null,
      receipt: result.receipt,
    });
    const otherPlayer = processEngineCommand(result.state, {
      ...command,
      order: { ...order, playerId: round.initialState.humans[1]!.playerId },
    });
    if (!otherPlayer.ok) throw new Error(JSON.stringify(otherPlayer));
    expect(otherPlayer.state.receipts).toHaveLength(2);
    expect(otherPlayer.batch).not.toBeNull();
    expect(
      processEngineCommand(result.state, {
        ...command,
        order: { ...order, roundId: playerId },
      }),
    ).toMatchObject({ ok: false, code: "ROUND_MISMATCH" });
    expect(
      processEngineCommand(result.state, {
        ...command,
        order: { ...order, playerId: roundId },
      }),
    ).toMatchObject({ ok: false, code: "PLAYER_NOT_IN_ROUND" });
    expect(
      processEngineCommand(result.state, {
        ...command,
        order: { ...order, quantity: 1.5 },
      }),
    ).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
  });

  it("replays abort and accepts reordered JSON object keys without reordering events", () => {
    const round = frozenRound();
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const aborted = processEngineCommand(opened.state, {
      type: "AbortRound",
      atMs: 6000,
      reason: "integrity",
    });
    if (!aborted.ok || !aborted.batch) throw new Error(JSON.stringify(aborted));
    const json = JSON.stringify([opened.batch, aborted.batch]);
    const reversedKeys: unknown = JSON.parse(json, (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    );
    expect(replayEngine(round, reversedKeys)).toEqual({
      ok: true,
      state: aborted.state,
    });
    expect(
      processEngineCommand(aborted.state, {
        type: "AbortRound",
        atMs: 9000,
        reason: "integrity",
      }),
    ).toEqual({ ok: true, state: aborted.state, batch: null, receipt: null });
    expect(aborted.state.finalResult).toBeNull();
    expect(replayEngine(round, [aborted.batch, opened.batch])).toMatchObject({
      ok: false,
      code: "INVALID_REPLAY",
    });
  });

  it("rejects unrepresentable valuations and exhausted sequences without partial settlement", () => {
    const config = loadBaseline();
    config.rules.player.startingCashCents = Number.MAX_SAFE_INTEGER;
    const round = buildRoundBaseline({
      roundId,
      seed: 3,
      configVersion: "1.0",
      participantIds: [playerId, "00000000-0000-4000-8000-000000000002"],
      createdAtMs: 0,
      opensAtMs: 5000,
      config,
    });
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const state = structuredClone(opened.state);
    state.trading.humans[0]!.holdings.FERN = 1;
    state.trading.market.bot.holdings.FERN -= 1;
    expect(getPortfolioRankings(state)).toMatchObject({
      ok: false,
      code: "UNSAFE_VALUATION",
    });
    const exhausted = { ...opened.state, sequence: Number.MAX_SAFE_INTEGER };
    expect(
      processEngineCommand(exhausted, {
        type: "AbortRound",
        atMs: 6000,
        reason: "integrity",
      }),
    ).toMatchObject({ ok: false, code: "SEQUENCE_EXHAUSTED" });
    expect(exhausted.trading.status).toBe("OPEN");
  });

  it("uses competition ranks and frozen join order for equal values", () => {
    const base = frozenRound();
    const round = buildRoundBaseline({
      roundId,
      seed: 3,
      configVersion: "1.0",
      participantIds: [
        ...base.initialState.humans.map((h) => h.playerId),
        "00000000-0000-4000-8000-000000000099",
      ],
      createdAtMs: 0,
      opensAtMs: 5000,
      config: loadBaseline(),
    });
    const opened = startEngineRound(round);
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    const state = structuredClone(opened.state);
    state.trading.humans[2]!.cashCents -= 1;
    state.trading.market.bot.cashCents += 1;
    state.trading.humans.reverse();
    const result = getPortfolioRankings(state);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(
      result.rankings.map((r) => [r.joinOrder, r.rank, r.portfolioValueCents]),
    ).toEqual([
      [0, 1, 1000000],
      [1, 1, 1000000],
      [2, 3, 999999],
    ]);
  });

  it("opens from frozen funding with one complete versioned batch", () => {
    const round = frozenRound();
    const before = structuredClone(round);
    const result = startEngineRound(round);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.state.trading.humans.map((h) => h.cashCents)).toEqual([
      1000000, 1000000,
    ]);
    expect(result.state.trading.market.bot.cashCents).toBe(1000000000);
    expect(result.state.trading.quotes).toHaveLength(24);
    expect(result.batch.events.map((e) => e.type)).toEqual([
      "RoundOpened",
      "QuotesRebuilt",
    ]);
    expect(result.batch.events.map((e) => e.sequence)).toEqual([2, 3]);
    expect(result.state.sequence).toBe(3);
    expect(result.state.trading.status).toBe("OPEN");
    expect(round).toEqual(before);
  });
});
