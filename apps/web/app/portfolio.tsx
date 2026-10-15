import type { LobbySnapshot, PortfolioRanking } from "@dinopump/contracts";

type Portfolio = NonNullable<LobbySnapshot["round"]>["portfolio"];
type Marks = Record<keyof Portfolio["holdings"], number>;
export const formatDinoDollars = (cents: number) =>
  `D$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PortfolioChange({
  profitCents,
  returnPercent,
}: Pick<PortfolioRanking, "profitCents" | "returnPercent">) {
  const direction =
    profitCents > 0 ? "gain" : profitCents < 0 ? "loss" : "unchanged";
  return (
    <div className={`portfolio-change ${direction}`}>
      <p data-testid="portfolio-profit">
        {profitCents > 0 ? "Profit" : profitCents < 0 ? "Loss" : "Unchanged"}:{" "}
        {formatDinoDollars(Math.abs(profitCents))}
      </p>
      <p>
        Return:{" "}
        <span data-testid="portfolio-return">
          {returnPercent > 0
            ? "Gain"
            : returnPercent < 0
              ? "Loss"
              : "Unchanged"}
          :{" "}
          {Math.abs(returnPercent).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          %
        </span>
      </p>
    </div>
  );
}

export function PortfolioPanel({
  portfolio,
  total,
  marks,
  frozen = false,
}: {
  portfolio: Portfolio;
  total: PortfolioRanking;
  marks: Marks;
  frozen?: boolean;
}) {
  return (
    <section
      className="terminal-panel portfolio-panel"
      aria-label={frozen ? "Your final portfolio" : "Your portfolio"}
      tabIndex={0}
    >
      <h3>{frozen ? "Your final portfolio" : "Your portfolio"}</h3>
      <p>
        {frozen ? "Remaining cash" : "Your cash"}:{" "}
        <strong data-testid={frozen ? "final-cash" : "own-cash"}>
          {formatDinoDollars(portfolio.cashCents)}
        </strong>
      </p>
      <p>
        {frozen ? "Frozen portfolio value" : "Marked portfolio value"}{" "}
        <strong data-testid="portfolio-value">
          {formatDinoDollars(total.portfolioValueCents)}
        </strong>
      </p>
      <PortfolioChange {...total} />
      <p className="muted">
        {frozen
          ? "Your remaining holdings are valued at frozen closing marks. They were not sold. Final values and ranks are fixed."
          : "Cash + holdings at the last trade price, or the opening price before any trades. Quote changes alone do not change your value. Live values and ranks are provisional."}
      </p>
      {Object.values(portfolio.holdings).every((units) => units === 0) && (
        <p>{frozen ? "No remaining holdings." : "No holdings yet."}</p>
      )}
      <details open>
        <summary>
          {frozen
            ? "Your holdings at frozen marks"
            : "Your holdings at last-trade marks"}
        </summary>
        <ul
          aria-label={frozen ? "Your final holdings" : "Your holdings"}
          className="portfolio-holdings"
        >
          {Object.entries(portfolio.holdings).map(([symbol, units]) => {
            const mark = marks[symbol as keyof Marks];
            return (
              <li key={symbol} data-testid={`holding-${symbol}`}>
                <strong>{symbol}</strong>
                <span data-testid="holding-units">
                  {units.toLocaleString("en-US")}{" "}
                  {units === 1 ? "unit" : "units"}
                </span>
                <span>
                  {frozen ? "Frozen mark" : "Last-trade mark"}:{" "}
                  <b data-testid="holding-mark">{formatDinoDollars(mark)}</b>
                </span>
                <span>
                  Marked holdings:{" "}
                  <b data-testid="holding-value">
                    {formatDinoDollars(units * mark)}
                  </b>
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}

export function ProvisionalLeaderboard({
  totals,
  players,
  playerId,
}: {
  totals: PortfolioRanking[];
  players: LobbySnapshot["players"];
  playerId: string;
}) {
  return (
    <section
      className="terminal-panel leaderboard"
      aria-label="Provisional leaderboard"
      tabIndex={0}
    >
      <h3>Provisional leaderboard</h3>
      <p className="muted">
        Ranked by cash + holdings at last-trade marks. Equal values share a
        rank; join order keeps the display stable. Disconnected players stay
        ranked.
      </p>
      <ol aria-label="Portfolio totals" className="leaderboard-rows">
        {totals.map((total) => {
          const player = players.find((p) => p.playerId === total.playerId);
          const shared = totals.filter((t) => t.rank === total.rank).length > 1;
          return (
            <li key={total.playerId} data-testid={`rank-${total.playerId}`}>
              <strong>
                Rank {total.rank}
                {shared ? " (shared)" : ""} ·{" "}
                {player?.displayName ?? "Round participant"}
                {playerId === total.playerId ? " · You" : ""}
              </strong>
              <span>
                {player?.connected ? "Online" : "Offline · still ranked"}
              </span>
              <span>
                Portfolio value:{" "}
                <b>{formatDinoDollars(total.portfolioValueCents)}</b>
              </span>
              <PortfolioChange {...total} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
