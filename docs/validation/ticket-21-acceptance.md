# Ticket #21: acceptance evidence

Work started October 16, 2026 on `ticket21` from
`7eba873ea35570322b2aa15403469f5843fb9543`, against
[ticket #21](https://github.com/Kenneth882/DinoPump/issues/21),
[verification §12](../spec/verification.md), [operations §11](../spec/operations.md)
and [milestone 6](../spec/implementation.md). Both listed blockers, #19 and #20,
were closed when implementation began. Existing duplicate-file deletions were
preserved and excluded from this work.

**Local sustained performance passes; release readiness is not established.**
The eight-client ten-minute peak workload passes all local gates after this fix.
Deployment-region measurement remains unrun.
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

## Final sustained result

The [after report](artifacts/ticket-21-sustained-after.json), started
`2026-10-16T19:00:25Z`, passes every local gate. Eight clients submitted five
orders/player/second throughout the remaining open window of the unchanged
600,000ms round, without an LLM key. The report records the source commit and
working-source SHA-256; its final source changes were reviewed against `5b73438`.

| Gate                                         | Measured result                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Submitted and acknowledged                   | **23,992/23,992**, zero skipped or unoffered attempts                                                           |
| Server acknowledgement p95 <300ms            | Upper bound **200ms**; maximum **840ms**                                                                        |
| Client round-trip p95 (separate measurement) | **149.5ms**                                                                                                     |
| Commit-to-client p95 <500ms                  | Upper bound **25ms**; maximum **350ms**                                                                         |
| Snapshot <1,000ms                            | Maximum **208.5ms**, 16 samples                                                                                 |
| Healthy scheduler lag ≤1,000ms               | Maximum **67ms**, all nine events                                                                               |
| Delivery completeness                        | **23,992 private results**, **172,864 public confirmations**, zero timeouts                                     |
| Integrity                                    | Eight identical streams, full replay, conservation, nonnegative balances, covered quotes and final results pass |
| Deployment region                            | **UNVERIFIED**; local loopback evidence only                                                                    |

The workload includes exact retries, protected-zero outcomes and two acknowledged
game rejections at the closing boundary. No transport/rate-limit rejection
occurred. Opening-snapshot acquisition consumes a small part of the open window;
all **23,992** scheduled offers for the remaining window were submitted.

Mean queue wait fell from **5,137ms** in the instrumented baseline to **65.8ms**.
Final mean durable submission was **9.08ms**, publication **7.87ms**, private
delivery **0.02ms**, engine processing **0.52ms**, state read **0.93ms**, and COMMIT
**0.37ms**. The evidence supports excessive serialized work and history growth,
not intrinsically slow individual commits. Earlier failed experiments below are
retained unchanged; this passing run does not relabel them.

## AC-01–18 matrix

These rows identify observed local test evidence, not a blanket deployment or
release certification. Pure-engine, service, browser and load evidence remain
distinct. The matrix refers to test files under `packages/engine/test`,
`tests/integration` and `tests/e2e` in this checkout.

| AC    | Executed validation boundary and cases                                                                           | Local evidence / remaining boundary                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | `db:verify`: `lobby.database`, `lobby-http.database`, `results.database`; lobby browser journey                  | Admission of 2–8, ninth refusal, locked joining and historical access covered by service tests.                                                                                       |
| AC-02 | `check`: content/contracts and `round-engine`; `db:verify`: `round-baseline.database`, `round-opening.database`  | Canonical baseline, exact one-time funding, join order, frozen configuration and cancelled countdown covered.                                                                         |
| AC-03 | `check`: `protected-buys`; `db:verify`: `trading.database`; portfolio browser                                    | Worked 150-unit D$6,080 buy and D$3,920 remainder, cheapest eligible asks and exact ledger changes covered.                                                                           |
| AC-04 | `check`: `protected-sells`, `protected-buys`; `db:verify`: `trading.database`; portfolio browser                 | Highest-bid sales, overselling and fully protected funding rejection covered.                                                                                                         |
| AC-05 | `check`: malformed baseline/engine contracts; `db:verify`: lobby, HTTP, trading, operations and reaction suites  | Stable rejection codes, forged/expired/missing identities, foreign origins, private access and unhealthy write gating covered.                                                        |
| AC-06 | `check`: buy/sell engine cases; `db:verify`: `trading.database`                                                  | Full, partial and zero fills preserve submitted protection.                                                                                                                           |
| AC-07 | `db:verify`: trading, recovery and recovery-process suites                                                       | Original outcomes survive later trades, snapshot bounds, restarts and after-commit SIGKILL; changed payloads conflict.                                                                |
| AC-08 | `check`: seeded mixed-order stress; `db:verify`: eight-participant trading and operations cases                  | Serialized concurrent service submissions, conserved finite ledgers and nonnegative resources covered; the final sustained load also passes the local latency and completeness gates. |
| AC-09 | `check`: content/catalog/round-engine; `db:verify`: scheduled-events and commentary; no-key browser              | Known bounded integer effects, nine exactly-once events, frozen factual inputs and prose isolation covered.                                                                           |
| AC-10 | `db:verify`: lobby HTTP/trading/recovery-process; journey/terminal/portfolio browsers                            | Peer public state, private delivery, ordering and pending-fill reconciliation covered. Load additionally compares eight complete streams.                                             |
| AC-11 | `check`: settlement/ranks; `db:verify`: results/recovery/commentary; journey/portfolio browsers                  | Boundary handling, frozen marks, ties, historical private results and late commentary isolation covered.                                                                              |
| AC-12 | `db:verify`: round-baseline/trading/results/recovery/recovery-process                                            | Replay checks full immutable state, public views, fills and results; damaged mutable projections recover and bad immutable evidence aborts safely.                                    |
| AC-13 | `check`: narrator adapter/factual validation; `db:verify`: commentary/operations; commentary and no-key browsers | Missing credentials, timeout/outage, invalid JSON/misleading prose and immediate authored news covered.                                                                               |
| AC-14 | `db:verify`: trading/scheduled-events/results/recovery-process/operations                                        | Rollbacks before commit, real SIGKILL before/after commit, missed publication, atomic job creation and ownership-loss rollback covered.                                               |
| AC-15 | `db:verify`: recovery/recovery-process/results/scheduled-events                                                  | Inaccessible startup during catch-up, ordered overdue events, immutable single settlement and closed-order refusal covered.                                                           |
| AC-16 | `check`: bot-quotes/protected-buys/protected-sells/round-engine; `db:verify`: trading/recovery                   | Seeded reservation coverage, finite exhaustion, integer limits, deterministic IDs/ties and conserved resources covered under rules 1.1.                                               |
| AC-17 | `test:e2e`: `journey`, `lobby`, `terminal`, `portfolio`, `reactions`, commentary and baseline files              | Desktop/360px join→ready→trade→event→reconnect→results, keyboard and reduced-motion checks. Automated usability evidence is not an observed novice or screen-reader session.          |
| AC-18 | `test:load --smoke`, `test:load --sustained`, no-key browser and operational database suites                     | All final local sustained gates pass; designated deployment-region acceptance remains unverified.                                                                                     |

## Initial implementation run results (before this fix)

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
- A later browser run exposed a missed keyboard submission after reconnect.
  The test now asserts button readiness and focus before Enter. The final
  `pnpm test:e2e` run passed **all 11 Chromium tests in 8 files**, including the
  corrected portfolio privacy case and full desktop/360px reconnect journey.
- Final tooling checks after harness refinements passed lint, formatting and
  tool/workspace typechecking. Documentation links and `git diff --check` passed.
- `pnpm test:load`: completed the real ten-minute no-key round and integrity
  checks, but correctly exited **1** for failed acknowledgement latency and
  incomplete offered peak workload. Its results are recorded below.

## Historical performance blocker

The [retained smoke report](artifacts/ticket-21-smoke.json) from
`2026-10-16T16:09:56Z` records the isolated twelve-second run. It offered the
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

This established a concrete local capacity blocker: the serialized service falls behind
the offered 40 attempts/second even without concurrent test/build workloads.
The measurements distinguish queue/acknowledgement delay from prompt delivery
after commit. They do not establish which individual service/database operation
dominates that delay. Profile the serialized path and validate any correction or deployment sizing
with the same workload before claiming peak-capacity acceptance. Targets remain
unchanged.

## Historical default-workload round

The [retained full report](artifacts/ticket-21-round.json) records
`2026-10-16T16:18:29Z` through `16:28:44Z`. The unchanged rules-1.1 round was open
for exactly **600,000ms**; load submission covered **599,801ms** after all eight
opening snapshots arrived. The complete run including verification took about
615 seconds. The report identifies source commit `943f621` with working-tree
changes: the reviewed report-assembly fix separated offered-load duration from
verification time; gameplay/workload logic was unchanged.

Of **1,344 scheduled offers**, **1,258 were submitted and acknowledged**, and
**86 were skipped** by the in-flight safety cap. There were 1,038 FILLED and 220
protected-zero acknowledgements, including original outcomes returned on retries.
Replay verified **1,135 distinct durable order receipts**. The report preserves
the actual per-symbol/side/new-or-retry mix; under backlog, retries capture the
most recently acknowledged request rather than assuming the preceding request
has completed.

| Gate                           | Actual full-run evidence                                                                                                                                    | Result       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Acknowledgement p95 <300ms     | Server histogram p95 **>5,000ms**, maximum **12,796ms**; separately, client RTT p95 **10,260ms**                                                            | **FAIL**     |
| Commit-to-client p95 <500ms    | Conservative p95 upper bound **100ms**, maximum **262ms**                                                                                                   | Pass locally |
| Snapshot <1,000ms              | 16 samples, maximum **88ms**                                                                                                                                | Pass locally |
| Healthy scheduler lag ≤1,000ms | Nine samples, maximum **385ms**                                                                                                                             | Pass locally |
| Complete offered workload      | 1,258 completed, 86 skipped                                                                                                                                 | **FAIL**     |
| Delivery completeness          | **9,160/9,160** validated batch confirmations, no timeouts                                                                                                  | Pass locally |
| Eight connected clients        | 8 players and 8 sockets through completion                                                                                                                  | Pass locally |
| Real-time no-key round         | Nine events, eight FINISHED results, 600-second frozen duration                                                                                             | Pass locally |
| History and results            | All eight streams have **1,145 batches**, cursor **5,460**, and identical SHA-256; replay matches projection, quotes, prices and all final portfolios/ranks | Pass locally |
| Resources                      | Replay checks each transition; cash/unit conservation, nonnegative balances, covered quotes and immutable fill identities verified                          | Pass locally |
| Deployment-region run          | No designated staging host/topology exercised                                                                                                               | **UNRUN**    |

The full report includes all eight synthetic final results, nine authored news
items, cumulative histograms, periodic scrapes and gate outcomes. No provider
credential, raw cookie, transport header or browser storage is retained. No
generated narration was present; missing-key worker fallback and browser
rendering have separate passing suite evidence.

## Performance diagnosis and fix

The isolated baseline on `5b73438` reproduced the original failure before any
service change: [baseline](artifacts/ticket-21-before.json) acknowledged 359
orders, skipped 49 and recorded client RTT p95 10,466ms. Smoke previously asserted
workload completeness but not latency; it now asserts the actual acknowledgement,
delivery and snapshot targets. The [second run](artifacts/ticket-21-repro.json)
failed the acknowledgement and workload gates again (64 skipped offers).

Ranked predictions, shown before experiments:

1. Repeated recipient authorization/private reads and publication constrain the
   serialized path. Consolidating equivalent reads should reduce publication
   time even with short history.
2. Accumulated receipts and complete snapshot/history reconstruction increase
   service time. Growing history should raise engine/read/write costs; compact
   live state and incremental publication should flatten that growth.
3. Individual database queries or COMMIT dominate. If true, application work
   reduction should have little effect and COMMIT should account for most time.

The [instrumented baseline](artifacts/ticket-21-profile-before.json) measured
mean queue wait 5,137ms, durable submission 17.24ms, publication 35.79ms, engine
processing 0.98ms, and private delivery 3.82ms. Individual reads averaged 0.50ms
and COMMIT 0.35ms. This supports excessive serialized round trips, not slow
individual commits. Service time above 25ms/order cannot sustain 40 orders/s.

| Isolated change / report                                                                                      | Submitted / skipped | Server acknowledgement p95 upper bound | Mean publication |
| ------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- | ---------------- |
| [Batched audience reads](artifacts/ticket-21-batched-publication.json)                                        | 408 / 0             | 7,110ms (fail)                         | 20.36ms          |
| [Incremental market publication](artifacts/ticket-21-incremental.json)                                        | 408 / 0             | 3,666ms (fail)                         | 9.14ms           |
| [60-second growth before compacting receipts](artifacts/ticket-21-growth-before.json)                         | 1,421 / 987         | 12,188ms (fail)                        | 12.88ms          |
| [Compact live projections](artifacts/ticket-21-growth-compact.json)                                           | 2,392 / 8           | 4,188ms (fail; 24 rate-limit errors)   | 7.59ms           |
| [Immediate private delivery using fresh publication authorization](artifacts/ticket-21-private-delivery.json) | 408 / 0             | 200ms (pass)                           | 6.72ms           |
| [60-second growth after the fix](artifacts/ticket-21-growth-after.json)                                       | 2,400 / 0           | 200ms (pass)                           | 7.43ms           |

The growth experiment raised mean engine processing from 1.15ms to 2.76ms and
state reads from 3.41ms to 7.51ms. Compact projections reduced engine work to
0.53ms; final growth validation measured 0.58ms and state reads 1.21ms. All 2,400
orders completed, private results matched acknowledgements, public confirmations
were complete, and the first scheduled event lag was 285ms. The final smoke
max acknowledgement was 221ms; the growth run max was 309ms, with p95 still
below 300ms. A maximum over 300ms is not a p95 failure.

The fix batches fresh recipient reads, publishes complete market batches without
rebuilding full history snapshots for ordinary orders, keeps live projections
bounded while preserving durable receipts and complete replay, and emits private
results using the same publication's fresh authorization. Cache invalidation,
projection comparison, session expiry, membership checks, serialized processing,
commit-before-publication, original retry outcomes, frozen rules 1.1 and all
acceptance timing boundaries remain enforced.

The load helper records numeric query classes only. In the retained experiments
above, whitespace-prefixed SQL (including the audience SELECT) was classified
under `db_other_ms`; later runs trim whitespace before classification. Service,
queue, engine, publication and acceptance spans are unaffected by this labeling
correction. No SQL parameters, raw credentials or arbitrary driver errors are
captured. Histograms are upper bounds, not exact percentiles.

`--smoke --growth` is a diagnostic, not full-round acceptance. The final harness
also counts expected and unoffered attempts, validates owner-only results, and
applies public reference-price updates to the workload. An offer missed because
the harness falls behind now fails completeness independently of the safety cap.

## Sustained history-growth finding

The [first sustained run](artifacts/ticket-21-sustained-before-context.json)
completed all **23,976 expected offers**, zero skipped/unoffered attempts, all
private results and **172,728** public confirmations. Full replay, all nine events,
final results and conservation passed. Snapshots peaked at **203ms** and delivery
p95 was at most **25ms**. It still **failed**: server acknowledgement p95 upper
bound **300ms** does not prove the strict <300ms gate, and scheduler lag reached
**1,283ms**. Client RTT p95 was **273ms**. This is not a passing sustained run.

The late-round read maximum reached **1,255ms**, while COMMIT averaged **0.34ms**.
Scheduled narration context still fetched every full prior engine batch, including
quotes and private receipts it never used. The follow-up changes only that read:
PostgreSQL projects commands, trade events, and complete scheduled-event boundaries.
Narration calculation, frozen input schema, source cutoff, ordering, transaction,
commit timing and full immutable replay remain unchanged. Replay independently
compares each resulting job with context recomputed from complete history.

The targeted scheduled-event, commentary and recovery suites passed **42 tests
in 3 files**, including empty activity windows, exact-deadline trades, multi-symbol
shocks, atomic rollback and restart. Both independent review axes found no issue
in the follow-up. Performance still requires the subsequent sustained measurement.

## Admission-denial amplification

The [next sustained run](artifacts/ticket-21-sustained-context.json) isolated the
narration-read change. Initial event lag improved (133ms, 205ms, 253ms), but an
early queue spike grew into **61 RATE_LIMITED responses**, **9,789 skipped offers**,
and acknowledgement timeouts. It failed workload, acknowledgement, private-result
completeness and scheduler gates. All nine events, full replay, final results,
resource integrity and public delivery confirmations still passed. Unrelated
browser and OS background CPU activity was observed during this run; no such
process was stopped. Host contention may have triggered the initial spike, but
it does not excuse the service's amplification or make this a passing run.

Every rate-limit exception discarded verified state, so the next legitimate
command replayed the accumulated immutable history. A regression through three
real Socket.IO connections and PostgreSQL demonstrated an unnecessary full replay
immediately after denial (**red: 1 read, expected 0**). The focused operations
suite passed all **5 tests** after changing that admission path to complete its
read-only transaction, then throw the same external rejection. No order/history/
engine work occurs on this path. Both ownership checks still run; storage,
COMMIT, ownership and integrity failures retain ordinary rollback and cache
invalidation. Limits, burst capacity, budget timing and error contracts are
unchanged. The regression also corrupts the replaceable projection and proves
that the next snapshot still performs full recovery and repairs it.

The [60-second regression after admission repair](artifacts/ticket-21-growth-cache.json)
passed with **2,400/2,400 offers**, zero skipped/unoffered attempts or transport
rejections, complete private/public delivery, acknowledgement p95 upper bound
**200ms**, delivery p95 upper bound **25ms**, and first-event lag **328ms**.

## Interrupted measurement and histogram resolution

The [following attempt](artifacts/ticket-21-sustained-interrupted.json) ran the
complete fix but was interrupted by macOS idle sleep. System power logs record
sleep at **13:49:27 EDT**, a maintenance wake at **13:55:38**, and full wake at
**13:57:15**. A database read recorded a **369-second** pause; clients disconnected
and **14,024 offers were unoffered**. This attempt failed before integrity checks
and supplies no full-round acceptance evidence. Subsequent macOS measurements
use a temporary `caffeinate -i` assertion; no permanent power settings change.

The final histogram adds **250ms and 299ms** buckets. A 300ms upper bound cannot
prove a strict <300ms target even when the actual percentile may lie below it.
This improves resolution only: the receipt-to-acknowledgement boundary, inclusion
of queue delay, population and strict threshold are unchanged. Earlier artifacts
and their failed or incomplete verdicts remain unchanged.

## Validation of the performance fix

### Remaining round trips and scheduled-history reads

The [keep-awake sustained run before bulk insertion](artifacts/ticket-21-sustained-before-bulk.json)
still failed: **23,842 submitted**, **23,745 completed**, **150 skipped** and
**97 rate-limit errors**, acknowledgement p95 upper bound **5,000ms** and
scheduler lag **1,694ms**. Private results, public confirmations, all nine events,
final results and replay integrity passed. This is retained as a failure.

One-variable experiments then addressed the remaining serialized costs:

- Bulk event insertion replaces one INSERT per event with one INSERT per atomic
  engine batch. Envelopes, generated IDs, ordering, row constraints and the
  transaction remain unchanged. The [growth measurement](artifacts/ticket-21-growth-bulk.json)
  completed all **2,400 offers**, zero skipped/unoffered attempts, acknowledgement
  p95 upper bound **200ms**, and mean durable submission **11.85ms**. Focused
  trading/recovery/operations checks passed **32 tests**.
- The earlier narrowed narration query still scanned every historical batch.
  The final read selects the current execution window and one earlier execution
  per affected asset, using the previous scheduled batch's complete boundary.
  That preserves last-executed price for empty windows without loading all prior
  quote JSON. Full immutable replay independently reconstructs the context and
  compares it. Scheduled-event/commentary/recovery checks passed **42 tests**,
  including strengthened exact-boundary and carried-last-price assertions.

Both independent review axes found no additional issue in these two changes.

The [bounded-read growth measurement](artifacts/ticket-21-growth-bounded.json)
completed all **2,400 offers** with complete deliveries and **24ms** first-event
lag, but acknowledgement p95 upper bound was **1,000ms**: still a failure.
Mean durable submission was **13.69ms** and publication **8.59ms**, leaving too
little margin for observed query-time spikes. Individual COMMIT averaged
**0.41ms**. This motivated one further round-trip reduction: order admission
keeps fresh session authentication, then reads room, membership, original-round
participation and abort status together. Validation precedence, token timing,
historical retries and ownership checks remain unchanged. Focused
trading/recovery/operations checks again passed **32 tests**; independent Spec
review found no change to authorization or rejection semantics.

The [smoke rerun after admission consolidation](artifacts/ticket-21-smoke-admission.json)
passed all applicable smoke gates: **408/408 offers**, zero skipped/unoffered
attempts, complete private/public delivery, server acknowledgement p95 upper
bound **200ms**, client RTT p95 **190ms**, and maximum acknowledgement **244ms**.
Smoke does not establish scheduled-event or full-round acceptance.

The [sustained admission-consolidation run](artifacts/ticket-21-sustained-admission.json)
still failed: **23,874 submitted**, **23,719 completed**, **118 skipped**, and
**155 rate-limit responses**. Acknowledgement p95 upper bound was **5,000ms**.
All nine events, complete private/public delivery, snapshots, replay, conservation
and final results passed; maximum scheduler lag was **118ms**. Typical persistence
plus publication remained about **20ms/order**, with transient query-time spikes
producing backlog. The report also recorded a disconnect during lengthy offline
replay after final online evidence had been captured. The harness now deliberately
closes sockets after final resync, confirmation deadlines, metrics and stream
comparison, before synchronous offline replay; online gates remain unchanged.

A [60-second CPU-profile run](artifacts/ticket-21-profile-late.json) sampled the
game-server child with Node's default 1,000µs CPU profiler. The
[credential-safe summary](artifacts/ticket-21-cpu-summary.json) records **56.12s
idle out of 70.97s**, and **0.28s** garbage collection. Profiling overhead makes
this diagnostic evidence only. Temporary profiler flags were removed. Alongside
numeric database spans, this supports reducing round trips rather than engine
arithmetic or garbage collection.

The next isolated change combines event INSERT, batch INSERT and projection
UPDATE in one dependent statement, preserving their ordering, row triggers and
outer transaction. Focused trading/recovery/operations checks passed **32 tests**.
The [smoke measurement](artifacts/ticket-21-smoke-batch-statement.json) completed
**408/408 offers**, zero skips, acknowledgement p95 upper bound **200ms**, and
mean persistence **10.45ms**. A subsequent change joins projection and final-result
reads, retaining the same full result validation, including unexpected results
during OPEN and missing or corrupt results after settlement.

The [joined-read growth attempt](artifacts/ticket-21-growth-projection-join.json)
completed all **2,400 offers** but stopped at final client comparison; it is
incomplete evidence, not a passing run. The harness now freezes the captured
snapshots before offline replay and, in growth mode, waits for all clients to
receive the first scheduled event before final resync. This avoids capturing
different sides of that event's deadline. The scheduled-event latency target
and all acceptance spans remain unchanged. Numeric assertion diagnostics retain
numbers only, never arbitrary errors or payloads.

Finally, a batch that already contains `QuotesRebuilt` no longer reads a prior
quote timestamp that its public view would ignore. Batches without a rebuild
retain the existing history lookup, including legacy recovery. Focused checks
passed **32 tests**. The [final growth run](artifacts/ticket-21-growth-quote-read.json)
passed: **2,400/2,400 offers**, zero skips/unoffered attempts or transport rejections,
complete delivery and replay, acknowledgement p95 upper bound **200ms**, maximum
**232ms**, delivery p95 upper bound **25ms**, and event lag **199ms**. Mean durable
submission was **9.10ms** and publication **7.15ms**.

### Complete checks

- Focused trading/recovery/operations checks: **32 tests in 3 files passed**.
- `pnpm check`: lint, formatting, workspace/tool typechecking, **226 tests in
  12 files**, and production builds passed.
- A subsequent check encountered duplicate generated `.next/types/* 2.ts`
  declarations. The generated cache was preserved under `/tmp` and rebuilt;
  `pnpm check` then passed again. Tracked duplicate-file deletions were untouched.
- `pnpm db:verify`: **133 tests in 12 suites passed**, including new bounded
  projection/legacy recovery and incremental publication/privacy cases.
- Earlier `pnpm test:e2e` runs passed **11 Chromium tests in 8 files**.
  Two preceding full runs failed the existing 1,500ms opening-resync assertion
  in `lobby.spec.ts`. Two isolated traced runs, a later full traced run, and
  another complete suite after tracing removal passed. Numeric lifecycle tracing
  showed COUNTDOWN capture followed by an OPEN heartbeat and immediate new
  resync; it did not reproduce the failing case. The intermittent cause remains
  unresolved. No assertion or deadline was relaxed, and temporary tracing was
  removed. These earlier runs predate the final query reductions; final-source
  verification is recorded separately below.

Final-source validation after the passing sustained run:

- `pnpm check`: **passed**, including 226 tests in 12 files and production builds.
  Duplicate generated Next.js declarations recurred; the generated cache was
  preserved and regenerated before this passing rerun. Source files and tracked
  duplicate deletions were unchanged by that cleanup. The complete check passed
  again after the browser-only setup changes below.
- `pnpm db:verify`: **133 tests in 12 suites passed**, including real crashes,
  integrity aborts, transaction rollback, recovery and final-result verification.
- The first final browser attempt reproduced the earlier opening-resync failure.
  A focused rerun passed after adding an explicit COUNTDOWN precondition to the
  held reply. The subsequent full run passed that journey but failed the terminal
  reaction case (one displayed reaction, two expected). Browser setup now forces
  the COUNTDOWN capture with an existing stale batch before the real countdown
  expires, and waits for both recipients to be Connected before terminal
  reactions. Results can render while recovery still clears ephemeral reactions.
  An explicit precondition then reproduced a LOBBY reply where COUNTDOWN was
  required, so the setup now waits for the guest countdown before capturing it.
  Both affected journeys passed in the focused rerun. The final complete
  `pnpm test:e2e` then passed **11 Chromium tests in 8 files**, including the
  lobby, reactions and terminal recovery journeys. No product behavior,
  existing assertion, or timing deadline changed.
- Documentation links, full/focused source synchronization, and `git diff --check`
  passed. The application/load-harness source is unchanged from the passing
  sustained report. Later browser-only setup checks capture COUNTDOWN explicitly
  and synchronize reaction recipients; the original recovery deadlines remain
  unchanged.

## Limits and remaining gates

- The designated deployment-region host and production database topology have
  not been provided or exercised. No hosting resources were provisioned.
- The final full-round sustained profile passes locally. The default profile
  uses a ten-second peak followed by one order/player every five seconds and
  supplies separate evidence; it cannot substitute for sustained capacity.
- Browser suites accelerate only their test-owned clock; a real ten-minute
  load run supplies separate wall-clock evidence. Browser tests use the Next.js
  development server; production compilation is verified by `pnpm check`.
- No manual novice usability observation or full screen-reader/WCAG audit was
  performed. Refer to [ticket #19](ticket-19-journey.md) for precise UI checks.
- Failed, skipped and unrun checks remain incomplete evidence. Keep ticket #21
  and milestone 6 open until the required performance and environment gates pass.

## Initial implementation Standards review

The independent Standards reviewer inspected the committed diff from `7eba873`.
No documented-standard violations were found. One low-priority duplicated-code
finding identified repeated workload/RTT report assembly with different duration
boundaries. The report now assembles those fields once, records offered-load
duration at the end of submission, and labels elapsed verification time
separately. The reviewer confirmed the fix; zero findings remain.

## Initial implementation Spec review

The independent Spec reviewer found no actionable implementation defects or
unrequested gameplay changes. Failed workloads and latency gates remain failures;
synthetic credentials and no-key operation remain isolated. The initial full browser and real-time-round evidence is recorded above.
At that review, deployment-region and peak-capacity gates remained open. The identified capacity
blocker does not establish AC-18 or release readiness.

A final independent Spec check compared both retained JSON artifacts with this
report after the real-time run and found no factual inconsistencies. The final
source-metadata refinement computes the working-tree flag rather than hardcoding
it; it does not change workload or gameplay.

Review totals: **0 remaining Standards findings; 0 Spec findings**. Reviews were
static; the reviewers did not rerun test suites or interfere with load runs.

## Standards review of the performance fix

An independent reviewer inspected the working diff against `5b73438`, excluding
pre-existing duplicate-file deletions. No gameplay, privacy, transaction-ordering
or recovery violations were found. The generated `next-env.d.ts` build change is
excluded from the fix. The query-classification finding was corrected by trimming
leading whitespace before numeric classification.

One nonblocking heuristic remains: owner-specific terminal assembly in the bulk
publication path resembles the existing individual result reader. Both use the
same runtime contract, and the bulk path selects only the recipient's portfolio.
A shared pure mapper is a possible later cleanup; it is not a correctness or
performance requirement for this fix.

## Spec review of the performance fix

The independent Spec reviewer found one instrumentation attribution error, now
resolved and verified. Follow-up review confirmed planned-offer accounting,
private-result checks, batch reference updates and unchanged acceptance timing
boundaries. Both reviewers also checked the bounded narration reads, read-only admission
denial, consolidated admission and persistence queries, shared result validation,
and harness evidence boundaries. No additional findings remain. Reviews were
static and ran no workloads. Both axes also reviewed the final browser setup
preconditions and found no new issues; the Spec review confirmed that the
retained sustained report agrees with the evidence summary.

Review totals: **0 remaining hard Standards violations; 1 optional duplication
heuristic; 0 remaining Spec findings**. Deployment-region acceptance remains
unverified regardless of local results.

## Deployment preparation continuation (October 16, 2026)

Starting commit `4cef8a79d536fc6f676ac53cee85f379a8f75fbe`, same `ticket21`
branch. User-approved seams: production HTTP/Socket.IO ingress, database
connection/role setup, and the existing eight-client runner. The untracked
`scripts/setup-hosting.sh` and ignored account credentials were preserved.
The minimum #22 prerequisite is in [the staging execution plan](../staging-deployment.md)
and [Render template](../../deploy/render.staging.yaml). No hosted resources
were provisioned or deployed by this work, and no acceptance target changed.

The staged adapter calls the same workload/assertions through public HTTPS and
private operator metrics, and verifies persisted history with a SELECT-only
login. It requires a new synthetic identity, fresh data, a matching game/source
identity and secure cookies. Its cleanup closes connections only. The original
loopback runner retains its isolated-schema cleanup guards.

Actual checks so far:

- TLS/session connection guard: test failed before implementation (missing module),
  then passed. Hosted connections require an explicit CA and reject SSL URL
  overrides; Supabase transaction pooling is rejected.
- Restricted-role integration: initial execution needed local socket permission;
  the authorized rerun passed. A real game owner starts under the runtime login;
  audit cannot write, game cannot create tables/change its identity marker, and
  audit cannot execute commentary functions.
- First local HTTPS rehearsal failed at the cookie assertion: the new assertion
  incorrectly expected Lax while the existing contract uses Strict. The assertion
  was corrected to Strict; product cookie policy did not change. The
  [failed report](artifacts/ticket-21-staging-cookie-assertion-failure.json) is retained.
- The [production-ingress smoke](artifacts/ticket-21-staging-smoke.json) passed
  **480/480** offers, no skipped/unoffered attempts, acknowledgement p95 upper
  bound **200ms**, delivery p95 upper bound **25ms**, complete private/public
  deliveries, identical streams and replay/resource integrity. It uses actual
  production game/Next.js binaries behind a trusted temporary localhost HTTPS
  terminator with PostgreSQL 18.6 on tmpfs. It is **smoke only**: no nine-event or
  full-round gate is claimed. It also is not evidence of managed PostgreSQL TLS,
  Render capacity/placement or Supabase compatibility.
- `pnpm check` passed: lint, format, typechecking, **227 tests in 13 files**, and
  production builds. Later source/configuration refinements are being checked
  separately; final results are recorded below when complete.

| AC / gate         | Additional boundary                                                                               | Current status                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| AC-05/10/18       | Production HTTPS proxy, Secure/HttpOnly/Strict cookie, private operator routes                    | Local smoke passed; hosted ingress unverified                                |
| AC-08/12/16       | Same eight-client assertions through staged adapter, restricted replay login                      | Local smoke passed; full hosted run unverified                               |
| AC-09/11/13/18    | Nine events and ten-minute no-key final results on candidate topology                             | Hosted run unverified; prior local sustained evidence retained               |
| AC-14/15          | Owner lock/recovery and durable hosted storage                                                    | Local suites support behavior; provider restart/ownership/restore unverified |
| AC-17             | Desktop/360px journey                                                                             | Prior browser evidence retained; continuation results below                  |
| #22 minimum setup | Render config, separate credentials, verified TLS/session settings, startup/teardown instructions | Prepared locally; provider validation awaits approval                        |

Deployment-region acceptance and #21 remain **OPEN / UNVERIFIED**. A report's
candidate region description is not provider placement evidence. Attach actual
redacted service/project inventory and source revisions to any future run. Full
#22 fresh-checkout/optional-worker/backup-restore and release gates remain separate.

### Continued validation and first sustained rehearsal

The complete database suite passed **134 tests in 13 files**. The complete
browser suite passed **11 Chromium tests in 8 files**, including desktop and
360px journeys. Final source typechecking passed after the Render host:port
reference wiring. Both independent reviews of `4cef8a7...3a19798` reported
**zero Standards violations/actionable smells and zero Spec findings**.

The [first local production sustained run](artifacts/ticket-21-staging-sustained-local.json)
**failed**: 23,350 submitted of 23,992 expected offers, 23,207 completed,
642 skipped, zero unoffered, and 143 rate-limit responses. Final server
acknowledgement histogram p95 upper bound was **5,000ms** (maximum 9,932ms);
client RTT p95 was **4,483.6ms**. The complete eight streams matched,
23,207 private results and 167,184 public confirmations were captured, and
no public delivery timeout occurred. Snapshot maximum was **248.9ms**;
all nine scheduler measurements were within **125ms**. Delivery p95 upper
bound was **25ms**. These passing submeasurements do not rescue the failed load.

This run then stopped at **verify persisted history and projection** with a
database error before producing an integrity verdict. Replay, conservation and
final-result comparisons are therefore **unverified in this report**. Its original
SQLSTATE was not retained; do not treat the timeout explanation as proven.
Inspection found the staged audit pool inherited the game connection's 5-second
statement timeout, which the original isolated replay pool does not have. The
adapter now preserves the original unlimited offline SQL duration; the game
keeps its 5-second setting and all online thresholds remain identical. Future
reports retain only a small allowlist of SQLSTATE codes, never SQL/error details.
The first artifacts' generic topology text says "durable PostgreSQL" even in
rehearsal mode: those runs actually used **local tmpfs**, not persistent storage.
The metadata now distinguishes this explicitly; retained artifacts are unchanged.

During the slowdown, sampled mean persistence plus publication was roughly
30ms/order, over the 25ms budget for 40 orders/second. Other host processes were
consuming CPU; none were stopped. This observation does not establish causality.
The [subsequent direct growth control](artifacts/ticket-21-direct-growth-control.json)
passed **2,400/2,400 offers**, no skips/unoffered/rejected transport attempts,
acknowledgement p95 upper bound **200ms**, delivery **25ms**, and all applicable
growth/replay gates. It uses the original direct helper, not the HTTPS topology;
it cannot isolate transient contention from runtime/role/proxy differences.
The full staged rerun after audit configuration correction is recorded below.
