import type { EngineState } from "@dinopump/contracts";

/** Public quote/price projection shared by snapshots and complete batches. */
export function publicMarketView(state: EngineState) {
  return {
    assets: state.trading.market.assets.map((asset) => ({
      symbol: asset.symbol,
      referencePriceCents: asset.referencePriceCents,
      lastPriceCents: state.trading.lastPrices[asset.symbol],
    })),
    quotes: state.trading.quotes,
  };
}
