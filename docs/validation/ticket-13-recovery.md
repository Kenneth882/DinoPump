# Ticket 13 crash recovery evidence

Implemented against `6958e831d5b253d9d3474a8e50a8bfff7b794d8c` on `ticket13`,
October 13, 2026. Scope: [issue #13](https://github.com/Kenneth882/DinoPump/issues/13),
[persistence](../spec/persistence.md), [API and recovery](../spec/api-and-recovery.md),
and the [service milestone](../spec/implementation.md). Rules remain `1.1`;
settlement, quote generation, scoring, deadlines, and schedule selection are unchanged.

## Behavior demonstrated

Exclusive room ownership precedes startup replay and due work. The service opens
its listener only after verification, projection repair, presence cleanup, and
catch-up commit. Missed events use recorded due-time order, strictly before the
unchanged closing deadline; closing settles once. A blocked startup test proves
that an overdue event must finish before a listener is exposed.

Recovery verifies initialization metadata and schema version, frozen configuration,
complete batches/events, original durable order outcomes, linked fills, materialized
public views, scheduled news/job inputs, and immutable results. It then replaces a
discarded, stale, malformed, or damaged mutable projection inside the owned
transaction. Rebuilding preserves exact human/bot balances, holdings, reference and
last prices, quotes/generations/reservations, receipt identities, and final rankings.
Changed current funding defaults never replace an existing round's frozen resources.
Historical participant results can repair a discarded projection after lobby reset.

Immutable evidence is never repaired or overwritten. Unsupported initialization
versions or unverifiable outcomes produce a safe abort without a winner. Aborted
rounds cannot return damaged order outcomes on retry. Verified finished results are
preserved across projection damage and restart; database guards still reject
conflicting abort/result records.

The process suite runs real child game services, real PostgreSQL transactions, and
real HTTP/Socket.IO clients. SIGKILL interrupts an order before commit, an order
after commit before any transport publication, a scheduled effect before its job
write commits, and settlement before final-result commit. Observers receive no
partial batches. Precommit recovery has no outcome or trade; unchanged resubmission
executes once. Postcommit recovery restores the original private outcome and two
fills from the snapshot; identical retries do not publish another execution, and
changed retries conflict. Another participant receives their own portfolio and no
owner receipts. Scheduled/settlement restart compares the entire state with the
public pure-engine command interface, then a second restart verifies identical
state, source news identities, and results.

A competing process cannot listen or acquire ownership. Terminating the owner's
database connection or releasing its advisory lock during a transaction makes it
unready and stops commands, snapshots, and publication. The health endpoint remains
live. A replacement process acquires ownership, verifies history, catches up, and
accepts commands; the old process remains unavailable. Connection/ownership loss
requires reopening the store, normally through a service restart. Test clock and
fault controls are restricted to the synthetic test helper; production has no
control endpoint.

## Validation environment and results

Node 24.21.0, pnpm 10.34.5, PostgreSQL 18.6 in Docker 29.6.1 on macOS.
Tests used loopback port 55433, `dinopump_test`, synthetic credentials, random
per-test schemas, and tmpfs storage. Development data and `.env` were not used.
The ticket-specific Compose project prevented another verification run from
removing this run's disposable container.

- `pnpm check`: **passed** lint, formatting, typechecking, **196 tests in 9 files**,
  and all production builds. No frontend changes were needed.
- `COMPOSE_PROJECT_NAME=dinopump-ticket13 pnpm db:verify`: **89 tests in 9 files
  passed**, 73.32 seconds; disposable container/network cleanup completed.
  Includes **5 projection/integrity recovery tests and 7 process fault tests**, plus
  all existing initialization, lobby, opening, events, trading, and results regressions.
- Red/green regressions demonstrated discarded current/historical projections,
  false outcome readback after integrity abort, and unsupported initialization-event
  versions before their fixes. Typechecking ran regularly during implementation.
- Standards and Spec reviews compared the complete change with `6958e83` before
  committing. No unresolved documented violation or Spec finding remains.

The first full database run had 86 passes and two timing failures in existing
socket tests under cross-file contention. Database files now use one Vitest worker;
tests requiring competing clients/processors create concurrency explicitly. The
complete rerun above passed. An early crash-harness cleanup waited for a blocked
backend before releasing its test lock; PostgreSQL notices a killed client's EOF
after the statement unblocks. The corrected harness releases that lock before
waiting on trigger cleanup, and all crash cases passed. These failures are retained
here as validation history, not passing evidence.

Generated Next.js declaration changes from typechecking/builds were restored;
pre-existing tracked ` 2.*` copies were preserved. Browser tests were not rerun for
this backend recovery change. Service/socket evidence does not establish the full
browser recovery journey or release latency targets.

## Service acceptance coverage

| IDs      | Evidence                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01–02 | Existing PostgreSQL lobby/opening suites retained: two-to-eight admission, ninth rejection, locked joining, cancelled countdown, all locked participants funded once, frozen configuration, fresh rounds after reset. |
| AC-07    | Original outcome across real postcommit crash/restart; unchanged retry has no new fills/broadcast; changed identity conflicts; aborted unverifiable outcomes cannot leak false balances.                              |
| AC-08    | Existing concurrent service submissions, eight-player seeded conservation stress, and explicit competing-process exclusion; DB/ownership loss rolls back unsafe work.                                                 |
| AC-09    | Existing effects/job atomicity and nine-event tests, plus SIGKILL/restart after one/multiple missed deadlines and close; news IDs remain unique across repeated restart.                                              |
| AC-10    | Real socket peers, authorized recovery snapshots, original pending outcome resolution, private portfolios, no half batch or duplicate execution; existing subscription/snapshot race tests retained.                  |
| AC-11    | Frozen last-trade marks, disconnected participants, shared ranks, immutable private results, exact close handling, no new closed fills, settlement interrupted and recovered once.                                    |
| AC-12    | Full history verification, exact replay/state comparisons through crash and repair, immutable result preservation, unsupported event-version rejection, frozen resources despite changed defaults.                    |
| AC-14    | Actual process termination at precommit and postcommit/prebroadcast order boundaries and during scheduler/settlement writes, with committed-state and publication assertions.                                         |
| AC-15    | Startup gated on replay/due work, original deadlines, one/three/nine due events caught up in order, repeated post-close restart retains one result, new closed attempts have no fills.                                |
| AC-16    | Replayed complete quote/reservation state agrees exactly; existing pure-engine/resource-exhaustion and service finite-resource regressions remain passing.                                                            |

This completes ticket #13's service recovery scope and supplies the service-level
milestone gate evidence for AC-01–02, AC-07–12, and AC-14–15. The full client
reconciliation/reordering journey remains ticket #12; AC-17 browser acceptance and
AC-18 latency/release gates require their own recorded validation. Narration worker
and reactions remain separate work; no AI provider can affect recovery, and no
credentials are needed by the recovery harness.

## Standards

No unresolved documented violations. One nonblocking judgment call is repeated
round-opening setup in the store and process test suites. Their store lifetimes
differ, so the fixtures remain separate to keep process ownership visible in tests.
The planned evidence link identified during review now resolves to this document.

## Spec

No findings. Immutable evidence verification precedes projection replacement;
process faults, ownership, due ordering, retries, and result preservation match the
ticket. No new gameplay rule, production test-control surface, or scope expansion.

Review summary: **Standards 0 unresolved violations, 1 accepted nonblocking fixture
duplication note; Spec 0 findings.**
