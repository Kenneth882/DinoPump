# 8: Ready players and open a funded authoritative round

GitHub issue: [#8](https://github.com/Kenneth882/DinoPump/issues/8). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

At least two connected ready guests let the host start a visible five-second countdown that locks participants and atomically opens a ten-minute round with exact starting resources.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §6, §7, §8, §9, §10, §11, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-01, AC-02, AC-05, AC-08, AC-10, AC-14. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Wire acknowledged room:ready and host-only round:start through validated contracts and the lobby UI; duplicate starts cannot fund twice.
- [ ] Require the specified two connected ready players; lock joining and the participant list during COUNTDOWN, returning to LOBBY if fewer than two remain connected before opening.
- [ ] Acquire database ownership and serialize room mutations before lifecycle writes; a second process cannot operate the room, and database/ownership loss disables writes and readiness.
- [ ] Commit participants, new round ID/seed/frozen rules, exact human/bot ledgers, four asset states, full recorded schedule, initial quotes and RoundOpened batch atomically.
- [ ] Synchronize displayed countdown/open/close deadlines with server time; expose GET /healthz for liveness and GET /readyz for safe service readiness.
- [ ] Reject new open-round participants while existing locked participants can reconnect; host status adds no trading privilege.
- [ ] Retain disconnected participants and continue an open round even with no connections; do not liquidate or refund on disconnect.

## Validation

Database fault injection before opening commit leaves no partial funding; retry start initializes exactly once. Service tests cover permission/readiness/countdown boundaries, participant locking, two-process ownership, and DB/lock loss. Two browsers ready and observe identical opening balances and ladders; run pnpm check and targeted E2E.

## Blocked by

Blocked by: #6, #7.

- [#6](https://github.com/Kenneth882/DinoPump/issues/6): Replay engine commands, events, and portfolio marks deterministically
- [#7](https://github.com/Kenneth882/DinoPump/issues/7): Create guest sessions and a shared eight-player lobby
