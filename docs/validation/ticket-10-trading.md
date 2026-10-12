# Ticket #10: durable protected trading evidence

Implementation started October 12, 2026 on `ticket10` at `b8731a88014d33fb114b0df2e1e8aebf37a1bd7e`. Live GitHub read confirmed #10 open with `ready-for-agent`, no comments, #9 closed, and PR #31 merged. No tracker writes, push, or deployment were performed.

## Behavior demonstrated

Strict shared contracts exclude browser-supplied identity and private data from public messages. The owned processor authenticates at serialized processing time, applies a player-wide five/second budget with burst ten, returns original durable outcomes before new matching, drains due effects, and commits orders/fills/history/projection/room visibility together. Invalid transport and throttled retries add no market batches. Closed attempts persist zero-fill immutable outcomes anchored to committed state while #11 settlement remains pending. Gameplay rules remain frozen at 1.1.

The AC-03 150-unit FERN buy fills 100 at 4,040 and 50 at 4,080, costs 608,000 cents, and leaves 392,000 cents. Tests cover protected sells, full/partial/zero fills, conservative insufficient-resource rejection, canonical/concurrent retries, changed-content conflicts, original balances after later trades and restart, all scheduled deadlines, and finite exhausted bot resources. Seeded mixed submissions by eight participants replay conserved, nonnegative ledgers.

Socket tests compare public batches and different private portfolios, deliver results to both owner tabs and no foreign tab, cover shared rate budgets, and inject precommit fill failure and postcommit persistence-response loss. Browser tests cover partial/zero/rejected/filled outcomes, keyboard submission at 360px, postcommit delivery loss, snapshot reconciliation, older-result ledger protection, fresh idle connectivity, and preserved Daily Roar news.

## Validation environment and checks

Node 24.21.0, pnpm 10.34.5, PostgreSQL 18.6 in disposable `compose.test.yaml` storage on loopback 55433, Chromium through the pinned Playwright configuration. Eight synthetic sockets use an ephemeral service port and an injected server clock. Browser tests use two independent profiles, web 3100/service 3101, and production opening/event deadlines with no worker or AI key.

The original workspace's 22 pre-existing duplicate ` 2.*` files and duplicate generated Next types were preserved. Its web typecheck encountered duplicate declarations. Final checks use `/private/tmp/dinopump-ticket10-validation`, copying intended source files and installed dependencies while excluding those duplicates. Next route-generation changes in the original workspace were restored. No dependency or lockfile change is required.

- Contract test-first failures: missing public schemas; contradictory fill summaries accepted before semantic validation.
- PostgreSQL test-first failure: missing trading snapshot fields/entry point; subsequent AC-03 durable arithmetic/readback passes.
- Socket test-first failure: `order:submit` timed out before its handler existed; complete public/private delivery passes after integration.
- Focused browser journey passed with two contexts and a 360px screenshot. The first run required narrowing a locator after the availability copy added another bot mention.
- `pnpm check`: passed lint, formatting, typechecking, 194 tests in eight files, and production builds. Build requires no live service/database/AI key.
- `pnpm db:verify`: passed all 70 tests in six PostgreSQL/service files in 23.22 seconds; disposable container/network removed.
- `pnpm test:e2e`: passed all five browser tests in 1.3 minutes, including postcommit lost delivery, old-result balance protection, news and mobile/keyboard use; disposable container/network removed.
- After review cleanup: full typecheck, focused lint/format checks, six durability/delivery regressions, and the final two-browser journey passed again.
- Documentation checks: all 15 complete source sections match exactly one focused extract, changed local links resolve, and the staged diff has no whitespace errors.
- The 360px trading screenshot was visually inspected: labeled controls, pending/result display, currency notice, current resources, trade activity and news fit without horizontal overflow.

Full-run harness fixes: the seeded eight-player test received a 20-second allowance instead of the default five seconds; transport-only opening fixtures explicitly drain the injected due clock instead of depending on a short scheduler poll under parallel suite contention. Existing real scheduler/deadline tests remain intact. A number-array annotation corrected the new timing test's typecheck. Final reruns passed.

## Local timing evidence

An initial eight-client 240-order test exceeded its 30-second budget while constructing snapshots independently for every recipient. Sharing coherent authorized publication work resolved that failure. One subsequent measured run recorded:

| Committed orders | Acknowledgement p95 | Snapshot |
| ---------------- | ------------------- | -------- |
| 80               | 509ms               | 44ms     |
| 160              | 716ms               | 44ms     |
| 240              | 501ms               | 47ms     |

Commit-to-first-connected-client public delivery p95: 58ms. Scheduler no-op: 11ms. Injected authoritative due-to-commit lag: 0ms. These are local observations, not assertions that the deployment-region release target passes. Eight-request bursts queue behind serialized transactions and publication; acknowledgement p95 exceeds the 300ms AC-18 target. Sustained deployment-region throughput and the complete load/operational gate remain #20/#21. Readiness/startup retain full replay and derived-record integrity checks; normal publication shares public work and uses only postcommit cache state.

## Acceptance scope

AC-03/04/06: durable service arithmetic, protection, outcomes and exact resources. AC-05/07: authorization, bounds, transport/rate rejection, closed attempts, idempotency/conflicts and restart readback. AC-08/16: serialized seeded eight-player orders, replay conservation and finite liquidity. AC-10/14/17 subsets: owner-only visibility, complete batches, reconnect/lost delivery, transaction rollback and two-browser keyboard/mobile journey. These are ticket #10 evidence, not whole-milestone acceptance.

Results/closing settlement (#11), the full client reconciliation matrix (#12), general projection repair/process-termination recovery (#13), complete terminal (#14), narration workers, and release load gates remain deferred. At/after close the ticket disables and the service remains unready. Pending browser requests survive reconnect within the mounted session; refresh persistence of pending UI state is part of broader client recovery. Durable outcomes remain retrievable by their original authenticated identity.

## Standards review

Independent staged review against `b8731a8` initially suggested two duplicated-code cleanups. Computing best bid/ask once and centralizing the owner-visible recent-order query resolved both. Re-review: zero outstanding documented breaches or smell findings within Ticket #10 scope. The acknowledgement latency limitation remains a release gate, explicitly deferred by the implementation plan.

## Spec review

Independent review: zero actionable findings or scope creep. Owned durability, private/public delivery, frozen retry identity, and sequence-aware portfolio updates match the plan. Full closing/results and broader client/crash recovery remain deferred. These reviews used `git diff --cached b8731a8`, the intended staged changes before the requested local commit.
