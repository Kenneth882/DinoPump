import { z } from "zod";
import { botQuoteResultSchema } from "./bot-quotes.js";
import {
  buyCommandSchema,
  buyResultSchema,
  buyFillSchema,
  buyStateSchema,
} from "./protected-buys.js";
import { frozenRoundSchema } from "./round-baseline.js";

import {
  sellCommandSchema,
  sellFillSchema,
  sellResultSchema,
} from "./protected-sells.js";
import { assetSymbolSchema } from "./baseline.js";

const orderCommandSchema = z.discriminatedUnion("side", [
  buyCommandSchema,
  sellCommandSchema,
]);
const orderReceiptSchema = z.strictObject({
  command: orderCommandSchema,
  result: z.union([
    buyResultSchema.options[0].omit({ state: true, command: true }).extend({
      fills: z.array(z.union([buyFillSchema, sellFillSchema])).max(24),
    }),
    buyResultSchema.options[1],
    sellResultSchema.options[1],
  ]),
});
export type OrderReceipt = z.infer<typeof orderReceiptSchema>;

const integer = z.number().int().nonnegative();
const timestamp = integer.max(8_640_000_000_000_000);
export const portfolioRankingSchema = z.strictObject({
  playerId: z.uuid().toLowerCase(),
  joinOrder: integer,
  rank: integer.positive(),
  portfolioValueCents: integer,
  profitCents: z.number().int(),
  returnPercent: z.number(),
});
export type PortfolioRanking = z.infer<typeof portfolioRankingSchema>;
export const engineFinalResultSchema = z.strictObject({
  marks: buyStateSchema.shape.lastPrices,
  rankings: z.array(portfolioRankingSchema).min(2).max(8),
  settlementSequence: integer.positive(),
});
const envelope = z.strictObject({
  schemaVersion: z.literal(1),
  roundId: z.uuid().toLowerCase(),
  sequence: integer.positive(),
  causeId: z.string().min(1),
  occurredAtMs: timestamp,
});

const referenceAdjustmentSchema = z.strictObject({
  symbol: assetSymbolSchema,
  beforeCents: integer.positive(),
  afterCents: integer.positive(),
  changeBps: z.number().int().min(-10000).max(10000),
});
export const engineEventSchema = z.discriminatedUnion("type", [
  envelope.extend({
    type: z.literal("RoundSettled"),
    payload: engineFinalResultSchema,
  }),
  envelope.extend({
    type: z.literal("RoundAborted"),
    payload: z.strictObject({ reason: z.string().min(1).max(200) }),
  }),
  envelope.extend({
    type: z.literal("MarketEventApplied"),
    payload: frozenRoundSchema.shape.schedule.element,
  }),
  envelope.extend({
    type: z.literal("OrderAccepted"),
    payload: orderCommandSchema,
  }),
  envelope.extend({
    type: z.literal("TradeExecuted"),
    payload: z.union([buyFillSchema, sellFillSchema]),
  }),
  envelope.extend({
    type: z.literal("ReferencePriceAdjusted"),
    payload: referenceAdjustmentSchema,
  }),
  envelope.extend({
    type: z.literal("OrderCompleted"),
    payload: orderReceiptSchema,
  }),
  envelope.extend({
    type: z.literal("OrderRejected"),
    payload: orderReceiptSchema,
  }),
  envelope.extend({
    type: z.literal("RoundOpened"),
    payload: frozenRoundSchema.shape.initialState,
  }),
  envelope.extend({
    type: z.literal("QuotesRebuilt"),
    payload: botQuoteResultSchema.options[0].omit({ ok: true }),
  }),
]);
export const engineCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("SettleRound"), atMs: timestamp }),
  z.strictObject({
    type: z.literal("AbortRound"),
    atMs: timestamp,
    reason: z.string().min(1).max(200),
  }),
  z.strictObject({
    type: z.literal("ApplyScheduledEvent"),
    atMs: timestamp,
    scheduledEventId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("SubmitOrder"),
    atMs: timestamp,
    order: orderCommandSchema,
  }),
  z.strictObject({ type: z.literal("OpenRound"), atMs: timestamp }),
]);
export const engineBatchSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    command: engineCommandSchema,
    events: z.array(engineEventSchema).min(1),
  })
  .superRefine((batch, ctx) => {
    const first = batch.events[0];
    if (!first) return;
    batch.events.forEach((event, index) => {
      if (
        event.roundId !== first.roundId ||
        event.causeId !== first.causeId ||
        event.sequence !== first.sequence + index ||
        event.occurredAtMs !== batch.command.atMs
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["events", index],
          message:
            "Batch events must share identity/time and have contiguous sequences",
        });
      }
    });
  });
