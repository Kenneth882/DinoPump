# Bot quote engine

Ticket [#3](https://github.com/Kenneth882/DinoPump/issues/3) implements the quote-generation portion of [market rules §5](../../docs/spec/market-engine.md), with engine evidence for AC-02, AC-08, and AC-16. Orders, settlement, persistence, and scheduling remain later tickets.

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
