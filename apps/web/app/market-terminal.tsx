"use client";

import { useState, type ComponentProps } from "react";
import { PortfolioPanel, ProvisionalLeaderboard } from "./portfolio";
import { TradeTicket } from "./trade-ticket";
import type { LobbySnapshot, OrderSubmit } from "@dinopump/contracts";

type RoundView = NonNullable<LobbySnapshot["round"]>;
const money = (cents: number) =>
  `D$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const elapsed = (at: number, opening: number) => {
  const seconds = Math.max(0, Math.floor((at - opening) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function PriceChart({
  round,
  symbol,
}: {
  round: RoundView;
  symbol: OrderSubmit["symbol"];
}) {
  const opening = round.openingAssets.find((a) => a.symbol === symbol)!;
  const points = [
    { sequence: 0, atMs: round.opensAt, priceCents: opening.initialPriceCents },
    ...round.priceHistory.filter((p) => p.symbol === symbol),
  ];
  const prices = points.map((p) => p.priceCents);
  const low = Math.min(...prices),
    high = Math.max(...prices);
  const padding = Math.max(1, (high - low) * 0.15);
  const x = (at: number) =>
    75 +
    615 *
      Math.max(
        0,
        Math.min(1, (at - round.opensAt) / (round.closesAt - round.opensAt)),
      );
  const y = (price: number) =>
    210 - (170 * (price - low + padding)) / (high - low + 2 * padding);
  return (
    <section aria-labelledby="chart-heading" className="terminal-panel">
      <div className="section-heading">
        <h3 id="chart-heading">{symbol} trade price</h3>
        <span>Opening + executed trades</span>
      </div>
      <svg
        viewBox="0 0 720 260"
        role="img"
        aria-labelledby="price-chart-title price-chart-description"
      >
        <title id="price-chart-title">
          {symbol} executed trade price chart
        </title>
        <desc id="price-chart-description">
          {points.length - 1} executed fills. Opening{" "}
          {money(opening.initialPriceCents)}. Last{" "}
          {money(points.at(-1)!.priceCents)}. Event lines indicate news, not
          trades.
        </desc>
        {[low, high]
          .filter((p, i, all) => all.indexOf(p) === i)
          .map((price) => (
            <g key={price}>
              <line
                x1="75"
                x2="690"
                y1={y(price)}
                y2={y(price)}
                className="chart-grid"
              />
              <text x="0" y={y(price) - 7}>
                {money(price)}
              </text>
            </g>
          ))}
        {round.news.map((item) => (
          <g key={item.sourceEventId} data-testid="event-marker">
            <title>
              {elapsed(item.appliedAtMs, round.opensAt)} · {item.headline}
            </title>
            <line
              x1={x(item.appliedAtMs)}
              x2={x(item.appliedAtMs)}
              y1="25"
              y2="220"
              className="chart-event"
            />
            <text x={x(item.appliedAtMs)} y="20">
              ◆
            </text>
          </g>
        ))}
        <polyline
          data-testid="price-line"
          points={points
            .map((p) => `${x(p.atMs)},${y(p.priceCents)}`)
            .join(" ")}
          className="chart-price"
        />
        {points.map((p) => (
          <circle
            key={p.sequence}
            data-testid="price-point"
            data-sequence={p.sequence}
            data-price-cents={p.priceCents}
            data-at-ms={p.atMs}
            cx={x(p.atMs)}
            cy={y(p.priceCents)}
            r="3.5"
            className="chart-point"
          >
            <title>
              {p.sequence === 0 ? "Opening" : `Fill #${p.sequence}`} ·{" "}
              {elapsed(p.atMs, round.opensAt)} · {money(p.priceCents)}
            </title>
          </circle>
        ))}
        <text x="75" y="250">
          0:00
        </text>
        <text x="620" y="250">
          {elapsed(round.closesAt, round.opensAt)}
        </text>
      </svg>
      <p className="muted">
        Elapsed round time · ◆ Market event. Events move reference prices and
        quotes; only fills move this chart.
      </p>
      <details>
        <summary>Read price history ({points.length} points)</summary>
        <ol className="price-history">
          {points.map((p) => (
            <li key={p.sequence}>
              {elapsed(p.atMs, round.opensAt)} ·{" "}
              {p.sequence === 0 ? "Opening" : `Fill #${p.sequence}`} ·{" "}
              {money(p.priceCents)}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

export function MarketTerminal({
  round,
  players,
  playerId,
  roomCode,
  connection,
  secondsRemaining,
  ...ticket
}: Omit<ComponentProps<typeof TradeTicket>, "symbol" | "onSelectSymbol"> & {
  players: LobbySnapshot["players"];
  playerId: string;
  roomCode: string;
  connection: string;
  secondsRemaining: number;
}) {
  const [symbol, setSymbol] = useState<OrderSubmit["symbol"]>("FERN");
  const asset = round.assets.find((a) => a.symbol === symbol)!;
  const opening = round.openingAssets.find((a) => a.symbol === symbol)!;
  const quotes = round.quotes.filter((q) => q.symbol === symbol);
  const bids = quotes
    .filter((q) => q.side === "bid")
    .sort(
      (a, b) =>
        b.priceCents - a.priceCents ||
        a.creationSequence - b.creationSequence ||
        a.id.localeCompare(b.id),
    );
  const asks = quotes
    .filter((q) => q.side === "ask")
    .sort(
      (a, b) =>
        a.priceCents - b.priceCents ||
        a.creationSequence - b.creationSequence ||
        a.id.localeCompare(b.id),
    );
  const playerName = (id: string) =>
    id === "system:bot"
      ? "game liquidity bot"
      : (players.find((p) => p.playerId === id)?.displayName ??
        "Round participant");
  const latest = round.news.at(-1);
  return (
    <section className="market-terminal" aria-labelledby="opening-heading">
      <h3 id="opening-heading">Market and your resources</h3>
      <div className="terminal-bar">
        <strong>Pangaea Exchange · Room {roomCode}</strong>
        <span data-testid="round-remaining">
          Round closes in {secondsRemaining} seconds.
        </span>
        <span>
          {connection} ·{" "}
          {ticket.enabled ? "Quotes live" : "Quotes stale or unavailable"}
        </span>
        <span>Fictional market game. Virtual currency only.</span>
      </div>
      <div className="terminal-columns">
        <section className="terminal-panel" aria-labelledby="watchlist-heading">
          <h3 id="watchlist-heading">Asset watchlist</h3>
          <p className="muted">Last trade · change since opening</p>
          <div className="watchlist">
            {round.openingAssets.map((initial) => {
              const current = round.assets.find(
                (a) => a.symbol === initial.symbol,
              )!;
              const change =
                ((current.lastPriceCents - initial.initialPriceCents) /
                  initial.initialPriceCents) *
                100;
              return (
                <button
                  key={initial.symbol}
                  aria-pressed={symbol === initial.symbol}
                  onClick={() => setSymbol(initial.symbol)}
                  disabled={ticket.pending}
                >
                  <strong>{initial.symbol}</strong>
                  <span>{initial.name}</span>
                  <b>{money(current.lastPriceCents)}</b>
                  <span className={change < 0 ? "loss" : "gain"}>
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)}% since opening
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <div className="terminal-center">
          <section className="terminal-panel" aria-label="Selected market">
            <h3>
              {opening.name} <span className="symbol">{symbol}</span>
            </h3>
            <div className="market-prices">
              <p>
                Last trade{" "}
                <strong data-testid="selected-last">
                  {money(asset.lastPriceCents)}
                </strong>
              </p>
              <p>
                Best bid{" "}
                <strong>
                  {bids[0]
                    ? money(bids[0].priceCents)
                    : "Unavailable liquidity"}
                </strong>
              </p>
              <p>
                Best ask{" "}
                <strong>
                  {asks[0]
                    ? money(asks[0].priceCents)
                    : "Unavailable liquidity"}
                </strong>
              </p>
            </div>
            <p className="muted">
              Opening {money(opening.initialPriceCents)} · Reference{" "}
              {money(asset.referencePriceCents)}
            </p>
          </section>
          <PriceChart round={round} symbol={symbol} />
          <section className="terminal-panel" aria-label="Latest event context">
            <h3>Latest event</h3>
            {latest ? (
              <p>
                {latest.headline} · {latest.facts}
              </p>
            ) : (
              <p>No market events yet.</p>
            )}
          </section>
          <section className="terminal-panel" aria-labelledby="tape-heading">
            <h3 id="tape-heading">Recent trade tape</h3>
            <p className="muted">
              Latest 30 executed fills across all assets · sequence order,
              newest first
            </p>
            {round.trades.length ? (
              <ol aria-label="Executed trades" className="trade-tape">
                {[...round.trades].reverse().map((t) => (
                  <li key={t.sequence} data-testid={`trade-${t.sequence}`}>
                    <strong>{t.symbol}</strong> · {t.quantity} units at{" "}
                    {money(t.priceCents)}
                    <br />
                    Executed total: {money(t.totalValueCents)} · Fill #
                    {t.sequence}
                    <br />
                    {playerName(t.buyerId)} buys from {playerName(t.sellerId)}
                  </li>
                ))}
              </ol>
            ) : (
              <p>No trades yet.</p>
            )}
          </section>
          <section
            aria-labelledby="news-heading"
            className="daily-roar terminal-panel"
          >
            <h3 id="news-heading">The Daily Roar</h3>
            {round.news.length === 0 ? (
              <p>
                No news yet. The first market event arrives one minute into the
                round.
              </p>
            ) : (
              <ol aria-label="Market news">
                {[...round.news].reverse().map((item) => (
                  <li key={item.sourceEventId} data-testid="news-item">
                    <article>
                      <h4>{item.headline}</h4>
                      <p>{item.facts}</p>
                      <p>{item.commentary}</p>
                      <p>
                        Authored game news ·{" "}
                        <time
                          dateTime={new Date(item.appliedAtMs).toISOString()}
                        >
                          {elapsed(item.appliedAtMs, round.opensAt)} elapsed
                        </time>
                      </p>
                      <ul aria-label="Reference price effects">
                        {item.effects.map((effect) => (
                          <li key={effect.symbol}>
                            {effect.symbol}: {effect.changeBps >= 0 ? "+" : ""}
                            {effect.changeBps / 100}% reference effect ·{" "}
                            {money(effect.beforeCents)} →{" "}
                            {money(effect.afterCents)}
                          </li>
                        ))}
                      </ul>
                    </article>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
        <div className="terminal-right">
          <TradeTicket
            key={symbol}
            round={round}
            symbol={symbol}
            onSelectSymbol={setSymbol}
            {...ticket}
          />
          <section className="terminal-panel" aria-labelledby="depth-heading">
            <h3 id="depth-heading">Bot quote depth</h3>
            <p>Covered executable quotes · {symbol} · game liquidity bot</p>
            <p className="muted">
              Quote age:{" "}
              {Math.max(
                0,
                Math.floor((ticket.serverNow - round.quoteUpdatedAtMs) / 1000),
              )}{" "}
              seconds.{" "}
              {ticket.enabled
                ? "Connection confirmed."
                : "Quotes stale or unavailable; trading paused."}
            </p>
            <div className="depth-sides">
              {(
                [
                  ["Bids", bids],
                  ["Asks", asks],
                ] as const
              ).map(([label, sideQuotes]) => (
                <div key={label}>
                  <h4>{label}</h4>
                  {sideQuotes.length ? (
                    <ol aria-label={label}>
                      {sideQuotes.map((q) => (
                        <li key={q.id} data-testid={q.id}>
                          <strong>{money(q.priceCents)}</strong>
                          <span>{q.quantity} units</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>
                      Unavailable liquidity. No covered {label.toLowerCase()}.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
          <PortfolioPanel
            portfolio={round.portfolio}
            total={round.totals.find((t) => t.playerId === playerId)!}
            marks={
              Object.fromEntries(
                round.assets.map((a) => [a.symbol, a.lastPriceCents]),
              ) as Record<OrderSubmit["symbol"], number>
            }
          />
        </div>
      </div>
      <ProvisionalLeaderboard
        totals={round.totals}
        players={players}
        playerId={playerId}
      />
    </section>
  );
}
