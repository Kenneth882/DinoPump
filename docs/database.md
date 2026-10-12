# Database storage

Ticket [#2](https://github.com/Kenneth882/DinoPump/issues/2) implements the persistence foundation in [§8](spec/persistence.md), using the round rules in [§4](spec/round-lifecycle.md) and event authority in [§10](spec/events-and-narration.md). These are internal server APIs; the HTTP introduction still excludes schedules and private resources.

## Migrations

Start Docker Desktop, install the pinned workspace dependencies, and copy `.env.example` to `.env` if needed. From the repository root:

```sh
pnpm db:up
pnpm db:check
pnpm db:migrate
pnpm db:migrate
```

`db:check` checks the connection only. The first migration creates `rounds`, `game_events`, `round_projections`, and the migration ledger. Repeating `db:migrate` reports that migrations are current. Migrations run in one transaction under a PostgreSQL advisory lock; concurrent runners serialize. Unknown or noncontiguous migration history fails. Add future migrations to `packages/database/src/migrations.ts` in order; never edit an applied migration. No reset or destructive down migration is provided. Development data stays in the existing Docker volume.

## Isolated verification

```sh
pnpm db:verify
pnpm check
```

`db:verify` builds shared contracts, starts `compose.test.yaml`, runs PostgreSQL integration tests, and removes its container/network even after a test failure. It uses a separate Compose project, loopback port **55433**, database **dinopump_test**, synthetic credentials, and temporary in-memory PostgreSQL storage. It does not load `.env` or use `DATABASE_URL`. Each test owns a randomly named schema and removes only that schema. The test suite rejects any URL outside the dedicated loopback database. Keep port 55433 free and run one verification process at a time. A force-killed process can leave the disposable container running; `docker compose -f compose.test.yaml down` removes it.

The suite covers fresh/repeated/concurrent migrations; exact initial resources; nine events at 60–540 seconds; catalog facts/effects; known seeded selections; concurrent and changed retries; transaction rollback after a real final-write failure; configuration changes; reconnect/readback; baseline event/projection consistency; and invalid initialization inputs. `pnpm check` runs the database-independent suite and the normal lint, formatting, type, and production-build checks. Database tests deliberately require `db:verify` instead of silently skipping inside `pnpm test`.

## Internal API and stored data

`@dinopump/database` exports `migrate(pool)`, `createRoundBaseline(pool, input)`, `readRoundBaseline(pool, roundId)`, and `readRoundRecovery(pool, roundId)`. Callers own their PostgreSQL pool. Run migrations before using round APIs.

Initialization takes a UUID round ID, unsigned 32-bit seed, explicit configuration version, ordered participant UUIDs, creation/open timestamps in integer epoch milliseconds, and a complete validated configuration from `loadBaseline()`. Creation must precede opening. Participant order records join order. Ticket #8 derives these inputs from authenticated room state, freezes them at countdown start, and composes initialization and opening in the owned room transaction.

The stored snapshot includes schema/rules/config/catalog versions, all source configuration, open/close deadlines, initial reference and last prices, human and bot resources, and the complete selected event schedule with IDs, times, facts, templates, icons, and fixed effects. Catalog version is the baseline's `contentVersion`, which already versions the authored catalog; `configVersion` identifies the chosen configuration snapshot. Defaults yield four assets, 1,000,000 cents per human with no units, and a bot with 1,000,000,000 cents plus 100,000 units per asset.

The first selection implementation is recorded as `lcg32-v1`: start with the seed; advance unsigned 32-bit state with `1664525 * state + 1013904223` modulo `2^32`; select `floor(state / 2^32 * catalog.length)` in catalog array order, with replacement. The default interval/duration yields nine selections, excluding close. Schedule IDs combine the round UUID and one-based position. This implements baseline 1.0's seeded selection; no existing timing or effect rule changes. Future algorithm changes must follow the project's rules-version and specification synchronization requirements. Reads use stored outcomes.

One transaction inserts the immutable baseline, a schema-version-1 `RoundInitialized` event at sequence 1, and the matching initial-state projection at sequence 1. The event and cause IDs are the round UUID for this initialization event. Constraints enforce unique event sequences and a projection sequence referencing a committed event. Database triggers reject updates/deletes to frozen baselines and committed events. The full schedule is embedded in the immutable snapshot and initialization event; ticket #9 tracks application through committed scheduled batches, the engine cursor, and source-linked news.

The round ID is the initialization idempotency key. Concurrent identical requests and retries after reconnect return the original snapshot. Reusing the ID with changed validated input throws `RoundInitializationConflict` with code `IDEMPOTENCY_CONFLICT`. To use changed configuration, create a new round ID. Read APIs validate stored contracts; recovery reads the event and projection in one database snapshot and rejects inconsistencies. Callers receive independent objects and cannot mutate persisted data by editing a returned value.

This is partial supporting evidence for **AC-02, AC-09, AC-12, and AC-15**. Ticket #8 adds live funding/opening and opening replay through the API below. Ticket #9 adds scheduled event application below; full gameplay recovery, settlement, and complete browser round acceptance remain later work. Later slices extend the schema-versioned events and projections; the current recovery contract accepts only initialization.

Validation recorded October 2, 2026: `pnpm db:verify` passed all 17 PostgreSQL cases and cleaned up its disposable container; `pnpm check` passed lint, formatting, typechecking, all 38 existing tests, and production builds. Changed documentation links resolved. Standards review reported no findings; the spec review's UUID-casing finding was fixed, regression-tested, and re-reviewed with no remaining findings. Browser tests were not rerun for this internal persistence change.

## Guest lobby storage

Migration 2 adds guests, rooms, membership, and lifecycle records without changing frozen rounds. The game service owns the single lobby using a dedicated PostgreSQL advisory-lock connection. See [lobby persistence, security, recovery, and verification](lobby.md) for the new API and deadlines. `pnpm db:verify` now also runs isolated database-backed HTTP and Socket.IO lobby tests.

## Atomic opening storage

Migration 3 adds readiness to memberships, `room_commands` for durable successful
command outcomes, `room_countdowns` for frozen intended initialization, and
`round_batches` for immutable engine command/event batches. The owned transaction
composes baseline initialization and the full opening, then updates the projection
to engine state at sequence 3. The room points to that round in the same commit.

`readOpenedRound(pool, roundId)` is an internal API returning validated engine
state after replay and comparison with the committed events/projection. It can
also compose with a caller's transaction connection. `readRoundRecovery` retains
its baseline-only sequence-1 contract; use `readOpenedRound` for actual opened
rounds. Opening event IDs are assigned UUIDs on commit, with the round UUID as
the cause. The complete logical batch remains available for replay.

The service derives private/public views from this state; callers must never
send a raw engine state or frozen schedule to the browser. Restart reads committed
opening history without refunding or reinitializing participants. Full gameplay
catch-up remains later work. See [ticket #8 evidence](validation/ticket-8-opening.md).

## Scheduled effects and template news

Migration 4 widens `game_events.cause_id` from UUID to text while preserving all
existing values. This stores engine schedule causes (`roundUUID:index`) losslessly.
It adds immutable `news_items`, uniquely linked to a scheduled source and the
same round's committed event, and `commentary_jobs` with approved inputs, status,
attempts, next-attempt time, and optional lease fields. No worker runs yet.

The owned transaction commits each complete engine batch, event rows, projection,
news, and job together. Multiple overdue events drain in due-time order in the
same transaction. Failure in any write rolls back the entire drain. The frozen
schedule is never changed; the engine cursor and unique source rows identify
already-applied events. `readOpenedRound` verifies replay, stored event causes,
projection equality, authored news, and job inputs against committed facts.
It rejects inconsistent storage rather than silently repairing it.

`LobbyStore.withMarketRound(roundId, work)` is the internal service seam for
future market commands. It shares the timer's owned queue and drains due effects
before invoking `work(client, state, now)` inside that transaction. Ticket #10
must authenticate commands, persist the complete outcome inside this callback,
and publish only after the returned promise commits. Calling transaction helpers
on an unrelated connection or separating matching from serialization is unsafe.

`LobbyStore.open` replays and catches up missed pre-close effects before returning.
The service remains unready after the closing deadline because settlement is
still ticket #11. General projection rebuilding and trade crash recovery remain
#13. Late catch-up never moves the persisted round deadlines.
