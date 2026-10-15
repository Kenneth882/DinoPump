import type { LobbySnapshot } from "@dinopump/contracts";
import { formatDinoDollars } from "./portfolio";

export function PlayerActivity({
  round,
  players,
}: {
  round: NonNullable<LobbySnapshot["round"]>;
  players: LobbySnapshot["players"];
}) {
  const name = (id: string) =>
    id === "system:bot"
      ? "Game liquidity bot"
      : (players.find((player) => player.playerId === id)?.displayName ??
        "Player");
  return (
    <section className="terminal-panel" aria-labelledby="activity-heading">
      <h3 id="activity-heading">Player activity</h3>
      <p>Executed fills · latest 30. Each fill is a separate entry.</p>
      {round.trades.length ? (
        <ol aria-label="Executed player activity" className="trade-tape">
          {round.trades.map((fill) => {
            const buy = fill.sellerId === "system:bot";
            return (
              <li key={fill.sequence} data-sequence={fill.sequence}>
                {name(buy ? fill.buyerId : fill.sellerId)}{" "}
                {buy ? "bought" : "sold"} {fill.quantity} {fill.symbol} at{" "}
                {formatDinoDollars(fill.priceCents)} ·{" "}
                {formatDinoDollars(fill.totalValueCents)} total ·{" "}
                {buy ? "from" : "to"} {name(buy ? fill.sellerId : fill.buyerId)}
              </li>
            );
          })}
        </ol>
      ) : (
        <p>No executed player activity yet.</p>
      )}
    </section>
  );
}
