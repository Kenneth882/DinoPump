import type { NewsItem } from "@dinopump/contracts";
import { formatDinoDollars as money } from "./portfolio";
import { elapsedRoundTime as elapsed } from "./round-time";

/** The same historical source cards remain visible after settlement. */
export function DailyRoar({
  news,
  opensAt,
}: {
  news: NewsItem[];
  opensAt: number;
}) {
  return (
    <section
      aria-labelledby="news-heading"
      className="daily-roar terminal-panel"
    >
      <h3 id="news-heading">The Daily Roar</h3>
      {news.length === 0 ? (
        <p>
          No news yet. The first market event arrives one minute into the round.
        </p>
      ) : (
        <ol aria-label="Market news">
          {[...news].reverse().map((item) => (
            <li key={item.sourceEventId} data-testid="news-item">
              <article>
                <h4>{item.headline}</h4>
                <p>{item.facts}</p>
                <p>{item.commentary}</p>
                <p>
                  Authored game news ·{" "}
                  <time dateTime={new Date(item.appliedAtMs).toISOString()}>
                    {elapsed(item.appliedAtMs, opensAt)} elapsed
                  </time>
                </p>
                {item.narration && (
                  <p data-testid="ai-narration">
                    <strong>AI narration</strong> · As of{" "}
                    {elapsed(item.narration.elapsedMs, 0)}
                    <br />
                    {item.narration.commentary}
                  </p>
                )}
                <ul aria-label="Reference price effects">
                  {item.effects.map((effect) => (
                    <li key={effect.symbol}>
                      {effect.symbol}: {effect.changeBps >= 0 ? "+" : ""}
                      {effect.changeBps / 100}% reference effect ·{" "}
                      {money(effect.beforeCents)} → {money(effect.afterCents)}
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
