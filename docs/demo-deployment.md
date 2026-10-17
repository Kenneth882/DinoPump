# Small privately shared demo: approval and runbook

Prepared October 16, 2026 for [#22](https://github.com/Kenneth882/DinoPump/issues/22),
reusing merged [PR #42](https://github.com/Kenneth882/DinoPump/pull/42).
**Nothing here authorizes provisioning, pushing or deploying.** The local work
is preparation; [actual validation](validation/ticket-22-setup.md) distinguishes
it from hosted readiness and full acceptance.

“Invite-only” means the user shares the HTTPS URL and room code privately. It is
not an authentication gate: anyone with the URL can create a guest session and
anyone with a lobby code can request to join. The user confirmed this boundary.
Start with two invited people and ordinary manual trading. The existing 2–8
player rules, ten-minute duration and rate limits remain unchanged. Do not market
this as validated eight-player peak capacity. #21 remains an acceptance blocker
despite its administrative closure. The #22 local HTTPS smoke also failed the
unchanged acknowledgement target (694.3ms p95 upper bound, all 480 offers
completed); it establishes no capacity sign-off.

## Exact proposal to approve before spending

| Resource                         | Configuration                                                                                                                                                                    | Base cost / lifetime                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Supabase project `dinopump-demo` | Dedicated project in the existing Pro organization, Micro (shared CPU, 1GB RAM), North Virginia `us-east-1`; Data API disabled; session pooler port 5432; schema `dinopump_demo` | $25/month organization base including one Micro within its $10 compute credit; retain until explicitly retired |
| Render `dinopump-demo-game`      | Private Node service, Virginia, `0.5c-512mb`, one instance, auto-deploy off, no disk                                                                                             | $7/month                                                                                                       |
| Render `dinopump-demo-web`       | Public Node web service, Virginia, `0.5c-512mb`, one instance, auto-deploy off, included HTTPS address, no disk                                                                  | $7/month                                                                                                       |
| Render workspace                 | Existing Hobby workspace, no paid workspace upgrade                                                                                                                              | $0 base                                                                                                        |

**Total base: $39/month**, plus tax and metered usage. This assumes one Micro
consumes the included compute credit. If an existing Pro organization already
uses that credit, a second Micro adds approximately $10/month; do not assume the
$39 total still applies. Record the chosen organization/project ID, credit usage,
account quote and public hostname before approval. The local account-preparation record is for **staging**, not this demo. Do not
repurpose or delete that recorded project as part of demo creation. Its existence,
current billing and organization credit usage must be verified before approval;
no account billing quote has been inspected. The planning ceiling is $50 all-in/month; it is not a universal
provider hard cap. Stop and request a revised plan if the quote/forecast exceeds
it. Do not silently upgrade capacity. Keep Supabase's spend cap on and inspect
both providers' usage; compute and some charges are outside that cap.

No hosted commentary worker, LLM key, Redis, Render Postgres, app disk, custom
domain, paid IPv4, log drain, PITR add-on or extra restore project is included.
PR #42's optional **separate synthetic staging** proposal remains available:
three named Render staging services plus an extra Micro for at most 24 hours,
under $1.70 estimated compute and a $10 total allowance, assuming an existing Pro
subscription. Approve that inventory separately in [staging deployment](staging-deployment.md).
Never point its load runner at the demo database or invited guests.

Prices and configuration checked against primary provider pages on October 16,
2026: [Render service prices](https://render.com/articles/render-vs-railway),
[Blueprint plan IDs](https://render.com/docs/blueprint-spec),
[Supabase pricing/credits](https://supabase.com/pricing),
[hourly compute](https://supabase.com/docs/guides/platform/manage-your-usage/compute).
Account checkout quotes take precedence. Usage, tax and future recurring duration
prevent an exact all-in bill estimate before account review.

Approval must identify: the source commit/branch to push/deploy, chosen existing
or new Supabase organization/project, the two service names/sizes, quoted cost
within the ceiling, the included public hostname, and whether temporary staging
is included. The user owns ongoing billing and teardown. No resources have been
created by this task; actual provider IDs are assigned only after approval.

## Configuration and build

Use [deploy/render.demo.yaml](../deploy/render.demo.yaml). It retains PR #42's
private game, same-origin Next.js proxy, pinned toolchain and verified TLS setup;
it omits the synthetic staging marker and load runner. This is a separate demo
schema, never a promoted load-test schema. Render Blueprint creation itself
starts billable resources. Choose the approved repository branch in the Blueprint
UI, verify the exact commit, and keep automatic deploys/previews disabled.

The web's `GAME_SERVER_HOSTPORT` is supplied from the private game service at
build and runtime; it must match because Socket.IO rewrites are compiled. Leave
`GAME_SERVER_ORIGIN` unset on Render to avoid a conflicting override. Rebuild web
when the private target changes. Set game `WEB_ORIGIN` to the exact public HTTPS
origin (no trailing slash/path). Browser HTTP and Socket.IO both use that origin.
Production game sets `HttpOnly; Secure; SameSite=Strict` cookies. No database key
or admin URL goes to web. `/metrics`, `/readyz` and operator routes remain private;
public web health checks alone do not prove owned database readiness.

Render uses Node 24.21.0 and Corepack selects package-pinned pnpm 10.34.5. Frozen
installs include build dependencies. Both services keep their workspace root;
do not deploy only an app subdirectory without shared packages. The game listens
on `0.0.0.0:10000`; web listens on `0.0.0.0:$PORT`. Neither runs migrations on boot.

## Database preparation after approval

Use a dedicated project with Data API disabled. Keep the administrative URL on
the operator machine only. Copy the **session pooler** endpoint/routing login from
Supabase Connect, port 5432; transaction mode 6543 cannot preserve the ownership
lock. Download the project CA and use explicit verified TLS. Do not append URL
`sslmode`, `sslrootcert` or `options` parameters: the shared connection helper
supplies CA verification and schema selection. See
[connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

From the approved checkout, install/build shared packages. Create ignored,
mode-600 `.env.demo-operator` locally, never in Render:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT:ENCODED_ADMIN_SECRET@COPIED_POOLER_HOST:5432/postgres
DATABASE_SSL_CA_FILE=/absolute/path/to/supabase-ca.pem
DATABASE_SCHEMA=dinopump_demo
DEMO_GAME_PASSWORD=REPLACE_WITH_A_UNIQUE_RANDOM_SECRET
```

Use a password manager to generate/save the runtime password. First preparation
is create-only; the following refuses an existing schema or login and never
resets data. It uses the same migrations and connection helper as PR #42:

```sh
pnpm install --frozen-lockfile
pnpm build:shared
node --env-file=.env.demo-operator --input-type=module <<'JS'
import { Pool } from 'pg';
import { databaseConnection } from './packages/database/dist/index.js';
if (process.env.DATABASE_SCHEMA !== 'dinopump_demo' || !process.env.DEMO_GAME_PASSWORD)
  throw new Error('Set the demo schema and runtime password');
const pool = new Pool(databaseConnection());
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('CREATE SCHEMA dinopump_demo');
  const { rows } = await client.query('SELECT quote_literal($1) AS password', [process.env.DEMO_GAME_PASSWORD]);
  await client.query(`CREATE ROLE dinopump_demo_game LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${rows[0].password}`);
  await client.query('COMMIT');
  console.info('Demo schema and runtime login created');
} catch {
  if (client) await client.query('ROLLBACK');
  console.error('Preparation failed; inspect privileges/identity without resetting data');
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
JS
```

Then migrate and grant runtime access with the operator credential. This second
command is repeatable for reviewed future migrations **only with the game stopped
and a verified backup available**. It does not recreate the schema/login:

```sh
node --env-file=.env.demo-operator --input-type=module <<'JS'
import { Pool } from 'pg';
import { databaseConnection, migrate } from './packages/database/dist/index.js';
if (process.env.DATABASE_SCHEMA !== 'dinopump_demo') throw new Error('Wrong demo schema');
const pool = new Pool(databaseConnection());
try {
  if ((await pool.query('SELECT current_schema() AS name')).rows[0].name !== 'dinopump_demo')
    throw new Error('Wrong schema');
  const applied = await migrate(pool);
  await pool.query('GRANT USAGE ON SCHEMA dinopump_demo TO dinopump_demo_game');
  await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dinopump_demo TO dinopump_demo_game');
  await pool.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA dinopump_demo TO dinopump_demo_game');
  await pool.query('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dinopump_demo FROM PUBLIC');
  console.info({ applied });
} catch {
  console.error('Migration/grants failed; keep game stopped and preserve evidence');
  process.exitCode = 1;
} finally {
  await pool.end();
}
JS
```

A failure can leave a partially migrated schema; preserve it, diagnose, and rerun
only the reviewed migration/grant phase when safe. Never rerun create-only setup
as a repair or reset. Supabase role/function privileges remain a hosted gate.

Set game `DATABASE_URL` to the copied pooler with routing username
`dinopump_demo_game.PROJECT` and its URL-encoded runtime password. Upload the CA
as its secret file `/etc/secrets/supabase-ca.pem`; set `DATABASE_SCHEMA=dinopump_demo`.
The login has DML access with immutable-history triggers but cannot migrate,
create roles or call commentary claim/completion functions. It must not own the
schema or belong to `dinopump_commentary`. The optional restricted local worker
is documented/tested separately in [commentary setup](commentary.md).

## Initial startup and demo admission

Start database → operator preparation/migrations → one game → web. From the game
service shell, verify `/readyz` and record actual PostgreSQL version,
`current_schema()` and `SHOW statement_timeout` through the runtime login:
expected `dinopump_demo`, 5 seconds, verified session-mode TLS. Record instance
IDs, source SHA, region and sizes. Do not infer pooler compatibility from local
PostgreSQL. Check no public operator endpoint is reachable through the website.

Before sharing the URL, run two browser profiles through a real ten-minute no-key
round, nine news events, a buy/sell, reconnect and frozen results; include a 360px
viewport. Confirm secure cookie attributes without exporting cookies. Confirm
actual WebSocket upgrades through Render and that ordinary trade acknowledgements
stay usable. Record observations, errors and timings as demo evidence. Stop the
session on repeated stalls, unready state, integrity errors or failed recovery;
do not represent a small passing session as the eight-player capacity gate.

## Maintenance, recovery, backup and retention

Use a maintenance window. Stop public web access, suspend the existing game and
confirm process exit/session-lock release before starting any replacement. Render's
normal overlapping deployment cannot safely replace a running single owner.
For a changed revision, keep the old service stopped; deploy the approved revision
only after verifying no owner remains. If the platform cannot perform that
sequence on the same service, stop and review the replacement-resource cost and
private endpoint change before proceeding. Do not temporarily run two owners or
force-release locks. Rebuild web for a changed private endpoint.

Restart reacquires ownership, verifies/replays history, applies missed events and
settles once before readiness. After database/ownership loss, restore connectivity
and restart the failed-closed owner. Verify readiness, existing guest reconnect,
original pending-order outcome and unchanged final results. Preserve aborted or
corrupt evidence. No reset/delete/seed command is part of normal operation.
See [local recovery steps](setup-and-recovery.md) and [operations](operations.md).

Supabase Pro advertises daily backups with seven-day retention; check actual
backup availability in this project. Keep complete game history/results; no
pruning is introduced. Guest expiry still limits historical participant access.
Treat database exports as private, encrypted artifacts, never repository evidence.
Before a migration, export a consistent backup and record its timestamp/checksum.
Restore only into a separately approved empty target, then replay and compare
frozen results and sample original receipts. Recreate roles/grants and verify
secure runtime connectivity before serving it. Record actual restore duration
and missing-commit window; no RTO/RPO is established by the local rehearsal.

[Supabase restore behavior](https://supabase.com/docs/guides/platform/backups)
requires provider-specific handling; this task does not authorize an in-place
restore, a paid restore project or PITR. Hosted restore remains unverified until
its exact target/cost is approved and the comparison actually passes.

## Teardown actions for approval

The user is the teardown owner. When retiring this demo: stop web access and game;
export redacted evidence and an encrypted, checked database backup; then delete
only `dinopump-demo-web` and `dinopump-demo-game` after recording their provider
IDs. Remove/disable their Blueprint so it cannot recreate services. Revoke the
runtime login and remove the associated Render secrets. Delete the dedicated
Supabase project only after its exact ID and backup disposition are approved.
Never delete unrelated projects or an existing organization. Retaining a project
continues compute charges. Deleting the final project does not necessarily cancel
the Pro subscription: explicitly review/cancel or downgrade the dedicated plan
with approval after checking all other projects. Record deletion confirmation,
remaining resources, subscription status and final usage; incurred charges remain.

Temporary staging has a separate 24-hour teardown inventory and evidence export
in its runbook. Its $10 allowance does not authorize deleting retained demo data.

## Readiness labels

- **Local setup verified:** only checks actually recorded in the #22 report.
- **Demo prepared:** reviewable configuration/runbooks and local checks; no cloud deployment implied.
- **Hosted demo ready:** only after approved provisioning and the hosted two-person/recovery checks pass, with known performance limits disclosed.
- **Full acceptance:** still blocked by #21 capacity failures and unverified regional/restore gates. Milestone 6 and #22's final MVP gate remain incomplete.
