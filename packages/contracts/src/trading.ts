import { z } from "zod";
import {
  buyCommandSchema,
  buyFillSchema,
  buyResultSchema,
} from "./protected-buys.js";
import { sellFillSchema } from "./protected-sells.js";
import { frozenRoundSchema } from "./round-baseline.js";
import { gameplayRulesSchema } from "./baseline.js";
import { portfolioRankingSchema } from "./round-engine.js";

/** Identity belongs to the authenticated session, never the browser payload. */
export const orderSubmitSchema = buyCommandSchema
  .omit({ playerId: true })
  .extend({ side: z.enum(["buy", "sell"]) });
export const tradingRejectionCodeSchema = z.enum([
  "INVALID_ORDER",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_HOLDINGS",
  "MARKET_CLOSED",
]);
export const privatePortfolioSchema =
  frozenRoundSchema.shape.initialState.shape.humans.element.omit({
    playerId: true,
    joinOrder: true,
  });
export const orderResultSchema = orderSubmitSchema
  .extend({
    sequence: z.number().int().positive(),
    status: z.enum([
      "FILLED",
      "PARTIALLY_FILLED",
      "NO_LIQUIDITY_WITHIN_PROTECTION",
      "REJECTED",
    ]),
    rejectionCode: tradingRejectionCodeSchema.nullable(),
    fills: z.array(z.union([buyFillSchema, sellFillSchema])).max(24),
    filledQuantity: z.number().int().nonnegative(),
    remainingQuantity: z.number().int().nonnegative(),
    totalValueCents: z.number().int().nonnegative(),
    averagePrice: buyResultSchema.options[0].shape.outcome.shape.averagePrice,
    portfolio: privatePortfolioSchema,
  })
  .superRefine((result, ctx) => {
    const issue = () =>
      ctx.addIssue({
        code: "custom",
        path: ["fills"],
        message: "Order summary must agree with its fills and rejection status",
      });
    const filled = result.fills.reduce(
      (sum, fill) => sum + BigInt(fill.quantity),
      0n,
    );
    const total = result.fills.reduce(
      (sum, fill) => sum + BigInt(fill.totalValueCents),
      0n,
    );
    if (
      filled !== BigInt(result.filledQuantity) ||
      total !== BigInt(result.totalValueCents) ||
      BigInt(result.filledQuantity) + BigInt(result.remainingQuantity) !==
        BigInt(result.quantity)
    )
      issue();
    if (
      result.fills.some(
        (fill) =>
          fill.symbol !== result.symbol ||
          BigInt(fill.priceCents) * BigInt(fill.quantity) !==
            BigInt(fill.totalValueCents) ||
          (result.side === "buy"
            ? fill.sellerId !== "system:bot" ||
              fill.priceCents > result.protectionPriceCents
            : fill.buyerId !== "system:bot" ||
              fill.priceCents < result.protectionPriceCents),
      )
    )
      issue();
    const status =
      result.rejectionCode !== null
        ? "REJECTED"
        : result.filledQuantity === 0
          ? "NO_LIQUIDITY_WITHIN_PROTECTION"
          : result.remainingQuantity === 0
            ? "FILLED"
            : "PARTIALLY_FILLED";
    if (
      result.status !== status ||
      (status === "REJECTED" && result.filledQuantity !== 0)
    )
      issue();
    if (
      result.filledQuantity === 0
        ? result.averagePrice !== null
        : !result.averagePrice ||
          result.averagePrice.numeratorCents !== result.totalValueCents ||
          result.averagePrice.denominatorUnits !== result.filledQuantity
    )
      issue();
  });
export const tradingRulesSchema = z.strictObject({
  rulesVersion: z.string(),
  prices: gameplayRulesSchema.shape.prices,
  orders: gameplayRulesSchema.shape.orders,
});
export const publicExecutionSchema = buyFillSchema
  .omit({ quoteId: true, buyerId: true, sellerId: true })
  .extend({
    sequence: z.number().int().positive(),
    buyerId: z.union([z.uuid().toLowerCase(), z.literal("system:bot")]),
    sellerId: z.union([z.uuid().toLowerCase(), z.literal("system:bot")]),
  });
export const publicTotalsSchema = z.array(portfolioRankingSchema).min(2).max(8);
export const tradingErrorMessages = {
  INVALID_REQUEST:
    "Check the asset, side, whole-unit quantity and protection price.",
  RATE_LIMITED: "Too many orders. Retry this same request shortly.",
  ROUND_MISMATCH: "This order belongs to another round.",
  PLAYER_NOT_IN_ROUND: "You are not a participant in this round.",
  MARKET_CLOSED: "This round is closed for trading.",
  INSUFFICIENT_CASH: "Insufficient cash for the protected quantity.",
  INSUFFICIENT_HOLDINGS: "You cannot sell more units than you own.",
  INVALID_ORDER: "The order is outside this round's frozen bounds.",
  IDEMPOTENCY_CONFLICT: "That request ID already has different order content.",
  UNAUTHENTICATED: "Your guest session has expired.",
  FORBIDDEN: "You cannot trade in this room.",
  ROOM_NOT_FOUND: "This room is unavailable.",
  INVALID_ROOM_STATE: "The market is not open.",
  SERVICE_UNAVAILABLE:
    "Trading is temporarily unavailable. Reconnect and retry the same request.",
} as const;
export const tradingCommandErrorSchema = z.strictObject({
  error: z.enum(
    Object.keys(tradingErrorMessages) as [
      keyof typeof tradingErrorMessages,
      ...(keyof typeof tradingErrorMessages)[],
    ],
  ),
  message: z.string(),
  requestId: z.uuid().toLowerCase().optional(),
});
export type OrderSubmit = z.infer<typeof orderSubmitSchema>;
export type OrderResult = z.infer<typeof orderResultSchema>;
export type TradingErrorCode = keyof typeof tradingErrorMessages;
