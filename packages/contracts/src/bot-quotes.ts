import { z } from "zod";
import { assetSymbolSchema, gameplayRulesSchema } from "./baseline.js";

const nonnegativeInteger = z.number().int().nonnegative();
const holdingsSchema = z.strictObject({
  AMBR: nonnegativeInteger,
  BONE: nonnegativeInteger,
  FERN: nonnegativeInteger,
  VOLC: nonnegativeInteger,
});
const resourcesSchema = z.strictObject({
  cashCents: nonnegativeInteger,
  holdings: holdingsSchema,
});

/** Current quote inputs, separate from the immutable generation-zero round baseline. */
export const botQuoteStateSchema = z
  .strictObject({
    roundId: z.uuid().toLowerCase(),
    rulesVersion: z.literal("1.1"),
    rules: gameplayRulesSchema,
    bot: resourcesSchema,
    assets: z
      .array(
        z.strictObject({
          symbol: assetSymbolSchema,
          referencePriceCents: z.number().int().positive(),
          quoteGeneration: nonnegativeInteger,
        }),
      )
      .length(4),
  })
  .superRefine((state, ctx) => {
    if (new Set(state.assets.map((asset) => asset.symbol)).size !== 4) {
      ctx.addIssue({
        code: "custom",
        path: ["assets"],
        message: "Expected each canonical symbol exactly once",
      });
    }
    state.assets.forEach((asset, index) => {
      if (
        asset.referencePriceCents < state.rules.prices.minCents ||
        asset.referencePriceCents > state.rules.prices.maxCents
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["assets", index, "referencePriceCents"],
          message: "Reference price outside frozen bounds",
        });
      }
    });
  });

export const botQuoteSchema = z.strictObject({
  id: z.string().min(1),
  symbol: assetSymbolSchema,
  generation: z.number().int().positive(),
  side: z.enum(["bid", "ask"]),
  level: z.number().int().min(1).max(3),
  creationSequence: z.number().int().min(0).max(23),
  priceCents: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

export const botQuoteResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    state: botQuoteStateSchema,
    quotes: z.array(botQuoteSchema).max(24),
    reservations: resourcesSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum([
      "INVALID_FROZEN_ROUND",
      "INVALID_QUOTE_STATE",
      "QUOTE_GENERATION_EXHAUSTED",
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

export type BotQuoteState = z.infer<typeof botQuoteStateSchema>;
export type BotQuote = z.infer<typeof botQuoteSchema>;
export type BotQuoteResult = z.infer<typeof botQuoteResultSchema>;
