# 13: Recover committed rounds safely after service crashes

GitHub issue: [#13](https://github.com/Kenneth882/DinoPump/issues/13). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

After the game service restarts, it reconstructs the committed round, catches up missed events and closing exactly once, and accepts commands only when it safely owns the room.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §7, §8, §9, §10, §11, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-14, AC-15, AC-16. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Rebuild all authoritative market state and immutable rankings from committed versioned events plus frozen initial configuration; projections may be discarded/rebuilt.
- [ ] Acquire exclusive database room ownership and remain unready/nonwriting until replay and due work finish; two processes never concurrently mutate a room.
- [ ] Recover original durable order outcomes across restart and reject changed retries with IDEMPOTENCY_CONFLICT.
- [ ] After restart, apply missed events in recorded due-time order; if close passed, apply only events due strictly before it and settle once. Outages never extend round deadlines.
- [ ] Handle precommit crashes as no committed trade and postcommit/prebroadcast crashes through snapshot/sequence recovery with no duplicated fills or publication of partial batches.
- [ ] Database or ownership loss immediately stops commands/trading until safe recovery; unrecoverable integrity failure records ABORTED without a winner.
- [ ] Record service milestone evidence for AC-01–02, AC-07–12 and AC-14–15, identifying any client/journey evidence still pending.

## Validation

Use isolated PostgreSQL/process integration fault tests that terminate before commit, after commit/before broadcast, during scheduler commit and during settlement. Restart before/multiple missed deadlines/after close; run two service processes and simulate DB/ownership loss. Compare replayed ledgers/prices/quotes/rankings exactly and run pnpm check plus recovery suite.

## Blocked by

Blocked by: #11.

- [#11](https://github.com/Kenneth882/DinoPump/issues/11): Close rounds once, show results, and return to the lobby
