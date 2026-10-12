import {
  newsItemSchema,
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

/** Approved narration inputs contain no credentials, future schedule, or player data. */
export function narrationInput(news: NewsItem) {
  return {
    sourceEventId: news.sourceEventId,
    facts: news.facts,
    effects: news.effects,
    headline: news.headline,
    commentary: news.commentary,
  };
}
