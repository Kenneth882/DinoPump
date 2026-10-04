# 4: Execute protected buys atomically in the engine

GitHub issue: [#4](https://github.com/Kenneth882/DinoPump/issues/4). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

A human buy consumes the cheapest eligible bot asks, returns a complete full/partial/zero-fill outcome, and transfers exact cash and units without violating price protection.

Implementation sequence: [ticket 4 plan](ticket-plans/04-protected-engine-buys-plan.md).

## Scope and specification

Milestone 2; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §7, §8, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [architecture](../architecture.md), [persistence](../persistence.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-03, AC-05, AC-06, AC-08, AC-16. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Validate engine inputs, whole quantities 1–500, known assets, valid integer protection prices, matching round and OPEN status with stable outcomes.
- [ ] Require the full requested quantity times maximum unit price in available cash before any fills; no self-trading or invented resources.
- [ ] Execute against fixed quotes for this order, cheapest first and deterministic tie order, at each resting quote price.
- [ ] Produce all fill/ledger/reference/quote changes as one complete deterministic result; rejected and zero-fill orders leave ledgers unchanged.
- [ ] After fills, update last price to the latest fill and move reference +10 basis points once per order using half-up rounding and clamping, then rebuild covered quotes.
- [ ] Return filled/remaining quantity, executed total, and volume-weighted average price; partial remainder is cancelled and never rests.

## Validation

Reproduce AC-03 exactly: 150 units at 4,040/4,080 cents cost 608,000 cents and leave 392,000 cash under 4,100-cent protection. Test conservative underfunding, stale protection, full/partial/zero fills, invalid values, closed rounds, and conservation; run pnpm check.

## Blocked by

Blocked by: #3.

- [#3](https://github.com/Kenneth882/DinoPump/issues/3): Generate covered deterministic bot quote ladders
