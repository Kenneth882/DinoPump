import { z } from "zod";

export const assetSymbolSchema = z.enum(["FERN", "AMBR", "VOLC", "BONE"]);
export const iconIdSchema = z.enum(["fern", "amber", "volcano", "fossil"]);
const versionSchema = z
  .string()
  .regex(/^\d+\.\d+$/, "Expected major.minor version");
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const text = z.string().trim().min(1);

export const assetSchema = z.strictObject({
  symbol: assetSymbolSchema,
  name: text,
  description: text,
  iconId: iconIdSchema,
  initialPriceCents: positiveInteger,
});

export const assetsSchema = z
  .array(assetSchema)
  .length(4)
  .superRefine((assets, ctx) => {
    if (new Set(assets.map((asset) => asset.symbol)).size !== 4) {
      ctx.addIssue({
        code: "custom",
        message: "Expected each canonical symbol exactly once",
      });
    }
  });

export const gameplayRulesSchema = z
  .strictObject({
    room: z.strictObject({
      minPlayers: z.literal(2),
      maxPlayers: z.literal(8),
      countdownMs: positiveInteger,
      hostDisconnectGraceMs: positiveInteger,
      emptyLobbyExpiryMs: positiveInteger,
    }),
    round: z.strictObject({
      durationMs: positiveInteger,
      eventIntervalMs: positiveInteger,
    }),
    player: z.strictObject({
      startingCashCents: positiveInteger,
      startingUnitsPerAsset: z.literal(0),
    }),
    prices: z.strictObject({
      minCents: positiveInteger,
      maxCents: positiveInteger,
      tickCents: z.literal(1),
    }),
    orders: z.strictObject({
      minQuantity: z.literal(1),
      maxQuantity: positiveInteger,
      feeBps: z.literal(0),
      defaultProtectionBps: nonnegativeInteger.max(10_000),
    }),
    bot: z.strictObject({
      startingCashCents: nonnegativeInteger,
      startingUnitsPerAsset: nonnegativeInteger,
      quoteOffsetsBps: z.array(positiveInteger.max(9_999)).length(3),
      unitsPerLevel: positiveInteger,
      referenceImpactBpsPerFilledOrder: nonnegativeInteger.max(10_000),
    }),
    events: z.strictObject({
      minShockBps: z.number().int().min(-1_500).max(0),
      maxShockBps: z.number().int().min(0).max(1_500),
    }),
  })
  .superRefine((rules, ctx) => {
    if (rules.prices.minCents > rules.prices.maxCents) {
      ctx.addIssue({
        code: "custom",
        path: ["prices"],
        message: "Minimum price exceeds maximum",
      });
    }
    if (
      !Number.isSafeInteger(rules.orders.maxQuantity * rules.prices.maxCents)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["orders", "maxQuantity"],
        message: "Maximum order value exceeds safe integer cents",
      });
    }
    if (rules.round.eventIntervalMs >= rules.round.durationMs) {
      ctx.addIssue({
        code: "custom",
        path: ["round"],
        message: "Event interval must occur before close",
      });
    }
    if (
      rules.bot.quoteOffsetsBps.some((offset, index, offsets) => {
        const previous = offsets[index - 1];
        return previous !== undefined && offset <= previous;
      })
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["bot", "quoteOffsetsBps"],
        message: "Quote offsets must strictly increase",
      });
    }
  });

export const catalogEventSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    facts: text,
    template: z.strictObject({
      headline: text.max(100),
      commentary: text.max(400),
    }),
    iconId: iconIdSchema,
    effects: z
      .array(
        z.strictObject({
          symbol: assetSymbolSchema,
          referenceChangeBps: z.number().int().min(-1_500).max(1_500),
        }),
      )
      .min(1)
      .max(4),
  })
  .superRefine((event, ctx) => {
    if (
      new Set(event.effects.map((effect) => effect.symbol)).size !==
      event.effects.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["effects"],
        message: "Each affected symbol must occur only once",
      });
    }
  });

export const baselineSchema = z
  .strictObject({
    contentVersion: versionSchema,
    rulesVersion: versionSchema,
    assets: assetsSchema,
    rules: gameplayRulesSchema,
    eventCatalog: z.array(catalogEventSchema).min(1),
  })
  .superRefine((baseline, ctx) => {
    for (const [index, asset] of baseline.assets.entries()) {
      if (
        asset.initialPriceCents < baseline.rules.prices.minCents ||
        asset.initialPriceCents > baseline.rules.prices.maxCents
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["assets", index, "initialPriceCents"],
          message: "Initial price is outside configured bounds",
        });
      }
    }
    const ids = new Set<string>();
    for (const [index, event] of baseline.eventCatalog.entries()) {
      if (ids.has(event.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["eventCatalog", index, "id"],
          message: "Duplicate event ID",
        });
      }
      ids.add(event.id);
      for (const [effectIndex, effect] of event.effects.entries()) {
        if (
          effect.referenceChangeBps < baseline.rules.events.minShockBps ||
          effect.referenceChangeBps > baseline.rules.events.maxShockBps
        ) {
          ctx.addIssue({
            code: "custom",
            path: [
              "eventCatalog",
              index,
              "effects",
              effectIndex,
              "referenceChangeBps",
            ],
            message: "Effect is outside configured shock bounds",
          });
        }
      }
    }
  });

// Public introduction only: never expose round schedules, configuration or private state.
export const marketBaselineResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  contentVersion: versionSchema,
  rulesVersion: versionSchema,
  assets: assetsSchema,
});

export type Baseline = z.infer<typeof baselineSchema>;
export type MarketBaselineResponse = z.infer<
  typeof marketBaselineResponseSchema
>;
export type IconId = z.infer<typeof iconIdSchema>;
