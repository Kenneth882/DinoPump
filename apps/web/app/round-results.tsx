import type { RoundEnded } from "@dinopump/contracts";
const money = (cents: number) =>
  `D$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
                  Rank {r.rank} · {r.displayName}
                </strong>
                <span>Final value: {money(r.portfolioValueCents)}</span>
                <span>
                  {r.profitCents >= 0 ? "Profit" : "Loss"}:{" "}
                  {money(r.profitCents)} · Return: {r.returnPercent.toFixed(2)}%
                </span>
              </li>
            ))}
          </ol>
          <h4>Your final portfolio</h4>
          <p>
            Remaining cash:{" "}
            <strong data-testid="final-cash">
              {money(result.portfolio.cashCents)}
            </strong>
          </p>
          <ul aria-label="Your final holdings">
            {Object.entries(result.portfolio.holdings).map(
              ([symbol, quantity]) => (
                <li key={symbol}>
                  {symbol}: {quantity} units · Frozen mark{" "}
                  {money(result.marks[symbol as keyof typeof result.marks])}
                </li>
              ),
            )}
          </ul>
          <p>
            Your remaining holdings are valued at frozen marks. They were not
            sold.
          </p>
          <h4>Major market events</h4>
          {result.timeline.length ? (
            <ol aria-label="Round event timeline">
              {result.timeline.map((item) => (
                <li key={item.sourceEventId}>
                  <strong>{item.headline}</strong>
                  <p>{item.facts}</p>
                  {item.effects.map((e) => (
                    <p key={e.symbol}>
                      {e.symbol}: {e.changeBps >= 0 ? "+" : ""}
                      {e.changeBps / 100}% reference effect
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
