# Ticket #8: readiness and round-opening evidence

Implementation: [ticket #8](https://github.com/Kenneth882/DinoPump/issues/8).
Scope and contracts: [guest lobby and opening](../lobby.md),
[round lifecycle §4](../spec/round-lifecycle.md), and
[acceptance criteria](../spec/verification.md).

## Approved lifecycle decisions

On October 5, 2026, the user confirmed that every current lobby member locks in
join order, including unready or disconnected guests. Cancellation resets all
readiness and unlocks admission. The two-connected-ready-player prerequisite and
all funding, timing, and quote rules remain unchanged. §4 and AC-02 are aligned
in the complete reference and focused specifications.

## Evidence by acceptance ID

| ID           | Tests and demonstrated behavior                                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01        | Countdown/open admission locks, existing participant reconnect, cancellation reopens admission; original eight-player lobby cases retained.                                                                                                    |
| AC-02        | Exact four assets, all locked humans receive starting resources once, finite bot funding, 24 initial quotes, nine-event schedule, configured timing/resources frozen before opening.                                                           |
| AC-05        | Validated acknowledged ready/start commands, forged identity rejection, authenticated membership, host-only start, stable errors, request conflicts, and private portfolio projections.                                                        |
| AC-08 subset | Concurrent starts serialize to one countdown; single database ownership and covered engine initialization. Concurrent trading remains later work.                                                                                              |
| AC-10 subset | Both Socket.IO clients receive complete consistent opening state; two browser profiles ready/open/reconnect at 360px. Pending-order reconciliation remains later work.                                                                         |
| AC-14 subset | A failure on the final opening lifecycle write rolls back baseline/events/batch/projection/room transition. Takeover after commit before snapshot delivery restores sequence 3 without funding twice. Trade crash recovery remains later work. |

`round-opening.database.test.ts` also covers countdown cancellation after
connectivity loss/session expiry, retries after cancellation/restart, no expiry
or refund of disconnected OPEN participants, frozen configuration, and false
readiness once scheduled work is overdue. HTTP/Socket.IO tests release the
advisory lock on a live connection and demonstrate rollback, write rejection,
503 readiness, and continuing 200 liveness.

## Validation status

Final validation on October 5, 2026:

- `pnpm check`: lint, formatting, workspace type checking, 190 tests, and all
  workspace production builds pass.
- `pnpm db:verify`: 42 tests across four database/service files pass using the
  disposable PostgreSQL test harness, which removes its container afterward.
- `pnpm test:e2e`: all five Chromium tests pass, including the two-profile
  readiness/countdown/opening/reconnect journey and 360px overflow checks.
  The 360px opening screenshot was visually inspected.
- All 15 focused numbered source sections exactly match `PROJECT_SPEC.md`;
  all 66 relative links in the affected documentation resolve.
- `/code-review` reviewed the worktree against starting commit `b2542f8` with
  separate Standards and Spec agents. Standards found duplicated command
  replay/record logic; Spec found the wrong error for an OPEN newcomer. Shared
  transaction-local helpers and admission checks before private projection
  resolve these findings. The OPEN admission regression failed before the fix
  and passes afterward; existing locked-member rejoin is covered too.
  Both agents rechecked the changes: zero remaining findings on either axis.

The implemented and demonstrated references are AC-01/02/05 and the opening
subsets of AC-08/10/14. The browser test also retains the entry/session portions
of AC-17; it does not establish a complete round journey.

## Remaining scope

This implementation opens a round and displays its starting resources/quotes.
Scheduled effects/news, trading, settlement/results, full market reconciliation,
and overdue-event/close catch-up remain tickets #9–13. `/readyz` becomes false at
the first unapplied event or closing deadline, keeping the opening-only slice's
readiness honest. Opening snapshots remain readable and explicitly labelled.
The full service milestone, AC-17 round journey, and release load targets are
not established by these checks. No AI credential or deployment is required.
