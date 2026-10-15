"use client";
import { useState, type FormEvent } from "react";
import {
  orderSubmitSchema,
  tradingErrorMessages,
  type LobbySnapshot,
  type OrderSubmit,
  type OrderResult,
} from "@dinopump/contracts";

type RoundView = NonNullable<LobbySnapshot["round"]>;
const money = (cents: number) =>
  `D$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function TradeTicket({
  round,
  symbol,
  onSelectSymbol,
  serverNow,
  enabled,
  pending,
  result,
  message,
  onSubmit,
}: {
  round: RoundView;
  symbol: OrderSubmit["symbol"];
  onSelectSymbol: (symbol: OrderSubmit["symbol"]) => void;
  serverNow: number;
  enabled: boolean;
  pending: boolean;
  result: OrderResult | null;
  message: string;
  onSubmit: (request: OrderSubmit) => void;
}) {
  const [side, setSide] = useState<OrderSubmit["side"]>("buy");
  const [quantity, setQuantity] = useState("1");
  const [customProtection, setCustomProtection] = useState("");
  const symbolQuotes = round.quotes.filter((quote) => quote.symbol === symbol);
  const bids = symbolQuotes
    .filter((quote) => quote.side === "bid")
    .sort((a, b) => b.priceCents - a.priceCents);
  const asks = symbolQuotes
    .filter((quote) => quote.side === "ask")
    .sort((a, b) => a.priceCents - b.priceCents);
  const bestBid = bids[0],
    bestAsk = asks[0];
  const quotes = side === "buy" ? asks : bids;
  const best = quotes[0];
  const { prices, orders } = round.tradingRules;
  // Floor the buy ceiling; ceil the sell floor, so rounding never widens tolerance.
  const defaultBound = best
    ? Number(
        (BigInt(best.priceCents) *
          BigInt(
            side === "buy"
              ? 10000 + orders.defaultProtectionBps
              : 10000 - orders.defaultProtectionBps,
          ) +
          (side === "sell" ? 9999n : 0n)) /
          10000n,
      )
    : null;
  const protection =
    customProtection === ""
      ? defaultBound === null
        ? null
        : Math.max(prices.minCents, Math.min(prices.maxCents, defaultBound))
      : Number(customProtection);
  const units = Number(quantity);
  const valid =
    Number.isSafeInteger(units) &&
    units >= orders.minQuantity &&
    units <= orders.maxQuantity &&
    protection !== null &&
    Number.isSafeInteger(protection) &&
    protection >= prices.minCents &&
    protection <= prices.maxCents;
  let remaining = valid ? units : 0,
    estimatedUnits = 0,
    estimatedTotal = 0;
  for (const quote of quotes) {
    if (
      protection === null ||
      (side === "buy"
        ? quote.priceCents > protection
        : quote.priceCents < protection)
    )
      continue;
    const filled = Math.min(remaining, quote.quantity);
    estimatedUnits += filled;
    estimatedTotal += filled * quote.priceCents;
    remaining -= filled;
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!enabled || pending || !valid) return;
    onSubmit(
      orderSubmitSchema.parse({
        roundId: round.roundId,
        requestId: crypto.randomUUID(),
        symbol,
        side,
        quantity: units,
        protectionPriceCents: protection,
      }),
    );
  }
  return (
    <section className="trade-ticket" aria-labelledby="trade-heading">
      <h3 id="trade-heading">Protected trade</h3>
      <p>
        Counterparty: game liquidity bot. Fictional market game. Virtual
        currency only.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="trade-asset">
          Asset
          <select
            id="trade-asset"
            value={symbol}
            disabled={pending}
            onChange={(e) => {
              onSelectSymbol(e.target.value as OrderSubmit["symbol"]);
              setCustomProtection("");
            }}
          >
            {round.assets.map((a) => (
              <option key={a.symbol}>{a.symbol}</option>
            ))}
          </select>
        </label>
        <label htmlFor="trade-side">
          Buy or sell
          <select
            id="trade-side"
            value={side}
            disabled={pending}
            onChange={(e) => {
              setSide(e.target.value as OrderSubmit["side"]);
              setCustomProtection("");
            }}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
        <label htmlFor="trade-quantity">
          Whole units
          <input
            id="trade-quantity"
            type="number"
            inputMode="numeric"
            min={orders.minQuantity}
            max={orders.maxQuantity}
            step="1"
            value={quantity}
            disabled={pending}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </label>
        <label htmlFor="trade-protection">
          {side === "buy"
            ? "Maximum buy price (cents)"
            : "Minimum sell price (cents)"}
          <input
            id="trade-protection"
            type="number"
            inputMode="numeric"
            min={prices.minCents}
            max={prices.maxCents}
            step={prices.tickCents}
            value={customProtection || protection || ""}
            disabled={pending}
            onChange={(e) => setCustomProtection(e.target.value)}
            required
          />
        </label>
        <p>
          Default protection: {orders.defaultProtectionBps / 100}% from the
          displayed best {side === "buy" ? "ask" : "bid"}.
        </p>
        <p>
          Best bid:{" "}
          {bestBid ? money(bestBid.priceCents) : "Unavailable liquidity"}. Best
          ask: {bestAsk ? money(bestAsk.priceCents) : "Unavailable liquidity"}.
        </p>
        <p>
          Quote age:{" "}
          {Math.max(0, Math.floor((serverNow - round.quoteUpdatedAtMs) / 1000))}{" "}
          seconds.{" "}
          {enabled
            ? "Connection confirmed."
            : "Quotes unavailable or stale; trading paused until the open market is synchronized."}
        </p>
        <p data-testid="trade-estimate">
          Estimate (not guaranteed): {estimatedUnits} units for{" "}
          {money(estimatedTotal)}.{" "}
          {remaining > 0 && `${remaining} units may remain unfilled.`}
        </p>
        {!best && <p>Unavailable liquidity for this side.</p>}
        <button disabled={!enabled || pending || !valid}>Submit {side}</button>
      </form>
      <div role="status" data-testid="trade-result">
        {pending ? (
          <p>
            Pending reconciliation. The exact original order will be retried.
          </p>
        ) : message ? (
          <p>{message}</p>
        ) : result ? (
          <>
            <p>
              {result.status === "FILLED"
                ? "Filled"
                : result.status === "PARTIALLY_FILLED"
                  ? "Partially filled"
                  : result.status === "NO_LIQUIDITY_WITHIN_PROTECTION"
                    ? "No liquidity within protection"
                    : `Rejected: ${tradingErrorMessages[result.rejectionCode!]}`}
            </p>
            <p>
              {result.filledQuantity} units executed; {result.remainingQuantity}{" "}
              unfilled. Executed total: {money(result.totalValueCents)}. Average
              fill price (rounded to cents):{" "}
              {result.averagePrice
                ? money(
                    result.averagePrice.numeratorCents /
                      result.averagePrice.denominatorUnits,
                  )
                : "No fills"}
              .
              {result.averagePrice && (
                <span>
                  {" "}
                  Exact average: {result.averagePrice.numeratorCents}/
                  {result.averagePrice.denominatorUnits} cents per unit.
                </span>
              )}
            </p>
            <p>
              Cash after this order: {money(result.portfolio.cashCents)}.{" "}
              {result.symbol} units after this order:{" "}
              {result.portfolio.holdings[result.symbol]}.
            </p>
            <p>
              Fills against game liquidity bot:{" "}
              {result.fills
                .map((f) => `${f.quantity} × ${money(f.priceCents)}`)
                .join(", ") || "None"}
              .
            </p>
          </>
        ) : (
          <p>No order submitted yet.</p>
        )}
      </div>
    </section>
  );
}
