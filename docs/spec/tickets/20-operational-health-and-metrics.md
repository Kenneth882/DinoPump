# 20: Measure safe operation and surface service health

GitHub issue: [#20](https://github.com/Kenneth882/DinoPump/issues/20). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Operators can distinguish live from ready services, detect ownership/database/scheduler/narration problems, and measure committed order and realtime latency without logging credentials.

## Scope and specification

Milestone 6; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §7, §8, §9, §10, §11, §12, §13.

Focused requirements: [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-05, AC-08, AC-10, AC-14, AC-15, AC-18. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Expose structured safe room/round/request/sequence/job logs and metrics for connections, order latency/rejections, scheduler lag, database failures and narration failures.
- [ ] Measure acknowledgement latency, commit-to-client delivery and snapshot duration at the specified boundaries; preserve existing rate limits and reject excess before engine work.
- [ ] Verify /healthz versus /readyz during startup/replay, DB failure, ownership loss and safe recovery; no unhealthy service accepts trades.
- [ ] Bound malformed/rate-limited operational logs, redact cookies/secrets/provider keys, and retain no raw guest credential in transport/debug fixtures.
- [ ] Document operator interpretation and recovery procedures for unhealthy dependencies, lock loss and ABORTED rounds without adding multi-room/Redis infrastructure.
- [ ] Keep optional narration faults separately observable and unable to delay deterministic scheduled effects.

## Validation

Integration tests assert readiness/write gating through DB/ownership faults and recovery, metric boundaries/counters, rate-limit behavior and synthetic-secret redaction. Exercise provider outage separately from scheduler health; run pnpm check and operational integration suite.

## Blocked by

Blocked by: #13, #18.

- [#13](https://github.com/Kenneth882/DinoPump/issues/13): Recover committed rounds safely after service crashes
- [#18](https://github.com/Kenneth882/DinoPump/issues/18): Add bounded, fact-checked optional AI narration
