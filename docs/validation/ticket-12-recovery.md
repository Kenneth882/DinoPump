# Ticket #12: client resynchronization and pending-trade reconciliation

Recorded October 13, 2026 for [issue #12](https://github.com/Kenneth882/DinoPump/issues/12).
Requirements: [API and recovery](../spec/api-and-recovery.md#client-resynchronization-ticket-12-stage),
[interface](../spec/interface.md), and AC-05, AC-07, AC-10, AC-11, AC-14 and AC-17
in [verification](../spec/verification.md).

## Implemented behavior

The strict round/sequence resync command derives room access from the authenticated
subscription and supports the existing code-based command. Complete authorized
snapshot events and correlated acknowledgements carry public state, deadlines,
and only the owner's portfolio, outcomes and terminal resources. Subscription,
capture and publication share the owned queue; durable batches retain commits
after the captured market cursor and are delivered afterward.

Disconnected or stale browsers pause trading and reconnect with bounded backoff.
Recovery rejects snapshots behind observed market or settlement sequences,
including sequences for a newly observed round that is not yet visible. Lifecycle
evidence invalidates older captures and requires a newly correlated read.
Fully covered duplicate batches cannot regress the screen. Countdown time continues
from server clock evidence and frozen deadlines.

Private receipts wait for complete public coverage. Validated pending receipts
arriving during resync are retained until authorized recovery finishes. Retries
preserve the original request ID, round, quantity, symbol, side and protection.
Owner readback resolves receipts outside the 20-result snapshot window and after
lobby reset. New stale-round attempts and nonparticipant historical access fail;
an old receipt cannot change the next round's resources.

No engine rules, scoring, round duration, funding or rules version changed.

## Validation results

Environment: Node 24.21.0, pnpm 10.34.5, PostgreSQL 18.6, Playwright 1.63.0/Chromium.
The test harness used project `dinopump-ticket12`, loopback PostgreSQL port 55434,
random synthetic schemas and temporary container storage. Another checkout was
using the default test port; its container and the development database were left
untouched. Harnesses ran sequentially and cleaned up their own test container.

- `pnpm check`: passed lint, formatting, all workspace/tool typechecks,
  **196 tests in 9 files**, and all production builds.
- `DINOPUMP_TEST_PROJECT=dinopump-ticket12 DINOPUMP_TEST_PORT=55434 pnpm db:verify`:
  **81 tests in 7 files passed**, 45.16 seconds.
- `DINOPUMP_TEST_PROJECT=dinopump-ticket12 DINOPUMP_TEST_PORT=55434 pnpm test:e2e`:
  **all 5 browser tests passed**, 1.9 minutes.
- Changed documentation links resolve; full-reference API content exactly matches
  the focused extract; the diff has no whitespace errors. The 360px screenshots
  retain the connection indicator, usable trade controls and results without
  horizontal overflow.

The database/service cases exercise a competing commit during snapshot capture,
complete subsequent delivery, per-recipient privacy, malformed/canonical cursors,
expired authorization, original outcomes after reset/new rounds, and readback
outside the recent-order bound. Existing commit rollback and postcommit delivery
failure/restart regressions also passed.

The two-browser journey exercises join, readiness, trades, immediate event news,
three-second freshness loss, acknowledgement-only snapshot recovery, a lost
precommit submit with exact retry, postcommit delivery loss, missing/reordered and
duplicate batches, private receipts ahead of public coverage, close/reconnect,
host reset and fresh rounds. Packet-order regressions reproduced failures before
their fixes: an older snapshot after newer facts, a terminal notification before
settlement coverage, a historical retry acknowledgement during resync, and a new
round's newer batch before its captured snapshot. The final journey passes through
four round identities and verifies that the recovered player can trade again with
fresh resources.

## Review and boundaries

Standards review: **0 unresolved findings**. Spec review: **0 unresolved findings**.
Review identified lifecycle cursor and deferred-receipt races; each was corrected
and checked with packet-order regressions before the final validation runs.

This is evidence for the client-recovery slice of the listed ACs. The complete
process-crash/projection-repair matrix remains ticket #13; deployment-region load
and full release/milestone gates remain separate work. No AI provider is needed
for this journey. Existing tracked duplicate source/test files were preserved.
