import type { RoundEnded } from "@dinopump/contracts";
import {
  PortfolioPanel,
  PortfolioChange,
  formatDinoDollars as money,
} from "./portfolio";
export function RoundResults({
  result,
  host,
  disabled,
  onReturn,
}: {
  result: RoundEnded;
  host: boolean;
  disabled: boolean;
  onReturn: () => void;
}) {
  const winners =
    result.status === "FINISHED"
      ? result.rankings.filter((r) => r.rank === 1)
      : [];
  return (
    <section className="round-results" aria-labelledby="results-heading">
      <h3 id="results-heading">
        {result.status === "FINISHED" ? "Round results" : "Round aborted"}
      </h3>
      <p role="status">
        {result.status === "ABORTED"
          ? result.message
          : `${winners.length > 1 ? "Tied winners" : "Winner"}: ${winners.map((w) => w.displayName).join(", ")}`}
      </p>
      {result.status === "FINISHED" && (
        <>
          <ol aria-label="Final rankings" className="players">
            {result.rankings.map((r) => (
              <li key={r.playerId}>
                <strong>
                  Rank {r.rank}
                  {result.rankings.filter((entry) => entry.rank === r.rank)
                    .length > 1
                    ? " (shared)"
                    : ""}{" "}
                  · {r.displayName}
                </strong>
                <span>Final value: {money(r.portfolioValueCents)}</span>
                <PortfolioChange {...r} />
              </li>
            ))}
          </ol>
          <PortfolioPanel
            portfolio={result.portfolio}
            total={result.rankings.find((r) => r.playerId === result.playerId)!}
            marks={result.marks}
            frozen
          />
          <h4>Major market events</h4>
          {result.timeline.length ? (
            <ol aria-label="Round event timeline" className="result-timeline">
              {result.timeline.map((item) => (
                <li key={item.sourceEventId}>
                  <strong>{item.headline}</strong>
                  <time dateTime={new Date(item.dueAtMs).toISOString()}>
                    {new Date(item.dueAtMs).toLocaleTimeString("en-US")}
                  </time>
                  <p>{item.facts}</p>
                  {item.effects.map((e) => (
                    <p key={e.symbol}>
                      {e.symbol}: {e.changeBps >= 0 ? "+" : ""}
                      {e.changeBps / 100}% reference effect ·{" "}
                      {money(e.beforeCents)} → {money(e.afterCents)}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          ) : (
            <p>No market events were recorded.</p>
          )}
        </>
      )}
      {host ? (
        <button disabled={disabled} onClick={onReturn}>
          Return to lobby
        </button>
      ) : (
        <p>Waiting for the host to return to the lobby.</p>
      )}
    </section>
  );
}
