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
- Full database, browser and two-axis review results are recorded after the
  remaining verification completes.

## Limits

This adds measurement and fault/recovery evidence; it does not establish deployment
region p95 performance or complete the release gates. Ticket #21 owns the full
eight-client load report. Counters reset on process restart; the external collector
must retain intervals/reset boundaries. Logs are sampled diagnostic context;
immutable database history remains the audit source.

The live issue still lists #13 as open; its recovery implementation and suites
already exist in this checkout and are used for validation. No tracker state is
changed by this implementation.
