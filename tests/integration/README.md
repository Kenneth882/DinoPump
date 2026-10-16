# Database and service integration tests

`operations.database.test.ts` covers ticket #20 at public HTTP/Socket.IO and worker
interfaces: distinct liveness/readiness, failed-owner write rejection and recovery,
client-confirmed commit timing, receipt-to-ack and snapshot measurements, shared
player rate limits, bounded credential-free logs and optional provider failure
while scheduled effects continue. See [operator guide](../../docs/operations.md).

`market-baseline.test.ts` runs with `pnpm test`. It starts a real service on an ephemeral loopback port, checks its public projection through the Next.js route, rejects mutations, verifies whole-baseline validation before listening, and checks unavailable/malformed upstream handling. No database or AI credentials are required. The test runner must be allowed to bind local ports.

`round-baseline.database.test.ts` runs with `pnpm db:verify` against the dedicated disposable PostgreSQL instance. It covers migrations, atomic initialization and rollback, concurrent retries, deterministic schedules, frozen resources/configuration, reconnect/readback, and baseline event/projection integrity. See [database setup and verification](../../docs/database.md) for isolation and commands.

This supports AC-02, AC-09, AC-12, and AC-15 at the persistence foundation only. This foundation suite alone does not verify live trading, scheduled effects, gameplay replay or restart catch-up; later suites provide that evidence. The development database is not a disposable test database.

`lobby.database.test.ts` and `lobby-http.database.test.ts` also run through `pnpm db:verify`. They exercise the public store, HTTP and Socket.IO boundaries against PostgreSQL: guest normalization/expiry, cookie privacy, authorization, concurrent admission, join locks, restart, persisted deadlines with an injected clock, ownership exclusion, multiple sockets, subscription races and rollback publication. These provide AC-01/05 and lobby-only AC-10 evidence. See [lobby documentation](../../docs/lobby.md).

`round-opening.database.test.ts` adds readiness/start retries, locking every lobby
member, cancellation/reset, frozen configuration, exact atomic funding/quotes,
rollback before commit, and takeover before snapshot delivery. Service cases also
exercise host-only acknowledged start, complete opening delivery, health/readiness,
and live-connection advisory-lock loss. These support AC-01/02/05 and opening-only
AC-08/10/14. The scheduler, trades, settlement, and full crash catch-up retain
their later acceptance gates.

`recovery.database.test.ts` and `recovery-process.database.test.ts` cover ticket #13.
They verify replacement of discarded/malformed/stale projections, immutable
initialization-version and outcome checks, historical result repair after reset,
frozen configuration, and refusal of damaged aborted order outcomes. Real child
HTTP/Socket.IO services are killed before order commit, after commit before
broadcast, during scheduled effects, and during settlement. Restarts verify exact
replayed state, deadline catch-up, one settlement, private pending-order recovery,
changed retries, startup gating, two-process exclusion, database connection loss,
and explicit ownership loss. Fault controls exist only in the test helper.

Synthetic legacy-history regressions cover settlement after batches without public
views and recovery of an already stored opening-time settlement timestamp. They
check exact preservation of batches, events, orders, fills, and private/public final
results, plus correct snapshot and batch quote times. Unexpected timestamps,
changed quotes/totals/results, and the same timestamp error after a materialized
predecessor remain integrity failures (AC-07/11/12/15).

Database files run with one Vitest worker to avoid incidental cross-suite load on
the shared test PostgreSQL instance. Required concurrent clients/processors run
explicitly within tests. Use `pnpm db:verify`; never point these tests at development
or production data. See [ticket #13 evidence](../../docs/validation/ticket-13-recovery.md)
for service acceptance coverage and client/release limitations.

`reactions.database.test.ts` uses real Socket.IO and synthetic PostgreSQL with a
controlled authoritative clock. It checks approved payloads, sender attribution,
player-wide cooldowns across sockets/reconnect (999ms versus 1,000ms), independent
players, sender/recipient expiry, removed membership, expired rooms, and database
ownership failure. Reaction-only sends preserve both authorized snapshots and all
market/history/result records before and after closing (AC-05/10/11). The
scheduler interval is held during these focused cases; scheduler/recovery suites
continue to exercise normal process timing.
