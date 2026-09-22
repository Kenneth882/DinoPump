# Market engine and liquidity

Read when implementing order validation, price protection, fills, rounding, settlement, liquidity quotes, bot reservations, or command ordering.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §5, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For ledger transactions, idempotency, and replay invariants, read [persistence](persistence.md). For valuation, read [round lifecycle](round-lifecycle.md). For order payloads and retry behavior, read [API and recovery](api-and-recovery.md).

Verification: AC-03–AC-09, AC-11, AC-12, AC-15, AC-16. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 5. Market and matching rules

### Numeric and execution rules

- Store cash and prices as integer cents, quantities as whole integers, and changes as integer basis points. Do not use floating-point arithmetic for settlement.
- Minimum price: D$1.00. Maximum price: D$10,000.00. Minimum quantity: 1; maximum quantity per order: 500.
- Price tick: D$0.01. Round reference-price calculations half-up to the nearest cent, then clamp to the allowed range.
- No trading fees in the MVP.
- Every order is immediate-or-cancel: fill what can execute within its protections and cancel the remainder. There are no resting human orders.
- Buys consume asks from lowest to highest price. Sells consume bids from highest to lowest price. Equal prices use quote creation sequence, then stable quote ID.
- Each fill executes at the resting quote price. A multi-fill order reports filled quantity, remaining quantity, total value, and volume-weighted average price.
- An order cannot trade with the same owner. Human-to-human matching becomes available when resting human orders are introduced later.

### Price protection and validation

The trade ticket shows an estimate, quote age, and the default **5% maximum price movement**. On submission, the client sends an explicit maximum unit price for buys or minimum unit price for sells, derived from the displayed best quote. This protection is fixed for that request; the server must not silently widen it.

Before processing, the server validates session identity, round ID, round status, asset, side, integer quantity, protection price, rate limits, and idempotency key. A buy must have enough cash for `quantity × maximumUnitPrice`; a sell must have the full requested quantity in holdings. These checks are conservative even when a partial fill is expected.

The engine settles all fills for one order atomically. Unused spending capacity is immediately available after the transaction. Insufficient balance, insufficient holdings, invalid input, and a closed market reject the entire order without fills. Valid orders may partially fill; if no quote qualifies, return `NO_LIQUIDITY_WITHIN_PROTECTION` without changing balances.

### Deterministic liquidity bot

Initial defaults:

- One system bot starts each round with **D$10,000,000.00 cash and 100,000 units of each asset**.
- Each asset has three quote levels per side, each for up to 100 units.
- At reference price `R`, ask levels are `ceil(R × (1 + offset / 10,000))`; bid levels are `floor(R × (1 − offset / 10,000))`, for offsets **100, 200, and 300 basis points**.
- Discard quotes outside price bounds. Bids must remain below asks; at a bound, a side may be empty.
- Quotes are limited by the bot's unreserved holdings and cash. Across all assets, aggregate bid reservations cannot exceed bot cash. Allocate reservations in symbol order, then from best to worst quote.
- Rebuild all bot quotes after each completed human order and each scheduled event. Replacements release old reservations first. Generation IDs and quote ordering are deterministic.
- Quotes stay fixed while an individual order executes. After an order with fills, move the traded asset's reference price by **+10 basis points for a buy** or **−10 basis points for a sell**, once per order, then rebuild quotes.
- The bot does not submit autonomous trades in the MVP. An idle chart may be flat; scheduled events still change quotes and the news feed.

Scheduled events apply their catalog basis-point changes to reference prices, then rebuild quotes. Last-trade prices change only on fills. These are intentionally simple game-balancing rules, not a model of real-world markets.

The bot is a real ledger participant with finite resources. Trades transfer existing cash and units; liquidity must not be fabricated during settlement. Resource exhaustion produces partial fills or unavailable quotes. No mid-round replenishment is part of the MVP.

### Determinism and ordering

- Exactly one authoritative processor owns the room and serializes all market-changing commands.
- Assign server sequence numbers; client timestamps never determine order priority.
- Before handling a player command, process scheduled events already due according to authoritative server time.
- At `serverNow >= closesAt`, settle the round before processing another order. A request sent earlier but processed after this boundary is rejected.
- Persist the round seed, rules version, configuration, event schedule, and selected event outcomes. Reconstructing state must not require an LLM, wall-clock calls, or fresh randomness.
- A command either commits its complete event batch and state changes or makes no changes. Broadcast only after commit.
