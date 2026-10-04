# Market engine

Tickets [#3](https://github.com/Kenneth882/DinoPump/issues/3) and [#4](https://github.com/Kenneth882/DinoPump/issues/4) implement quote generation and protected buys from [market rules §5](../../docs/spec/market-engine.md). Sells, persistence, and scheduling remain later tickets.

## Public boundary

`initializeBotQuotes(frozenRound)` consumes the validated frozen round produced by `buildRoundBaseline`. It uses that snapshot's funding, references, and configuration and generates generation one. Call it only to initialize a round, never to replace live quotes.

`rebuildBotQuotes(state)` consumes a `BotQuoteState` containing `roundId`, `rulesVersion`, frozen `rules`, total `bot` cash/holdings, and each asset's current reference price and quote generation. Both functions accept unknown input, validate it, and return `BotQuoteResult`; the schemas and types live in `@dinopump/contracts`.

```ts
import { initializeBotQuotes, rebuildBotQuotes } from "@dinopump/engine";

const initial = initializeBotQuotes(frozenRound);
if (initial.ok) {
  // Later: update ledger totals/references in a new state after a completed order
  // or scheduled event, then rebuild once. Initialization must not run again.
  const replacement = rebuildBotQuotes(initial.state);
}
```

A successful result contains `state`, `quotes`, and `reservations`. All are independent of input; the engine does not mutate inputs. Treat a result as one replacement: the caller commits the new state and replaces every old quote and reservation summary together. Reservations describe resources covered by the emitted quotes; they are not additional balances to debit or credit. The engine performs no commit or broadcast itself.

The returned state carries the same ledger totals, references, round identity, and frozen rules with each generation incremented once. Empty ladders also advance generation. Retrying the same input reproduces the same result; pass only committed state to the next operation. Existing reservations are deliberately absent from the input, so replacement cannot accumulate or double-refund them.

## Ordering and arithmetic

Rules version `1.1` records the agreed identity and replacement contract; default funding, prices, offsets, and depth remain unchanged. New baselines use `1.1`. Earlier frozen snapshots stay readable by storage but cannot be processed by this engine; they are never silently upgraded.

Output order is AMBR, BONE, FERN, VOLC; within each asset, bids precede asks, and each side is best-to-worst. Equal prices preserve original level order. IDs are `roundId:symbol:generation:side:level` with levels 1–3. `creationSequence` is the fixed zero-based slot within a generation (0–23), retaining gaps for omitted quotes. It is independent of the persisted event sequence.

Prices use exact `BigInt` intermediate products and divisions, with ask ceiling and bid floor. Out-of-bounds levels are discarded. Quantities are whole units covered by remaining cash/holdings; zero-unit quotes are omitted, and allocation continues through later levels and symbols. Output fields remain JSON-safe integer numbers. The reservation summary is derived from the emitted quotes and must not be edited separately.

Failures have `ok: false`, a stable `code`, and `issues` containing field paths and messages. Codes are `INVALID_FROZEN_ROUND`, `INVALID_QUOTE_STATE`, and `QUOTE_GENERATION_EXHAUSTED`. No partial result or ledger mutation is returned. Field paths refer to the supplied input; unsupported rules detected after frozen-round validation use `rulesVersion`. Zero resources are valid. Result schemas validate structure; the engine and invariant tests enforce the relationship between quotes and resource totals.

## Validation

From the repository root:

```sh
pnpm test packages/engine/test/bot-quotes.test.ts
pnpm typecheck
pnpm check
```

Tests exercise worked price ladders, custom frozen configuration, boundary prices, partial/empty liquidity, cross-asset reservations, equal-price priority, replacement/retry identity, invalid input, safe integer limits, JSON round trips, and 500 seeded rebuilds. Seeded tests verify quote reservations against finite resources and prove that generation does not alter cash or units. They do not establish conservation during trades or the service/browser portions of the acceptance criteria.

## Protected buys

`executeBuy(state, command)` accepts unknown inputs and returns a runtime-validated `BuyResult` shape. Shared schemas/types are exported from `@dinopump/contracts`. This implements the existing rules `1.1`; it does not change settlement or quote rules or upgrade frozen rounds.

The `BuyState` contains the current `market` (`BotQuoteState`), round `status`, all `humans` with their cash/holdings, `lastPrices` by symbol, and the current `quotes` and `reservations`. Build the initial state from `initializeBotQuotes(frozenRound)` and the frozen initial human balances and last prices. Thereafter pass only committed output state. State validation checks finite safe integer resources, unique participants/quote IDs, matching quote generations, frozen price/level bounds, and exact covered reservations.

The internal `BuyCommand` contains `roundId`, `requestId`, `playerId`, `side: "buy"`, `symbol`, `quantity`, and `protectionPriceCents`. IDs are UUIDs. The service must derive `playerId` from the authenticated session; never forward a client-supplied identity. The sole quote owner is `system:bot`, distinct from every human UUID, so this boundary cannot self-trade or match humans. Authentication, idempotency, due events, closing deadlines, command serialization, event sequencing and database transactions belong to the caller. `OPEN` validation alone does not enforce the authoritative clock.

A buy first requires cash for the entire requested quantity multiplied by the fixed protection. Eligible asks execute at their resting prices, ordered by price, creation sequence and stable ID. The ladder remains fixed throughout matching. After fills, the latest fill sets the last price, and the frozen reference impact applies once, with exact half-up rounding and clamping. Every completed valid order, including a zero fill, rebuilds all quotes; rejected orders do not rebuild. A zero fill leaves ledgers, last prices and references unchanged.

Success returns the normalized `command`, ordered `fills`, complete replacement `state` (all ledgers, references, marks, quotes and reservations), and `outcome`. Commit these together before broadcasting; the function performs no I/O. Outcomes are `FILLED`, `PARTIALLY_FILLED`, or `NO_LIQUIDITY_WITHIN_PROTECTION`. `remainingQuantity` is cancelled and never rests. `totalValueCents` and every settlement value are safe integer numbers. `averagePrice` reports exact volume-weighted price as `{ numeratorCents: totalValueCents, denominatorUnits: filledQuantity }`, or `null` for zero fills. Divide this ratio only for display; it never feeds settlement. All intermediate products use `BigInt`, and receiving balances are checked for overflow before returning a transition.

Failures return only `ok: false`, a stable `code`, and field-specific `issues`; no partial fills or state escape. Codes are `INVALID_BUY_STATE`, `INVALID_ORDER`, `ROUND_MISMATCH`, `MARKET_CLOSED`, `PLAYER_NOT_IN_ROUND`, `INSUFFICIENT_CASH`, `QUOTE_GENERATION_EXHAUSTED`, and `UNSAFE_SETTLEMENT`. Paths refer to the command for order failures and the state for state/integrity failures. Neither input is mutated; retrying identical inputs yields identical output, but the caller must enforce request idempotency before applying output again.

```sh
pnpm test packages/engine/test/protected-buys.test.ts
pnpm check
```

The buy tests cover AC-03's exact example, the underfunded-buy portion of AC-04, engine input/status rejection in AC-05, full/partial/zero protection outcomes in AC-06, and the engine conservation/reservation portions of AC-08 and AC-16. They include exhausted inventory, stale protection, deterministic tie ordering, frozen custom settings, numeric boundaries, atomic failure, and 500 seeded commands across both players and all four assets. Service serialization, database atomicity/recovery, browser trading, and a complete playable round remain unverified by these pure tests.
