import {
  newsItemSchema,
  narrationInputSchema,
  type FrozenRound,
  type EngineBatch,
  type NewsItem,
} from "@dinopump/contracts";

/** Authored facts and exact engine adjustments, never a newly sampled catalog. */
export function newsFromBatch(
  batch: EngineBatch,
  sourceEventId: string,
): NewsItem {
  const source = batch.events.find(
    (event) => event.type === "MarketEventApplied",
  );
  if (!source || source.type !== "MarketEventApplied")
    throw new Error("Missing news source");
  const { catalogEvent, dueAtMs, scheduledEventId } = source.payload;
  return newsItemSchema.parse({
    sourceEventId,
    roundId: source.roundId,
    scheduledEventId,
    sequence: source.sequence,
    dueAtMs,
    appliedAtMs: source.occurredAtMs,
    catalogEventId: catalogEvent.id,
    facts: catalogEvent.facts,
    ...catalogEvent.template,
    iconId: catalogEvent.iconId,
    effects: batch.events.flatMap((event) =>
      event.type === "ReferencePriceAdjusted" ? [event.payload] : [],
    ),
    narrationStatus: "pending",
  });
}

export interface NarrationActivity {
  previous: { sequence: number; atMs: number } | undefined;
  trades: Pick<
    Extract<EngineBatch["events"][number], { type: "TradeExecuted" }>,
    "sequence" | "payload"
  >[];
}

/** Approved narration inputs contain no credentials, future schedule, or player data. */
export function narrationInput(
  news: NewsItem,
  round?: FrozenRound,
  preceding: EngineBatch[] = [],
) {
  const previous = [...preceding]
    .reverse()
    .find((batch) => batch.command.type === "ApplyScheduledEvent");
  return narrationFromActivity(news, round, {
    previous: previous && {
      sequence: previous.events.at(-1)!.sequence,
      atMs: previous.command.atMs,
    },
    trades: preceding
      .flatMap((batch) => batch.events)
      .filter((event) => event.type === "TradeExecuted"),
  });
}

/** Live persistence supplies a bounded window; replay derives it from immutable batches. */
export function narrationFromActivity(
  news: NewsItem,
  round: FrozenRound | undefined,
  { previous, trades }: NarrationActivity,
) {
  const authored = {
    sourceEventId: news.sourceEventId,
    facts: news.facts,
    effects: news.effects,
    headline: news.headline,
    commentary: news.commentary,
  };
  // Preserve the exact inputs of historical jobs written before context capture existed.
  if (!round) return authored;
  const afterSequence = previous?.sequence ?? 0;
  return narrationInputSchema.parse({
    version: 1,
    sourceEventId: news.sourceEventId,
    roundId: news.roundId,
    facts: news.facts,
    headline: news.headline,
    commentary: news.commentary,
    context: {
      capturedAtMs: news.appliedAtMs,
      elapsedMs: news.appliedAtMs - round.opensAtMs,
      windowStartMs: previous?.atMs ?? round.opensAtMs,
      afterSequence,
      throughSequence: news.sequence - 1,
      assets: news.effects.map((effect) => {
        const asset = round.config.assets.find(
          (asset) => asset.symbol === effect.symbol,
        )!;
        const executed = trades.filter(
          (event) => event.payload.symbol === effect.symbol,
        );
        const window = executed.filter(
          (event) => event.sequence > afterSequence,
        );
        return {
          ...effect,
          name: asset.name,
          description: asset.description,
          initialPriceCents: asset.initialPriceCents,
          lastExecutedPriceCents: executed.at(-1)?.payload.priceCents ?? null,
          activity: {
            fillCount: window.length,
            boughtUnits: window
              .filter((event) => event.payload.buyerId !== "system:bot")
              .reduce((total, event) => total + event.payload.quantity, 0),
            soldUnits: window
              .filter((event) => event.payload.sellerId !== "system:bot")
              .reduce((total, event) => total + event.payload.quantity, 0),
            totalValueCents: window.reduce(
              (total, event) => total + event.payload.totalValueCents,
              0,
            ),
          },
        };
      }),
    },
  });
}
