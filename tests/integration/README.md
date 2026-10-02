# Database and service integration tests

`market-baseline.test.ts` runs with `pnpm test`. It starts a real service on an ephemeral loopback port, checks its public projection through the Next.js route, rejects mutations, verifies whole-baseline validation before listening, and checks unavailable/malformed upstream handling. No database or AI credentials are required. The test runner must be allowed to bind local ports.

`round-baseline.database.test.ts` runs with `pnpm db:verify` against the dedicated disposable PostgreSQL instance. It covers migrations, atomic initialization and rollback, concurrent retries, deterministic schedules, frozen resources/configuration, reconnect/readback, and baseline event/projection integrity. See [database setup and verification](../../docs/database.md) for isolation and commands.

This supports AC-02, AC-09, AC-12, and AC-15 at the persistence foundation only. Live trading, scheduled effects, gameplay replay and restart catch-up remain unverified. The development database is not a disposable test database.
