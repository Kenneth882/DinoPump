# Ticket #21 staging execution plan

Prepared October 16, 2026 for [#21](https://github.com/Kenneth882/DinoPump/issues/21)
with the minimum hosting prerequisite from [#22](https://github.com/Kenneth882/DinoPump/issues/22).
**Provisioning, deployment, spending and hosted teardown await approval.**
Local results are recorded in the [evidence matrix](validation/ticket-21-acceptance.md).
No gameplay rules or acceptance thresholds change.

## Resources and spending proposal

Use one dedicated synthetic Supabase Pro Micro project in North Virginia
(`us-east-1`), two Render services in Virginia, and a temporary independent
Render worker as the load generator. The runner now targets deployed services,
so it needs Node rather than a Docker daemon. Docker remains local-test-only.

| Resource       | Name / configuration                                                                                   | Maximum lifetime                        | Estimated compute                            |
| -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------- |
| Public web     | `dinopump-staging-web`, Render `0.5c-512mb`, 1 instance, Virginia                                      | 24 hours                                | $7/month, about $0.24/day                    |
| Private game   | `dinopump-staging-game`, same size/region, 1 instance                                                  | 24 hours                                | $7/month, about $0.24/day                    |
| Private runner | `dinopump-staging-runner`, Render `1c-2g`, 1 instance, Virginia                                        | 24 hours                                | $25/month, about $0.84/day                   |
| Database       | Dedicated staging project in the existing Pro organization; Micro, North Virginia; session pooler 5432 | 24 hours for any newly approved project | $0.01344/hour; allow 25 billed hours = $0.34 |

Total additional compute estimate: **under $1.70** for the window, assuming the
Pro organization already exists. Reserve the existing **$10 total validation
allowance**, leaving about $8.30 for tax, metered traffic/builds and contingency.
Stop at $8 observed/forecast additional spend to leave teardown margin. This is
an operator-controlled limit, not a provider-enforced hard cap. No paid upgrade,
new Pro organization/subscription, IPv4 add-on, custom domain, worker for AI,
paid LLM, app disk, or permanent deployment is included. A new Pro subscription
would add $25 and cannot fit this temporary allowance.

The user's ignored account-preparation file records a $50 all-in monthly
ceiling, a $10 validation allowance and a 24-hour window, with the user as
teardown owner. These are planning inputs, not evidence of account billing or
permission to provision. Inspect the current provider quotes and remaining
allowances before applying this plan; stop if the total cannot fit. The existing
$39/month demo base is separate from temporary validation costs.

Pricing sources checked October 16, 2026: [Render instance prices](https://render.com/articles/render-vs-railway),
[Render prorating](https://render.com/docs/faq), [Render usage charges](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses),
[Supabase hourly compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
The [Blueprint reference](https://render.com/docs/blueprint-spec) uses resource-size
plan IDs. Provider/account quotes take precedence over this estimate.

## Source and configuration

[deploy/render.staging.yaml](../deploy/render.staging.yaml) declares all three
Render services. It is a reviewable template; creating a Blueprint immediately
creates billable services. Auto-deploys and previews are off. Use the approved
commit on the current `ticket21` branch; pushing it requires approval. Do not
silently deploy `main` from the earlier account-preparation notes.

Before creating services, choose the available public HTTPS name and record it.
Use that exact origin for game `WEB_ORIGIN` and runner `DINOPUMP_LOAD_ORIGIN`.
The Blueprint supplies web `GAME_SERVER_HOSTPORT` and runner
`DINOPUMP_METRICS_HOSTPORT` from the game's private `hostport` property. Code
adds the HTTP scheme. Outside Render, explicit `GAME_SERVER_ORIGIN` and
`DINOPUMP_METRICS_ORIGIN` remain supported; do not set conflicting overrides. Never use the public web URL
for metrics. The web forwards only the existing allowlisted API routes and
Socket.IO rewrite; `/metrics` and `/operator/deployment` remain private.

**Build and runtime game targets must match.** Next.js freezes external
Socket.IO rewrites at build time, while API routes read runtime environment.
Build web after the private origin is known; rebuild if it changes. Native
Node 24.21.0 and the workspace's pnpm 10.34.5 are pinned. Frozen installs explicitly
include devDependencies because builds and the runner require TypeScript/tsx.
The web listens on `0.0.0.0:$PORT`; the game explicitly opts into external binding.
Production Next.js does not load the developer's root `.env`.

## Operator-only database preparation (after approval)

Reuse the recorded project only after verifying it is dedicated to synthetic
staging, Pro/Micro, in North Virginia, and its Data API is disabled. Do not use
recruiter or production sessions. A newly created project must be included in
approval and the teardown inventory. Existing resources are retained unless
specifically approved for deletion.

1. Copy the session-pooler URI and routing username from Supabase Connect.
   Use port **5432**, never transaction mode 6543. Download the project's CA.
   TLS certificate and hostname verification are mandatory; remove `sslmode`
   and other SSL URL parameters because the application supplies verified TLS.
2. Create an ignored mode-600 `.env.staging-operator` containing:

   ```dotenv
   STAGING_ADMIN_DATABASE_URL=postgresql://postgres.PROJECT:ENCODED_SECRET@COPIED_POOLER_HOST:5432/postgres
   DATABASE_SSL_CA_FILE=/absolute/path/to/supabase-ca.pem
   DINOPUMP_DEPLOYMENT_ID=REPLACE_WITH_32_LOWERCASE_HEX_CHARACTERS
   STAGING_GAME_PASSWORD=REPLACE_WITH_RANDOM_SECRET
   STAGING_AUDIT_PASSWORD=REPLACE_WITH_DIFFERENT_RANDOM_SECRET
   ```

   Generate a fresh ID with `node -e 'console.log(require("node:crypto").randomBytes(16).toString("hex"))'`.
   It is a nonsecret run identifier. Store passwords in the secret manager;
   never paste them into chat, command arguments, Git, reports or screenshots.

3. From the approved checkout, run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build:shared
   node --env-file=.env.staging-operator --import tsx scripts/prepare-staging.ts
   ```

   This creates `staging_<id>`, applies all existing migrations, and creates
   `game_<id>` and `audit_<id>` logins. The game has table DML, with existing
   immutability triggers; audit has SELECT only. Neither owns the schema, can
   migrate it, or can execute worker claim/completion functions. Admin credentials
   stay off application/runner services. The identity marker is read-only for both.
   Supabase role-creation permissions and PostgreSQL compatibility remain hosted
   checks; local PostgreSQL 18.6 success does not establish them.

4. This is intentionally **create-only**, not a reset/retry command. Reusing an ID
   fails without overwriting existing credentials/data. A migration failure can
   leave a partial schema and roles; preserve evidence and diagnose it. Do not
   blindly retry, drop tables, or invoke the local test cleanup against Supabase.
5. Set game `DATABASE_URL` to the same copied pooler endpoint with routing login
   `game_<id>.PROJECT` and its encoded password. Set runner
   `STAGING_AUDIT_DATABASE_URL` to `audit_<id>.PROJECT`. Both use
   `DATABASE_SCHEMA=staging_<id>` and `DINOPUMP_DEPLOYMENT_ID=<id>`.
   Upload `supabase-ca.pem` as a Render secret file on game and runner at
   `/etc/secrets/supabase-ca.pem`. No database secret goes to web. Keep
   Supabase's spend cap enabled; compute is outside that cap.

No commentary worker or AI key is deployed. Authored news and scheduled effects
remain available. Optional worker setup and its restricted role remain documented
in [commentary.md](commentary.md); full #22 four-process/fresh-checkout sign-off
is separate from this minimum prerequisite.

## Startup and measurement order

1. Prepare the database before starting the game. Start exactly one game owner;
   it verifies the staging marker and acquires its session advisory lock before
   listening. Record actual PostgreSQL version, TLS verification, role isolation,
   Data API status and session-pooler endpoint mode without credentials.
2. Start web after the game's private origin is final. `/api/market-baseline`
   checks web-to-game connectivity; private `/readyz` checks owned authoritative
   state. A passing web health check alone is not database readiness.
3. Start the idle runner, then record provider inventory: IDs, region, tier,
   CPU/RAM allocation for all three services, Supabase project ID/region/size,
   durable storage, actual git commit for web/game/runner, build/start settings,
   and UTC start time. Retain a redacted provider export with the JSON report.
   OS CPU/memory values in a container may describe its host, not its allocation.
4. Run **one** measurement from the runner shell:

   ```sh
   pnpm test:load --staging --sustained
   ```

   Use a new synthetic schema/ID and restart the game for each run. Smoke is
   available with `--smoke --sustained` but consumes that fresh deployment; it
   never substitutes for the full ten-minute run. The adapter rejects used
   schemas, writable audit credentials, mismatched game/database/source IDs,
   insecure cookies and public operator routes. It does not migrate or delete.

5. Preserve `test-results/load-*/report.json` before any restart or teardown.
   The default workload, offered-load accounting, complete private/public
   delivery, all nine events, immutable replay, conservation and final results
   are shared with the original harness. Thresholds stay acknowledgement p95
   **<300ms**, commit-to-client p95 **<500ms**, snapshots **<1,000ms**, and every
   healthy scheduler lag **≤1,000ms**. Server acknowledgement excludes client
   internet latency; client RTT is reported separately. Delivery includes the
   HTTPS/proxy path and client confirmation. A region label alone cannot pass.
6. Compare inventory with the approved candidate. Record no-key operation from
   the deployed process configuration and complete authored news. Retain failed
   runs unchanged. No capacity upgrade or relaxed threshold is automatic.

## Recovery, retained history and remaining hosted gates

Do not deploy over a live game owner with Render's ordinary overlapping rollout:
the replacement cannot acquire the session lock until the old connection closes.
For this staging window, pause web access, **suspend the old game**, confirm it
has stopped and released ownership, then resume the same revision for restart
checks. For a changed revision, start its replacement only after that stop is
confirmed. Keep one instance and automatic deployment off. This deliberately
accepts maintenance downtime. SIGTERM disconnects sockets, stops scheduling and
closes the store/pool; committed data stays in Supabase. On database/ownership
loss, readiness fails and a new owned startup is required; do not force writes.

After the performance run, separately record reconnect and immutable results
across restart, refusal of a competing owner, and ordered catch-up after a missed
event/close using another synthetic round. Replay the original round and compare
its frozen results before/after. Existing isolated crash suites remain supporting
AC-14/15 evidence; do not inject corruption into hosted state through browser APIs.
The local real-crash suites and desktop/360px journey must still pass.

Supabase backups and a restorable application history are different evidence.
Verify a backup/restore into an explicitly approved disposable target, then replay
and compare its frozen results; never restore over the source. A daily backup
may not yet exist during a short window. Until restore is actually rehearsed,
record it as unverified for #22. No extra paid restore project is preauthorized.
No history/result pruning is introduced. Keep #21 open while any of its required
gates remain unverified, and keep broader #22 release/restore gates separate.

## Teardown proposal

The user is the recorded teardown owner; the assistant can execute the specifically
approved actions in this session. Set a 24-hour deadline when billing begins.
Before deletion, export reports, redacted inventory/build IDs, metrics and failures
into the repository evidence directory; keep any database export encrypted/private
because it includes session hashes. Confirm the export is readable and redact
credentials. Stop the workload and web access, stop game and runner, and delete
only the three newly created named staging services. Disable/remove their Blueprint
so it cannot recreate them. Revoke temporary runtime/audit credentials.

Delete a newly provisioned staging Supabase project only if its exact project ID
was included in approval. Retain any pre-existing project unless its deletion is
explicitly authorized; record its ongoing cost and owner. Never delete the Pro
organization, existing demo resources, unrelated secrets, or retained acceptance
evidence. Confirm deletion/suspension in both dashboards and record UTC end time,
actual billed usage and any remaining charges. Deleting services does not undo
already incurred charges.
