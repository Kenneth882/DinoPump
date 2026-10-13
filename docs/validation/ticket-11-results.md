# Ticket 11 closing and results evidence

Implemented against `9a67057` on `ticket11`, October 13, 2026. Scope:
[issue #11](https://github.com/Kenneth882/DinoPump/issues/11) and the
[implementation plan](../spec/tickets/ticket-plans/11-round-close-and-results-plan.md).
Rules remain `1.1`; no engine scoring or timing changes.

## Behavior demonstrated

The owned processor drains pre-close events and commits lifecycle entry into
SETTLING, one complete settlement, frozen public/private results, FINISHED, and
room visibility atomically. Closing orders have no fills; original order retries
retain their original outcomes. Final holdings are marked, never liquidated.

Results have shared ranks with stable join-order display, frozen last-trade/initial
marks, disconnected participants, and no bot. The HTTP route and per-recipient
terminal socket/snapshot expose only the viewer's final cash/holdings. Original
participants retain access after lobby reset and subsequent rounds; new lobby
members do not gain access to prior results. Stored results reject updates/deletes
and replay verifies marks, arithmetic, private portfolios, timeline, and sequence.

Host reset is durable and idempotent. It clears readiness/current round and restores
lobby deadlines while retaining history. A retried old reset cannot change a later
round. Browser round changes clear old UI/pending state; late old order results
cannot regress the next round's resources. The results screen works at 360px and
supports keyboard reset, winner/tied-winner announcements, profit/loss text, and
the fictional-currency notice.

Unverifiable market history rolls back before an independent owned abort
transaction records a fixed safe terminal explanation. It retains damaged evidence,
omits the corrupt market view, and declares no winner. Ownership loss during that
abort rolls back its metadata; recovery under a new owner safely records it.
An existing valid final result is never replaced by integrity abort metadata. Later projection damage makes verification fail until repaired, preserving the finished result and status; automatic projection rebuilding remains #13. Database terminal guards reject conflicting result/abort inserts. No production test-control endpoint or accelerated gameplay duration was added.

## Validation environment and results

Node 24.21.0, pnpm 10.34.5, PostgreSQL 18.6 in the disposable Compose harness,
Chromium/Playwright 1.63.0. Synthetic database on loopback port 55433 with random
per-test schemas and tmpfs data; development `.env`/database were not used.

Checks run in `/private/tmp/dinopump-ticket11-validation`, an isolated source copy
excluding pre-existing untracked ` 2.*` duplicates and generated artifacts. Their
originals remain untouched. In the original tree, web typechecking encounters
pre-existing duplicate `.next/types` declarations. Supported runtime and dependency
versions were retained in the isolated copy.

- `pnpm db:verify`: **77 tests across 7 files passed**, 26.00 seconds. Includes
  six new settlement/reset/abort scenarios and the real HTTP/socket terminal
  journey, plus all existing initialization, lobby, events, and trading regressions.
- `pnpm check`: **passed** lint, formatting, typechecking, **196 tests across 9 files**, and all production builds. Builds ran without a live database, game service, or AI key.
- Focused two-browser journey: **passed**, 1.4 minutes. Includes original trading
  outcomes/dropped delivery/news/reconnect, close with a disconnected guest,
  participant results route, keyboard host reset, second-round fresh resources,
  and identical old results for both players. The final `pnpm test:e2e` run passed **all 5 browser tests**, 1.4 minutes.
- Changed links resolve; affected full-reference sections exactly match their focused extracts; staged diff has no whitespace errors. Both review axes finished with zero unresolved actionable findings.

The browser harness owns a temporary clock-offset file read only by a test service
entrypoint. The first event uses the normal real-time deadline; advancing test time
then crosses the unchanged frozen 600-second deadline, drains remaining events, and
settles. The next round still uses the normal five-second countdown. Screenshots
include `results-360.png` in the Playwright result directory; visual inspection
confirmed readable results and no horizontal overflow.

Initial regression runs exposed an asynchronous ownership-release race on immediate
store restart; close now explicitly releases the advisory lock before destroying its
connection. The rerun passed. An initial sandboxed HTTP test lacked permission to
bind loopback; completion checks use the approved listener permissions. The successful reruns above provide completion evidence.

## Acceptance and remaining scope

| IDs          | Evidence                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01/02     | Host-only reset, readiness cleared, admission restored, fresh second round, prior data retained; original lobby/opening regressions retained.                                                      |
| AC-05/11     | Exact before/at/after boundary, no new closed fills, original outcome readback, final portfolios, ties, no-trade marks, disconnected rankings, abort without a winner, authorized private results. |
| AC-09/15     | Nine pre-close events exactly once, no event at close, restart beyond the deadline settles once, all-disconnected closing, verified terminal readiness.                                            |
| AC-12        | Replay agrees with final results/private portfolios; integrity mismatch aborts safely; immutable result storage.                                                                                   |
| AC-14 subset | Settlement rollback leaves no committed partial result; postcommit/pre-delivery restart returns one original result; ownership loss prevents abort writes.                                         |
| AC-17 subset | Two contexts complete results/reset/second round at 360px, reconnect at close, keyboard reset, frozen history readback, virtual-currency notice, no AI credential.                                 |

General projection repair, process termination at every crash boundary, and the full
client reordering/reset matrix remain #13/#12. Full terminal/accessibility review,
reactions, and narration worker remain later work. Late narration/reaction immunity
is enforced by immutable result storage and frozen timeline facts; those deferred
features were not implemented for this ticket. No new eight-player latency or
release claim is made; ticket #10's acknowledgement latency gap remains documented.
This is Ticket 11 evidence, not completion of all milestone/release gates.

## Standards review

No remaining actionable findings. The shared timeline reader resolves the duplicated
query/projection. Result preservation and abort ownership checks meet the documented
standards. Zero outstanding documented breaches or smell findings.

## Spec review

No unresolved actionable findings. The initial review identified an abort path that
could mask a valid finished result after projection damage. The guard, database
terminal exclusivity, and regression now preserve that result and room status.
All required checks have completed successfully.

Review summary: **Standards 0 unresolved; Spec 0 unresolved.**
