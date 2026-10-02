# 10: Place durable protected trades from a minimal trade ticket

GitHub issue: [#10](https://github.com/Kenneth882/DinoPump/issues/10). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

An authenticated round participant buys or sells from a minimal browser ticket, receives their private committed outcome, and sees shared market changes exactly once despite concurrent submissions or lost acknowledgements.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §6, §8, §9, §11, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-10, AC-14, AC-16, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Wire acknowledged order:submit to the owned serialized processor; derive identity from the session and validate membership, round, quantities, protection and request identity.
- [ ] Apply five orders/second/player with burst ten before engine work; malformed/rate-limited transport requests use bounded safe logs while valid trading attempts and outcomes are persisted.
- [ ] Atomically commit outcome, fills, human/bot ledgers, asset state, events and projection sequence; enforce unique round/player/request identity and IDEMPOTENCY_CONFLICT for changed content.
- [ ] Process due scheduled effects first and reject at or after closesAt; never widen the client's fixed submitted price protection.
- [ ] Broadcast complete public start/end sequence envelopes after commit only; send private holdings/order outcomes solely to their owner, with public trade activity and portfolio totals.
- [ ] Provide buy/sell selection, whole quantity, quote age/estimate and default 5% protection, plus filled/partial/rejected/pending results including executed total and average price.
- [ ] Disable repeated submission for a pending request; timeouts reuse its original request ID and payload, and disconnected/unsynchronized/closed clients cannot trade.

## Validation

Repeat AC-03/04/06 through the API and real database; test eight concurrent synthetic participants, rejection invariants and rate bursts. Inject failure before commit and after commit/before acknowledgement/broadcast, retry the same ID, and verify one outcome/fill batch. Use two browser contexts to verify private/public visibility and ticket results; run pnpm check and targeted integration/E2E.

## Blocked by

Blocked by: #9.

- [#9](https://github.com/Kenneth882/DinoPump/issues/9): Apply nine scheduled events with immediate Daily Roar news
