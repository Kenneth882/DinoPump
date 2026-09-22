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
