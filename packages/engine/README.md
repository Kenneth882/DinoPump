# Market engine

Tickets [#3](https://github.com/Kenneth882/DinoPump/issues/3), [#4](https://github.com/Kenneth882/DinoPump/issues/4), and [#5](https://github.com/Kenneth882/DinoPump/issues/5) implement quote generation and protected buys/sells from [market rules §5](../../docs/spec/market-engine.md). Persistence and scheduling remain later tickets.

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

## Protected sells

`executeSell(state, command)` uses the same complete transition boundary as buys. `SellState` shares the validated `BuyState` shape, and either command's committed output can be the next command's input. `SellCommand` uses `side: "sell"`; `protectionPriceCents` is a fixed minimum. `SellResult` shares the buy outcome and issue shapes, with the human as seller and `system:bot` as buyer in every fill. These schemas/types are exported from `@dinopump/contracts`.

A sell requires holdings for the entire requested quantity before matching, including when only a partial fill could execute. Covered bids execute highest price first, then creation sequence and stable ID, at resting prices without widening protection. Settlement transfers the bot's existing cash to the seller and the seller's units to the bot. A filled sell moves reference down by the frozen impact (10 basis points by default), once per order, using exact half-up rounding and clamping; last price becomes the latest fill. Every completed order rebuilds quotes, including zero fills. There is no shorting, borrowing, fee, or replenishment.

Sell failures use `INVALID_SELL_STATE` and `INSUFFICIENT_HOLDINGS` in place of the buy-specific state/cash codes; other failure codes and atomicity guarantees are shared. Authentication, command serialization, request idempotency, event envelopes/sequences, database commit and broadcast remain the service's responsibility. The engine returns all facts needed for the same order/trade/reference/quote event batch as buys; it does not persist or emit events.

```sh
pnpm test packages/engine/test/protected-sells.test.ts
pnpm check
```

Sell tests support AC-04, AC-05, AC-06, AC-08, and AC-16 at the engine boundary: exact multi-level proceeds and buy→sell settlement; conservative oversell rejection; stable invalid-input/closed-round errors; full/partial/zero outcomes and stale protection; tie priority; exhausted bot cash; frozen limits and reference impact; half-up rounding, clamping, safe integer arithmetic, and atomic failure. A 1,000-command seeded mixed buy/sell run verifies deterministic output, immutable inputs, nonnegative balances, cash/unit conservation, and covered reservations across both players and all assets. These tests do not establish authentication, concurrent service serialization, database recovery, browser trading, or full milestone acceptance. The implementation uses existing rules `1.1` without changing gameplay requirements or upgrading active rounds.

## Round commands, marking, and replay (#6)

Use the following public boundary for complete round transitions. The low-level
`executeBuy`/`executeSell` functions above remain available; this wrapper adds
in-memory request idempotency and versioned, ordered event batches. It implements
existing rules `1.1` without changing gameplay or upgrading frozen rounds.

- `startEngineRound(frozenRound)` consumes the validated funding and recorded
  schedule from ticket #2. It returns an `OPEN` projection and a complete
  `RoundOpened`/`QuotesRebuilt` batch. Sequence 1 remains the existing persisted
  `RoundInitialized` record; opening starts at sequence 2. The caller invokes
  opening only when its authoritative clock permits it.
- `processEngineCommand(state, command)` accepts `SubmitOrder`,
  `ApplyScheduledEvent`, `SettleRound`, or `AbortRound`. Each includes `atMs`,
  supplied by the authoritative service. The engine never reads a clock.
  `OpenRound` is recorded only by `startEngineRound`, not accepted again on a
  current projection.
- `getPortfolioRankings(state)` marks each human's holdings at the latest fill
  price (initial prices before any fill). It uses exact integer value calculations,
  excludes the bot, and returns portfolio value, profit, display-only return
  percentage, and shared competition ranks (`1, 1, 3`). Join order stabilizes
  display only. Unsafe values return `UNSAFE_VALUATION`.
- `reduceEngineBatch(state, batch)` applies a complete recorded batch atomically.
  `replayEngine(frozenRound, batches)` reconstructs from opening through the last
  complete committed batch. Both reject unsupported, reordered, incomplete,
  duplicate, or altered batches with `INVALID_REPLAY` and no partial state.

`EngineState`, commands, facts, batches, errors, rankings, and final results have
shared runtime schemas in `@dinopump/contracts`. Projection validation checks
frozen rules/participants, safe resources, conservation, covered reservations,
unique receipt identities, and terminal status consistency. Only use returned,
committed projections as future inputs; use replay to validate history rather
than treating a structurally valid projection as proof of provenance.

A successful command returns `{ ok: true, state, batch, receipt }`. A rejected
**trading attempt** is still a successfully processed command: its receipt has
`result.ok: false`, and its batch records `OrderRejected`. A matched order records
`OrderAccepted`, ordered `TradeExecuted` facts, its reference adjustment when
filled, quote replacement, and `OrderCompleted`. Malformed commands and commands
with foreign round/player identity return a top-level error without a batch.
The caller must derive player identity from authentication; these are internal
commands, not browser payloads.

Receipts retain the normalized order and its original outcome/fills, without a
historical full-state copy. The `(roundId, playerId, requestId)` identity is checked
before time/status handling. An identical retry returns the original receipt,
current state, and `batch: null`; changed content returns
`IDEMPOTENCY_CONFLICT`. Retrying an earlier rejected attempt never rematches it.
Different players can use the same request ID independently. Replay reconstructs
these receipts, enabling the same pure retry behavior after reconstruction;
durable uniqueness and transactional retry enforcement remain service work.

Scheduled commands contain only a recorded schedule ID, never replacement
shocks or generated prose. Effects apply in recorded order, exactly once, with
integer half-up rounding and clamping. All quotes rebuild, including unaffected
symbols, while last-trade marks and ledgers stay unchanged. Duplicate applied
IDs return `batch: null`. Commands cannot move authoritative time backwards.
New orders return `EVENTS_DUE` if a recorded effect is due. At/after close an
open round rejects new orders with `MARKET_CLOSED`: the caller must catch up all
pre-close effects, settle, then submit the attempt to record its closed-market
receipt. Catch-up may use a time after close; it never extends the round.

Settlement requires the closing deadline and the complete pre-close schedule.
It freezes marks, values, shared ranks, and settlement sequence in `finalResult`.
The transition to `FINISHED` is atomic (no partially visible settling projection).
Settlement retries are no-ops, and later order rejections preserve final results.
Abort produces `ABORTED` with a reason and no final result/winner; a terminal round
cannot be changed by another terminal transition. Narration is not an accepted
engine command.

Persist the **whole batch including its command** and resulting projection in one
transaction, then broadcast filtered public/private views after commit. Each fact
carries schema version 1, round ID, sequence, cause ID and recorded time. These
are internal engine facts: persistence assigns durable event IDs and maps logical
causes to its storage envelope. The database adapter is not added by this ticket.
Replay reduces recorded commands using the frozen version's engine and compares
all resulting facts before exposing state, so matching/settlement has one source
of truth. Retain rules-version implementations for historical replay. JSON object
key order is immaterial; array/event order is authoritative.

The engine performs no persistence, authentication, scheduling timers, network
I/O, randomness, or narration. The service still owns serialization, due-event
catch-up, opening/closing clock authority, transaction boundaries, durable retries,
event-ID mapping, visibility filtering and restart orchestration.

See [ticket #6 validation evidence](../../docs/validation/ticket-6-engine.md)
for acceptance coverage and the remaining service/browser gates.
