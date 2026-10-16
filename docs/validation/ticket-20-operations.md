# Ticket #20: operational health and measurements

Implemented October 16, 2026, against [ticket #20](https://github.com/Kenneth882/DinoPump/issues/20)
and [operations](../spec/operations.md), [API/recovery](../spec/api-and-recovery.md),
[persistence](../spec/persistence.md) and [narration](../spec/events-and-narration.md).
See the [operator guide](../operations.md) for exact boundaries and recovery.

## Behavior and acceptance coverage

- AC-05/08: player-wide five/second, burst-ten limits remain before engine/readback;
  malformed/rate-limited submissions leave the market cursor unchanged. Metrics
  count all attempts, while logs are bounded and exclude synthetic secrets, raw
  cookies, payloads and error text.
- AC-10/18: real HTTP/Socket.IO cases verify order receipt-to-acknowledgement,
  snapshots, unique connected players versus sockets, and commit-to-client timing
  including an intentionally delayed confirmation. Missing confirmations count
  separately; they never block gameplay.
- AC-14/15: ownership loss during a trade rolls back without a success delivery or
  commit-latency sample; database connection loss leaves process health available
  and readiness/writes unavailable. Reopening ownership recovers safely; the old
  service remains unready. Existing recovery suites cover inaccessible startup
  during replay, SIGKILL boundaries, deadline catch-up and immutable settlement.
- AC-15/18 (also supporting AC-09/13): a provider call remains pending while the
  next scheduled event commits; failed generation is observable independently of
  scheduler lag/readiness. Worker probes exercise startup, failed storage polling,
  recovery and disabled-provider readiness.

## Validation

Environment: local macOS, Node 24.21.0, pnpm 10.34.5, PostgreSQL 18.6 in the
dedicated loopback/tmpfs Compose test project. No external provider credential.

- Focused operational suite: 5 passing tests, including red/green cycles for
  health metrics, transport measurements and provider-failure observability.
- `pnpm check`: passed lint, formatting, typechecking, 226 tests and all production
  builds. Typechecking also passed during implementation.
- `pnpm db:verify`: 131 tests passed across all 12 database suites, including
  operational, crash/replay and narration regressions. The initial run exposed
  removal of safe scheduler log timing fields; restoring the fields resolved it
  and the complete rerun passed.
- `pnpm test:e2e tests/e2e/commentary-no-key.spec.ts tests/e2e/terminal.spec.ts`:
  both Chromium cases passed. Real desktop/360px browsers confirmed committed
  batches, traded, received nine events, reconnected and reached immutable results
  without a provider key; the terminal regression also passed.
- Documentation links and duplicated API source sections checked for existence
  and exact synchronization; `git diff --check` passed.
- Final focused operational suite: all 5 tests passed after adding the fenced
  lease-loss counter. Final typechecking, lint and formatting passed. Duplicate
  generated Next.js declarations appeared after browser runs; the local generated
  cache was preserved in `/private/tmp` and regenerated before the clean typecheck.

## Review

Separate Standards and Spec agents reviewed the committed diff from `e911486`.
Both initially reported zero findings. A follow-up counter for expired/superseded
worker completion leases added one shared documentation consistency finding:
the narration-duration description incorrectly implied every completion was
stored. The guide now says timing is recorded after the storage attempt returns,
including fenced rejections. Standards: one documentation finding fixed, zero
remaining. Spec: one documentation finding fixed, zero remaining. No gameplay,
security or scope findings remained.

## Limits

This adds measurement and fault/recovery evidence; it does not establish deployment
region p95 performance or complete the release gates. Ticket #21 owns the full
eight-client load report. Counters reset on process restart; the external collector
must retain intervals/reset boundaries. Logs are sampled diagnostic context;
immutable database history remains the audit source.

The live issue still lists #13 as open; its recovery implementation and suites
already exist in this checkout and are used for validation. No tracker state is
changed by this implementation.
