# 9: Apply nine scheduled events with immediate Daily Roar news

GitHub issue: [#9](https://github.com/Kenneth882/DinoPump/issues/9). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

An open round receives its nine recorded market shocks on time, changes executable quotes, and immediately shows factual template news even with no commentary worker or API key.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §3, §4, §5, §6, §8, §9, §10, §11, §12, §13.

Focused requirements: [game content](../game-content.md), [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-09, AC-10, AC-13, AC-14, AC-15. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Consume persisted due times at 60,120,…,540 seconds exactly once; never create a market event at the 600-second closing boundary.
- [ ] Before any market-changing player command, apply already-due recorded events in due-time order using authoritative server time.
- [ ] Commit effects, reference/quote updates, sequence batch, factual NewsItem and CommentaryJob together; a failure commits none of them.
- [ ] Publish the factual template immediately after commit via ordered market/news updates; no provider call runs in the scheduler or delays an effect.
- [ ] Display structured facts and unchanged last-trade marks alongside new quotes; one source event creates one news item.
- [ ] Keep due processing independent of connections and reject unsafe writes on ownership/database loss; healthy scheduler lag must be measurable against the one-second target.

## Validation

Use fake authoritative time with real PostgreSQL to cover all nine deadlines, repeated scheduler ticks, multi-symbol effects, command/due-event races, rollback between effect and job creation, and no close-time event. Browser checks verify immediate news with no worker/key and unchanged last price for an idle market; run pnpm check and targeted integration/E2E.

## Blocked by

Blocked by: #8.

- [#8](https://github.com/Kenneth882/DinoPump/issues/8): Ready players and open a funded authoritative round
