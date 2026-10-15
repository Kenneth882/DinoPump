import { z } from "zod";
import { assetSymbolSchema } from "./baseline.js";

const integer = z.number().int().nonnegative();
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !/[<>\u0000-\u001f]/.test(s), "Plain text required");
export const narrationProvenanceSchema = z.strictObject({
  provider: text(80),
  model: text(100),
  promptVersion: text(80),
  durationMs: integer,
  validationStatus: z.enum([
    "accepted",
    "disabled",
    "unavailable",
    "invalid",
    "timeout",
  ]),
});
export const commentaryResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    headline: text(100),
    commentary: text(400),
    provenance: narrationProvenanceSchema.extend({
      validationStatus: z.literal("accepted"),
    }),
  }),
  z.strictObject({
    status: z.literal("fallback"),
    provenance: narrationProvenanceSchema.extend({
      validationStatus: z.enum([
        "disabled",
        "unavailable",
        "invalid",
        "timeout",
      ]),
    }),
  }),
]);
export const narrationInputSchema = z.strictObject({
  version: z.literal(1),
  sourceEventId: z.uuid(),
  roundId: z.uuid(),
  facts: z.string(),
  headline: z.string(),
  commentary: z.string(),
  context: z.strictObject({
    capturedAtMs: integer,
    elapsedMs: integer,
    windowStartMs: integer,
    // A sequence boundary also distinguishes multiple overdue events applied at the same time.
    afterSequence: integer,
    throughSequence: integer,
    assets: z
      .array(
        z.strictObject({
          symbol: assetSymbolSchema,
          name: z.string(),
          description: z.string(),
          beforeCents: integer.positive(),
          afterCents: integer.positive(),
          changeBps: z.number().int(),
          initialPriceCents: integer.positive(),
          lastExecutedPriceCents: integer.positive().nullable(),
          activity: z.strictObject({
            fillCount: integer,
            boughtUnits: integer,
            soldUnits: integer,
            totalValueCents: integer,
          }),
        }),
      )
      .min(1)
      .max(4),
  }),
});
export type NarrationInput = z.infer<typeof narrationInputSchema>;
export type CommentaryResult = z.infer<typeof commentaryResultSchema>;
