import {
  assetSymbolSchema,
  type PortfolioRanking,
  frozenRoundSchema,
  engineStateSchema,
  engineCommandSchema,
  type EngineState,
  type EngineEvent,
  type EngineCommand,
  type EngineCommandResult,
  type OrderReceipt,
  engineBatchSchema,
  engineReplayLogSchema,
  type EngineReplayResult,
  type EngineBatch,
  type EngineError,
  type EngineTransition,
} from "@dinopump/contracts";
import { executeBuy } from "./protected-buys.js";
import { executeSell } from "./protected-sells.js";
import { initializeBotQuotes, rebuildBotQuotes } from "./bot-quotes.js";

function invalid(
  code: EngineError["code"],
  error: { issues: { path: PropertyKey[]; message: string }[] },
): EngineError {
  return {
    ok: false,
    code,
    issues: error.issues.map(({ path, message }) => ({
      path: path.map((p) => (typeof p === "number" ? p : String(p))),
      message,
    })),
  };
}

/** The service calls this at opening; sequence 1 is the frozen RoundInitialized record. */
export function startEngineRound(input: unknown): EngineTransition {
  const parsed = frozenRoundSchema.safeParse(input);
  if (!parsed.success) return invalid("INVALID_FROZEN_ROUND", parsed.error);
  const round = parsed.data;
  const quotes = initializeBotQuotes(round);
  if (!quotes.ok) return quotes;
  const metadata = {
    schemaVersion: 1 as const,
    roundId: round.roundId,
    causeId: round.roundId,
    occurredAtMs: round.opensAtMs,
  };
  return {
    ok: true,
    state: {
      schemaVersion: 1,
      round,
      sequence: 3,
      receipts: [],
      nextScheduledEvent: 0,
      finalResult: null,
      abortReason: null,
      lastCommandAtMs: round.opensAtMs,
      trading: {
        market: quotes.state,
        quotes: quotes.quotes,
        reservations: quotes.reservations,
        status: "OPEN",
        humans: structuredClone(round.initialState.humans),
        lastPrices: {
          AMBR: round.initialState.assets.find((a) => a.symbol === "AMBR")!
            .lastPriceCents,
          BONE: round.initialState.assets.find((a) => a.symbol === "BONE")!
            .lastPriceCents,
          FERN: round.initialState.assets.find((a) => a.symbol === "FERN")!
            .lastPriceCents,
          VOLC: round.initialState.assets.find((a) => a.symbol === "VOLC")!
            .lastPriceCents,
        },
      },
    },
    batch: {
      schemaVersion: 1,
      command: { type: "OpenRound", atMs: round.opensAtMs },
      events: [
        {
          ...metadata,
          sequence: 2,
          type: "RoundOpened",
          payload: round.initialState,
        },
        {
          ...metadata,
          sequence: 3,
          type: "QuotesRebuilt",
          payload: {
            state: quotes.state,
            quotes: quotes.quotes,
            reservations: quotes.reservations,
          },
        },
      ],
    },
  };
}

function reject(
  code: EngineError["code"],
  path: string,
  message: string,
): EngineError {
  return { ok: false, code, issues: [{ path: [path], message }] };
}

type Fact = EngineEvent extends infer Event
  ? Event extends EngineEvent
    ? Pick<Event, "type" | "payload">
    : never
  : never;

function finish(
  state: EngineState,
  command: EngineCommand,
  causeId: string,
  facts: Fact[],
  receipt: OrderReceipt | null = null,
): EngineCommandResult {
  if (!Number.isSafeInteger(state.sequence + facts.length))
    return reject(
      "SEQUENCE_EXHAUSTED",
      "sequence",
      "Cannot advance event sequence",
    );
  const events = facts.map((fact) => ({
    ...fact,
    schemaVersion: 1 as const,
    roundId: state.round.roundId,
    sequence: ++state.sequence,
    causeId,
    occurredAtMs: command.atMs,
  }));
  state.lastCommandAtMs = command.atMs;
  return {
    ok: true,
    state,
    batch: { schemaVersion: 1, command, events },
    receipt,
  };
}

