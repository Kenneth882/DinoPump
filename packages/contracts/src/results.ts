import { z } from "zod";
import {
  engineFinalResultSchema,
  portfolioRankingSchema,
} from "./round-engine.js";
import { privatePortfolioSchema } from "./trading.js";
import { newsItemSchema } from "./news.js";

export const roundReturnSchema = z.strictObject({
  roundId: z.uuid().toLowerCase(),
  requestId: z.uuid().toLowerCase(),
});
export const publicRoundResultSchema = z.strictObject({
  status: z.literal("FINISHED"),
  roundId: z.uuid().toLowerCase(),
  closesAtMs: z.number().int().nonnegative(),
  marks: engineFinalResultSchema.shape.marks,
  settlementSequence: z.number().int().positive(),
  rankings: z
    .array(
      portfolioRankingSchema.extend({ displayName: z.string().min(2).max(20) }),
    )
    .min(2)
    .max(8),
  timeline: z.array(
    z.strictObject({
      sourceEventId: newsItemSchema.shape.sourceEventId,
      sequence: newsItemSchema.shape.sequence,
      dueAtMs: newsItemSchema.shape.dueAtMs,
      headline: newsItemSchema.shape.headline,
      facts: newsItemSchema.shape.facts,
      effects: newsItemSchema.shape.effects,
    }),
  ),
});
export const abortedRoundSchema = z.strictObject({
  status: z.literal("ABORTED"),
  roundId: z.uuid().toLowerCase(),
  message: z.literal(
    "This round ended safely because its recorded state could not be verified.",
  ),
});
export const roundEndedSchema = z.discriminatedUnion("status", [
  publicRoundResultSchema.extend({
    playerId: z.uuid().toLowerCase(),
    portfolio: privatePortfolioSchema,
  }),
  abortedRoundSchema,
]);
export type PublicRoundResult = z.infer<typeof publicRoundResultSchema>;
export type RoundEnded = z.infer<typeof roundEndedSchema>;
