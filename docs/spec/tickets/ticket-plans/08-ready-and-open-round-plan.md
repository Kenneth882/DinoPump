# Ticket 8 implementation plan: readiness and authoritative round opening

Prepared October 5, 2026 from issue #8 and the repository at `b2542f8`.

Ticket: [Ready players and open a funded authoritative round](../08-ready-and-open-round.md).
Tracker: [GitHub issue #8](https://github.com/Kenneth882/DinoPump/issues/8).

## Start here

Use `/implement` in a fresh session in this repository:

```text
/implement GitHub issue #8 in Kenneth882/DinoPump.
Follow docs/spec/tickets/ticket-plans/08-ready-and-open-round-plan.md.
Check blockers #6 and #7 and inspect the current branch before editing.
Use test-first slices, finish with /code-review, and commit completed work.
```

Issues #6 and #7 were closed when checked in the planning conversation. The
working tree was clean on `ticket8` before this plan was added. Recheck the live
issue and comments using [issue-tracker instructions](../../../agents/issue-tracker.md),
confirm the branch contains both implementations, and record the implementation
starting commit for review. Preserve any subsequent user changes.

Read [product boundaries](../../product-and-scope.md),
[round lifecycle §4](../../round-lifecycle.md),
[market engine §5](../../market-engine.md),
[interface §6](../../interface.md),
[architecture §7](../../architecture.md),
[persistence §8](../../persistence.md),
[API and recovery §9](../../api-and-recovery.md),
[events §10](../../events-and-narration.md),
[operations §11](../../operations.md),
[verification §12](../../verification.md), and
[milestone gates §13](../../implementation.md).
Resolve discrepancies against the relevant section of
[PROJECT_SPEC.md](../../../../PROJECT_SPEC.md). Read `apps/web/AGENTS.md` and
the relevant installed Next.js guides before web implementation.

## Intended outcome and scope

At least two connected ready guests allow the host to start a five-second
countdown. Joining and the participant list lock. If fewer than two remain
connected before opening, return to the lobby. Otherwise atomically open the
round for the locked participants with the frozen configuration's resources,
initial quotes, recorded schedule, and ten-minute deadline.

Defaults remain D$10,000 per human with zero holdings, four canonical assets,
and a bot with D$10,000,000 and 100,000 units of each asset. Consume validated
configuration and the current rules version (`1.1`); the ticket's baseline-1.0
scope label is not an instruction to downgrade quote rules.

Deliver readiness/start commands, lifecycle persistence, safe opening snapshots,
health/readiness endpoints, and the browser journey through opening. Scheduled
event execution/news (#9), durable orders (#10), settlement/results (#11), full
market reconciliation (#12), and complete crash catch-up (#13) retain their own
scope. Persist the full schedule now, without exposing future events to players.

## Existing foundation and integration constraints

- `packages/database/src/lobby.ts` owns a dedicated PostgreSQL advisory-lock
  connection and serializes transactions. `apps/game-server/src/lobby-realtime.ts`
  serializes subscriptions, presence, timers, HTTP mutations, and publication.
  Extend these ownership boundaries; avoid a second competing room processor.
- Migrations 1 and 2 already store immutable round baselines/events/projections
  and guest sessions/rooms/members/lifecycle records. Add a migration for the
  new state. Keep applied migrations and historical baselines intact.
- `createRoundBaseline(pool, input)` in `packages/database/src/rounds.ts` opens
  and commits its own transaction. Calling it inside a lobby transaction would
  split opening across connections. Introduce a transaction-scoped persistence
  seam so the owned room transaction commits the entire opening, while keeping
  existing standalone baseline behavior and tests working.
- `startEngineRound(frozenRound)` already returns the pure opening transition:
  sequence 1 is `RoundInitialized`; sequences 2 and 3 are `RoundOpened` and
  `QuotesRebuilt`. Reuse its ledgers, quotes, and reservations. Persist the
  complete batch, including its command, and resulting engine projection.
  See [engine API](../../../../packages/engine/README.md).
- Current database recovery validates only the single initialization event and
  sequence-1 projection. Add an explicit opened-round read/replay path or a
  compatible versioned extension; preserve baseline-only fixtures. Map engine
  event envelopes to the database's UUID event IDs and cause IDs deliberately.
- Current lobby snapshots contain presence but no readiness, active-round
  deadlines, quotes, or private portfolio. Room sequence and round event
  sequence are different domains. Extend shared schemas and browser ordering
  together; never compare them as interchangeable counters.
- The service currently exposes `/health` as liveness. Its owner store tracks
  availability internally. `/readyz` needs evidence of usable database ownership
  and loaded authoritative state, including loss of an advisory lock while the
  connection remains alive. A successful `SELECT 1` alone is insufficient.

## Implementation sequence

Work one behavior at a time: failing test, minimal implementation through the
affected boundaries, then refactor with tests passing. Use injectable time and
synthetic identities; keep clocks, randomness, transport, and SQL outside the
pure engine.

1. **Define lifecycle contracts and persist readiness.** Add strict schemas for
   `room:ready { ready, requestId }`, `round:start { requestId }`, acknowledged
   outcomes, stable errors, and visible readiness. Derive room/player identity
   from the authenticated socket; revalidate membership, expiry, origin, and
   lifecycle permissions on every command. Add persisted readiness and the
   minimum countdown/participant/command records needed for subsequent slices.
   Test malformed inputs, forged identities, nonmembers, expired sessions,
   ready/unready changes, multiple tabs, and unauthorized starts. Completion:
   two browsers observe committed readiness and each command receives a
   validated outcome with its request ID.

2. **Commit host start and participant locking.** In the existing owner queue,
   validate host authority and at least two connected ready guests. Persist the
   countdown deadline, ordered locked participants, round identity/seed, and
   configuration needed to reproduce the intended opening. Set the creation
   timestamp before the future opening timestamp, as required by the existing
   frozen-round schema. Give duplicate/retried starts a durable outcome so they
   cannot allocate another round, extend a countdown, or fund twice. Test same-ID
   retries, concurrent starts with different IDs, and ready/join/disconnect races.
   Completion: one accepted countdown locks the participant list and rejects new
   joins while existing locked participants can reconnect.

3. **Cancel an invalid countdown at the authoritative boundary.** Route timers,
   disconnects, session expiry, and reconnects through the same serialization
   boundary. Recheck connected participants before opening; if fewer than two
   remain, persist the return to LOBBY, clear the active countdown/participant
   lock, and publish the committed result. Preserve enough command history to
   distinguish a retried old start from a new attempt. Apply lobby host-transfer
   and empty-expiry behavior only in the appropriate lifecycle state. Test just
   before/at the deadline, a second tab remaining connected, repeated timer
   execution, and a new start after cancellation. Completion: cancelled attempts
   leave no funded/open round and the room can admit guests again.

4. **Open the round in one database transaction.** At the persisted deadline,
   recheck ownership, room state, locked participants, and connectivity. Build
   the frozen baseline from the recorded inputs and call `startEngineRound`.
   Atomically commit the baseline and schedule, initialization event, complete
   opening batch, engine projection, room's current-round link/status, and
   lifecycle record. Publish or replace in-memory authoritative state only
   after commit. Use the frozen opening and closing deadlines; timer delay or a
   retry must not silently extend the round. Completion: fault injection before
   commit leaves no partial funding; retry after commit returns the existing
   opening and exact same round, ledgers, quotes, and event sequences.

5. **Expose owned state and honest service readiness.** Add `/healthz` for
   process liveness and `/readyz` for safe service readiness; preserve `/health`
   compatibility for existing harnesses or update every consumer deliberately.
   Verify unavailable database, competing owner, lost ownership, startup, and
   shutdown behavior. Recover already committed opening data without funding
   again; keep readiness false if authoritative recovery cannot safely finish.
   Full overdue-event/settlement recovery belongs to #13 and must remain an
   explicit limitation. Completion: ownership/database faults prevent lifecycle
   writes and successful readiness, including a live-connection lock-loss test.

6. **Deliver authorized countdown and opening state.** Extend HTTP and Socket.IO
   snapshots with round identity, server time, deadlines, public asset/quote
   state, and the requesting player's own cash/holdings. Project visible data
   explicitly: neither the frozen schedule nor the full engine state is a
   public payload. Keep other players' holdings and credentials private. Preserve
   subscribe/snapshot ordering and ensure each client receives a complete
   committed opening. Retain disconnected locked participants and their balances;
   an empty OPEN room must not expire, refund, or liquidate. Completion: two
   clients agree on round/deadlines/quotes; reconnect restores the same participant
   and own portfolio, including after every participant disconnects.

7. **Complete the browser opening journey.** Extend `apps/web/app/lobby.tsx`
   with ready controls, ready/connection indicators, and a host-only start
   action. Show pending commands and safe errors, retaining request IDs across
   retries. Derive displayed countdowns from server time/deadlines and correct
   them on fresh snapshots; the client never opens the round locally. Show a
   minimal authoritative opening view with own starting resources and initial
   bid/ask ladders, sufficient to demonstrate #8 without building the later
   trading terminal. Update outdated availability copy to describe the actual
   supported stage. Completion: two browser profiles ready, count down, and see
   identical opening data, with keyboard access, visible focus, a 360px layout,
   and the fictional-currency notice.

8. **Validate, document, and review.** Extend the existing isolated database and
   browser harnesses. Update [lobby documentation](../../../lobby.md),
   [database documentation](../../../database.md), and setup/test instructions
   affected by the new migration, contracts, readiness endpoints, and recovery
   limits. Run the checks below, then `/code-review` against the recorded starting
   commit and resolve findings. Completion: record actual evidence per AC,
   remaining limitations, and commit the reviewed implementation.

## Decisions to resolve before dependent code

Approved October 5, 2026 in the implementation conversation: lock all current
lobby members in join order, including unready/disconnected guests; cancellation
resets everyone to not ready. These decisions are recorded in §4 of both
specification forms. Preserve the two-connected-ready-player start prerequisite.

Choose internal transaction composition, event storage, and module names from
the existing code. Preserve published contracts or document compatible extensions.
Any proposed change to timing, funding, quote generation, or other gameplay rules
requires the existing rules-version and specification process.

## Validation and completion evidence

Applicable ticket IDs: **AC-01, AC-02, AC-05, AC-08, AC-10, AC-14**.

| Evidence | Required demonstration |
| --- | --- |
| AC-01 | New joins fail during COUNTDOWN/OPEN; locked participants reconnect; cancellation unlocks admission. |
| AC-02 | Exactly four assets, exact human/bot funding, deterministic initial quotes and nine-event schedule; duplicate starts/timers never fund twice. |
| AC-05 | Runtime validation, session/membership/origin checks, host-only start, stable errors, and safe private/public response boundaries. |
| AC-08 subset | Concurrent ready/start/join/disconnect/timer work is serialized; one owner; initialized ledgers and reservations satisfy engine invariants. |
| AC-10 subset | Two clients agree on countdown/opening and quote state; reconnect restores identity and own resources; no half-opening or private-data broadcast. |
| AC-14 subset | Inject failure before opening commit and after commit before publication; verify rollback or committed recovery without duplicate initialization. |
| Lifecycle/readiness | Fewer-than-two cancellation, repeated deadlines, DB/lock loss, health versus readiness, and retention after all open-round participants disconnect. |

Use the existing commands, adding targeted test files to their configured suites:

```sh
pnpm db:verify
pnpm check
pnpm test:e2e
```

Run database verification and E2E sequentially: both use disposable PostgreSQL
on port 55433. Keep the synthetic isolation and cleanup described in
[lobby validation](../../../lobby.md#validation-boundaries). Use targeted tests
and typechecking during slices; run the full configured checks at completion.
Keep builds independent of a running service or database and require no AI key.

This file is a plan, not implementation evidence. Report passing, failing, and
unrun checks separately. Opening-only AC-08/10/14 evidence does not establish
concurrent trading, pending-order reconciliation, or trade crash recovery.
Ticket #8 alone cannot satisfy the full authoritative-service milestone or the
complete ready → trade → event → reconnect → results journey.
