import { z } from "zod";
import { assetSymbolSchema } from "./baseline.js";
import { botQuoteSchema, botQuoteStateSchema } from "./bot-quotes.js";
import { frozenRoundSchema } from "./round-baseline.js";

const nonnegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const uuid = z.uuid().toLowerCase();

/** Internal command: playerId must be supplied by the authenticated service. */
export const buyCommandSchema = z.strictObject({
  roundId: uuid,
  requestId: uuid,
  playerId: uuid,
  side: z.literal("buy"),
  symbol: assetSymbolSchema,
  quantity: positiveInteger,
  protectionPriceCents: positiveInteger,
});

export const buyStateSchema = z
  .strictObject({
    market: botQuoteStateSchema,
    status: z.enum([
      "LOBBY",
      "COUNTDOWN",
      "OPEN",
      "SETTLING",
      "FINISHED",
      "ABORTED",
    ]),
    humans: frozenRoundSchema.shape.initialState.shape.humans,
    lastPrices: z.strictObject({
      AMBR: positiveInteger,
      BONE: positiveInteger,
      FERN: positiveInteger,
      VOLC: positiveInteger,
    }),
    quotes: z.array(botQuoteSchema).max(24),
    reservations: botQuoteStateSchema.shape.bot,
  })
  .superRefine((state, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (
      new Set(state.humans.map((human) => human.playerId)).size !==
      state.humans.length
    )
      issue(["humans"], "Duplicate participant");
    const { rules, bot, assets } = state.market;
    const inBounds = (price: number) =>
      price >= rules.prices.minCents && price <= rules.prices.maxCents;
    let cash = 0n;
    const holdings = { AMBR: 0n, BONE: 0n, FERN: 0n, VOLC: 0n };
    const ids = new Set<string>();
    state.quotes.forEach((quote, index) => {
      if (ids.has(quote.id))
        issue(["quotes", index, "id"], "Duplicate quote ID");
      ids.add(quote.id);
      if (
        quote.generation !==
        assets.find((asset) => asset.symbol === quote.symbol)?.quoteGeneration
      )
        issue(
          ["quotes", index, "generation"],
          "Quote differs from current generation",
        );
      if (!inBounds(quote.priceCents))
        issue(
          ["quotes", index, "priceCents"],
          "Quote outside frozen price bounds",
        );
      if (quote.quantity > rules.bot.unitsPerLevel)
        issue(["quotes", index, "quantity"], "Quote exceeds frozen level size");
      if (quote.side === "bid")
        cash += BigInt(quote.priceCents) * BigInt(quote.quantity);
      else holdings[quote.symbol] += BigInt(quote.quantity);
    });
    if (
      cash !== BigInt(state.reservations.cashCents) ||
      cash > BigInt(bot.cashCents)
    )
      issue(
        ["reservations", "cashCents"],
        "Bid reservations must match quotes and be covered",
      );
    for (const symbol of assetSymbolSchema.options) {
      if (
        holdings[symbol] !== BigInt(state.reservations.holdings[symbol]) ||
        holdings[symbol] > BigInt(bot.holdings[symbol])
      )
        issue(
          ["reservations", "holdings", symbol],
          "Ask reservations must match quotes and be covered",
        );
      if (!inBounds(state.lastPrices[symbol]))
        issue(["lastPrices", symbol], "Last price outside frozen bounds");
    }
  });

export const buyFillSchema = z.strictObject({
  quoteId: z.string().min(1),
  buyerId: uuid,
  sellerId: z.literal("system:bot"),
  symbol: assetSymbolSchema,
  quantity: positiveInteger,
  priceCents: positiveInteger,
  totalValueCents: positiveInteger,
});

export const buyResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    command: buyCommandSchema,
    state: buyStateSchema,
    fills: z.array(buyFillSchema).max(24),
    outcome: z.strictObject({
      status: z.enum([
        "FILLED",
        "PARTIALLY_FILLED",
        "NO_LIQUIDITY_WITHIN_PROTECTION",
      ]),
      filledQuantity: nonnegativeInteger,
      remainingQuantity: nonnegativeInteger,
      totalValueCents: nonnegativeInteger,
      // Exact VWAP ratio; no fractional cents enter settlement.
      averagePrice: z
        .strictObject({
          numeratorCents: positiveInteger,
          denominatorUnits: positiveInteger,
        })
        .nullable(),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      "INVALID_BUY_STATE",
      "INVALID_ORDER",
      "ROUND_MISMATCH",
      "MARKET_CLOSED",
      "PLAYER_NOT_IN_ROUND",
      "INSUFFICIENT_CASH",
      "QUOTE_GENERATION_EXHAUSTED",
      "UNSAFE_SETTLEMENT",
    ]),
    issues: z
      .array(
        z.strictObject({
          path: z.array(z.union([z.string(), nonnegativeInteger])),
          message: z.string(),
        }),
      )
      .min(1),
  }),
]);

export type BuyCommand = z.infer<typeof buyCommandSchema>;
export type BuyState = z.infer<typeof buyStateSchema>;
export type BuyFill = z.infer<typeof buyFillSchema>;
export type BuyResult = z.infer<typeof buyResultSchema>;
