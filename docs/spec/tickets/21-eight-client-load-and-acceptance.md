# 21: Record an eight-client round and the complete acceptance gates

GitHub issue: [#21](https://github.com/Kenneth882/DinoPump/issues/21). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

A reproducible eight-client load run and recorded full no-key round demonstrate the MVP's performance, conservation, recovery, and player-journey targets with auditable evidence.

## Scope and specification

Milestone 6; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §4, §5, §6, §8, §9, §10, §11, §12, §13.

Focused requirements: [product and scope](../product-and-scope.md), [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Run eight connected synthetic participants with up to five submitted orders/player/second in the deployment-region test environment and record environment, command mix and duration.
- [ ] Demonstrate acknowledgement p95 <300ms excluding client internet latency, commit-to-connected-client delivery p95 <500ms, snapshot <1s and healthy scheduler lag ≤1s.
- [ ] Record an end-to-end ten-minute round without an LLM key, with nine events, full results and consistent clients; verify no negative balances, duplicated fills or conservation violations.
- [ ] Execute the engine, database atomicity/replay/crash/restart, ownership and two-browser/360px suites against their exact AC IDs.
- [ ] Publish an AC-01–18 evidence matrix with runnable commands, actual results and material limitations; empty or unrun tests cannot be marked passing.
- [ ] Fix failures within baseline scope or identify a concrete blocker; do not weaken targets or declare release readiness without passing gates.

## Validation

Run pnpm check, the full isolated integration/recovery/narration suites, desktop/360px Playwright and the reproducible eight-client load harness. Compare event replay with final projections/results and record measured distributions plus no-key evidence.

## Blocked by

Blocked by: #19, #20.

- [#19](https://github.com/Kenneth882/DinoPump/issues/19): Verify the complete accessible player journey at 360px
- [#20](https://github.com/Kenneth882/DinoPump/issues/20): Measure safe operation and surface service health
