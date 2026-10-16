# Persistence and event model

Read when changing database schemas, migrations, event types, projections, transactions, idempotency, conservation invariants, or replay.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §8, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For engine state changes, read [market engine](market-engine.md). For restart, ownership locks, and snapshots, read [API and recovery](api-and-recovery.md). For event/job atomicity and worker permissions, read [events and narration](events-and-narration.md).

Verification: AC-02–AC-04, AC-07–AC-09, AC-11, AC-12, AC-14–AC-16. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 8. Persistence and event model

| Entity | Required information |
| --- | --- |
| GuestSession | Player ID, hashed secret, expiry; no raw credential in logs |
| Room | ID/code, host, current round, status |
| Round | Participants, seed, rules/config version, open/close times, status |
| PlayerRoundState | Cash, holdings, connection metadata, projection sequence |
| AssetRoundState | Initial price, reference price, last price, quote generation |
| Order | Request ID, player, side, symbol, quantity, protection, outcome |
| Trade | Buyer/seller IDs, symbol, quantity, unit price, order ID, sequence |
| GameEvent | Round ID, sequence, schema version, type, payload, cause ID, timestamp |
| ScheduledEvent | Due time, catalog ID, fixed effects, applied event ID |
| CommentaryJob | Source event, status, attempts, next attempt time, lease |
| NewsItem | Structured facts, fallback copy, optional generated copy, provenance |
| RoundResult | Frozen marks, player values, shared ranks, settlement sequence |

Representative event types: `RoundOpened`, `OrderAccepted`, `TradeExecuted`, `OrderCompleted`, `OrderRejected`, `ReferencePriceAdjusted`, `QuotesRebuilt`, `MarketEventApplied`, `CommentaryPublished`, `RoundSettled`, and `RoundAborted`. Lifecycle changes also have persisted records. High-volume transient reactions/presence are separate from the market event stream.

Persist valid trading attempts and their outcomes. Malformed and rate-limited transport requests belong in bounded operational logs rather than an unbounded market event log.

### Atomicity and invariants

- A unique constraint on `(roundId, playerId, requestId)` enforces order idempotency. The same request ID with different content returns `IDEMPOTENCY_CONFLICT`.
- Commit the order outcome, fills, balance changes, asset changes, events, and resulting projection sequence in one database transaction.
- A market event's state effects and commentary-job creation commit together.
- Sequence numbers are unique and increasing within a round. Event batches are applied in order; clients never render half a settlement batch.
- Cash and holdings cannot become negative. Bot quote reservations must be covered.
- Total cash and each asset's total units across humans and the bot are conserved after initial round funding. Reference-price changes do not create cash or units.
- Final results are written once and cannot be changed by later commentary or reactions.
- A committed event stream plus its initial configuration reconstructs authoritative market state. Mutable projections are replaceable accelerators.

### Durable trading storage (ticket #10 stage)

Migration 5 adds immutable `orders` keyed by round/player/request, storing canonical public content, original private outcome, commit sequence, and authoritative processing time. Immutable `trades` link each fill to its source event and owned order. These records commit with the complete engine batch, ledgers/assets in the projection, and room visibility sequence. Replay validates every derived order, fill and stored public view against deterministic history. Closed attempts in this stage have no engine receipt or batch: their zero-fill outcome is validated against its committed state anchor and the frozen close deadline.

`round_batches.public_view` stores the batch's verified public view in the same transaction, avoiding historical replay for each recipient. Pre-migration batches retain a reconstruction fallback. An owned state cache accepts generated states only after commit, invalidates on failed transactions or ownership/database loss, and compares its projection on reads. Startup and readiness still verify full immutable history and derived records. The cache is an accelerator; it does not replace committed history.

Quote freshness follows the latest committed `QuotesRebuilt` event, including when older batches have no public views. A historical settlement immediately after a batch with a null public view may contain the opening timestamp instead; recovery verifies that exact legacy encoding against the complete replayed public view, allowing only that timestamp discrepancy. It preserves the stored batch and immutable results, derives the correct timestamp for delivery, and still rejects every other disagreement with history.

### Bounded live projections and publication (ticket #21)

Live engine projections use storage schema version 2 and omit historical receipts; immutable orders and batches retain every original identity and outcome. The owned service checks durable idempotency before executing a new command. Full recovery verifies every batch, receipt, fill, public view and final result and reconstructs the complete receipt history. Version-1 projections remain readable and are rebuilt from verified history into version 2. Every owned read still compares the replaceable projection with committed cached state; rollback, ownership loss and database failure invalidate the cache. This storage version does not change frozen gameplay rules.

Recovery retains only the ledger anchors needed to verify original outcomes, instead of copying accumulated receipts into every intermediate state. Public persistence reads still return the full verified history. No receipt is discarded from durable storage or excluded from integrity verification.

### Immutable closing storage (ticket #11 stage)

Migration 6 adds immutable `round_results`, keyed by round and linked to its settlement event sequence. Frozen public marks/ranks/display names/timeline and all private final portfolios commit with the settlement batch, projection, lifecycle transitions, and room visibility. Replay verifies result arithmetic and private portfolios against history; delivery selects only the authenticated owner's portfolio. Results cannot be updated or deleted and remain recorded after lobby reset.

Immutable `round_aborts` stores a safe terminal explanation independently of an unverifiable market stream, preserving damaged evidence instead of inventing a replayable batch. Integrity recovery rolls back unsafe work before recording the abort in another owned transaction. Aborted snapshots do not read the corrupt projection or declare winners. Temporary database/ownership loss prevents all writes until safe recovery.

### Owned history recovery (ticket #13 stage)

The room owner verifies versioned initialization metadata, frozen configuration, every complete engine batch and event, durable order outcomes/fills, public views, scheduled news/job inputs, and immutable final results before rebuilding `round_projections`. Missing, malformed, stale, or damaged mutable projections are replaced transactionally from that verified history; recovery never refunds or reinitializes resources or reads current defaults for an existing round. Other derived immutable records remain evidence and must agree with replay. Unverifiable history is retained and safely aborted without a winner; trading commands cannot return unverified outcomes from an aborted round. An existing final result is never replaced with an abort.

Startup acquires exclusive database ownership, verifies and rebuilds active state, clears obsolete process presence, and drains overdue pre-close events and settlement before exposing a service listener. Owned reads also repair damaged projections, including historical participant results after lobby reset. A failed transaction invalidates the state cache; database/ownership loss disables the old owner. Recovery after connection or ownership loss requires reopening the store under a newly acquired lock, normally by restarting the service. No transaction helpers or test fault controls are exposed to browsers.

### Leased commentary storage (ticket #17 stage)

Migration 7 adds append-only attempt provenance, immutable commentary publications and a delivered-news view that preserves original authored items. New jobs freeze versioned approved inputs when the event applies: affected fictional assets, actual reference effects, initial/last-executed prices and aggregate executed activity since the preceding event or opening. Recorded sequence boundaries disambiguate overdue events sharing an application time. Recovery verifies these inputs against immutable batches; legacy inputs remain readable and use fallback.

The restricted NOLOGIN role can execute only schema-scoped claim/completion functions. Claims lock with `SKIP LOCKED`, consume at most two attempts and establish a 15-second fenced lease. Timeout/unavailable outcomes retry after one second; disabled/invalid outcomes retain fallback. Completion atomically records provenance/output only for the current unexpired token. Abandoned final leases become fallback on a subsequent poll. The owner commits each publication once by source ID and retries publication independently of generation. The role cannot read private state or change inputs, market data or immutable results. See the worker setup guide (`docs/commentary.md`) for provisioning and independent process commands.
