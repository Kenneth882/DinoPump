# Interface and accessibility

Read when implementing lobby, terminal, trade ticket, charts, portfolio, news, reactions, responsive layouts, accessibility, or results screens.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §6, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For visible round and scoring behavior, read [round lifecycle](round-lifecycle.md). For client synchronization and private data, read [API and recovery](api-and-recovery.md). For estimates and protection prices, read [market engine](market-engine.md). For generated news, read [events and narration](events-and-narration.md).

Verification: AC-01, AC-03–AC-06, AC-10, AC-11, AC-13, AC-17. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 6. Interface specification

### Read-only introduction

Before live rounds are implemented, show Pangaea Exchange, the four canonical assets and their initial prices in Dino Dollars, “Fictional market game. Virtual currency only.”, and “Live rounds are not available yet.” Fetch the validated baseline from the game service at runtime; production builds must not require a running service. Do not add gameplay or configuration controls.

During the scheduled-events implementation stage (ticket #9), the availability notice reads “Ready your herd to open a round. Trading is coming next.” The introduction retains initial-price labels; the round view shows authoritative resources, current quotes, reference and last-trade prices, and immediate authored Daily Roar news without trading controls.

During the durable-trading stage (ticket #10), the availability notice reads “Ready your herd, then buy and sell protected trades against the game liquidity bot.” The round view adds a minimal protected buy/sell ticket, executed trades, and provisional public portfolio totals. Closing results and the full terminal remain later slices.

During the closing/results stage (ticket #11), the availability notice reads “Ready your herd, then buy and sell protected trades against the game liquidity bot.” Closing adds immutable shared ranks, winner/tied winners, final value/profit/return, owned remaining cash/holdings, and a compact committed-event timeline. The host can return to the lobby and start a fresh round. An aborted round shows a safe explanation with no winner. The full terminal remains a later slice.

During the live-terminal stage (ticket #14), the synchronized round view uses a desktop watchlist/chart-news/trade-depth layout. It adds frozen opening changes, actual covered depth, a recent fill tape, and an elapsed-time chart of opening plus all executed fills. News markers never add trade points. Keyboard selection connects the watchlist, chart, and protected ticket; quote freshness and reconnect pauses remain visible. Portfolio and activity expansion and the complete narrow-screen tab journey are delivered by their subsequent tickets.

During the portfolio stage (ticket #15), each owner sees private cash, units, marked holdings, portfolio value, profit and return. Live values use the authoritative public total and last-trade marks, falling back to the frozen opening price before any fill. The provisional leaderboard shows shared ranks in stable join order and retains disconnected players. Only permitted public totals appear for other players. Closing reuses the owner summary with frozen marks/results and a major-event timeline; historical authorized results remain unchanged after reconnect, lobby reset, and later rounds. Gain, loss and unchanged labels accompany numeric values, and portfolio panels and holdings disclosures support keyboard use.

During the reactions/activity stage (ticket #16), shared room controls offer the three fixed dinosaur reactions in lobby, countdown, market and results views. Show pending/cooldown feedback and safe errors, disable sending until an authorized connection is synchronized, and report uncertain timeouts without automatic resend. Show at most 20 recent reactions for ten seconds, separately from executed facts; neither incoming reactions nor activity is a live announcement stream. Clear transients on disconnect and room/round change. The lower player activity panel derives one entry per completely applied public fill, with player, buy/sell direction, symbol, executed units/price/total and game liquidity bot counterparty. Use the existing latest-30-fill bound, an explicit empty state, and authoritative snapshot replacement on reconnect. Multi-level orders produce multiple entries; rejected and zero-fill orders produce none. Preserve the existing trade tape.

During service failure or an invalid response, retain the introduction and both notices, omit asset prices, and show “Market information is temporarily unavailable” with a keyboard-accessible Retry button. Do not substitute bundled prices. Label successfully loaded prices as initial prices, not live quotes.

### Lobby

Room code, participant avatars, connection/ready indicators, host start button, avatar/name controls, and concise instructions. Explain that trades execute against a game liquidity bot in the MVP.

### Market screen

On desktop, use a three-column terminal layout:

- **Left:** four-asset watchlist, last prices, change since opening, and selected asset.
- **Center:** selected asset line chart, latest event context, recent trade tape, and Daily Roar news feed.
- **Right:** buy/sell ticket, bot bid/ask depth ladder, cash, holdings, portfolio value, and P/L.

A top bar shows the room, server-synchronized round countdown, connection state, and virtual-currency label. A lower panel contains leaderboard, player activity, and preset reactions such as “Big roar,” “Tiny arms, big gains,” and “Meteor incoming.”

On narrow screens, use Market, Trade, Portfolio, and News tabs; keep countdown and connection status visible. The buy/sell ticket must remain usable at a 360px viewport width.

### Interaction requirements

- Show a confirmation/result for every order: filled, partially filled, rejected, or pending reconciliation.
- Disable repeat submission while the same request is pending. Network retries reuse its original request ID.
- A quote estimate is not a guaranteed execution price. Show average fill price and executed total after settlement.
- Show empty states for no holdings, no trades, no news, and unavailable liquidity.
- Disable trading when disconnected, resynchronizing, or outside the open round.
- Mark stale quotes visibly after three seconds without fresh connectivity evidence.
- Chart points come from executed trades plus the initial point. Event markers may appear without an accompanying trade-price move.
- News facts appear immediately; delayed AI copy enhances the same news item without changing its timestamp or market effects.
- Display bot counterparties in trade details and show player activity without exposing session credentials.

### Visual direction and accessibility

Use a dark jungle/volcanic background, amber highlights, fern green accents, clear numeric typography, and restrained cartoon dinosaur art. Charts and trade controls take visual priority over decoration.

All controls support keyboard use and visible focus. Gains and losses use text or icons as well as color. Respect reduced-motion preferences, use readable contrast, and avoid announcing every market tick to screen readers; announce trade results and connection changes.

### Results screen

Show shared ranks, winner or tied winners, final portfolio value, profit, return, remaining cash/holdings, and a compact timeline of major market events. Provide a return-to-lobby action for the host. Full interactive replay is deferred.
