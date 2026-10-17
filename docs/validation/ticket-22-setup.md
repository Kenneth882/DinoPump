# Ticket #22 setup and demo preparation

Work on October 16, 2026 on `ticket22`, starting at `756295a`, then fast-forwarded
to merged PR #42 (`227f7ad`) at the user's request. Its tree was identical; local
edits were preserved. [#22](https://github.com/Kenneth882/DinoPump/issues/22)
requires fresh setup, secure configuration, startup/recovery and honest evidence
under §7–13; applicable ACs are AC-10/12/13/14/15/17/18.

The user confirmed privately sharing the URL/room code, with no new access gate.
The pre-existing untracked `scripts/setup-hosting.sh` is excluded from this work.
No gameplay behavior, workload, acceptance threshold or frozen rule changed;
full/focused requirements remain unchanged. #21's existing failed artifacts are
retained. Its administrative closure does not establish acceptance.

## Scope

- README setup now builds workspace dependencies before database commands and
  starts the separate restricted worker from a copyable environment template.
- [Startup/recovery](../setup-and-recovery.md) documents all four local processes,
  compiled startup, environment ownership, probes, shutdown, database/ownership
  failures, nondestructive backup/restore and history retention.
- [Demo proposal](../demo-deployment.md) and [Blueprint](../../deploy/render.demo.yaml)
  reuse PR #42's two-service topology, verified TLS and private proxy. Demo data
  is separate from synthetic staging. Costs, manual migrations, single ownership,
  hosted verification and exact teardown actions remain approval-gated.
- Hosting/status summaries now lead with the later #21 failures rather than the
  earlier passing loopback result. Historical measurements are not rewritten.

## Validation record

Fresh local clone at `/private/tmp/dinopump-ticket22-checkout`, with no inherited
`node_modules`, build outputs or secret files; candidate documentation/configuration
copied into it. Node **24.21.0**, pnpm **10.34.5**, Docker Desktop **4.81.0**,
Compose **5.2.0**, PostgreSQL **18.6**, macOS/arm64. Local setup used synthetic
credentials, an independently named persistent volume and port **55436**, leaving
the user's development database untouched. Other test harnesses retain their
isolated tmpfs databases. No provider key was supplied.

| Check                                                                          | Actual result / boundary                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                               | Passed in the fresh clone; 213 pinned packages. An initial shell with Node 25/pnpm 9 was correctly rejected; explicitly selecting the pinned versions passed.                                                                                                                                                                                                                                                             |
| `pnpm build:shared`, `db:up`, `db:check`, `db:migrate` twice, `db:worker-role` | Passed. Migrations 1–7 applied once; repeat reported current; separate restricted worker login created.                                                                                                                                                                                                                                                                                                                   |
| `pnpm dev` + `pnpm worker`                                                     | All four components started; web baseline, game readiness and worker readiness passed; worker logged provider disabled.                                                                                                                                                                                                                                                                                                   |
| Compiled game/web/worker start commands                                        | Passed after build. A remaining development child first prevented competing ownership; after stopping it the compiled game acquired ownership and became ready.                                                                                                                                                                                                                                                           |
| `pnpm typecheck` and final `pnpm check`                                        | Passed: lint, formatting, tools/workspace types, **227 tests in 13 files**, all production builds. Later edits only clarify documentation.                                                                                                                                                                                                                                                                                |
| Demo operator commands copied verbatim from runbook                            | Local create-only schema/login and migrations/grants passed; migration repeat applied nothing. Managed Supabase privileges/TLS remain unverified.                                                                                                                                                                                                                                                                         |
| Local backup/restore                                                           | Passed into a separate `dinopump_restore_check` database. Source contained an accelerated synthetic two-guest round, a 150-unit fill, nine events and frozen results. Archive restored with no owner/ACL, function permissions reapplied, owned startup ready, complete replay hash identical. See [redacted restore artifact](artifacts/ticket-22-local-restore.json). This is not a wall-clock round or hosted restore. |
| Documentation targets and specification coverage                               | All local Markdown file links resolve; all 15 numbered sections match their complete-reference extracts. No requirement/rules change.                                                                                                                                                                                                                                                                                     |

The first `pnpm db:verify` attempt passed 133/134 tests; the separate worker test
collided with the manually running worker on port 3002. The guide now explicitly
requires stopping manual processes and leaving the test Compose project override
unset. Clean database/browser/production-ingress results are being recorded below.

No new application behavior or repository test seam was introduced. Existing
engine, database, browser and production-ingress suites supply validation; the
restore fixture uses the existing store/replay interfaces with an accelerated
synthetic clock. No new gameplay timing is exposed to production.

## Acceptance boundary

Local verification is preparation for a small demo, not hosted demo readiness.
Managed PostgreSQL version/permissions/session pooling, CA verification against
Supabase, actual Render WebSocket ingress, stop/start handoff and hosted restore
remain unverified. No resources were provisioned, no push/deployment occurred,
and no provider credentials or billing settings were inspected.

The latest retained #21 production rehearsal submitted **21,602/24,000** offers
and acknowledgement p95 exceeded **5,000ms**, against the unchanged **<300ms**
target. Earlier loopback success and a later smoke cannot override those failures.
Regional AC-18 and milestone 6 remain incomplete. See the complete
[#21 evidence and artifacts](ticket-21-acceptance.md).
