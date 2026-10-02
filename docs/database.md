# Frozen round storage

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

Initialization takes a UUID round ID, unsigned 32-bit seed, explicit configuration version, ordered participant UUIDs, creation/open timestamps in integer epoch milliseconds, and a complete validated configuration from `loadBaseline()`. Creation must precede opening. Participant order records join order; sessions, avatars, room state, and authorization arrive in later tickets. The service must derive these inputs from its authoritative state when that integration is implemented.

The stored snapshot includes schema/rules/config/catalog versions, all source configuration, open/close deadlines, initial reference and last prices, human and bot resources, and the complete selected event schedule with IDs, times, facts, templates, icons, and fixed effects. Catalog version is the baseline's `contentVersion`, which already versions the authored catalog; `configVersion` identifies the chosen configuration snapshot. Defaults yield four assets, 1,000,000 cents per human with no units, and a bot with 1,000,000,000 cents plus 100,000 units per asset.

The first selection implementation is recorded as `lcg32-v1`: start with the seed; advance unsigned 32-bit state with `1664525 * state + 1013904223` modulo `2^32`; select `floor(state / 2^32 * catalog.length)` in catalog array order, with replacement. The default interval/duration yields nine selections, excluding close. Schedule IDs combine the round UUID and one-based position. This implements baseline 1.0's seeded selection; no existing timing or effect rule changes. Future algorithm changes must follow the project's rules-version and specification synchronization requirements. Reads use stored outcomes.

One transaction inserts the immutable baseline, a schema-version-1 `RoundInitialized` event at sequence 1, and the matching initial-state projection at sequence 1. The event and cause IDs are the round UUID for this initialization event. Constraints enforce unique event sequences and a projection sequence referencing a committed event. Database triggers reject updates/deletes to frozen baselines and committed events. The full schedule is embedded in the immutable snapshot and initialization event; the scheduler ticket will add mutable applied-event tracking.

The round ID is the initialization idempotency key. Concurrent identical requests and retries after reconnect return the original snapshot. Reusing the ID with changed validated input throws `RoundInitializationConflict` with code `IDEMPOTENCY_CONFLICT`. To use changed configuration, create a new round ID. Read APIs validate stored contracts; recovery reads the event and projection in one database snapshot and rejects inconsistencies. Callers receive independent objects and cannot mutate persisted data by editing a returned value.

This is partial supporting evidence for **AC-02, AC-09, AC-12, and AC-15**. Live funding/opening, event application, gameplay replay, restart catch-up, settlement, and browser round acceptance remain unimplemented. Later slices extend the schema-versioned events and projections; the current recovery contract accepts only initialization.

Validation recorded October 2, 2026: `pnpm db:verify` passed all 17 PostgreSQL cases and cleaned up its disposable container; `pnpm check` passed lint, formatting, typechecking, all 38 existing tests, and production builds. Changed documentation links resolved. Standards review reported no findings; the spec review's UUID-casing finding was fixed, regression-tested, and re-reviewed with no remaining findings. Browser tests were not rerun for this internal persistence change.
