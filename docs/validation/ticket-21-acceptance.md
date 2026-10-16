# Ticket #21: acceptance evidence

Work started October 16, 2026 on `ticket21` from
`7eba873ea35570322b2aa15403469f5843fb9543`, against
[ticket #21](https://github.com/Kenneth882/DinoPump/issues/21),
[verification §12](../spec/verification.md), [operations §11](../spec/operations.md)
and [milestone 6](../spec/implementation.md). Both listed blockers, #19 and #20,
were closed when implementation began. Existing duplicate-file deletions were
preserved and excluded from this work.

**Release readiness is not established.** The local eight-client peak workload
exceeds the acknowledgement target. Deployment-region measurement is unrun.
No acceptance threshold, gameplay rule or frozen-round configuration was changed.

## Reproduction

Use [repository setup](../../README.md#local-setup) and the
[load-run guide](../load-testing.md). Validation commands:

```sh
pnpm check
pnpm db:verify
pnpm test:e2e
pnpm test:load --smoke
pnpm test:load
pnpm test:load --sustained
```

The first three commands run the full engine/content/contracts/HTTP checks,
all isolated database suites, and desktop/360px browser suites respectively.
The load commands use a separate tmpfs database on 55434. Run performance
measurements alone. `--sustained` is the explicit full-round 40 orders/second
profile; do not substitute a passing lower workload for that capacity claim.

## AC-01–18 matrix

These rows identify observed local test evidence, not a blanket deployment or
release certification. Pure-engine, service, browser and load evidence remain
distinct. The matrix refers to test files under `packages/engine/test`,
`tests/integration` and `tests/e2e` in this checkout.

| AC    | Executed validation boundary and cases                                                                           | Local evidence / remaining boundary                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | `db:verify`: `lobby.database`, `lobby-http.database`, `results.database`; lobby browser journey                  | Admission of 2–8, ninth refusal, locked joining and historical access covered by service tests.                                                                              |
| AC-02 | `check`: content/contracts and `round-engine`; `db:verify`: `round-baseline.database`, `round-opening.database`  | Canonical baseline, exact one-time funding, join order, frozen configuration and cancelled countdown covered.                                                                |
| AC-03 | `check`: `protected-buys`; `db:verify`: `trading.database`; portfolio browser                                    | Worked 150-unit D$6,080 buy and D$3,920 remainder, cheapest eligible asks and exact ledger changes covered.                                                                  |
| AC-04 | `check`: `protected-sells`, `protected-buys`; `db:verify`: `trading.database`; portfolio browser                 | Highest-bid sales, overselling and fully protected funding rejection covered.                                                                                                |
| AC-05 | `check`: malformed baseline/engine contracts; `db:verify`: lobby, HTTP, trading, operations and reaction suites  | Stable rejection codes, forged/expired/missing identities, foreign origins, private access and unhealthy write gating covered.                                               |
| AC-06 | `check`: buy/sell engine cases; `db:verify`: `trading.database`                                                  | Full, partial and zero fills preserve submitted protection.                                                                                                                  |
| AC-07 | `db:verify`: trading, recovery and recovery-process suites                                                       | Original outcomes survive later trades, snapshot bounds, restarts and after-commit SIGKILL; changed payloads conflict.                                                       |
| AC-08 | `check`: seeded mixed-order stress; `db:verify`: eight-participant trading and operations cases                  | Serialized concurrent service submissions, conserved finite ledgers and nonnegative resources covered; peak-load latency remains a separate failing gate.                    |
| AC-09 | `check`: content/catalog/round-engine; `db:verify`: scheduled-events and commentary; no-key browser              | Known bounded integer effects, nine exactly-once events, frozen factual inputs and prose isolation covered.                                                                  |
| AC-10 | `db:verify`: lobby HTTP/trading/recovery-process; journey/terminal/portfolio browsers                            | Peer public state, private delivery, ordering and pending-fill reconciliation covered. Load additionally compares eight complete streams.                                    |
| AC-11 | `check`: settlement/ranks; `db:verify`: results/recovery/commentary; journey/portfolio browsers                  | Boundary handling, frozen marks, ties, historical private results and late commentary isolation covered.                                                                     |
| AC-12 | `db:verify`: round-baseline/trading/results/recovery/recovery-process                                            | Replay checks full immutable state, public views, fills and results; damaged mutable projections recover and bad immutable evidence aborts safely.                           |
| AC-13 | `check`: narrator adapter/factual validation; `db:verify`: commentary/operations; commentary and no-key browsers | Missing credentials, timeout/outage, invalid JSON/misleading prose and immediate authored news covered.                                                                      |
| AC-14 | `db:verify`: trading/scheduled-events/results/recovery-process/operations                                        | Rollbacks before commit, real SIGKILL before/after commit, missed publication, atomic job creation and ownership-loss rollback covered.                                      |
| AC-15 | `db:verify`: recovery/recovery-process/results/scheduled-events                                                  | Inaccessible startup during catch-up, ordered overdue events, immutable single settlement and closed-order refusal covered.                                                  |
| AC-16 | `check`: bot-quotes/protected-buys/protected-sells/round-engine; `db:verify`: trading/recovery                   | Seeded reservation coverage, finite exhaustion, integer limits, deterministic IDs/ties and conserved resources covered under rules 1.1.                                      |
| AC-17 | `test:e2e`: `journey`, `lobby`, `terminal`, `portfolio`, `reactions`, commentary and baseline files              | Desktop/360px join→ready→trade→event→reconnect→results, keyboard and reduced-motion checks. Automated usability evidence is not an observed novice or screen-reader session. |
| AC-18 | `test:load --smoke`, real-time `test:load`, no-key browser and operational database suites                       | Local peak acknowledgement latency fails; deployment-region and full-round sustained-peak acceptance remain unverified.                                                      |

## Run results

Environment: macOS 27 on Apple M1, 8 logical CPUs, 16 GiB RAM, Node 24.21.0,
pnpm 10.34.5, isolated PostgreSQL 18.6 in Docker. Load and game run in separate
processes on the same host; clients and database use loopback. No provider or
key is supplied to the game process.

- `pnpm check`: lint, formatting, workspace/tool typechecking, **226 tests in
  12 files**, and all production builds passed. An initial sandboxed invocation
  failed at local socket creation; the complete rerun with socket access passed.
- `pnpm db:verify`: **131 tests in 12 suites passed**, including actual process
  crashes, full replay/restart, ownership loss and narration failures.
- The first full browser run reached the portfolio privacy checks and failed
  because the test's Socket.IO packet filter excluded numeric acknowledgement
  IDs. The parser now accepts both acknowledged and unacknowledged event packets
  while retaining the original public-payload/privacy assertions.
- Browser rerun and real-time round results are recorded below when complete.

## Performance blocker

The isolated twelve-second smoke run at `2026-10-16T16:09:56Z` offered the
five-orders/second/player peak for ten seconds. It submitted and acknowledged
343 attempts; the 160-in-flight safety cap counted **65 skipped attempts**.
There were 305 filled outcomes and 38 protected-zero outcomes, including retries;
312 distinct committed order batches reached each of eight clients.

Client acknowledgement round-trip p95 was **9,086ms**, maximum **9,260ms**.
The server acknowledgement histogram's p95 lies above 5,000ms, with maximum
**9,259ms**; it cannot establish the required p95 <300ms. Commit-to-client p95
upper bound was **50ms**, maximum **71ms**, with all **2,496** batch confirmations
and no delivery timeouts. Snapshot maximum was **56ms**. All eight stream hashes
and cursors agreed, and immutable history replay passed exact conservation,
nonnegative-balance and covered-resource checks. A smoke run stops before events
or settlement and cannot establish those gates.

This is a concrete local capacity blocker: the serialized service falls behind
the offered 40 attempts/second even without concurrent test/build workloads.
The measurements distinguish queue/acknowledgement delay from prompt delivery
after commit. They do not establish which individual service/database operation
dominates that delay. Service profiling and a measured fix are required before
claiming peak-capacity acceptance. Targets remain unchanged.

## Limits and remaining gates

- The designated deployment-region host and production database topology have
  not been provided or exercised. No hosting resources were provisioned.
- A full-round five-orders/second/player run has not passed. The default profile
  uses a ten-second peak followed by one order/player every five seconds; it
  cannot demonstrate ten minutes at sustained peak.
- Browser suites accelerate only their test-owned clock; a real ten-minute
  load run supplies separate wall-clock evidence. Browser tests use the Next.js
  development server; production compilation is verified by `pnpm check`.
- No manual novice usability observation or full screen-reader/WCAG audit was
  performed. Refer to [ticket #19](ticket-19-journey.md) for precise UI checks.
- Failed, skipped and unrun checks remain incomplete evidence. Keep ticket #21
  and milestone 6 open until the required performance and environment gates pass.