/** Internal serialized command boundary. The service supplies identity and time. */
export function processEngineCommand(
  input: unknown,
  request: unknown,
): EngineCommandResult {
  const parsedState = engineStateSchema.safeParse(input);
  if (!parsedState.success)
    return invalid("INVALID_ENGINE_STATE", parsedState.error);
  const parsedCommand = engineCommandSchema.safeParse(request);
  if (!parsedCommand.success)
    return invalid("INVALID_COMMAND", parsedCommand.error);
  const state = parsedState.data;
  const command = parsedCommand.data;
  if (command.type === "SettleRound") {
    if (state.trading.status === "FINISHED")
      return { ok: true, state, batch: null, receipt: null };
    if (state.trading.status !== "OPEN")
      return reject("MARKET_CLOSED", "status", "Only an open round can settle");
    if (command.atMs < state.lastCommandAtMs)
      return reject(
        "INVALID_TIME",
        "atMs",
        "Commands must use nondecreasing authoritative time",
      );
    if (command.atMs < state.round.closesAtMs)
      return reject(
        "ROUND_NOT_CLOSED",
        "atMs",
        "The closing deadline has not passed",
      );
    if (state.nextScheduledEvent !== state.round.schedule.length)
      return reject(
        "EVENTS_DUE",
        "nextScheduledEvent",
        "Apply all pre-close effects before settlement",
      );
    const values = getPortfolioRankings(state);
    if (!values.ok) return values;
    state.finalResult = {
      marks: state.trading.lastPrices,
      rankings: values.rankings,
      settlementSequence: state.sequence + 1,
    };
    state.trading.status = "FINISHED";
    return finish(state, command, state.round.roundId, [
      { type: "RoundSettled", payload: state.finalResult },
    ]);
  }
  if (command.type === "AbortRound") {
    if (
      state.trading.status === "ABORTED" &&
      state.abortReason === command.reason
    )
      return { ok: true, state, batch: null, receipt: null };
    if (state.trading.status !== "OPEN")
      return reject(
        "MARKET_CLOSED",
        "status",
        "A terminal round cannot be aborted",
      );
    if (command.atMs < state.lastCommandAtMs)
      return reject(
        "INVALID_TIME",
        "atMs",
        "Commands must use nondecreasing authoritative time",
      );
    state.trading.status = "ABORTED";
    state.abortReason = command.reason;
    return finish(state, command, state.round.roundId, [
      { type: "RoundAborted", payload: { reason: command.reason } },
    ]);
  }
  if (command.type === "ApplyScheduledEvent") {
    const index = state.round.schedule.findIndex(
      (event) => event.scheduledEventId === command.scheduledEventId,
    );
    if (index < 0 || index > state.nextScheduledEvent)
      return reject(
        "INVALID_SCHEDULED_EVENT",
        "scheduledEventId",
        "Apply the next recorded scheduled event in order",
      );
    if (index < state.nextScheduledEvent)
      return { ok: true, state, batch: null, receipt: null };
    if (state.trading.status !== "OPEN")
      return reject(
        "MARKET_CLOSED",
        "status",
        "Scheduled effects require an open round",
      );
    const event = state.round.schedule[index]!;
    if (command.atMs < state.lastCommandAtMs)
      return reject(
        "INVALID_TIME",
        "atMs",
        "Commands must use nondecreasing authoritative time",
      );
    if (command.atMs < event.dueAtMs)
      return reject("EVENT_NOT_DUE", "atMs", "Scheduled event is not due");
    const facts: Fact[] = [{ type: "MarketEventApplied", payload: event }];
    for (const effect of event.catalogEvent.effects) {
      const asset = state.trading.market.assets.find(
        (a) => a.symbol === effect.symbol,
      )!;
      const beforeCents = asset.referencePriceCents;
      const rounded =
        (BigInt(beforeCents) * BigInt(10000 + effect.referenceChangeBps) +
          5000n) /
        10000n;
      const { minCents, maxCents } = state.trading.market.rules.prices;
      asset.referencePriceCents = Number(
        rounded < BigInt(minCents)
          ? BigInt(minCents)
          : rounded > BigInt(maxCents)
            ? BigInt(maxCents)
            : rounded,
      );
      facts.push({
        type: "ReferencePriceAdjusted",
        payload: {
          symbol: effect.symbol,
          beforeCents,
          afterCents: asset.referencePriceCents,
          changeBps: effect.referenceChangeBps,
        },
      });
    }
    const quotes = rebuildBotQuotes(state.trading.market);
    if (!quotes.ok) return quotes;
    state.trading.market = quotes.state;
    state.trading.quotes = quotes.quotes;
    state.trading.reservations = quotes.reservations;
    state.nextScheduledEvent += 1;
    facts.push({
      type: "QuotesRebuilt",
      payload: {
        state: quotes.state,
        quotes: quotes.quotes,
        reservations: quotes.reservations,
      },
    });
    return finish(state, command, event.scheduledEventId, facts);
  }
  if (command.type !== "SubmitOrder")
    return reject("INVALID_COMMAND", "type", "Round is already initialized");
  const order = command.order;
  if (order.roundId !== state.round.roundId)
    return reject(
      "ROUND_MISMATCH",
      "roundId",
      "Order belongs to a different round",
    );
  if (!state.trading.humans.some((h) => h.playerId === order.playerId))
    return reject(
      "PLAYER_NOT_IN_ROUND",
      "playerId",
      "Player is not a round participant",
    );
  const existing = state.receipts.find(
    (r) =>
      r.command.playerId === order.playerId &&
      r.command.requestId === order.requestId,
  );
  if (existing) {
    if (JSON.stringify(existing.command) !== JSON.stringify(order))
      return reject(
        "IDEMPOTENCY_CONFLICT",
        "requestId",
        "Request identity already has different content",
      );
    return { ok: true, state, batch: null, receipt: existing };
  }
  if (command.atMs < state.lastCommandAtMs)
    return reject(
      "INVALID_TIME",
      "atMs",
      "Commands must use nondecreasing authoritative time",
    );
  if (state.trading.status === "OPEN" && command.atMs >= state.round.closesAtMs)
    return reject(
      "MARKET_CLOSED",
      "atMs",
      "Settle the round before handling a new order",
    );
  const nextEvent = state.round.schedule[state.nextScheduledEvent];
  if (
    state.trading.status === "OPEN" &&
    nextEvent &&
    command.atMs >= nextEvent.dueAtMs
  )
    return reject(
      "EVENTS_DUE",
      "atMs",
      "Process recorded due effects before trading",
    );
  const result =
    order.side === "buy"
      ? executeBuy(state.trading, order)
      : executeSell(state.trading, order);
  const receipt: OrderReceipt = {
    command: order,
    result: result.ok
      ? { ok: true, fills: result.fills, outcome: result.outcome }
      : result,
  };
  const facts: Fact[] = [];
  if (result.ok) {
    facts.push({ type: "OrderAccepted", payload: order });
    facts.push(
      ...result.fills.map((fill) => ({
        type: "TradeExecuted" as const,
        payload: fill,
      })),
    );
    if (result.fills.length)
      facts.push({
        type: "ReferencePriceAdjusted",
        payload: {
          symbol: order.symbol,
          beforeCents: state.trading.market.assets.find(
            (a) => a.symbol === order.symbol,
          )!.referencePriceCents,
          afterCents: result.state.market.assets.find(
            (a) => a.symbol === order.symbol,
          )!.referencePriceCents,
          changeBps:
            state.trading.market.rules.bot.referenceImpactBpsPerFilledOrder *
            (order.side === "buy" ? 1 : -1),
        },
      });
    state.trading = result.state;
    facts.push(
      {
        type: "QuotesRebuilt",
        payload: {
          state: result.state.market,
          quotes: result.state.quotes,
          reservations: result.state.reservations,
        },
      },
      { type: "OrderCompleted", payload: receipt },
    );
  } else facts.push({ type: "OrderRejected", payload: receipt });
  state.receipts.push(receipt);
  return finish(state, command, order.requestId, facts, receipt);
}

