# 3: Generate covered deterministic bot quote ladders

GitHub issue: [#3](https://github.com/Kenneth882/DinoPump/issues/3). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Given a frozen baseline and current finite bot resources, the pure engine produces executable bid/ask ladders with deterministic ordering and fully covered reservations.

## Scope and specification

Milestone 2; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §7, §8, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [architecture](../architecture.md), [persistence](../persistence.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-02, AC-08, AC-16. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Initialize one bot with 1,000,000,000 cash cents and 100,000 units of each asset, using round-frozen defaults.
- [ ] Produce three levels per side, up to 100 units each, at 100/200/300 basis-point offsets using integer ask ceiling and bid floor.
- [ ] Discard prices outside 100–1,000,000 cents, keep bids below asks, and allow an empty side at bounds or exhausted resources.
- [ ] Allocate covered bid reservations across all assets in symbol order then best-to-worst quote; ask reservations never exceed holdings.
- [ ] Replacing ladders releases old reservations first; quote IDs, generations, and tie ordering are deterministic.
- [ ] Expose a framework-independent input/output contract that callers can verify without a database, browser, wall clock, randomness, or AI.

## Validation

Pure tests cover all four initial ladders, price bounds, equal-price ordering, tiny cash/holdings, cross-asset exhaustion, repeated replacements, and reproducible generation IDs. Run seeded conservation/reservation checks and pnpm check.

## Blocked by

Blocked by: #1.

- [#1](https://github.com/Kenneth882/DinoPump/issues/1): Show the canonical four-asset market baseline