export const engineReplayLogSchema = z.array(engineBatchSchema).min(1);
export const engineStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    round: frozenRoundSchema,
    trading: buyStateSchema,
    sequence: integer.min(3),
    lastCommandAtMs: timestamp,
    receipts: z.array(orderReceiptSchema),
    nextScheduledEvent: integer,
    finalResult: engineFinalResultSchema.nullable(),
    abortReason: z.string().min(1).max(200).nullable(),
  })
  .superRefine((state, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const { round, trading } = state;
    if (
      trading.market.roundId !== round.roundId ||
      trading.market.rulesVersion !== round.rulesVersion ||
      JSON.stringify(trading.market.rules) !==
        JSON.stringify(round.config.rules)
    )
      issue("trading", "Market must retain frozen round identity and rules");
    if (
      trading.humans.length !== round.initialState.humans.length ||
      trading.humans.some(
        (h) =>
          !round.initialState.humans.some(
            (initial) =>
              initial.playerId === h.playerId &&
              initial.joinOrder === h.joinOrder,
          ),
      )
    )
      issue("trading", "Participants and join order must remain frozen");
    const initialLedgers = [
      ...round.initialState.humans,
      round.initialState.bot,
    ];
    const ledgers = [...trading.humans, trading.market.bot];
    if (
      ledgers.reduce((sum, h) => sum + BigInt(h.cashCents), 0n) !==
      initialLedgers.reduce((sum, h) => sum + BigInt(h.cashCents), 0n)
    )
      issue("trading", "Cash must be conserved after funding");
    for (const symbol of assetSymbolSchema.options) {
      if (
        ledgers.reduce((sum, h) => sum + BigInt(h.holdings[symbol]), 0n) !==
        initialLedgers.reduce((sum, h) => sum + BigInt(h.holdings[symbol]), 0n)
      )
        issue("trading", "Units must be conserved after funding");
    }
    if (state.nextScheduledEvent > round.schedule.length)
      issue("nextScheduledEvent", "Scheduled position exceeds frozen schedule");
    if (state.lastCommandAtMs < round.opensAtMs)
      issue("lastCommandAtMs", "Commands cannot precede opening");
    if (!["OPEN", "FINISHED", "ABORTED"].includes(trading.status))
      issue("trading", "Engine projections must be open or terminal");
    if (
      (trading.status === "FINISHED") !== (state.finalResult !== null) ||
      (trading.status === "ABORTED") !== (state.abortReason !== null)
    )
      issue(
        "trading",
        "Terminal status must agree with results or abort reason",
      );
    if (
      state.finalResult &&
      (state.finalResult.settlementSequence > state.sequence ||
        JSON.stringify(state.finalResult.marks) !==
          JSON.stringify(trading.lastPrices) ||
        state.nextScheduledEvent !== round.schedule.length)
    )
      issue(
        "finalResult",
        "Final results must retain frozen marks and completed schedule",
      );
    const identities = new Set<string>();
    for (const receipt of state.receipts) {
      const key = `${receipt.command.playerId}:${receipt.command.requestId}`;
      if (
        identities.has(key) ||
        receipt.command.roundId !== round.roundId ||
        !trading.humans.some((h) => h.playerId === receipt.command.playerId)
      )
        issue(
          "receipts",
          "Receipts must have unique round/participant/request identity",
        );
      identities.add(key);
    }
  });
export type EngineState = z.infer<typeof engineStateSchema>;
export type EngineEvent = z.infer<typeof engineEventSchema>;
export type EngineBatch = z.infer<typeof engineBatchSchema>;
export type EngineCommand = z.infer<typeof engineCommandSchema>;

export const engineErrorSchema = z.strictObject({
  ok: z.literal(false),
  code: z.enum([
    "ROUND_NOT_CLOSED",
    "UNSAFE_VALUATION",
    "INVALID_SCHEDULED_EVENT",
    "EVENT_NOT_DUE",
    "IDEMPOTENCY_CONFLICT",
    "ROUND_MISMATCH",
    "PLAYER_NOT_IN_ROUND",
    "MARKET_CLOSED",
    "EVENTS_DUE",
    "INVALID_TIME",
    "SEQUENCE_EXHAUSTED",
    "INVALID_FROZEN_ROUND",
    "INVALID_ENGINE_STATE",
    "INVALID_COMMAND",
    "INVALID_REPLAY",
    "INVALID_QUOTE_STATE",
    "QUOTE_GENERATION_EXHAUSTED",
  ]),
  issues: z
    .array(
      z.strictObject({
        path: z.array(z.union([z.string(), integer])),
        message: z.string(),
      }),
    )
    .min(1),
});
export type EngineError = z.infer<typeof engineErrorSchema>;
export type EngineTransition =
  { ok: true; state: EngineState; batch: EngineBatch } | EngineError;

export type EngineCommandResult =
  | {
      ok: true;
      state: EngineState;
      batch: EngineBatch | null;
      receipt: OrderReceipt | null;
    }
  | EngineError;

export type EngineReplayResult = { ok: true; state: EngineState } | EngineError;
