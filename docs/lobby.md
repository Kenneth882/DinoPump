# Guest sessions and shared lobby

Ticket [#7](https://github.com/Kenneth882/DinoPump/issues/7) implements the lobby portion of [round lifecycle §4](spec/round-lifecycle.md), [interface §6](spec/interface.md), [persistence §8](spec/persistence.md), [API §9](spec/api-and-recovery.md), and [identity/access controls §11](spec/operations.md). Ticket [#8](https://github.com/Kenneth882/DinoPump/issues/8) adds readiness, countdown, and atomic round opening. Trading, scheduled effects, and results remain later tickets. The existing introduction and unavailable/retry behavior remain available.

## Run locally

Use the pinned Node and pnpm versions in the [root setup](../README.md). Start Docker Desktop, then run:

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:3000`. Set `WEB_ORIGIN` to that exact browser origin and `GAME_SERVER_ORIGIN` to `http://127.0.0.1:3001`. Use the same hostname consistently. Each independent browser profile creates its own guest; tabs share a session. Create a room and share the six-character code. A creator can wait alone; at most eight memberships are admitted. Reloading restores the current guest through the HttpOnly cookie. A temporary session-lookup failure keeps recovery pending and retries with backoff (or Retry session); only an unauthenticated response offers a new guest. Local storage contains only the last room code, never a credential.

The service requires migrated PostgreSQL for lobby features. Without `DATABASE_URL`, the public introduction still works; lobby requests are unavailable. A configured but unavailable database or competing owner prevents lobby startup. `/health` and `/healthz` are process liveness; `/readyz` reports safe service readiness.

## HTTP and credentials

Shared schemas live in `packages/contracts/src/lobby.ts`. All lobby responses are uncached. Inputs reject unknown fields, including forged player IDs. Names use NFKC normalization, trim/collapsed whitespace, a 2–20-character limit, and case-insensitive uniqueness within the room. Avatars are `trex`, `triceratops`, `stegosaurus`, and `brachiosaurus`.

- `POST /api/session` takes `{ displayName, avatar }`, returns `{ player }`, and sets `dino_session`. The credential is 32 random bytes; storage contains only its SHA-256 hash and a 24-hour expiry.
- `GET /api/session` returns the current visible player for browser reloads, or `UNAUTHENTICATED`.
- `POST /api/rooms` takes `{}` and atomically creates the room, creator membership, host assignment, deadlines, and lifecycle record. A concurrent creator receives `ACTIVE_ROOM_EXISTS`.
- `POST /api/rooms/:code/join` takes `{}`. An existing member reconnects without adding a slot, including after joining locks. New members require LOBBY, a free slot, and a unique normalized name.
- `GET /api/rooms/:code/snapshot` requires an unexpired session and membership. It contains visible players, host, status, sequence, server time, and deadlines. An OPEN snapshot includes public opening quotes and only the requesting player’s portfolio; it excludes credentials and other players’ private data.

Error responses contain a stable `error` code and safe `message`. All mutations require the configured browser Origin. Session, room, and Socket.IO identity comes from the cookie. The web proxy forwards Cookie/Origin and Set-Cookie, validates upstream responses, and converts upstream faults to safe unavailable responses.

Cookies are HttpOnly, SameSite=Strict, Path=/, with a 24-hour Max-Age. With `NODE_ENV=production`, they also require Secure and the service requires an HTTPS `WEB_ORIGIN`. Nonsecure development origins are restricted to loopback. Production runs web and service behind the same HTTPS origin; route `/socket.io/` to the long-running service with WebSocket upgrade support, preserving Origin and Cookie. Route HTTP through Next.js's API handlers, or to the service under the same origin. The development Next.js rewrite preserves the Socket.IO trailing slash and disables automatic slash redirects for successful upgrades. `GAME_SERVER_ORIGIN` is server-only; when using Next.js rewrites in production, set it at build time as well as runtime. No live service is needed during build. The service listens on loopback, suitable for a reverse proxy on the same host.

## Realtime and ownership

Socket.IO handshakes carry `{ code }` in `auth`, with the credential in the cookie. The server checks the exact Origin, expiry, and room membership. Every supported resync and every snapshot delivery revalidates the session and membership. A periodic sweep disconnects expired sessions even in an idle lobby.

`room:snapshot` and `presence:update` carry a complete validated lobby snapshot. `room:resync` takes `{ code, requestId }` (UUID) and acknowledges with `{ requestId, snapshot }`, or a safe error. Handshake/authorization failures return safe errors. Before starting, these remain lobby contracts with no round identity. Countdown and opening add the round views described below. Each committed visible lobby change increments the room's sequence. Full snapshots replace older state; a missed sequence requires no delta replay because every delivery is complete. The browser ignores older snapshots and reconnects with backoff, waiting for a fresh snapshot before displaying Connected.

One service queue serializes subscription, HTTP mutations, timers, and publication. The database commits before publication. A joining socket therefore receives either the earlier snapshot followed by the change or the later snapshot including it. Multiple sockets count as one connected player, and only the last disconnection starts deadlines.

A dedicated PostgreSQL connection holds an advisory ownership lock for the single lobby namespace. A second process fails closed. All store operations run in serialized transactions on this same connection; database loss prevents writes and snapshot delivery, and disconnects sockets. Restart the process after database connectivity is restored to acquire ownership and recover. PostgreSQL independently enforces one active room with a partial unique index, unique normalized names and join order, and eight membership slots.

Migration 2 adds `guest_sessions`, `rooms`, `room_members`, and `room_lifecycle`; migration 3 adds readiness, durable command outcomes, countdown inputs, and immutable engine batches. Applied migrations remain unchanged. Room codes are room identities; `current_round_id` remains null until the opening transaction commits. Creation, joins, host transfers, and expiry record lifecycle history in the same transaction. Presence metadata and lobby sequence are separate from `game_events`.

The service consumes the validated shared room configuration for capacity and deadlines. Defaults remain unchanged. The persisted host deadline is 15 seconds after the last host socket disconnects. A due action rechecks state and chooses the earliest currently connected guest, with join order resolving equal timestamps. No candidate leaves the host unchanged. Reconnection cancels the deadline. Empty lobbies expire after five minutes and release the active-room slot. Repeated timers have no duplicate lifecycle effects; reconnect and expiry serialize, so whichever commits first determines the outcome. On ownership takeover, stale socket presence is cleared; existing deadlines remain, and newly detected disconnections start deadlines at recovery time. Full round crash recovery remains outside this ticket.

## Readiness and round opening

`room:ready` takes `{ ready, requestId }`; `round:start` takes `{ requestId }`.
Both use UUID request IDs and acknowledge `{ requestId, sequence, status, roundId }`
after commit, or a safe error with the request ID when valid. A stored successful
outcome is returned unchanged on retry, including after restart. Reusing an ID
for different command content returns `IDEMPOTENCY_CONFLICT`. The browser retries
unconfirmed commands with the same ID and disables duplicate submission.

Only the authenticated host can start, and at least two connected, unexpired
guests must be ready. All current lobby members lock in join order, including
unready/disconnected guests. The countdown freezes a new ID, seed, complete
configuration, participant list, and open/close deadlines. Its visible snapshot
contains `countdown: { roundId, opensAt, closesAt, participantIds }`; a lobby has
`countdown: null`. New joins fail during countdown or opening.

Losing the second connected participant before opening cancels the countdown,
unlocks joining, and resets all readiness. Restart clears stale socket presence
and safely cancels a persisted countdown; it never funds disconnected stale
presence. A fresh start requires a new request ID. Cancelled attempts have no
funded round, while their original command acknowledgements remain recorded.

At the deadline, one owned transaction commits the immutable baseline/schedule,
`RoundInitialized` at sequence 1, the engine's `RoundOpened`/`QuotesRebuilt` batch
at sequences 2–3, its engine projection, room linkage/status, and lifecycle
record. Failure rolls back all writes. Timer delay/retry preserves recorded
deadlines; it does not grant extra round time. Publication follows commit.

The opened snapshot has `round: { roundId, sequence, opensAt, closesAt, assets,
quotes, portfolio }` and `countdown: null`. `portfolio` contains only the requesting
player's cash and holdings. Future catalog events/schedules, other portfolios,
and the internal engine state stay private. `round.sequence` is the market event
sequence; top-level `sequence` is the independent room snapshot sequence.
Opened-round reads replay committed batches and reject inconsistent projections.
All locked participants retain their resources through disconnect; an empty
OPEN room does not expire. The browser shows opening resources and ladders,
without trading controls, and derives countdowns from server time and deadlines.

`GET /healthz` is liveness, with `/health` retained as an alias. `GET /readyz`
returns 200 only with usable database ownership and validated supported state;
otherwise it returns 503. Ownership is checked before work and before commit,
including when a live connection loses its advisory lock. Database/ownership
loss fails closed until process restart. With this opening-only implementation,
readiness also becomes false at the first unapplied event deadline or closing
deadline. Scheduled effects and overdue-event/close recovery arrive in later
tickets; snapshots remain explicitly opening data rather than a playable market.

## Validation boundaries

```sh
pnpm db:verify
pnpm check
pnpm test:e2e
# Target the multiplayer browser journey:
pnpm test:e2e tests/e2e/lobby.spec.ts
```

Both database and E2E harnesses start `compose.test.yaml` on loopback 55433 with synthetic credentials and temporary PostgreSQL storage, never the development database. Do not run the two harnesses simultaneously. Database cases use separate random schemas. E2E creates and migrates a random schema, starts the service on 3101 and web on 3100 using `.next-e2e`, and removes the disposable container afterward. No AI key is needed. Install Chromium once with `pnpm exec playwright install chromium`.

Ticket #7 originally demonstrated lobby AC-01/05 and lobby-only AC-10/17 with synthetic countdown/open guards. Ticket #8 adds real opening AC-02 and opening-only AC-08/10/14; see [opening evidence](validation/ticket-8-opening.md). Market recovery, ready → trade → event → results, complete milestone 3 gates, and release load targets remain unverified.

Validation recorded October 5, 2026: `pnpm check` passed lint, formatting, typechecking, 190 database-independent tests, and production builds. `pnpm db:verify` passed 32 PostgreSQL/service cases, including ownership-connection loss and recovery. `pnpm test:e2e` passed all five browser cases; the multiplayer case includes two profiles, offline/reconnect, reload identity after a temporary session lookup failure, keyboard submission, and a 360px layout screenshot. All disposable database containers were cleaned up. Changed documentation links resolve. This establishes the lobby slice only, not the full round acceptance criteria.

The two-axis code review found duplicated timing constants, duplicated browser cleanup, and a transient startup-session recovery gap. All were corrected and re-reviewed: Standards 0 remaining findings; Spec 0 remaining findings. The new regressions demonstrate configured room deadlines and recovery of the original browser identity after session lookup failures.
