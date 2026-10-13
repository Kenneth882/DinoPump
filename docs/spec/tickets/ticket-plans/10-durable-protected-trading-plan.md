# Ticket 10 implementation plan: durable protected trading

Prepared October 12, 2026 against `main` at `b8731a8` (merged ticket #9).

Ticket: [Durable protected trading](../10-durable-protected-trading.md).
Tracker: [GitHub issue #10](https://github.com/Kenneth882/DinoPump/issues/10).

## Start here

Use the installed `/implement` skill in a fresh session in this repository:

```text
Use $implement to implement GitHub issue #10 in Kenneth882/DinoPump.
Follow docs/spec/tickets/ticket-plans/10-durable-protected-trading-plan.md.
Recheck blocker #9 and create or reuse a ticket10 branch from current main.
Use $tdd at the seams below, then $code-review against the starting commit.
Preserve unrelated local work. Commit the reviewed implementation locally;
do not push, deploy, or close the issue.
```

Read [issue-tracker instructions](../../../agents/issue-tracker.md), then fetch
the live issue, labels, and comments. Planning verified #10 is open and
`ready-for-agent`, with no comments; blocker #9 is closed and PR #31 is merged.
Recheck this evidence and record the actual implementation starting commit.
If `gh` is unavailable, use the connected GitHub tools.

Inspect git status and the diff before editing. Planning found 22 pre-existing
untracked duplicate ` 2.*` files; preserve them and stage only intended changes.
The local development servers/database may already be running. Use the isolated
test harnesses for synthetic scenarios rather than resetting development data.

Read [product boundaries](../../product-and-scope.md),
[round lifecycle](../../round-lifecycle.md), [market rules](../../market-engine.md),
[interface](../../interface.md), [architecture](../../architecture.md),
[persistence](../../persistence.md), [API/recovery](../../api-and-recovery.md),
[operations](../../operations.md), [verification](../../verification.md), and
[milestone gates](../../implementation.md). Resolve discrepancies against
[PROJECT_SPEC.md](../../../../PROJECT_SPEC.md). For browser changes, follow
[web instructions](../../../../apps/web/AGENTS.md) and the installed Next.js guides.

## Outcome and scope

An authenticated participant submits a protected buy or sell from a minimal
browser ticket. One owned transaction commits the order outcome, fills, ledger
and asset changes, complete event batch, and projection. The owner receives the
private committed result; all participants receive coherent public market changes.
Lost acknowledgements and duplicate submissions never create another trade.

Reuse the existing deterministic engine and frozen rules `1.1`. Keep conservative
cash/holding validation, finite bot resources, exact integer settlement, and fixed
per-request price protection. This is service/browser integration, not a change
to matching rules. A necessary gameplay-rule change requires the repository's
version/specification/AC process before applying it to new rounds.

Deliver the minimal retry and reconnect behavior needed to use this ticket safely.
[Closing/results #11](../11-round-close-and-results.md), the complete
[client reconciliation matrix #12](../12-client-resync-and-reconciliation.md),
[projection rebuilding/crash recovery #13](../13-server-crash-recovery.md), and
[full terminal #14](../14-live-market-terminal.md) remain later slices. At/after
`closesAt`, reject new orders and disable the ticket; retain the current unready
limitation until #11 supplies settlement. Do not claim final results or a complete
round journey. Narration workers and broad release/load gates remain later work.

## Existing integration points

| Area | Starting point and constraint |
| --- | --- |
| Engine | `packages/engine/src/round-engine.ts`: `processEngineCommand(SubmitOrder)` already performs protected matching, records receipts, emits full batches, and recognizes duplicate/conflicting request identities. `getPortfolioRankings` provides marks-based public totals. Preserve this authority. |
| Contracts | `packages/contracts/src/round-engine.ts` and `protected-buys.ts`/`protected-sells.ts` define internal commands/results. Internal commands contain `playerId`; the strict public submit schema must omit it and derive it from the session. UUIDs are canonicalized internally. |
| Owned transaction | `packages/database/src/lobby.ts`: `withMarketRound` and `catchUpRound` serialize and drain due effects. Extend this boundary for authenticated order processing; validate session expiry and membership inside serialization at processing time. Avoid awaiting another queued `run` from within `run`. |
| Storage | Migrations 1–4, `persistEngineBatch`, and `readOpenedRound` persist/replay opening and scheduled batches. Add durable order identities/results and fill linkage; existing event/projection JSON already represents ledgers and assets. Keep a single authoritative transaction and validate derived order/fill records against history. |
| Transport | `apps/game-server/src/lobby-realtime.ts` serializes commands, subscriptions, and publication. Its `execute` publishes after the store promise commits. Add acknowledged `order:submit` and owner-only `order:result`, including safe trading-specific errors. |
| Visibility | `market-view.ts`, `market-updates.ts`, and lobby snapshots currently expose assets/quotes/news plus the requesting player's portfolio. Add public executions/totals and private results deliberately; raw receipts, engine state, future events, and other holdings stay private. |
| Browser | `apps/web/app/lobby.tsx` applies snapshots/batches with gap detection. Its existing pending command only supports ready/start. Extend or extract a focused trading controller so independent market/private messages cannot regress balances or resolve the wrong request. |

Two existing limits require explicit handling. First, engine `ok: true` can contain
a rejected trading receipt; `ok: false` is not automatically a persisted outcome.
In particular, a new order at the closing deadline returns an engine error without
a batch. Define safe durable service handling for valid rejected attempts without
inventing fills, advancing an unsupported settlement path, or treating integrity
errors as ordinary player rejections. Second, full replay currently occurs on
snapshot reads and again while constructing historical public updates. Measure
this with growing trade history and eight participants; avoid multiplying replay
per recipient when a verified committed batch can supply the same public view.
Any cache introduced must update only after commit, invalidate on ownership loss,
and preserve startup replay and storage-integrity checks.

## Test-first implementation slices

Work one failing behavior through persistence, service, and browser at a time.
Use synthetic identities, real isolated PostgreSQL, and injectable server time.

1. **Define public submit and result contracts.** Specify strict `order:submit`
   fields from the API spec, stable acknowledgements/errors, and owner-only
   `order:result` with request/round identity, committed sequence, fills, executed
   totals, exact average-price representation, and resulting private balances.
   Distinguish malformed transport, rate limiting, durable trading rejection,
   and unavailable/integrity failures. Publish only the frozen configuration
   fields needed for quantity bounds and default protection; the browser must
   not silently use mutable baseline rules for an active round. Define public
   trade activity and portfolio totals without private order protection or holdings.
   **Done:** runtime contract tests reject forged identity, unknown fields,
   malformed numbers/UUIDs, and private fields on public messages; all required
   filled/partial/zero-fill/rejected states have a clear representation.

2. **Persist order identity and one complete outcome.** Add the next migration
   with a database uniqueness constraint on `(roundId, playerId, requestId)`.
   Store canonical request content and immutable original outcome, including
   its original commit sequence and owner balances, with source-linked fills.
   Reuse batch/projection persistence for human/bot ledgers and asset changes;
   keep any query projections transactionally consistent with that authority.
   Look up an existing authorized request before re-evaluating price, funds,
   or the closing boundary. Return the original result for an identical retry;
   changed content returns `IDEMPOTENCY_CONFLICT`. Both filled and rejected
   attempts need durable identities. Treat a duplicate engine result with
   `batch: null` as a readback, not a new persistence operation.
   **Done:** AC-03's 150-unit FERN buy costs 608,000 cents and leaves 392,000;
   sells, partial/zero fills, insufficient resources, replay, concurrent retries,
   and restart retries produce exactly one outcome and the expected fills.

3. **Join authentication, rate limiting, due effects, and matching.** Add an
   authenticated store entry point using the existing owned transaction boundary.
   Check current session expiry, room membership, locked round participant,
   submitted round, and payload before trusting a command. Apply a per-player
   five/second token budget with burst ten across that player's sockets, before
   engine work; cleanup limiter state and bound/summarize safe rejection logs.
   Specify and test retry/rate-limit ordering: any throttled retry preserves
   the same request identity and eventually retrieves its original outcome.
   Malformed/rate-limited requests add no market events. Valid new attempts
   drain already-due scheduled effects, then match at authoritative processing
   time with the submitted protection unchanged. A boundary rejection must
   retain already-committed outcomes and perform no new fills. Persist trading
   rejections without accidentally rolling back required due work. Increment
   the room visibility sequence when new private/public state needs delivery.
   **Done:** eight concurrent participants conserve cash/units; exact refill and
   burst limits hold across sockets; both scheduler/command queue orders use
   updated quotes; orders processed before/at/after close behave consistently;
   ownership or database loss prevents writes and successful acknowledgements.

4. **Publish only complete committed changes.** Route submissions through the
   existing service queue and derive the player from its authenticated session.
   Send ordered complete public envelopes, public execution activity, and
   marks-based player totals; even a batch with private-only event details must
   advance public sequence coverage. Deliver results/holdings only to the owner,
   revalidating authorization for every recipient. Keep acknowledgement and
   `order:result` identities/outcomes consistent. A retry may redeliver its
   private result but must not republish trades as newly executed.
   Capture snapshots and delivery cursors coherently with publication. Include
   the owner's recent outcomes needed for pending resolution, or an equivalent
   authorized durable readback through the unchanged request; preserve existing
   room resync compatibility. Never truncate durable identity storage merely to
   bound a visible recent-outcomes list.
   **Done:** two sockets see equal public market state and different private
   ledgers; only the submitter's sessions receive its result; no rollback emits
   success; postcommit/pre-ack or pre-broadcast loss recovers one original result.

5. **Add the minimal usable trade ticket.** Provide asset and buy/sell selection,
   whole-unit quantity, best bid/ask, quote age, estimated execution, and default
   5% protection derived from the displayed best executable quote. Use integer
   price ticks and conservative rounding so the bound does not exceed the stated
   tolerance; respect frozen price bounds and show unavailable liquidity explicitly.
   Freeze the exact payload and UUID on the first submit. New quotes, edits,
   timeouts, and reconnects must not change that pending request. Show filled,
   partial, rejected, or pending reconciliation status, executed total, average
   fill price, and resulting resources; label estimates as nonguaranteed and
   bot counterparties clearly. Preserve exact settlement integers; round only
   display formatting for the average-price ratio.
   Apply public and private changes by round/sequence so an old retry result
   cannot overwrite newer holdings. Disable duplicate submission and trading
   while disconnected, unsynchronized, or at/after close. Reconnect through an
   authoritative snapshot before retrying the original request. Track quote age
   separately from connection freshness: an idle unchanged quote is not evidence
   of a dead connection. Implement only the freshness evidence needed by this
   ticket; the full stale/reordering/round-reset matrix remains #12.
   **Done:** two real browser contexts buy/sell, show all outcome categories,
   recover a lost acknowledgement without another fill, and retain Daily Roar
   updates. The ticket works by keyboard at 360px with visible focus, labeled
   controls, announced results/connection changes, and the currency notice.

6. **Record evidence and finish the slice.** Add focused failure tests before
   commit and after commit/before acknowledgement or broadcast; restart the
   store/service and compare replayed state, original outcomes, and fill counts.
   Preserve all ticket #9 event/news rollback and replay checks. Record actual
   commands, environment, timings, results, and deferred coverage in
   `docs/validation/ticket-10-trading.md`. Update README, lobby/database docs, and
   stage-specific browser copy; align public-contract clarifications in both
   specification forms using the [synchronization rules](../../README.md#keeping-the-references-aligned).
   Run `/code-review` against the recorded starting commit, resolve findings,
   and commit only the scoped implementation and evidence.
   **Done:** required checks pass, reviewers have no unresolved actionable
   findings, and the report distinguishes this slice from whole-milestone or
   release acceptance. Unrun/failing checks remain explicit incomplete evidence.

## Validation map

| Acceptance | Required ticket #10 evidence |
| --- | --- |
| AC-03/04/06 | API plus PostgreSQL buy/sell arithmetic, conservative funding, full/partial/zero fills, protection unchanged, and exact ledgers. |
| AC-05 | Invalid/forged/expired/nonmember/wrong-round commands, closed orders, stable safe codes, and rate bursts; malformed/rate-limited requests create no market log growth. |
| AC-07 | Concurrent identical retries, changed content, canonical UUID identity, rejected-attempt retries, retries after later trades/close/restart, and original outcome readback. |
| AC-08/16 | Eight participants, seeded mixed orders, finite/exhausted bot liquidity, covered reservations, nonnegative balances, and cash/unit conservation. |
| AC-10 subset | Complete public batches, owner-only results, authoritative snapshots, dropped acknowledgement, reconnect, and no old-result balance regression. Full #12 fault matrix remains pending. |
| AC-14 subset | Failure before commit publishes nothing; restart after commit/before delivery recovers one outcome/fill batch. Full process/settlement fault matrix remains #13. |
| AC-17 subset | Two-browser join → ready → buy/sell → event → reconnect at 360px and keyboard use. Results/full terminal remain #11/#14. |

Also retain due-event/close boundary regressions from #9 and trade-history replay
equality. Measure local acknowledgement, delivery, snapshot, and scheduler behavior
with increasing history; report environment and limitations. Broader operational
instrumentation and deployment-region AC-18 gates remain #20/#21.

Discover runnable scripts from `package.json`. At planning time final checks are:

```sh
pnpm check
pnpm db:verify
pnpm test:e2e
```

`pnpm check` excludes database tests. Run database verification and browser tests
sequentially: both manage disposable PostgreSQL on port 55433. Reuse the isolated
database helper and test-owned clocks/fault injection. Browser scenarios currently
share one active-room database: extend the existing multiplayer journey or isolate
new scenarios, rather than allowing test ordering to cause active-room conflicts.
Preserve production deadlines and keep test controls out of production endpoints.
For checks affected by existing duplicate generated files, use an isolated source
copy/worktree and report the exclusion instead of deleting user files. Builds
must still work without a live database, game service, or AI key.

This plan defines work and validation; it is not passing acceptance evidence.
