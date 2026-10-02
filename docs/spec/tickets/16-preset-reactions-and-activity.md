# 16: Send approved reactions and show public player activity

GitHub issue: [#16](https://github.com/Kenneth882/DinoPump/issues/16). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Players can send the approved dinosaur reactions and see public executed-trade activity without free-text chat, private order details, or market-state effects.

## Scope and specification

Milestone 4; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §2, §6, §8, §9, §11, §12, §13.

Focused requirements: [product and scope](../product-and-scope.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-05, AC-10, AC-11, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Provide runtime-validated approved reaction identifiers and acknowledged reaction:send behavior for authorized room members.
- [ ] Enforce one reaction/second/player before publication; reject unapproved/free-text inputs and unauthorized/expired sessions with safe stable errors.
- [ ] Display prescribed reactions and public executed player activity using server-validated facts, without exposing private requests/holdings or credentials.
- [ ] Keep high-volume transient reactions separate from the market event stream; reactions never change marks, balances or frozen rankings.
- [ ] Make reaction controls keyboard accessible and restrained under reduced-motion preferences; do not turn every transient update into a screen-reader announcement.

## Validation

Service tests cover rate limits, identifiers, ownership and expiry; two-browser E2E verifies permitted shared reactions/activity and unchanged market/results hashes. Run pnpm check and targeted E2E.

## Blocked by

Blocked by: #12.

- [#12](https://github.com/Kenneth882/DinoPump/issues/12): Resynchronize clients and reconcile pending trades
