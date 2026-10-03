import {
  botQuoteStateSchema,
  frozenRoundSchema,
  type BotQuote,
  type BotQuoteResult,
} from "@dinopump/contracts";

function invalid(
  code: "INVALID_FROZEN_ROUND" | "INVALID_QUOTE_STATE",
  error: { issues: { path: PropertyKey[]; message: string }[] },
): BotQuoteResult {
  return {
    ok: false,
    code,
    issues: error.issues.map(({ path, message }) => ({
      path: path.map((part) =>
        typeof part === "number" ? part : String(part),
      ),
      message,
    })),
  };
}

/** Consume existing frozen funding; never fund a live bot during replacement. */
export function initializeBotQuotes(value: unknown): BotQuoteResult {
  const parsed = frozenRoundSchema.safeParse(value);
  if (!parsed.success) return invalid("INVALID_FROZEN_ROUND", parsed.error);
  const round = parsed.data;
  return rebuildBotQuotes({
    roundId: round.roundId,
    rulesVersion: round.rulesVersion,
    rules: round.config.rules,
    bot: round.initialState.bot,
    assets: round.initialState.assets.map(
      ({ symbol, referencePriceCents, quoteGeneration }) => ({
        symbol,
        referencePriceCents,
        quoteGeneration,
      }),
    ),
  });
}

/** Replace the complete ladder from total resources. Input is never mutated. */
export function rebuildBotQuotes(value: unknown): BotQuoteResult {
  const parsed = botQuoteStateSchema.safeParse(value);
  if (!parsed.success) return invalid("INVALID_QUOTE_STATE", parsed.error);
  const state = parsed.data;
  const exhaustedIndex = state.assets.findIndex(
    (asset) => asset.quoteGeneration === Number.MAX_SAFE_INTEGER,
  );
  if (exhaustedIndex !== -1) {
    return {
      ok: false,
      code: "QUOTE_GENERATION_EXHAUSTED",
      issues: [
        {
          path: ["assets", exhaustedIndex, "quoteGeneration"],
          message: "Cannot advance generation beyond safe integer range",
        },
      ],
    };
  }
  state.assets.sort((a, b) =>
    a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0,
  );
  const quotes: BotQuote[] = [];
  const reservations = {
    cashCents: 0,
    holdings: { AMBR: 0, BONE: 0, FERN: 0, VOLC: 0 },
  };
  for (const [assetIndex, asset] of state.assets.entries()) {
    asset.quoteGeneration += 1;
    for (const [sideIndex, side] of (["bid", "ask"] as const).entries()) {
      for (const [
        levelIndex,
        offset,
      ] of state.rules.bot.quoteOffsetsBps.entries()) {
        const numerator =
          BigInt(asset.referencePriceCents) *
          BigInt(10_000 + (side === "ask" ? offset : -offset));
        const price = (numerator + (side === "ask" ? 9_999n : 0n)) / 10_000n;
        if (
          price < BigInt(state.rules.prices.minCents) ||
          price > BigInt(state.rules.prices.maxCents)
        )
          continue;
        // The validated frozen bounds guarantee an exact, JSON-safe conversion.
        const priceCents = Number(price);
        const available =
          side === "bid"
            ? Number(
                BigInt(state.bot.cashCents - reservations.cashCents) /
                  BigInt(priceCents),
              )
            : state.bot.holdings[asset.symbol] -
              reservations.holdings[asset.symbol];
        const quantity = Math.min(state.rules.bot.unitsPerLevel, available);
        if (quantity === 0) continue;
        quotes.push({
          id: `${state.roundId}:${asset.symbol}:${asset.quoteGeneration}:${side}:${levelIndex + 1}`,
          symbol: asset.symbol,
          generation: asset.quoteGeneration,
          side,
          level: levelIndex + 1,
          creationSequence: assetIndex * 6 + sideIndex * 3 + levelIndex,
          priceCents,
          quantity,
        });
        // Coverage bounds the product and cumulative total to safe integer cash.
        if (side === "bid")
          reservations.cashCents += Number(
            BigInt(priceCents) * BigInt(quantity),
          );
        else reservations.holdings[asset.symbol] += quantity;
      }
    }
  }
  return { ok: true, state, quotes, reservations };
}
