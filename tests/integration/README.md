# Database and service integration tests

`market-baseline.test.ts` runs with `pnpm test`. It starts a real service on an ephemeral loopback port, checks its public projection through the Next.js route, rejects mutations, verifies whole-baseline validation before listening, and checks unavailable/malformed upstream handling. No database or AI credentials are required. The test runner must be allowed to bind local ports.

Add synthetic-data database tests as persistence and room processing are implemented. AC-07, AC-10, AC-12, AC-14, and AC-15 remain unverified. The development database is not a disposable test database.
