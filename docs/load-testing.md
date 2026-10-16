# Eight-client acceptance runs

Ticket [#21](https://github.com/Kenneth882/DinoPump/issues/21) exercises
[AC-08/09/10/11/12/13/16/18](spec/verification.md) through the real HTTP and
Socket.IO service and immutable PostgreSQL history. The complete acceptance
matrix is in [ticket #21 evidence](validation/ticket-21-acceptance.md).

Use the repository's pinned Node 24.21.0, pnpm 10.34.5 and Docker setup. No
development database, `.env`, worker or provider credential is loaded. The
runner creates synthetic guests in a random schema on tmpfs PostgreSQL 18.6,
starts a separate game process on an ephemeral loopback port, and removes the
synthetic schema and Compose project afterward. It never resets the development
database. The default project `dinopump-load` uses port **55434**, separately
from the database/browser suites on 55433. Do not run two load commands together. Keep the host awake for the entire run;
on macOS, `caffeinate -i pnpm test:load --sustained` holds a temporary idle-sleep
assertion for that command without changing permanent power settings.

```sh
pnpm test:load --smoke
pnpm test:load --smoke --growth
pnpm test:load
pnpm test:load --sustained
```

`--smoke` offers twelve seconds of load on an ordinary round and stops before
its first scheduled event. It asserts acknowledgement, delivery, snapshot,
private-result equality and workload-completeness gates, but is never full-round
acceptance. `--smoke --growth` runs sixty seconds at the sustained peak, asserts
the first scheduled event's lag, and reports ten-second metric intervals to catch
history-related cost growth. Neither diagnostic substitutes for the sustained
full-round gate.
The default command runs a real five-second countdown and ten-minute round:
eight participants submit five orders/second each for the first ten seconds,
then one order every five seconds each. `--sustained` instead offers five
orders/second/player throughout the round (approximately 24,000 attempts; the exact scheduled count
uses the remaining time after all opening snapshots arrive). Neither
mode changes game defaults, deadlines or rules. Report the chosen workload;
a short peak does not establish ten minutes of sustained peak capacity.

All eight clients submit concurrently on an open-loop 200ms schedule. The
repeating mix rotates the four assets: four one-unit buys, four one-unit sells,
one buy with minimum-price protection, and one unchanged retry. Buy protection
is capped at 120% of the latest observed reference; sell protection uses the
frozen minimum. Executions may legitimately differ with current liquidity.
Each retry captures a previously acknowledged request and compares its complete
original outcome. Every private result must belong to a request sent by that client and agree with
its acknowledgement, including retries. Public batches refresh the workload's
observed references. No raw session cookies, headers or browser storage are saved.

A safety bound of 160 in-flight attempts counts skipped submissions as failure;
30-second acknowledgement timeouts also fail the run. Those collection limits
do not change the 300ms acceptance target. The report records expected, submitted,
completed, skipped and unoffered counts and stable transport rejection codes. The workload
does not automatically retry transport errors or silently slow down to wait for
acknowledgements. Run performance checks alone, without concurrent builds,
browser tests or database verification.

## Evidence and interpretation

The runner writes `test-results/load-<UTC timestamp>/report.json` even when a
check fails. It contains environment metadata, workload, server histograms,
periodic metric scrapes, a source-diff digest, client round-trip times, outcome counts, client stream
hashes, replay verification, news, final results and individual gate results.
The last phase and safe failure classifications locate incomplete runs without
serializing arbitrary driver errors. Keep numeric reports; never enable
Socket.IO debug logging or save network traces containing guest credentials.

Server timing boundaries are defined in [operations](operations.md). Server
acknowledgement timing excludes client internet latency. Client round-trip times
are reported separately. Commit-to-client timing includes the validated batch
confirmation return. Timeouts remain failures instead of disappearing from the
latency denominator. Histograms give conservative p95 upper bounds, not exact
percentiles; an upper bound equal to a strict target does not prove a pass.
The 250ms and 299ms buckets resolve values below the strict 300ms target; earlier
reports used only 200ms and 300ms in that interval and remain unchanged.
Snapshots must have a recorded maximum below 1,000ms, all nine committed event
lags must be at most 1,000ms, and missing delivery confirmations fail the gate.

Each connected client validates every batch before acknowledging it, checks
contiguous sequence ranges, and hashes its complete ordered stream. Final
resynchronization compares all eight assets, quotes, totals and cursors. History
verification reconstructs immutable batches, orders, fills, news and results
and compares them with the persisted projection. The runtime state contract
also checks nonnegative balances, covered quote reservations and exact cash/unit
conservation. Each participant's frozen portfolio and public rankings must agree
with replay. Existing crash/recovery suites provide separate fault evidence;
this load run does not deliberately restart the service.

## Deployment-region gate

See the [US East hosting and validation plan](hosting-validation.md) for the
recruiter-demo budget, topology choices, and remaining validation decisions.

Run the same checkout and commands on an authorized dedicated staging host in
the intended deployment region, with Docker available. Set a nonsecret label:

```sh
DINOPUMP_TEST_REGION=staging-region-name pnpm test:load --sustained
```

Record the actual host size, region, database topology and chosen deployment
configuration alongside the report. This runner always provisions isolated,
same-host PostgreSQL; it does not connect to an arbitrary existing game or
managed database. If the intended deployment uses a separate database host,
that topology needs additional measurement before declaring deployment
acceptance. A region label alone does not make a local run deployment evidence.
Provisioning, deployment and spending are separate authorized operations.

Keep AC-18 and release readiness open until the relevant deployment-region
measurements and all other gates pass. Failed checks identify blockers; they
must never be converted into relaxed targets or passing evidence.

## Diagnosis boundaries

The service also records `order_queue_ms` (handler receipt to serialized work),
`order_store_ms` (the durable submission call), `order_publication_ms` (fresh
audience read through public emissions), `order_private_delivery_ms` (immediate
owner-only emissions), `engine_command_ms` (new-order pure engine work), and
`state_read_ms` (catch-up's verified state read). These are diagnostic spans;
`order_ack_ms` and every acceptance boundary remain unchanged. Queue time is
included in acknowledgements, not subtracted from them.

Only the isolated load helper wraps PostgreSQL calls into numeric read, write,
COMMIT and other-query histograms (`db_read_ms`, `db_write_ms`, `db_commit_ms`,
`db_other_ms`). It retains no SQL text, parameters, credentials or driver errors.
These nested totals are not additive to the enclosing service spans. Compare
interval deltas and counts when evaluating growth or batching changes. The
retained experiment reports and hypothesis results are linked in the acceptance
matrix.

## Hosted staging adapter

After explicit resource approval and [staging preparation](staging-deployment.md),
run `pnpm test:load --staging --sustained` from the separate Virginia runner.
It uses the same eight-client workload and every original threshold. HTTPS
player traffic goes through Next.js; private metrics and a SELECT-only replay
login target the dedicated synthetic database. The runner never migrates or
drops hosted data and requires a fresh deployment identity for each run.

`pnpm test:staging-local --smoke` rehearses the production binaries, TLS ingress,
secure cookies, private metrics and replay with a local tmpfs database. Omit
`--smoke` for the full sustained ten-minute rehearsal. This command builds the
web with a temporary private origin; rebuild for normal local use afterward.
Neither local production rehearsal nor a region label proves provider placement.
Retain failed reports and attach redacted actual provider inventory to hosted
reports before updating deployment acceptance.
