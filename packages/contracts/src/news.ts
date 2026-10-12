import { z } from "zod";
import { assetSymbolSchema, catalogEventSchema } from "./baseline.js";

const timestamp = z.number().int().nonnegative();
export const newsItemSchema = z
  .strictObject({
    sourceEventId: z.uuid(),
    roundId: z.uuid(),
    scheduledEventId: z.string().min(1),
    sequence: z.number().int().positive(),
    dueAtMs: timestamp,
    appliedAtMs: timestamp,
    catalogEventId: catalogEventSchema.shape.id,
    facts: catalogEventSchema.shape.facts,
    headline: catalogEventSchema.shape.template.shape.headline,
    commentary: catalogEventSchema.shape.template.shape.commentary,
    iconId: catalogEventSchema.shape.iconId,
    effects: z
      .array(
        z.strictObject({
          symbol: assetSymbolSchema,
          beforeCents: z.number().int().positive(),
          afterCents: z.number().int().positive(),
          changeBps: z.number().int().min(-1500).max(1500),
        }),
      )
      .min(1)
      .max(4),
    narrationStatus: z.literal("pending"),
  })
  .refine(
    (news) => news.appliedAtMs >= news.dueAtMs,
    "News cannot precede its due time",
  )
  .refine(
    (news) =>
      new Set(news.effects.map((effect) => effect.symbol)).size ===
      news.effects.length,
    "Duplicate affected symbol",
  );
export type NewsItem = z.infer<typeof newsItemSchema>;
