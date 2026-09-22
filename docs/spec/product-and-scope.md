# Product and scope

Read when deciding MVP scope, product boundaries, deferred features, or changes to baseline rules.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §1, §2, §14, §15, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For implementation order, read [implementation](implementation.md). For asset names and event content, read [game content](game-content.md).

Verification: All acceptance criteria apply to release scope. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 1. Product definition

DinoPump is a browser game in which 2–8 players trade invented prehistoric assets during a shared, ten-minute market round. Players react to volcanic eruptions, migrating herds, fossil discoveries, and other fictional events to grow their virtual portfolios. The player with the highest portfolio value when the market closes wins.

The experience combines the information density of a simplified trading terminal with playful dinosaur characters, readable charts, and fast decisions. The market is authoritative, deterministic, and controlled by the server. An optional LLM adds entertaining commentary from verified game facts; it has no authority over game state.

This document defines the MVP and its acceptance criteria. Values marked as defaults are initial balancing choices, configurable before a round and frozen for that round. Future features are explicitly outside MVP scope.

### Product boundaries

- All assets, companies, headlines, and currency are fictional.
- Currency is called **Dino Dollars**, displayed as `D$`. It cannot be bought, withdrawn, transferred outside a round, or redeemed.
- No brokerage integration, real securities, cryptocurrency wallets, deposits, payouts, leverage, borrowing, or short selling.
- The lobby and game interface display: “Fictional market game. Virtual currency only.”
- Player-facing language uses “play,” “round,” and “virtual portfolio”; it must not promise real financial returns.

### Success criteria

- A first-time player can join a lobby and place a first trade within two minutes without reading external documentation.
- Players see a consistent shared market and can explain why their cash, holdings, and ranking changed.
- A complete round works even when the commentary provider is unavailable.
- Eight simultaneous players can complete a round with no negative balances, duplicated trades, or divergent authoritative state.

## 2. MVP scope

| Included | Deferred |
| --- | --- |
| One active room, 2–8 human players | Multiple concurrent rooms, matchmaking, tournaments |
| Guest identities and reconnectable sessions | Accounts, long-term profiles, progression |
| Four fictional assets | Player-created assets and new asset classes |
| Ten-minute rounds and a results screen | Alternate round lengths and game modes in the UI |
| Buy/sell market orders | Player limit orders and cancellations |
| A deterministic liquidity bot | Multiple bot strategies and advanced AMMs |
| Executable bid/ask quote ladder | Full player-driven order book UI |
| Live line charts and recent trades | Candlesticks and advanced indicators |
| Cash, holdings, P/L, live leaderboard | Teams, achievements, analytics dashboards |
| One market event every 60 seconds | Complex event chains and boss modes |
| LLM commentary with template fallback | Conversational AI analyst |
| Preset trader reactions | Free-text chat, moderation, direct messages |
| An event log and internal state reconstruction | Player-facing replay controls |

Player-to-player limit matching is a later phase. In the MVP, human market orders execute against system bot quotes. Market orders alone do not provide resting liquidity; the bot is therefore a required dependency, not an optional enhancement.

## 14. Post-MVP roadmap

**Phase 2 — Player-driven exchange:** limit orders, cancellation, reserved funds/holdings, price-time priority across human and bot orders, a real order book, candlesticks, and expanded trade history. Resting orders require dedicated cancellation and reservation-release tests.

**Phase 3 — Deeper game:** new asset categories, achievements, curated event chains, team rooms, multiple bot personalities, and more sophisticated supply/demand rules. Version rule changes per round.

**Phase 4 — Competitive and social:** persistent accounts, multi-room routing, tournaments, approved player-created assets, abuse detection, and moderated chat. Revisit scoring and market manipulation before competitive rewards.

**Phase 5 — Explainability and replay:** interactive replay from the event store, shareable round highlights, and an AI analyst whose explanations cite actual event IDs and recorded trades.

## 15. Baseline decisions

To avoid blocking implementation, this specification assumes browser delivery, guest play, one active room, ten-minute rounds, whole units, no fees, zero starting holdings, and bot-provided liquidity. Next.js plus a separate long-running Node service is the proposed stack. Hosting provider, charting library, and LLM provider can be selected during implementation without changing the gameplay contract.

Any change to settlement, rounding, scheduling, quote generation, or scoring must update the rules version, this specification, and the applicable acceptance cases before being used in a new round.
