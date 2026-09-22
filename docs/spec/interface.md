# Interface and accessibility

Read when implementing lobby, terminal, trade ticket, charts, portfolio, news, reactions, responsive layouts, accessibility, or results screens.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §6, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For visible round and scoring behavior, read [round lifecycle](round-lifecycle.md). For client synchronization and private data, read [API and recovery](api-and-recovery.md). For estimates and protection prices, read [market engine](market-engine.md). For generated news, read [events and narration](events-and-narration.md).

Verification: AC-01, AC-03–AC-06, AC-10, AC-11, AC-13, AC-17. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 6. Interface specification

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
