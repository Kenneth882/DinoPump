import {
  frozenRoundSchema,
  roundInitializationSchema,
  type FrozenRound,
} from "@dinopump/contracts";

/** First version of seeded selection: LCG32, catalog order, sampling with replacement. */
export function buildRoundBaseline(value: unknown): FrozenRound {
  const input = roundInitializationSchema.parse(value);
  const { config } = input;
  const { durationMs, eventIntervalMs } = config.rules.round;
  let state = input.seed;
  const schedule: FrozenRound["schedule"] = [];
  for (
    let elapsed = eventIntervalMs;
    elapsed < durationMs;
    elapsed += eventIntervalMs
  ) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const catalogEvent =
      config.eventCatalog[
        Math.floor((state / 0x1_0000_0000) * config.eventCatalog.length)
      ];
    if (!catalogEvent) throw new Error("Empty event catalog");
    schedule.push({
      scheduledEventId: `${input.roundId}:${schedule.length + 1}`,
      dueAtMs: input.opensAtMs + elapsed,
      catalogEvent,
    });
  }
  function holdings(units: number) {
    return { FERN: units, AMBR: units, VOLC: units, BONE: units };
  }
  return frozenRoundSchema.parse({
    schemaVersion: 1,
    roundId: input.roundId,
    seed: input.seed,
    configVersion: input.configVersion,
    rulesVersion: config.rulesVersion,
    catalogVersion: config.contentVersion,
    selectionVersion: "lcg32-v1",
    createdAtMs: input.createdAtMs,
    opensAtMs: input.opensAtMs,
    closesAtMs: input.opensAtMs + durationMs,
    config,
    initialState: {
      assets: config.assets.map((asset) => ({
        symbol: asset.symbol,
        referencePriceCents: asset.initialPriceCents,
        lastPriceCents: asset.initialPriceCents,
        quoteGeneration: 0,
      })),
      humans: input.participantIds.map((playerId, joinOrder) => ({
        playerId,
        joinOrder,
        cashCents: config.rules.player.startingCashCents,
        holdings: holdings(config.rules.player.startingUnitsPerAsset),
      })),
      bot: {
        cashCents: config.rules.bot.startingCashCents,
        holdings: holdings(config.rules.bot.startingUnitsPerAsset),
      },
    },
    schedule,
  });
}