/** Integer marks feed value/rank; returnPercent is display-only. */
export function getPortfolioRankings(
  input: unknown,
): { ok: true; rankings: PortfolioRanking[] } | EngineError {
  const parsed = engineStateSchema.safeParse(input);
  if (!parsed.success) return invalid("INVALID_ENGINE_STATE", parsed.error);
  const { trading, round } = parsed.data;
  const rankings: PortfolioRanking[] = [];
  for (const human of trading.humans) {
    const value = assetSymbolSchema.options.reduce(
      (sum, symbol) =>
        sum +
        BigInt(human.holdings[symbol]) * BigInt(trading.lastPrices[symbol]),
      BigInt(human.cashCents),
    );
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      return reject(
        "UNSAFE_VALUATION",
        "humans",
        "Portfolio value exceeds safe integer cents",
      );
    const portfolioValueCents = Number(value);
    const profitCents =
      portfolioValueCents - round.config.rules.player.startingCashCents;
    rankings.push({
      playerId: human.playerId,
      joinOrder: human.joinOrder,
      rank: 1,
      portfolioValueCents,
      profitCents,
      returnPercent:
        (profitCents / round.config.rules.player.startingCashCents) * 100,
    });
  }
  rankings.sort(
    (a, b) =>
      b.portfolioValueCents - a.portfolioValueCents ||
      a.joinOrder - b.joinOrder,
  );
  rankings.forEach((entry, index) => {
    const previous = rankings[index - 1];
    entry.rank =
      previous?.portfolioValueCents === entry.portfolioValueCents
        ? previous.rank
        : index + 1;
  });
  return { ok: true, rankings };
}

