# Ticket #9 validation: scheduled events and immediate news

Validated October 12, 2026 on `ticket9`, against starting commit `3a5c8a9`.
Sources: [ticket #9](../spec/tickets/09-scheduled-events-and-template-news.md),
[implementation plan](../spec/tickets/ticket-plans/09-scheduled-events-and-template-news-plan.md),
and [acceptance criteria](../spec/verification.md).

## Implemented behavior

The existing owned room queue applies the frozen schedule through the pure engine.
One transaction commits event batches, projections, authored news, and narration
jobs. Source identities are unique and replayable; logical scheduled causes are
stored losslessly. Startup replays and catches up missed pre-close events.
Snapshots and ordered public market/news messages expose only authorized fields.
The Daily Roar renders immediate authored text and actual reference effects;
idle last-trade marks and portfolios remain unchanged.

`withMarketRound` provides the internal owned transaction boundary for subsequent
market commands. Its tests race synthetic engine matching against scheduler ticks
in both queue orders. No public trading endpoint was introduced.

## Executed checks

| Check                     | Result                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`              | Passed lint, formatting, typechecking, 191 tests in seven files, and production builds.                                                          |
| `pnpm db:verify`          | Passed 53 PostgreSQL/service tests in five files; disposable container/network removed.                                                          |
| Focused browser journey   | Passed two guests, first real scheduled event, updated quotes, unchanged last prices/portfolio, one news item after reconnect, and 360px layout. |
| Full `pnpm test:e2e`      | Passed all five Chromium browser tests in the isolated validation copy; disposable container/network removed.                                    |
| Documentation consistency | All 15 numbered sections in the full reference match exactly one focused extract; changed local links checked before commit.                     |

Toolchain: Node 24.21.0, pnpm 10.34.5, PostgreSQL 18.6 in the repository's isolated
Compose setup, Chromium through the installed Playwright configuration.

The original working directory contains pre-existing untracked duplicate source
files and duplicate generated `.next` types. Its initial typecheck failed on
those duplicate generated definitions. They were preserved. The final `pnpm check`
ran on an isolated source copy under `/private/tmp/dinopump-ticket9-validation`,
excluding the duplicate ` 2` files and using the same installed dependency versions.
Dependency symlinks crossing that copy's root initially prevented Turbopack startup;
copying dependencies inside the validation root resolved the harness issue.
The successful production build used the normal Turbopack build command.
No dependency, lockfile, or gameplay-rule changes were required.

The first full database run exposed a test timing assumption: it checked the
second socket immediately after the first received its batch. The corrected
assertion waits for both asynchronous deliveries, then compares their content.
The full rerun passed. Earlier test-first failures demonstrated missing event
application, lag reporting, news contract validation, the browser news view, and
the owned pre-command transaction seam before their implementations were added.

## Acceptance evidence and limits

| AC           | Evidence                                                                                                                                                                                                                     | Remaining scope                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| AC-09        | Every boundary from 60 through 540 seconds, no 600-second event, repeated/concurrent ticks, multiple symbols, exact reference effects, unchanged idle ledgers/marks, and immutable frozen inputs.                            | No generated prose is executed; provider behavior is later work.                            |
| AC-10 subset | Two sockets receive equal complete batches/news; authorized snapshots restore applied news; two browser contexts remain consistent through reconnect.                                                                        | Durable trades and pending-fill reconciliation remain #10/#12.                              |
| AC-13 subset | Immediate authored news with no worker process or provider call; jobs persist without delaying template delivery.                                                                                                            | Provider timeouts, output validation, and worker publication remain #17/#18.                |
| AC-14 subset | Job-write fault rolls back effects/news/projection; retries apply once; committed effects replay across restart without duplicate news. Advisory-lock loss inside a scheduled transaction rolls back and prevents readiness. | Trade crashes and the full process-termination matrix remain #10/#13.                       |
| AC-15 subset | Restart before close catches up multiple deadlines in recorded order; restart after close applies only the nine pre-close effects and retains the original deadline.                                                         | Service remains unready at/after close until #11 adds settlement; complete recovery is #13. |

The healthy scheduler test advances authoritative time at wall-clock speed across
an imminent deadline with no connected sockets. It checks the structured
postcommit lag record is between 0 and 1,000ms. This is local functional evidence,
not the eight-client deployment-region performance gate. Broader load/operational
acceptance remains #20/#21.

The 360px news screenshot was visually inspected: authored copy, reference effects,
quotes, currency notice, and connection state remain readable with no horizontal
overflow. Complete trading/results accessibility remains later journey work.

## Standards review

Independent review against `3a5c8a9`: no documented-rule violations. The initial
nonblocking duplicated public-market projection suggestion was resolved with
`publicMarketView`; re-review reported zero remaining findings.

## Spec review

Independent review initially found that the pre-command test did not race the
scheduler through the owned queue. The shared `withMarketRound` transaction seam
and both-order concurrent regression resolved it. Re-review reported zero remaining
findings; the focused 20-test event/service run and final 53-test database run passed.

This establishes ticket #9's scheduled-event slice. It does not establish a fully
playable round, the complete authoritative-service milestone, or release readiness.
