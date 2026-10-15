import {
  publicExecutionSchema,
  type EngineState,
  type EngineBatch,
} from "@dinopump/contracts";
import { getPortfolioRankings } from "@dinopump/engine";
import type { Pool, PoolClient } from "pg";

/** Quote age follows committed rebuilds, including histories without public views. */
export async function readQuoteUpdatedAtMs(
  db: Pool | PoolClient,
  state: EngineState,
) {
  const row = (
    await db.query(
      "SELECT occurred_at_ms FROM game_events WHERE round_id=$1 AND sequence<=$2 AND type='QuotesRebuilt' ORDER BY sequence DESC LIMIT 1",
      [state.round.roundId, state.sequence],
    )
  ).rows[0];
  return row ? Number(row.occurred_at_ms) : state.round.opensAtMs;
}

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