function sameBatch(actual: EngineBatch, recorded: EngineBatch): boolean {
  // Parse both to canonical property order; PostgreSQL JSONB can reorder object keys.
  return (
    JSON.stringify(engineBatchSchema.parse(actual)) === JSON.stringify(recorded)
  );
}

/** Reduce a complete recorded batch, checking every fact before exposing state. */
export function reduceEngineBatch(
  input: unknown,
  recorded: unknown,
): EngineReplayResult {
  const parsed = engineBatchSchema.safeParse(recorded);
  if (!parsed.success) return invalid("INVALID_REPLAY", parsed.error);
  const result = processEngineCommand(input, parsed.data.command);
  if (!result.ok || !result.batch || !sameBatch(result.batch, parsed.data))
    return reject(
      "INVALID_REPLAY",
      "events",
      "Batch is out of order, incomplete, unsupported, or disagrees with deterministic facts",
    );
  return { ok: true, state: result.state };
}

/** Replay only frozen configuration and committed batches; no I/O, clock or randomness. */
export function replayEngine(
  round: unknown,
  recorded: unknown,
): EngineReplayResult {
  const parsed = engineReplayLogSchema.safeParse(recorded);
  if (!parsed.success) return invalid("INVALID_REPLAY", parsed.error);
  const opened = startEngineRound(round);
  if (!opened.ok) return opened;
  if (!sameBatch(opened.batch, parsed.data[0]!))
    return reject(
      "INVALID_REPLAY",
      "events",
      "Opening batch disagrees with frozen funding",
    );
  let state = opened.state;
  for (const batch of parsed.data.slice(1)) {
    const result = reduceEngineBatch(state, batch);
    if (!result.ok) return result;
    state = result.state;
  }
  return { ok: true, state };
}
