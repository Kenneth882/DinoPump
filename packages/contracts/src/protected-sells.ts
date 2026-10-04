import { z } from "zod";
import {
  buyCommandSchema,
  buyFillSchema,
  buyResultSchema,
  buyStateSchema,
} from "./protected-buys.js";

/** Internal command: playerId must be supplied by the authenticated service. */
export const sellCommandSchema = buyCommandSchema.extend({
  side: z.literal("sell"),
});
export const sellStateSchema = buyStateSchema;
export const sellFillSchema = buyFillSchema.extend({
  buyerId: z.literal("system:bot"),
  sellerId: buyCommandSchema.shape.playerId,
});
export const sellResultSchema = z.discriminatedUnion("ok", [
  buyResultSchema.options[0].extend({
    command: sellCommandSchema,
    state: sellStateSchema,
    fills: z.array(sellFillSchema).max(24),
  }),
  buyResultSchema.options[1].extend({
    code: z.enum([
      "INVALID_SELL_STATE",
      "INVALID_ORDER",
      "ROUND_MISMATCH",
      "MARKET_CLOSED",
      "PLAYER_NOT_IN_ROUND",
      "INSUFFICIENT_HOLDINGS",
      "QUOTE_GENERATION_EXHAUSTED",
      "UNSAFE_SETTLEMENT",
    ]),
  }),
]);

export type SellCommand = z.infer<typeof sellCommandSchema>;
export type SellState = z.infer<typeof sellStateSchema>;
export type SellFill = z.infer<typeof sellFillSchema>;
export type SellResult = z.infer<typeof sellResultSchema>;
