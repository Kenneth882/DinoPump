import {
  publicExecutionSchema,
  type EngineState,
  type EngineBatch,
} from "@dinopump/contracts";
import { getPortfolioRankings } from "@dinopump/engine";

/** Public quote/price projection shared by snapshots and complete batches. */
export function publicMarketView(
  state: EngineState,
  batch?: EngineBatch,
  quoteUpdatedAtMs = state.round.opensAtMs,
) {
  const totals = getPortfolioRankings(state);
  if (!totals.ok) throw new Error("Unsafe public valuation");
  return {
    assets: state.trading.market.assets.map((asset) => ({
      symbol: asset.symbol,
      referencePriceCents: asset.referencePriceCents,
      lastPriceCents: state.trading.lastPrices[asset.symbol],
    })),
    quotes: state.trading.quotes,
    quoteUpdatedAtMs: batch?.events.some((e) => e.type === "QuotesRebuilt")
      ? batch.command.atMs
      : quoteUpdatedAtMs,
    totals: totals.rankings,
    trades: (batch?.events ?? []).flatMap((event) =>
      event.type === "TradeExecuted"
        ? [
            publicExecutionSchema.parse({
              sequence: event.sequence,
              symbol: event.payload.symbol,
              buyerId: event.payload.buyerId,
              sellerId: event.payload.sellerId,
              quantity: event.payload.quantity,
              priceCents: event.payload.priceCents,
              totalValueCents: event.payload.totalValueCents,
            }),
          ]
        : [],
    ),
  };
}
