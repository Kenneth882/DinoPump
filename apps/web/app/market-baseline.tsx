"use client";

import { useEffect, useState } from "react";
import {
  marketBaselineResponseSchema,
  type IconId,
  type MarketBaselineResponse,
} from "@dinopump/contracts";

const icons: Record<IconId, string> = {
  fern: "🌿",
  amber: "🟠",
  volcano: "🌋",
  fossil: "🦴",
};

type State =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; baseline: MarketBaselineResponse };

function formatDinoDollars(cents: number) {
  return `D$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

export function MarketBaseline() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/market-baseline", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10_000),
          ]),
        });
        if (!response.ok) throw new Error("Market information unavailable");
        const baseline = marketBaselineResponseSchema.parse(
          await response.json(),
        );
        if (!controller.signal.aborted) setState({ status: "ready", baseline });
      } catch {
        if (!controller.signal.aborted) setState({ status: "unavailable" });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  return (
    <section aria-labelledby="assets-heading" className="market">
      <div className="section-heading">
        <h2 id="assets-heading">Meet the market</h2>
        <span>Initial prices · Dino Dollars</span>
      </div>
      <p className="market-status" role="status">
        {state.status === "loading" && "Loading market information…"}
        {state.status === "unavailable" &&
          "Market information is temporarily unavailable"}
        {state.status === "ready" &&
          "Four fictional assets. One prehistoric exchange."}
      </p>
      {state.status === "unavailable" && (
        <button
          onClick={() => {
            setState({ status: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
      )}
      {state.status === "ready" && (
        <ul className="asset-grid">
          {state.baseline.assets.map((asset) => (
            <li key={asset.symbol} className="asset-card">
              <div className="asset-topline">
                <span aria-hidden="true" className="asset-icon">
                  {icons[asset.iconId]}
                </span>
                <span className="symbol">{asset.symbol}</span>
              </div>
              <h3>{asset.name}</h3>
              <p className="asset-description">{asset.description}</p>
              <p className="asset-price">
                <span className="price-label">Initial price</span>
                {formatDinoDollars(asset.initialPriceCents)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
