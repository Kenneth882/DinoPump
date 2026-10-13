# Ticket 11 implementation plan: round close and results

Prepared October 13, 2026 against `9a67057` (merged ticket #10, PR #32).
The local branch at planning time is `ticket11`.

Ticket: [Close rounds once, show results, and return to the lobby](../11-round-close-and-results.md).
Tracker: [GitHub issue #11](https://github.com/Kenneth882/DinoPump/issues/11).

## Start here

Use the installed `/implement` skill in a fresh session in this repository:

```text
Use $implement to implement GitHub issue #11 in Kenneth882/DinoPump.
Follow docs/spec/tickets/ticket-plans/11-round-close-and-results-plan.md.
Recheck blocker #10 and reuse ticket11 if it still starts from current main.
Record the starting commit. Use $tdd at the seams below, then $code-review.
Preserve unrelated local changes, including the environment documentation,
untracked ticket plans, and duplicate files. Commit only the reviewed ticket
implementation and its plan/evidence locally; do not push or deploy.
```

Read [issue-tracker instructions](../../../agents/issue-tracker.md), then fetch
the live issue and comments. Planning verified #11 is open, `ready-for-agent`,
and has no comments; blocker #10 is closed. Recheck before implementation.
Use the connected GitHub tools if `gh` is unavailable.

Inspect status and diff first. Planning found unrelated edits to `.env.example`,
`README.md`, and `docs/database.md`, plus untracked earlier plans and duplicate
` 2.*` files. Preserve them; selectively stage any overlapping documentation
changes. Use disposable synthetic databases instead of resetting development data.

Read [product boundaries](../../product-and-scope.md),
[round lifecycle](../../round-lifecycle.md), [market rules](../../market-engine.md),
[interface](../../interface.md), [persistence](../../persistence.md),
[API/recovery](../../api-and-recovery.md), [events/narration](../../events-and-narration.md),
[verification](../../verification.md), and [milestone gates](../../implementation.md).
Consult [architecture](../../architecture.md) and [operations](../../operations.md)
for affected service boundaries and failure handling. Resolve discrepancies against
[PROJECT_SPEC.md](../../../../PROJECT_SPEC.md). Before browser code, read
[web instructions](../../../../apps/web/AGENTS.md) and the installed Next.js guides.

## Outcome and scope

At the frozen 600-second deadline, the authoritative processor applies remaining
events due strictly before close, stops new trades, and records final results once.
Every participant sees the same frozen ranks and marks, plus only their own final
cash and holdings. Results survive retries, reconnects, restarts, and a subsequent
round. The host can return the room to the lobby, reset readiness, and start a new
round with a new identity, seed, and freshly initialized resources.

Reuse the existing engine settlement/scoring and frozen rules `1.1`. Integrating
already-specified behavior does not introduce a new scoring rule. If implementation
requires changing settlement, rounding, scheduling, or scoring semantics, follow
the rules-version/specification/AC process before applying it to new rounds.

Include close-specific restart, rollback, and delivery recovery. General projection
rebuilding and the full process-fault matrix remain [#13](../13-server-crash-recovery.md);
the broad client reconciliation matrix remains [#12](../12-client-resync-and-reconciliation.md).
The full terminal, reactions, narration worker, and release/load gates remain later
tickets. Do not claim the complete service milestone solely from this slice.

## Existing integration points

| Area | Starting point and constraint |
| --- | --- |
| Engine | `packages/engine/src/round-engine.ts` already implements `SettleRound`, `AbortRound`, frozen marks/ranks, and replay. Settlement returns `batch: null` when already finished. Existing pure tests cover ties, last-trade valuation, terminal immutability, and replay. Reuse these rules. |
| Contracts | `packages/contracts/src/round-engine.ts` has `engineFinalResultSchema`; `lobby.ts` recognizes terminal room statuses but lacks the finished-round delivery/reset surface. Internal engine state contains all ledgers and receipts and cannot be sent directly. |
| Durable storage | Migrations 1–5 store immutable baselines, events, batches, orders, and trades. `rounds` rejects updates/deletes; do not add lifecycle updates to that frozen row. `persistEngineBatch` and `readOpenedRound` already persist/replay engine batches. Add immutable result storage and validate it against settlement history. |
| Owned processing | `LobbyStore.run`, `catchUpRound`, `processDue`, and `submitOrder` serialize work under ownership. `catchUpRound` currently accepts only room status `OPEN`; readiness deliberately fails after close. Extend terminal handling coherently across scheduler, commands, startup, and snapshots. |
| Order compatibility | Ticket #10 stores deadline rejections without an engine batch, anchored to a committed state. Preserve these historical records and original outcomes. New closed attempts must not roll back settlement or mutate frozen results. |
| Publication | `publication` shares public views but personalizes snapshots; `lobby-realtime.ts` publishes only after committed work. Add terminal delivery without leaking the first recipient's private result to other recipients. |
| HTTP/browser | `lobby-http.ts` and the Next catch-all proxy currently allow session/room routes only. Add the results route and shared validation at both boundaries. `apps/web/app/lobby.tsx` owns snapshots, pending commands/orders, and round sequences; add a focused results view and reset behavior there. |

Keep `SETTLING` as a durable lifecycle transition within the settlement transaction:
record entry into settlement, persist the complete engine settlement and result,
then record `FINISHED` and update room visibility before one commit. The engine
currently moves directly from `OPEN` to `FINISHED`; it need not acquire a new
intermediate engine state or expose a partially committed result. A failed
transaction must leave no committed half-settlement.

## Test-first implementation slices

Work one failing observable behavior through the relevant boundaries at a time.
Use the existing isolated PostgreSQL helpers, injectable clocks, and real transport
tests. Keep test controls out of production endpoints.

1. **Define terminal results and reset contracts.** Add strict schemas for the
   participant results response, `round:ended`, terminal snapshot data, and an
   acknowledged host reset command. Use `room:return-to-lobby` with
   `{ roundId, requestId }` as the proposed command; document it in both spec forms.
   Derive identity from the session. Public results include round identity, frozen
   marks, shared ranks, values, profit/return, settlement sequence, and a compact
   timeline of committed major-event facts. Private results contain only the
   authenticated participant's final cash/holdings. Freeze necessary participant
   display metadata so historical rendering does not depend on current membership.
   Define safe unavailable/not-finished/aborted responses and a terminal abort view
   with no winner or fabricated results.
   **Done:** schemas reject forged identity, unknown fields, invalid identities,
   and private ledger fields in public results; HTTP, socket, and snapshot forms
   agree on round/status/sequence and owner visibility.

2. **Commit closing and frozen results exactly once.** Add the next migration
   (expected version 6) for immutable results keyed by round, with a settlement
   event/sequence link. Store all final portfolios privately, alongside frozen
   public data or sufficient immutable inputs to derive it. Use database uniqueness
   and update/delete protection consistent with existing immutable records.
   Extend the owned catch-up boundary: apply due scheduled events in due-time order,
   limited to deadlines strictly before close; at `now >= closesAtMs`, call
   `SettleRound`, persist the complete batch/projection/public view/result and room
   lifecycle changes atomically. A settlement retry reads the existing result and
   verifies agreement; it never overwrites it or adds another settlement event.
   Extend replay validation to compare stored results, final portfolios, marks,
   ranks, and settlement sequence against committed history. Preserve replay of
   migration-5 closed attempts and rounds opened before this migration.
   **Done:** before/at/after-boundary tests, concurrent scheduler/order processing,
   and repeated ticks produce one settlement; nine pre-close events occur once,
   none at close; injected rollback leaves no result, terminal status, or publication.

3. **Integrate terminal orders, restart, readiness, and abort.** Capture server
   processing time inside serialization. A new order processed at/after close must
   settle first and return a durable closed outcome without fills. Preserve lookup
   of an authorized identical order before re-evaluating trading conditions, and
   preserve the original outcome/sequence for retries. Do not throw an ordinary
   rejection in a way that rolls back due effects or settlement. Handle orders
   against an already finished or aborted current round safely, including an abort
   before the nominal deadline. Keep new old-round submissions rejected after reset.
   Startup after close must replay, catch up, and settle once before readiness;
   valid finished rounds must no longer make the service permanently unready.
   Closing must run even when all players are disconnected.
   Distinguish unrecoverable integrity failure from temporary database/ownership
   loss. Roll back unsafe work, then record an idempotent abort under verified
   ownership using the last verified state and a safe reason. If history itself
   cannot be replayed, retain evidence and record terminal abort metadata separately
   from the invalid market stream; do not fabricate a valid engine batch. Snapshots
   must be able to render that abort without re-reading the corrupt projection.
   If storage or ownership is unavailable, remain unready/nonwriting until safe
   recovery allows an abort to be persisted. Never turn an existing valid final
   result into an abort or declare a winner on an aborted round.
   **Done:** close-specific restart/precommit/postcommit tests preserve exact
   outcomes and results; integrity failure yields a durable safe abort and no
   winner; ordinary connectivity failures cannot write an abort without ownership.

4. **Expose and deliver authorized immutable results.** Implement
   `GET /api/rounds/:roundId/results` through the service and Next proxy, with runtime
   validation and `no-store` responses. Authorize using the original locked
   participant set and a currently valid session, independent of the room's current
   round. A later lobby member must not gain access to an earlier round's results.
   Publish complete settlement sequence coverage and `round:ended` only after
   commit. Either personalize terminal messages per authenticated recipient or
   send public results and fetch private details separately; never room-broadcast
   all final portfolios. Include terminal data in reconnect snapshots or fetch it
   through the authorized route, and deduplicate by round and settlement sequence.
   Keep immutable result/timeline facts separate from mutable narration copy.
   **Done:** two sockets agree on public ranks but see only their own portfolios;
   outsiders/expired sessions are denied; lost terminal delivery recovers by
   snapshot/HTTP; duplicate publication and late commentary cannot change results.

5. **Return to the lobby without touching prior rounds.** Implement host-only
   `room:return-to-lobby` from `FINISHED` or a safely persisted `ABORTED` state.
   Serialize authorization, matching current terminal round, request deduplication,
   lifecycle record, readiness reset, countdown cleanup, and current-round pointer
   clearing in one transaction. Retain all previous round/event/order/result data.
   Reinitialize the existing lobby host-transfer/empty-lobby deadlines from actual
   connection state; do not introduce host powers during trading. Reuse durable
   room command identities: identical retries return the original acknowledgement,
   changed content conflicts, and a stale request cannot reset a later round.
   Preserve existing ready/start rules. Next start freezes a new round ID/seed,
   current configuration, participants, and starting resources exactly once.
   **Done:** nonhosts, wrong rounds, and active-round resets fail; duplicate/lost
   reset acknowledgements have one effect; second-round initialization is fresh
   while old results and trades remain identical and accessible to their owners.

6. **Finish the browser journey.** Render winner or tied winners, shared ranks,
   final values, profit/return, the viewer's cash and remaining holdings, and the
   compact event timeline. Use committed results rather than recomputing scores
   from current quotes or provisional totals. Show settlement/loading and safe
   abort states, and keep trading disabled outside a synchronized open round.
   Provide the host reset control with pending/retry acknowledgement handling.
   On a confirmed lobby/new-round snapshot, clear prior round UI/cursors/pending
   command state deliberately. Resolve a late old order acknowledgement only for
   its original request; it must not overwrite final resources or the next round.
   Similarly, late old `round:ended` or reset messages must not replace a newer
   authoritative screen. Reconnect during close/reset through a fresh snapshot.
   **Done:** two browser contexts complete trade → event → reconnect → results →
   host reset → second round. Verify immutable first-round results again, keyboard
   controls, announced terminal state, readable gain/loss text, and 360px layout.
   Preserve the fictional-currency notice and complete play without an AI key.

7. **Record evidence and review.** Add `docs/validation/ticket-11-results.md` with
   actual checks, AC coverage, and limitations. Update stage-specific interface,
   persistence, and API documentation in both specification forms, removing the
   ticket-10 post-close unready limitation where superseded. Update setup/lobby
   documentation as needed without staging unrelated environment edits. Run
   `/code-review` against the recorded starting commit, address actionable findings,
   and commit only the scoped implementation, this plan, and evidence.
   **Done:** required checks pass and evidence distinguishes this slice from the
   full #12/#13 recovery matrix and remaining milestone/release gates.

## Validation map

| Acceptance | Required ticket #11 evidence |
| --- | --- |
| AC-01/02 | Host-only reset, all readiness cleared, admission restored, normal host/expiry rules, and a fresh second round with new identity/seed/resources. |
| AC-05/11 | Commands processed immediately before/at/after close; no new terminal fills; immutable marks, rankings, portfolios, sequence, and safe abort behavior. |
| AC-09/15 | All nine due events applied once before settlement, no closing event, delayed scheduler and restart after close preserve original deadlines. |
| AC-11 | No-trade marks use initial prices; trades set marks independently of event-driven quotes; shared ties use join-order display; disconnected humans remain ranked; bot excluded; holdings never force-sold. |
| AC-12 | Replay equals committed final state/results, including stored private portfolios; result/history disagreement is detected safely. |
| AC-14 subset | Failure before settlement commit changes nothing; restart after commit/before terminal delivery retrieves one result and no extra settlement. Full process-fault matrix remains #13. |
| AC-17 subset | Two browsers complete results/reset/second-round journey, reconnect at close, preserve first-round results, and remain usable at 360px by keyboard. Full terminal/release accessibility remains later work. |
| AC-07/10 regressions | Original order outcomes survive settlement; late messages do not regress balances or switch rounds; owner-only privacy and complete sequence delivery remain intact. |

Use synthetic scenarios for no trades, a unique winner, tied winners, remaining
holdings, all players disconnected, a delayed scheduler, concurrent closing orders,
an aborted round, and a second round. Inject attempted result updates/deletes and
verify storage rejects them. Assert public/private isolation in serialized payloads,
not merely hidden UI. Keep evidence for late narration/reaction immutability at
the existing storage/contract seams; do not build deferred workers or reactions
just to test that boundary.

Discover scripts from `package.json`; at planning time the completion commands are:

```sh
pnpm check
pnpm db:verify
pnpm test:e2e
```

Use supported Node 24 and pinned pnpm 10.34.5. `pnpm check` excludes database
integration tests. Run database verification and browser tests sequentially because
both use disposable PostgreSQL on port 55433. Extend/isolate the current multiplayer
journey to respect the one-active-room constraint; do not let scenario ordering
become a hidden dependency. Use test-owned clocks for boundary cases and preserve
the production 600-second duration. If duplicate/generated local files prevent
checks, validate in an isolated source copy and disclose exclusions instead of
deleting user files. Builds must work without a live database/service or AI key.

This document is an implementation plan, not passing acceptance evidence. Report
unrun or failing checks as incomplete and identify the remaining blocker.
