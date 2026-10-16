"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { PortfolioPanel, ProvisionalLeaderboard } from "./portfolio";
import { DailyRoar } from "./daily-roar";
import { elapsedRoundTime as elapsed } from "./round-time";
import { PlayerActivity } from "./player-activity";
import { TradeFeedback, TradeTicket } from "./trade-ticket";
import type { LobbySnapshot, OrderSubmit } from "@dinopump/contracts";

type RoundView = NonNullable<LobbySnapshot["round"]>;
const terminalTabs = ["Market", "Trade", "Portfolio", "News"] as const;
type TerminalTab = (typeof terminalTabs)[number];

const money = (cents: number) =>
  `D$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  result,
  message,
  ...ticket
}: Omit<ComponentProps<typeof TradeTicket>, "symbol" | "onSelectSymbol"> & {
  result: ComponentProps<typeof TradeFeedback>["result"];
  message: string;
  players: LobbySnapshot["players"];
  playerId: string;
  roomCode: string;
  connection: string;
  secondsRemaining: number;
}) {
  const [selectedTab, setSelectedTab] = useState<TerminalTab>("Market");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const panel = (name: TerminalTab) => ({
    id: `terminal-panel-${name}`,
    role: narrow ? "tabpanel" : undefined,
    "aria-labelledby": narrow ? `terminal-tab-${name}` : undefined,
    hidden: narrow && selectedTab !== name,
    tabIndex: narrow ? 0 : undefined,
  });
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
      <div className="terminal-navigation">
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
        {narrow && (
          <div
            role="tablist"
            aria-label="Terminal views"
            className="terminal-tabs"
          >
            {terminalTabs.map((name, index) => (
              <button
                key={name}
                id={`terminal-tab-${name}`}
                role="tab"
                aria-selected={selectedTab === name}
                aria-controls={`terminal-panel-${name}`}
                tabIndex={selectedTab === name ? 0 : -1}
                onClick={() => setSelectedTab(name)}
                onKeyDown={(event) => {
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? terminalTabs.length - 1
                        : event.key === "ArrowRight"
                          ? (index + 1) % terminalTabs.length
                          : event.key === "ArrowLeft"
                            ? (index + terminalTabs.length - 1) %
                              terminalTabs.length
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  setSelectedTab(terminalTabs[next]!);
                  document
                    .getElementById(`terminal-tab-${terminalTabs[next]}`)
                    ?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <TradeFeedback
        pending={ticket.pending}
        result={result}
        message={message}
      />
      <div className="terminal-columns">
        <div {...panel("Market")} className="terminal-screen terminal-market">
          <section
            className="terminal-panel"
            aria-labelledby="watchlist-heading"
          >
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
            <section
              className="terminal-panel"
              aria-label="Latest event context"
            >
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
          </div>
        </div>
        <div {...panel("Trade")} className="terminal-screen terminal-right">
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
        </div>
        <div
          {...panel("Portfolio")}
          className="terminal-screen terminal-portfolio"
        >
          <PortfolioPanel
            portfolio={round.portfolio}
            total={round.totals.find((t) => t.playerId === playerId)!}
            marks={
              Object.fromEntries(
                round.assets.map((a) => [a.symbol, a.lastPriceCents]),
              ) as Record<OrderSubmit["symbol"], number>
            }
          />
          <ProvisionalLeaderboard
            totals={round.totals}
            players={players}
            playerId={playerId}
          />
        </div>
        <div {...panel("News")} className="terminal-screen terminal-news">
          <DailyRoar news={round.news} opensAt={round.opensAt} />
        </div>
      </div>
      <PlayerActivity round={round} players={players} />
    </section>
  );
}
