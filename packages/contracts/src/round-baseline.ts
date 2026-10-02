import { z } from "zod";
import {
  assetSymbolSchema,
  baselineSchema,
  catalogEventSchema,
} from "./baseline.js";

const uuid = z.uuid().toLowerCase();
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const version = z.string().regex(/^\d+\.\d+$/);
const holdings = z.strictObject({
  FERN: z.number().int().nonnegative(),
  AMBR: z.number().int().nonnegative(),
  VOLC: z.number().int().nonnegative(),
  BONE: z.number().int().nonnegative(),
});
const resources = z.strictObject({
  cashCents: z.number().int().nonnegative(),
  holdings,
});

export const roundInitializationSchema = z
  .strictObject({
    roundId: uuid,
    seed: z.number().int().min(0).max(0xffff_ffff),
    configVersion: version,
    participantIds: z
      .array(uuid)
      .min(2)
      .max(8)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate participant",
      ),
    createdAtMs: timestamp,
    opensAtMs: timestamp,
    config: baselineSchema,
  })
  .superRefine((input, ctx) => {
    if (input.createdAtMs >= input.opensAtMs) {
      ctx.addIssue({
        code: "custom",
        path: ["opensAtMs"],
        message: "Initialization must precede opening",
      });
    }
    if (
      !timestamp.safeParse(
        input.opensAtMs + input.config.rules.round.durationMs,
      ).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["opensAtMs"],
        message: "Closing deadline exceeds timestamp bounds",
      });
    }
  });

export const frozenRoundSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    roundId: uuid,
    seed: z.number().int().min(0).max(0xffff_ffff),
    configVersion: version,
    rulesVersion: version,
    catalogVersion: version,
    selectionVersion: z.literal("lcg32-v1"),
    createdAtMs: timestamp,
    opensAtMs: timestamp,
    closesAtMs: timestamp,
    config: baselineSchema,
    initialState: z.strictObject({
      assets: z
        .array(
          z.strictObject({
            symbol: assetSymbolSchema,
            referencePriceCents: z.number().int().positive(),
            lastPriceCents: z.number().int().positive(),
            quoteGeneration: z.literal(0),
          }),
        )
        .length(4),
      humans: z
        .array(
          resources.extend({
            playerId: uuid,
            joinOrder: z.number().int().nonnegative(),
          }),
        )
        .min(2)
        .max(8),
      bot: resources,
    }),
    schedule: z
      .array(
        z.strictObject({
          scheduledEventId: z.string().min(1),
          dueAtMs: timestamp,
          catalogEvent: catalogEventSchema,
        }),
      )
      .min(1),
  })
  .superRefine((round, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const { rules } = round.config;
    if (
      round.rulesVersion !== round.config.rulesVersion ||
      round.catalogVersion !== round.config.contentVersion
    ) {
      issue("config", "Frozen versions must match configuration");
    }
    if (
      round.createdAtMs >= round.opensAtMs ||
      round.closesAtMs !== round.opensAtMs + rules.round.durationMs
    ) {
      issue("closesAtMs", "Invalid frozen round deadlines");
    }
    const symbols = new Set(
      round.initialState.assets.map((asset) => asset.symbol),
    );
    if (
      symbols.size !== 4 ||
      round.initialState.assets.some((asset) => {
        const initial = round.config.assets.find(
          (entry) => entry.symbol === asset.symbol,
        );
        return (
          initial?.initialPriceCents !== asset.referencePriceCents ||
          initial.initialPriceCents !== asset.lastPriceCents
        );
      })
    )
      issue("initialState", "Initial asset prices must match configuration");
    const humans = round.initialState.humans;
    if (
      new Set(humans.map((human) => human.playerId)).size !== humans.length ||
      humans.some(
        (human, index) =>
          human.joinOrder !== index ||
          human.cashCents !== rules.player.startingCashCents ||
          Object.values(human.holdings).some(
            (units) => units !== rules.player.startingUnitsPerAsset,
          ),
      )
    )
      issue(
        "initialState",
        "Initial participant resources or order disagree with configuration",
      );
    if (
      round.initialState.bot.cashCents !== rules.bot.startingCashCents ||
      Object.values(round.initialState.bot.holdings).some(
        (units) => units !== rules.bot.startingUnitsPerAsset,
      )
    ) {
      issue(
        "initialState",
        "Initial bot resources disagree with configuration",
      );
    }
    const count =
      Math.ceil(rules.round.durationMs / rules.round.eventIntervalMs) - 1;
    if (round.schedule.length !== count)
      issue("schedule", "Incomplete frozen event schedule");
    for (const [index, event] of round.schedule.entries()) {
      if (
        event.scheduledEventId !== `${round.roundId}:${index + 1}` ||
        event.dueAtMs !==
          round.opensAtMs + (index + 1) * rules.round.eventIntervalMs ||
        event.dueAtMs >= round.closesAtMs
      ) {
        issue("schedule", "Invalid scheduled event identity or deadline");
      }
      const source = round.config.eventCatalog.find(
        (entry) => entry.id === event.catalogEvent.id,
      );
      if (JSON.stringify(event.catalogEvent) !== JSON.stringify(source))
        issue("schedule", "Scheduled event differs from frozen catalog");
    }
  });

export type RoundInitialization = z.infer<typeof roundInitializationSchema>;
export type FrozenRound = z.infer<typeof frozenRoundSchema>;

export const roundRecoverySchema = z
  .strictObject({
    events: z
      .array(
        z.strictObject({
          roundId: uuid,
          sequence: z.literal(1),
          eventId: uuid,
          schemaVersion: z.literal(1),
          type: z.literal("RoundInitialized"),
          payload: frozenRoundSchema,
          causeId: uuid,
          occurredAtMs: timestamp,
        }),
      )
      .length(1),
    projection: z.strictObject({
      roundId: uuid,
      sequence: z.literal(1),
      schemaVersion: z.literal(1),
      state: frozenRoundSchema.shape.initialState,
    }),
  })
  .superRefine((recovery, ctx) => {
    const event = recovery.events[0];
    if (!event) return;
    if (
      event.roundId !== event.payload.roundId ||
      event.occurredAtMs !== event.payload.createdAtMs ||
      event.causeId !== event.roundId ||
      event.eventId !== event.roundId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["events"],
        message: "Initialization event metadata disagrees with baseline",
      });
    }
    if (
      recovery.projection.roundId !== event.roundId ||
      JSON.stringify(recovery.projection.state) !==
        JSON.stringify(event.payload.initialState)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["projection"],
        message: "Projection disagrees with committed initialization",
      });
    }
  });
