# Ticket 7 implementation plan: guest sessions and shared lobby

Saved October 4, 2026 after inspecting the current repository and issue.

Ticket: [Create guest sessions and a shared eight-player lobby](../07-guest-lobby.md).
Tracker: [GitHub issue #7](https://github.com/Kenneth882/DinoPump/issues/7).

## Start here

Use `/implement` in a fresh session in this repository, with this plan as context:

```text
/implement GitHub issue #7 in Kenneth882/DinoPump.
Follow docs/spec/tickets/ticket-plans/07-guest-lobby-plan.md.
Check that blocker #2 is closed first.
```

Issue #7 is open and labeled `ready-for-agent`; its listed blocker,
[#2](https://github.com/Kenneth882/DinoPump/issues/2), was closed as completed
when checked for this plan. Before implementing, reread the current issue and
comments, recheck the blocker, and inspect the repository instructions and git
diff. Preserve unrelated changes.

Read [product boundaries](../../product-and-scope.md),
[round lifecycle §4](../../round-lifecycle.md),
[interface §6](../../interface.md),
[architecture §7](../../architecture.md),
[persistence §8](../../persistence.md),
[API and recovery §9](../../api-and-recovery.md),
[operations §11](../../operations.md),
[verification §12](../../verification.md), and
[milestone gates §13](../../implementation.md).
The [complete reference](../../../../PROJECT_SPEC.md) remains authoritative.
Read `apps/web/AGENTS.md` and the relevant installed Next.js guides before web
implementation.

## Existing foundation

- `apps/game-server/src/server.ts` exposes the validated public market baseline
  and `/health`; session, room, and Socket.IO behavior are not implemented.
  Socket.IO server and client dependencies are already pinned.
- `packages/database` provides ordered migrations and immutable round baseline
  storage. Add migrations for guests, rooms, membership, and lifecycle records;
  do not modify the applied first migration or use frozen rounds as mutable
  lobby storage.
- `packages/contracts` owns shared runtime schemas. `apps/web` currently shows
  the read-only introduction through its market-baseline API route.
- Database verification already uses isolated synthetic PostgreSQL data.
  Existing Playwright tests start the real service and web app but do not yet
  provision a database for multiplayer tests.

These are starting points, not evidence that ticket #7 passes.

## Implementation sequence

Work one test-first slice at a time: write a failing behavior test, implement the
smallest complete behavior across the necessary boundaries, then refactor with
tests passing. Keep transport and persistence out of the pure market engine.

1. **Create and authenticate a guest session.** Add shared request, response,
   visible-player, and safe-error schemas, then implement `POST /api/session`.
   Validate dinosaur avatar identifiers and normalized display names of 2–20
   characters; enforce name uniqueness when entering a room. Store player ID,
   hashed random session secret, and a 24-hour expiry. Return the credential
   only through the cookie: secure and HttpOnly in same-site production, with
   explicitly documented loopback development settings. Wire the database
   package into the service. Test malformed inputs, expired/unknown cookies,
   storage without raw secrets, and public responses without credentials.
2. **Create one durable active lobby.** Implement authenticated
   `POST /api/rooms` and `GET /api/rooms/:code/snapshot`. Persist the creator's
   membership, host assignment, and lifecycle record atomically. Enforce the
   single-active-room rule in PostgreSQL so simultaneous creates produce one
   room and a stable conflict for the loser. Authorize snapshots by membership,
   derive identity from the cookie, and validate the visible response. Test
   rollback, concurrent creates, nonmember access, and forged identity fields.
3. **Join by code and reconnect without duplicate membership.** Implement
   `POST /api/rooms/:code/join` with transactional checks for capacity,
   normalized-name uniqueness, and joinable state. The creator may wait alone;
   the lobby supports up to eight guests, and a ninth is rejected. Test
   competing joins for the last slot, name collisions, invalid codes, and
   repeated joins by the same session. Reject new participants once joining
   locks, including COUNTDOWN and OPEN, while recognizing existing members on
   reconnect. Exercise those state guards with synthetic fixtures; opening a
   real round belongs to ticket #8.
4. **Deliver authorized realtime lobby state.** Attach Socket.IO to the
   long-running service and authenticate its handshake using the same session.
   Validate origin, membership, and expiry on supported requests, including
   after a connection is established. Deliver `room:snapshot` and
   `presence:update` only to authorized members; publish durable changes after
   commit. Keep transient presence separate from round market events and
   document the lobby's snapshot/sequence semantics without inventing a round.
   Serialize subscription and snapshot delivery so a concurrent join is not
   lost. Reconnection fetches fresh authoritative state. Track multiple sockets
   for one player so closing one tab does not falsely disconnect the player.
5. **Apply host transfer and empty-lobby expiry.** Persist the lifecycle state
   and deadlines needed for a host replacement after 15 seconds disconnected
   and lobby expiry after five minutes empty. Choose the earliest-connected
   remaining player for replacement. Use an injectable clock for boundary
   tests; recheck current state before committing a due action. Cover host
   reconnection before the deadline, duplicate timer execution, concurrent
   reconnect/expiry, no remaining host candidate, and releasing the active-room
   slot after expiry. Keep database ownership and loss-of-database behavior
   consistent with §9 so competing processes cannot apply conflicting changes.
   Full round crash recovery remains a later ticket.
6. **Connect the browser guest and lobby journey.** Build avatar/name entry,
   create/join-by-code controls, and the shared lobby with room code, avatars,
   host and connection indicators, concise buying/selling/scoring instructions,
   and “Fictional market game. Virtual currency only.” Explain the game liquidity
   bot. Add validated HTTP and realtime clients, safe error feedback, pending
   states, and automatic reconnect with backoff and a fresh snapshot. Verify
   cookie forwarding and Socket.IO routing for local and same-site production
   setups. Preserve the introduction and its unavailable/retry behavior;
   readiness, host start, and countdown actions arrive with ticket #8. Support
   keyboard use, visible focus, and a 360px lobby layout.
7. **Prove the integrated slice and review it.** Extend the disposable database
   harness to support real service and browser lobby tests without using the
   development database as disposable data. Demonstrate two independent browser
   contexts creating/joining the same lobby and reconnecting with the same
   player identity. Update setup, environment, database, and test instructions
   for the implemented path. Run the checks below, then `/code-review` against
   the implementation's starting point and address findings.

## Validation and completion evidence

Applicable acceptance IDs: **AC-01, AC-05, AC-10, AC-17**.

| Evidence | Required coverage |
| --- | --- |
| AC-01: database/service | One active room under concurrent creation; two through eight guests; atomic final-slot admission; ninth-player rejection; join locks and existing-member reconnect. |
| AC-05: contracts/service | Invalid names and avatars, normalized-name collisions, forged identity, missing/expired sessions, bad WebSocket origin, unauthorized snapshots, and stable safe errors. |
| AC-10: realtime/service/browser | Consistent lobby snapshots and presence, subscribe/snapshot races, multiple tabs, and reconnect without a new player slot or leaked private data. |
| Lifecycle: database/service | Persisted room/host records, 15-second host transfer, five-minute empty expiry, reconnect at deadline boundaries, and no publication of rolled-back changes. |
| AC-17: browser subset | Two independent guests create/join/reconnect; room code, avatars, instructions, and notices; keyboard and 360px checks. |

Use the existing commands, extending their harnesses where required:

```sh
pnpm db:verify
pnpm check
pnpm test:e2e
```

For iteration, use `pnpm test:e2e <lobby-spec-path>` after creating the lobby
spec. Install Chromium with `pnpm exec playwright install chromium` if needed.
Follow [database isolation instructions](../../../database.md); document the
exact disposable database setup for E2E before claiming its command is runnable.
Keep `pnpm check` independent of a running database and retain the separate
database verification gate. Production builds must not require running services.

This plan records intended work; saving it does not implement or validate the
feature. Report actual checks and remaining failures or unrun checks. Ticket #7
provides lobby-level evidence only: AC-10 still needs market/order recovery, and
AC-17 still needs ready → trade → event → reconnect → results. Readiness,
countdown, funding, trading, results, narration, and complete milestone 3 gates
remain in their owning tickets. No gameplay rule or specification change is
authorized by this plan.
