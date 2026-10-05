# Ticket #6: deterministic engine evidence

Scope: [GitHub #6](https://github.com/Kenneth882/DinoPump/issues/6),
[local ticket](../spec/tickets/06-deterministic-engine-replay.md), existing frozen
rules `1.1`. No gameplay requirement or rules version changes.

Requirements: [round lifecycle §4](../spec/round-lifecycle.md),
[market engine §5](../spec/market-engine.md), [persistence §8](../spec/persistence.md),
[events §10](../spec/events-and-narration.md),
[acceptance §12](../spec/verification.md),
[milestone 2 §13](../spec/implementation.md). `PROJECT_SPEC.md` remains the complete
reference; no source requirement text was changed.

## Public validation boundaries

The user confirmed tests through the public engine command, recorded-batch replay,
portfolio ranking, and shared runtime contract boundaries. Tests use synthetic
rounds and participants. Existing quote, buy, and sell tests remain part of the
engine milestone gate.

| AC    | Engine evidence                                                                                                                                                                                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-03 | Existing protected-buy tests retain the exact 150-unit/D$6,080 fill. The round command test verifies the same complete recorded outcome.                                                                                                                                                                                                                     |
| AC-04 | Existing buy/sell tests verify exact transfers, full-request funding/holdings checks, exhausted liquidity, and no overselling. Rejected sell receipts remain rejected after a later buy.                                                                                                                                                                     |
| AC-05 | Existing invalid input/status tests plus command, foreign round/player, time, unsupported narration, corrupt projection and event-version validation. Authentication remains a service gate.                                                                                                                                                                 |
| AC-06 | Existing protection tests plus a seeded round containing full, partial, zero-fill, underfunded and oversell outcomes.                                                                                                                                                                                                                                        |
| AC-07 | Original outcomes/fills survive retries, rejected-attempt retries, changed payload conflicts, independent player identities, JSON reconstruction and replay. No additional batch/fills on duplicates.                                                                                                                                                        |
| AC-08 | Existing 500-buy and 1,000-mixed-order stress cases plus 300 ordered round commands preserve exact cash/unit totals, nonnegative balances and covered reservations.                                                                                                                                                                                          |
| AC-09 | All nine recorded effects apply once, in order; early/out-of-order/unknown effects reject. Multi-symbol shocks cover half-up boundaries, both clamps, unchanged idle marks and immutable funding.                                                                                                                                                            |
| AC-11 | Explicit close boundary, required catch-up, frozen final marks/values/sequence, shared ranks, join-order display, immutable results on retries/late orders, and abort without a winner.                                                                                                                                                                      |
| AC-12 | JSON round-tripped opening, commands, scheduled effects, settlement and abort replay deterministically. Entire final state equality includes ledgers, references, marks, quote IDs/generations, reservations, receipts and results. Corrupted, reordered, duplicate and incomplete batches reject. Replay succeeds with wall-clock and random APIs disabled. |
| AC-16 | Existing quote and settlement boundary cases plus reservations/conservation throughout the replay sequence, safe valuation and event-sequence overflow rejection.                                                                                                                                                                                            |

## Reproduce

```sh
pnpm test packages/engine/test/round-engine.test.ts
pnpm typecheck
pnpm check
```

## Evidence limits

These checks establish the pure-engine portion of milestone 2 (AC-03–08 and
AC-16) when the repository gate passes. They do not establish service concurrency,
authentication, database transaction atomicity/unique constraints, crash recovery,
real timers, restart catch-up, public/private broadcast filtering, browser journeys,
LLM availability, or full milestone 3/release acceptance. The new engine batch
contract requires a future persistence adapter to retain the command and complete
facts together; no database schema or service API is changed here.

## Recorded run — October 4, 2026

- New public-boundary suite: 21 tests passed, including a 300-command seeded
  round and all nine effects. TDD slices were observed failing before the related
  behavior was implemented; regression/boundary cases supplement those slices.
- `pnpm typecheck`: passed during implementation and at the repository gate.
- `pnpm check`: lint, formatting and typechecking passed. Its restricted test
  run passed 189/190 tests; the existing real-HTTP integration test could not bind
  `127.0.0.1` (`EPERM`).
- `pnpm test && pnpm build`, rerun with localhost access: all 190 tests passed
  across six files, followed by successful production builds of all packages/apps.
  This confirmed the restricted failure was environmental.
- Final `pnpm check` after the review refactor, with localhost access: passed
  lint, formatting, typechecking, all 190 tests, and all production builds.
- Independent Standards and Spec reviews against `3614078`: no remaining
  findings. The Standards review suggested sharing reference adjustment arithmetic;
  `adjustReferencePrice` now serves both order impacts and scheduled effects.
  Follow-up review confirmed equivalent arithmetic and resolution of that smell.
- Local links in changed documentation resolve. The complete reference and
  focused requirement text are unchanged.

This completes the milestone 2 pure-engine gate. Service/browser portions of
these ACs remain subject to the limits above.
