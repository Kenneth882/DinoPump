# Ticket 9 implementation plan: scheduled events and immediate Daily Roar news

Prepared October 12, 2026 against `main` at `3a5c8a9`.

Ticket: [Scheduled events and template news](../09-scheduled-events-and-template-news.md).
Tracker: [GitHub issue #9](https://github.com/Kenneth882/DinoPump/issues/9).

## Start here

Use the installed `/implement` skill in a fresh session in this repository:

```text
Use $implement to implement GitHub issue #9 in Kenneth882/DinoPump.
Follow docs/spec/tickets/ticket-plans/09-scheduled-events-and-template-news-plan.md.
Recheck blocker #8 and use a ticket9 branch based on current main.
Use $tdd for the slices below, then $code-review against the starting commit.
Preserve unrelated local files. Commit the reviewed implementation locally;
do not push, deploy, or close the GitHub issue.
```

Read [issue-tracker instructions](../../../agents/issue-tracker.md) before
fetching the live issue, labels, and comments. Issue #8 was closed and its PR #30
was merged when checked during planning. Verify this remains true and record the
implementation starting commit. If `gh` remains unavailable, use the connected
GitHub tools. Inspect the current diff and any existing `ticket9` branch before
editing; preserve existing work.

Planning found 22 untracked files with ` 2` before their extensions, all byte-for-byte
duplicates of tracked originals. Leave them untouched and stage only intended
changes. Recheck their contents before relying on this observation; a later session
may contain additional work. An isolated worktree is optional, not a prerequisite.

Read [product boundaries](../../product-and-scope.md),
[content §3](../../game-content.md), [lifecycle §4](../../round-lifecycle.md),
[engine §5](../../market-engine.md), [interface §6](../../interface.md),
[architecture §7](../../architecture.md), [persistence §8](../../persistence.md),
[API/recovery §9](../../api-and-recovery.md),
[events/narration §10](../../events-and-narration.md),
[operations §11](../../operations.md), [verification §12](../../verification.md),
and [milestone gates §13](../../implementation.md).
Resolve discrepancies against [PROJECT_SPEC.md](../../../../PROJECT_SPEC.md).
Before web changes, follow [the web agent instructions](../../../../apps/web/AGENTS.md)
and read the relevant installed Next.js guides.

## Outcome and scope

An OPEN round consumes its frozen nine-event schedule at elapsed seconds
60, 120, …, 540. Each recorded event changes only its specified reference prices,
rebuilds covered quotes, and commits factual Daily Roar news plus a narration job.
Both connected browsers immediately receive the committed facts and quotes.
Last-trade prices, cash, holdings, and portfolio marks remain unchanged by an
idle-market event. This works with no worker process and no API key.

Keep existing rules `1.1`, frozen configuration, seeded selections, and exact
engine arithmetic. Implementing the specified scheduler does not itself change
the scheduling rules. Any proposed rule change requires the repository's version,
full/focused specification, and acceptance-update process before new rounds use it.

Deliver persistence, owned scheduling, public contracts, template news UI, and
the validation needed for this ticket. Durable order submission/ticket (#10),
settlement/results (#11), complete pending-order resynchronization (#12), full
crash recovery/projection rebuilding (#13), the complete terminal (#14), worker
leases/permissions/publication (#17), and provider calls (#18) remain later work.
Implement the event replay and overdue-event startup behavior needed to read and
operate the state this ticket creates; preserve an explicit unready state once
closing requires the still-unimplemented settlement path.

## Existing code and integration constraints

| Area | Current implementation and required integration |
| --- | --- |
| Pure engine | `packages/engine/src/round-engine.ts` already handles `ApplyScheduledEvent`, due-order enforcement, duplicate applied IDs, quote rebuilding, and replay. Reuse `processEngineCommand` and `replayEngine`; see [engine API](../../../../packages/engine/README.md). |
| Owner transaction | `packages/database/src/lobby.ts` serializes `LobbyStore.run` on a dedicated advisory-lock connection and checks ownership before work and commit. Extend that boundary; avoid nested calls that enqueue another `run` while awaiting inside it. |
| Timer/publication | `apps/game-server/src/lobby-realtime.ts` serializes subscriptions, commands, and timer work. Its current one-second timer calls `processDue` regardless of connections, then publishes snapshots. Keep one authoritative scheduling path. |
| Durable history | Migrations 1–3 store immutable baselines, `game_events`, `round_batches`, and engine projections. `persistRoundOpening` provides transaction-scoped opening persistence; factor compatible batch persistence for subsequent transitions. |
| Cause identity | Engine scheduled causes are string schedule IDs; `game_events.cause_id` is currently UUID. `readOpenedRound` currently compares stored event envelopes directly with engine facts. Add an explicit lossless representation/mapping and validate it during replay; a random UUID substitution alone breaks recovery. |
| Readiness | `isReady` currently returns false as soon as any event is due. Replace the opening-only limitation with truthful readiness for supported, caught-up state; keep ownership/database/integrity failures and unsupported closing unready. |
| Visible state | `openedRoundViewSchema` exposes assets, quotes, and the owner's portfolio. `publish` only notices changes to room sequence, while the engine has its own round sequence. Extend delivery tracking deliberately so scheduled changes are delivered even without presence changes. |
| Browser | `apps/web/app/lobby.tsx` consumes snapshots and shows opening resources. Add a small Daily Roar view and coherent quote/news updates here or in focused components. The worker entry point is still a placeholder. |

Read these files before selecting internal module names. New helpers should expose
small transaction, scheduling, and visibility interfaces while keeping SQL, clocks,
transport, randomness, and narration outside the engine.

## Test-first implementation slices

For each slice, write a failing behavioral test, implement the smallest complete
path, then refactor with that test passing. Use synthetic identities and injectable
authoritative time. Run relevant test files and typechecking during implementation.

1. **Define durable event/news identities and contracts.** Extend runtime schemas
   for the public news item, `news:update`, and complete `market:batch` envelope
   with round ID, start/end sequence, and server time. News carries a stable source
   event ID, schedule identity, factual template, actual reference changes, timestamp,
   and narration status. Keep due time distinct from application time for delayed
   processing. Define internal job input from approved frozen facts only. Add the
   next migration for event-application identity, news, and jobs, with uniqueness
   for one application/news/job per scheduled source and referential linkage to
   the committed `MarketEventApplied` record. Keep the baseline schedule immutable;
   applied progress belongs in separate records/projections. Include job status,
   attempts, next-attempt time, and lease fields, leaving execution to #17.
   **Done:** migration/readback and contract tests reject malformed data and
   duplicate identities; historical opening records still read correctly.

2. **Persist one complete scheduled transition atomically.** Inside the existing
   owned transaction, load verified state and invoke `ApplyScheduledEvent` with
   the recorded schedule ID and authoritative processing time. Persist the entire
   engine batch including its command, ordered event rows, resulting projection,
   application marker, factual news item, and job together. Preserve the engine's
   logical cause through the storage adapter. Populate news from frozen catalog
   facts and the returned reference adjustments, including actual rounded/clamped
   before/after values. Treat an already-applied event as a no-op, not another news
   publication. Return committed data to the service only after COMMIT.
   **Done:** injected failures between effect, news, and job writes roll everything
   back; retry yields one complete event/news/job and the same deterministic state.

3. **Process due work in the owned command path.** Extract a transaction-scoped
   helper that drains recorded due events in order using the next applied position,
   each event's frozen deadline, and the strict pre-close cutoff. Sample server
   processing time inside serialization; do not backdate commands to event due
   times or use client timestamps. Route timer work and the pre-market-command
   boundary through this helper. #10 must be able to invoke it before matching
   without a second timer or ownership queue. Demonstrate the event/command race
   at this internal seam using a synthetic engine command; no public trading
   endpoint is needed for #9. Preserve opening, countdown, and lobby behavior.
   **Done:** all nine boundaries, repeated/concurrent ticks, delayed ticks spanning
   several events, multi-symbol effects, and zero connected clients work; no
   tenth event appears at 600 seconds and a due event precedes matching.

4. **Extend replay, startup catch-up, and readiness.** Update `readOpenedRound`
   and batch storage validation to accept scheduled transitions and their cause
   mapping, while detecting altered, missing, or reordered facts. Check application,
   news, and job source consistency with committed history. On startup, replay
   committed effects and catch up missed pre-close events before exposing ready
   service state. Use unchanged persisted deadlines. After close, process only
   pre-close effects and retain the documented unready limitation until #11 adds
   settlement; do not fabricate final results. Scope projection repair and the
   wider recovery fault matrix to #13.
   **Done:** restart before/after multiple deadlines produces the exact replayed
   state, one news/job per event, and no duplicated effects; DB or advisory-lock
   loss prevents writes/publication and readiness, including live-connection lock loss.

5. **Publish authorized complete market/news updates.** Extend the existing service
   queue to publish committed `market:batch` and `news:update` payloads in order,
   retaining complete sequence envelopes and stable source identities. Include
   applied news in authorized snapshots for initial connection and reconnect.
   Keep room sequence and round sequence distinct, and update per-socket delivery
   tracking accordingly. Establish a single browser state-application path: apply
   a complete batch coherently and upsert news by source ID; separate news delivery
   must not duplicate the item or expose half-applied market state. Serialize
   subscription/snapshot capture with publication and handle duplicate or missing
   updates by requesting an authoritative snapshot. Preserve existing resync
   compatibility; pending trade reconciliation remains #12. Revalidate membership
   and expiry before delivery. Explicitly project public fields rather than
   transmitting engine state, the future schedule, private ledgers, or job inputs.
   **Done:** two sockets see identical committed prices/news; reconnect restores
   all applied news; rollback emits nothing and postcommit/prepublication restart
   restores the batch via snapshot without duplication or private-data disclosure.

6. **Show immediate Daily Roar facts in the browser.** Render the authored headline,
   copy, affected symbols, actual reference-price effects, and timestamp as plain
   text with a no-news state. Distinguish reference changes and bid/ask changes
   from last-trade marks; retain own resources, server countdown, connection state,
   and the fictional-currency notice. Templates remain visible while narration
   is pending or unavailable, with no loading state that blocks facts. Generated
   narration is not implemented by this slice. Keep the feed readable at 360px,
   keyboard accessible, and restrained for screen readers/reduced motion. Update
   misleading opening-only labels and affected browser assertions together.
   **Done:** two real browser contexts observe event facts and changed quotes
   without a worker/key, unchanged idle last prices/portfolios, no duplicate news
   after reconnect, and no horizontal overflow at 360px.

7. **Measure, document, and review.** Record scheduler lag against the persisted
   due time at a clearly documented application/commit boundary, with safe
   round/source IDs. The current one-second polling interval leaves no allowance
   for queue/transaction time: select timer cadence from measured behavior and
   the ≤1-second healthy-operation target without changing event deadlines.
   Add focused operational evidence; broad metrics/load testing remains #20/#21.
   Update [lobby documentation](../../../lobby.md),
   [database documentation](../../../database.md), and README where behavior,
   commands, or limitations changed. Record actual results in
   `docs/validation/ticket-9-events.md`. Follow the
   [spec synchronization rules](../../README.md#keeping-the-references-aligned)
   for any clarified public contract or stage-specific copy; preserve the full
   reference and stable AC IDs. Run the checks below, then `/code-review` against
   the recorded starting commit, resolve findings, and commit scoped changes.
   **Done:** evidence distinguishes passing, failing, and unrun checks and names
   the deferred parts of the ACs; no release or whole-milestone claim is inferred.

## Validation and acceptance evidence

Ticket IDs: **AC-09, AC-10, AC-13, AC-14, AC-15**.

| Evidence | Required demonstration |
| --- | --- |
| AC-09 | All nine frozen events apply exactly once; recorded ordering, multi-symbol changes, and configured shock validation; only reference prices/quotes change, with unchanged ledgers and last-trade marks. |
| AC-10 subset | Two clients receive coherent market/news batches and matching authorized snapshots; reconnect and repeated news delivery preserve one visible item per source. Pending-fill recovery remains #10/#12. |
| AC-13 subset | Authored facts appear immediately with no key, worker, or provider call; persisted jobs cannot block template visibility. Provider timeout/invalid-copy handling remains #17/#18. |
| AC-14 subset | Fault injection before commit leaves no partial event/news/job; restart after commit and before publication restores committed state without duplication. Trade crash cases remain #10/#13. |
| AC-15 subset | Startup before close catches up missed effects in order; startup after close applies only pre-close effects, preserves deadlines, and stays unready pending settlement. Full close/restart acceptance remains #11/#13. |
| Integrity/operations | Finite quote reservations and conserved resources, auth/private-data filtering, command/event serialization, zero-client scheduling, ownership/DB loss, replay tamper detection, and measured scheduler lag. |

Use fake service time with real isolated PostgreSQL for deadline and fault tests.
Reuse the existing database helpers and inject failures inside real transactions.
Retain pure engine regression tests; service tests must demonstrate persistence
and transport behavior beyond the already-tested engine arithmetic.

The browser suite currently has one shared active-room database and no service
clock-control fixture. Extend the existing journey or isolate the new scenario's
database/service so test order cannot cause `ACTIVE_ROOM_EXISTS`. For a browser
deadline, either wait through a real first event with an explicit timeout or add
a test-owned injected-clock server fixture that exercises the real service; keep
clock controls out of production routes and keep production deadlines unchanged.
Use deterministic time for all-nine-event coverage rather than a ten-minute sleep.

Discover the current scripts before running them. At planning time the final
checks are:

```sh
pnpm check
pnpm db:verify
pnpm test:e2e
```

`pnpm check` excludes `*.database.test.ts`, so it cannot establish database
acceptance by itself. Run `db:verify` and E2E sequentially: both harnesses own the
disposable PostgreSQL instance on port 55433. Require Docker, supported Node/pnpm,
and Playwright Chromium as documented; use synthetic test storage, never the
development database. Production builds must still work without a live service,
database, or AI key. If existing untracked duplicate files interfere with checks,
use an isolated checkout or report the interference rather than deleting them.

This document is an implementation plan, not evidence that any new behavior passes.
