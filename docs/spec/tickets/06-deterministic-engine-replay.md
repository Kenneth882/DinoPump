# 6: Replay engine commands, events, and portfolio marks deterministically

GitHub issue: [#6](https://github.com/Kenneth882/DinoPump/issues/6). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

The pure engine can apply recorded scheduled effects and ordered trading attempts, reproduce an entire seeded market state, and compute identical live/final portfolio values and shared ranks.

## Scope and specification

Milestone 2; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §8, §10, §12, §13, §15.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [persistence](../persistence.md), [events and narration](../events-and-narration.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-07, AC-08, AC-09, AC-11, AC-12, AC-16. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Define versioned deterministic reducers/events covering round funding, accepted/rejected/completed orders, fills, reference adjustments, quote replacements, scheduled effects, settlement and abort.
- [ ] Apply only recorded affected-symbol basis-point effects, round/clamp references, rebuild all quotes, and leave last-trade marks unchanged when no trade occurs.
- [ ] At the engine command boundary, repeated round/player/request identity returns the original outcome; changed content yields IDEMPOTENCY_CONFLICT. Durable retry enforcement remains a later service gate.
- [ ] Compute portfolio value from cash plus holdings at latest completed trade or initial marks; bots are excluded, ties share rank, and join order only stabilizes display.
- [ ] Replay depends only on initial configuration plus recorded inputs/events, never fresh random choices, clocks, mutable global configuration, or narration.
- [ ] Complete the engine-level milestone gate for AC-03–08 and AC-16; distinguish the pure gate from service concurrency/restart evidence.

## Validation

Run seeded command/event sequences and compare all ledgers, reference/last prices, quote generations/reservations and rankings after replay. Test duplicate identities, changed payloads, half-up boundaries, multi-symbol events, idle marks and ties. Record the engine milestone evidence and run pnpm check.

## Blocked by

Blocked by: #5.

- [#5](https://github.com/Kenneth882/DinoPump/issues/5): Execute protected sells without overselling
