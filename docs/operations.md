# Operating DinoPump

Ticket [#20](https://github.com/Kenneth882/DinoPump/issues/20) implements the
observability requirements in [§11](spec/operations.md), supporting
AC-05/08/10/14/15/18. Gameplay rules and active-round configuration are unchanged.

## Probes and collection

The game service binds loopback on `GAME_SERVER_PORT` (default 3001). The worker
binds loopback on `COMMENTARY_HEALTH_PORT` (default 3002; override in the ignored
`.env.commentary`). Both expose uncached, GET-only JSON probes:

```sh
curl --fail http://127.0.0.1:3001/healthz
curl --fail http://127.0.0.1:3001/readyz
curl --fail http://127.0.0.1:3001/metrics
curl --fail http://127.0.0.1:3002/readyz
curl --fail http://127.0.0.1:3002/metrics
```

`/healthz` reports only a responding process. Game `/readyz` checks the owned
database transaction and full replay, and returns 503 when due work remains or
ownership/database access fails. A verified FINISHED or safely ABORTED round is
ready: inspect room status before interpreting readiness as an open market.
Introduction-only mode is live and unready. The production game listener opens
only after baseline validation, ownership acquisition, replay and catch-up finish;
startup/replay failure leaves it inaccessible and logs `service.start_failed`
without driver errors. Restart readiness never extends deadlines.

Worker `/readyz` is 503 until its first successful poll, then reflects the last
claim/completion storage operation (normally refreshed every second; a provider
attempt can take up to five seconds). Provider outage, invalid copy and disabled
narration do not make the worker or game unready. A failed poll sets worker
readiness to zero; successful polling restores it. Worker startup also verifies
the restricted database role before opening a listener.

Collect `/metrics` from a host-local monitor and forward stdout JSON to your log
collector. Keep these endpoints on the operator network when configuring a
reverse proxy; the web proxy does not forward them. They contain no player IDs,
holdings, request IDs or credentials. They require no Redis or new infrastructure.

## Reading the measurements

Counters and histograms are cumulative within one process and reset on restart.
Missing counters mean zero; missing histograms mean no measured samples.
Scrape deltas to compare intervals. Each histogram contains count, sum, maximum
and cumulative millisecond buckets (1–5,000ms); its count also includes values
above the largest bucket. Use bucket deltas for percentile upper bounds. Preserve
process identity and reset boundaries in the collector.

| Measurement                                                                             | Boundary and interpretation                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `order_ack_ms`                                                                          | Socket.IO handler receipt, before joining the serialized queue, through issuing the acknowledgement after commit, publication and private result delivery. Includes queue/database work; excludes client internet latency. Includes acknowledged rejected/retried attempts. Target p95 <300ms. |
| `commit_to_client_ms`                                                                   | Successful database COMMIT completion through a connected client's Socket.IO callback confirming receipt of a validated complete batch. Includes publication queries, transport and confirmation return; does not claim browser paint timing. Target p95 <500ms.                               |
| `snapshot_ms`                                                                           | HTTP handler receipt through issuing a successful snapshot response; socket handshake receipt through initial snapshot emission; or resync handler receipt through snapshot/ack emission. Includes queue/authorization/read work; excludes client internet latency. Target <1,000ms.           |
| `scheduler_lag_ms`                                                                      | Authoritative server time immediately after commit minus each event's persisted due time, including catch-up triggered by orders. Failed/rolled-back events add no sample. Healthy target ≤1,000ms.                                                                                            |
| `narration_ms`                                                                          | Worker generation/validation attempt duration, recorded after the completion storage attempt returns. Separate from scheduler timing.                                                                                                                                                          |
| `connected_players`, `connected_sockets`                                                | Current authorized subscriptions; multiple sockets count as one player.                                                                                                                                                                                                                        |
| `orders_received`, `orders_rejected`                                                    | Transport attempts and unsuccessful outcomes, including malformed/rate-limited attempts and durable rejections; retries count as attempts.                                                                                                                                                     |
| `orders_invalid`, `orders_rate_limited`                                                 | Malformed payloads and player-wide token-budget rejections before engine execution or durable outcome lookup. Five tokens/second, capacity ten remain unchanged.                                                                                                                               |
| `database_failures`, `ownership_losses`, `integrity_aborts`                             | Storage transaction/connection failures, detected advisory-lock losses, and safely committed integrity aborts. Optional publication storage failures also increment database failures.                                                                                                         |
| `narration_failures`, `narration_invalid`, `narration_timeout`, `narration_unavailable` | Worker attempts using fallback for failed generation/validation. Errors remain separate from game readiness.                                                                                                                                                                                   |
| `narration_disabled`, `narration_accepted`                                              | Normal no-provider fallback attempts and accepted generated attempts. Accepted means generated copy passed validation, before owner publication.                                                                                                                                               |
| `narration_publication_failures`                                                        | Game-owner attempts to publish optional worker output failed; retry independently after market delivery.                                                                                                                                                                                       |
| `delivery_timeouts`                                                                     | No client confirmation within one second. These are missing delivery samples, never zero-latency successes. Watch this with latency percentiles to avoid survivor bias.                                                                                                                        |
| `ready`, `ownership`                                                                    | Last readiness-probe result and known game ownership. Ownership loss/connection loss/close immediately clear both. Worker readiness has no room-ownership meaning.                                                                                                                             |

`narration_lease_losses` counts completions rejected by the database fence because
the lease expired or was superseded. Generation outcome counters still count that
attempt.

Delivery timing retains at most 2,048 committed sequence ranges for 60 seconds.
Recovered history and older deliveries have no live commit sample. Unsupported
clients still receive batches and count as confirmation timeouts. Confirmation
never blocks gameplay or changes state. Test environments must acknowledge batches
and report timeout counts, client count, region, host, database and workload before
making performance claims. Ticket #21 owns full eight-client load acceptance.

Structured log samples contain a fixed event name, validated room/round/request/job
IDs where relevant, sequence, duration and attempt/outcome. Only known rejection
codes and narration outcomes are admitted. No arbitrary error messages, request
bodies, headers, cookies, provider keys, URLs, generated copy or display names enter
the logging API. Each event name emits at most once per 30 seconds, including
malformed/rate-limited failures. Metrics retain every counted attempt; sampled logs
are diagnostic context, not an audit trail. Immutable database events remain the
audit source. Log-sink failure cannot roll back a successful commit.

Playwright tracing is disabled because network traces retain HttpOnly cookies.
Keep diagnostic screenshots and numeric timing attachments in ignored
`test-results/`; do not save browser storage state, cookie dumps or transport
headers. Use synthetic sessions for verification.

## Recovery

For game unready/storage failure, check PostgreSQL availability, migrations and
host connectivity without printing connection URLs. Keep traffic away from the
unready process. Connection or ownership loss fails the old owner closed; restore
the dependency and restart the game service with its documented start command.
Do not clear locks manually or run competing owners. A new owner acquires the lock,
replays immutable history and drains overdue events/close before accepting commands.
Verify `/readyz` and a participant snapshot after recovery.

On `ownership.lost`, stop the affected instance and identify the legitimate owner.
Do not force unlock or extend a round. On `round.aborted`, preserve the database
and investigate immutable evidence. An ABORTED view has no winner and no trading;
the host may return to the lobby using the normal command. Do not edit history,
delete results or reset the database to force recovery. See
[database recovery](database.md#recovery-and-projection-rebuilding).

For narration faults, inspect worker failure counters and fixed outcome samples,
its restricted database access and private provider configuration. Authored news
remains complete while bounded generation retries/fallback proceed. Owner
publication retries separately with 100ms statement and 50ms lock limits. Restart
only the affected worker when appropriate; no provider key is required for play.
See [worker setup](commentary.md).

Run `pnpm check` and `pnpm db:verify` for regression checks. The dedicated
`tests/integration/operations.database.test.ts` exercises HTTP/Socket.IO and worker
interfaces using synthetic credentials and the isolated database described in
[database verification](database.md#isolated-verification). Acceptance evidence
and remaining release limits are in [ticket #20 validation](validation/ticket-20-operations.md).
