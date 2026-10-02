# 5: Execute protected sells without overselling

GitHub issue: [#5](https://github.com/Kenneth882/DinoPump/issues/5). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

A player can sell owned whole units into the highest eligible bot bids and receive exact proceeds, while insufficient holdings or exhausted liquidity cannot create balances or fills.

## Scope and specification

Milestone 2; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §7, §8, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [architecture](../architecture.md), [persistence](../persistence.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-04, AC-05, AC-06, AC-08, AC-16. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Require holdings for the full requested quantity even when a partial fill is expected; reject overselling without ledger effects.
- [ ] Consume highest eligible covered bids, preserve quote ordering within equal prices, and never execute below the submitted minimum.
- [ ] Transfer finite bot cash and human units atomically; support full, partial, and NO_LIQUIDITY_WITHIN_PROTECTION outcomes.
- [ ] Apply -10 basis points to reference once after a filled sell, round half-up and clamp, then rebuild quotes; update last price only on fills.
- [ ] Use the same complete outcome/event contracts as buys, with no shorting, borrowing, autonomous bot trades, fees, or replenishment.

## Validation

Pure tests exercise buy-then-sell, exact multi-level proceeds, overselling, conservative holdings checks, protection limits, exhausted bot cash, and price bounds. Seed mixed buy/sell commands to verify cash/unit conservation and nonnegative balances; run pnpm check.

## Blocked by

Blocked by: #4.

- [#4](https://github.com/Kenneth882/DinoPump/issues/4): Execute protected buys atomically in the engine
