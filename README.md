# DinoPump

A dinosaur-themed multiplayer market game built around fictional assets and virtual Dino Dollars. Players trade on the Pangaea Exchange, react to prehistoric news, and compete for the highest portfolio value in a ten-minute round.

The market engine is deterministic and server-controlled. AI provides optional narration of recorded events.

## Project specification

Read [PROJECT_SPEC.md](./PROJECT_SPEC.md) for the MVP scope, game rules, architecture, data contracts, interface requirements, acceptance criteria, and implementation milestones.

For feature-specific work, use the [focused specification index](./docs/spec/README.md). Agent guardrails and task-to-spec routing live in [AGENTS.md](./AGENTS.md). The complete project specification remains the human reference.

Current status: the read-only Pangaea Exchange introduction loads four canonical assets and initial prices from the game service. Shared runtime schemas validate versioned assets, all documented gameplay defaults, and the authored event catalog. Invalid content prevents service startup; service outages show an unavailable state with Retry. PostgreSQL migrations and internal APIs now persist immutable synthetic round baselines, seeded schedules, and initialization events/projections. The pure engine generates covered deterministic bot quote ladders and executes protected buys and sells with exact settlement and complete immutable state transitions. Guests can create or join one durable eight-player lobby, mark ready, and watch a host-started countdown atomically open a funded round with deterministic quotes. Reconnect restores identity and private opening resources. Trading, scheduled event execution, results, and narration remain later work. See [guest lobby setup and contracts](docs/lobby.md).

## Local setup

Use Node **24.21.0**, pnpm **10.34.5**, and Docker with Compose. The runtime is pinned in `.nvmrc`, the package manager in `package.json`, and dependencies in `pnpm-lock.yaml`. Next.js and React are installed locally in `apps/web`; TypeScript, ESLint, Prettier, Vitest, and Playwright are workspace development dependencies.

With [nvm](https://github.com/nvm-sh/nvm) installed, run from the repository root:

```sh
nvm install
nvm use
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
cp -n .env.example .env
pnpm db:up
pnpm db:check
pnpm db:migrate
pnpm dev
```

The read-only introduction and its tests do not require PostgreSQL or an AI key; for introduction-only use, omit or empty `DATABASE_URL` and skip the database commands. Lobby features require PostgreSQL and migrations. Start Docker Desktop before `pnpm db:up`. Open <http://127.0.0.1:3000> for the web app. The service responds at <http://127.0.0.1:3001/health>; this remains a liveness alias for `/healthz`. `/readyz` checks owned database access and supported authoritative state. `Ctrl+C` stops the development processes. Run `nvm use` when opening a new terminal in this repository; installing Node with nvm does not replace your system Node.

The root `.env` contains synthetic local database credentials and is ignored by Git. PostgreSQL **18.6** runs in Docker, binds only to `127.0.0.1:55432`, and stores data in the `dinopump_postgres-data` volume. `pnpm db:stop` stops PostgreSQL while preserving its data. If port 55432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL` in `.env`. No AI API key is needed.

## Baseline content and service connection

`packages/game-content/src/index.ts` owns the baseline: content version `1.0`, rules version `1.1`, and the four approved event effects (FERN +500, AMBR +500, VOLC −500, BONE +500 basis points). `loadBaseline()` validates the entire dataset and returns an independent copy. Internal round creation persists its own frozen snapshot and nine-event schedule. Tune authored content under a new content version and follow the specification's rules-version requirements when changing gameplay. Keep authored facts/templates consistent with effects; prose is never interpreted as an instruction.

Run `pnpm db:verify` for disposable PostgreSQL migration, write/readback, rollback, retry, frozen-configuration, guest/session, room admission, and lifecycle checks. It uses a separate temporary database on port 55433 and never resets the development database. See [frozen round storage](docs/database.md) for migration readiness, API inputs, sequence storage, seeded selection, and validation limits.

The game service exposes `GET /api/market-baseline`. Its public response contains only schema/content/rules versions and assets; configuration, events, and private data are excluded. The browser loads it through the same-origin Next.js route. Set `GAME_SERVER_ORIGIN` in the root `.env` to the service origin (default `http://127.0.0.1:3001`); keep it in sync if changing `GAME_SERVER_PORT`. Web development/start commands load the root `.env`; the origin stays server-side. Requests and responses are uncached, with a five-second upstream timeout and HTTP 503 on failure. The introduction remains visible without substituting bundled prices.

`pnpm dev` first compiles shared packages, then watches those packages alongside the service and web app. The root test/typecheck commands also compile shared dependencies, so they work from a clean checkout. `pnpm build` needs neither a running game service nor a database. To run the built apps, run `pnpm --filter @dinopump/game-server start` and `pnpm --filter @dinopump/web start` in separate terminals after building.

## Development commands

| Command             | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `pnpm dev`          | Build/watch shared packages, web app, and game service        |
| `pnpm build`        | Compile workspace packages and build the Next.js app          |
| `pnpm lint`         | Run ESLint across application and tooling code                |
| `pnpm typecheck`    | Check application, package, and test/tool configuration types |
| `pnpm format:check` | Check formatting without changing files                       |
| `pnpm format`       | Format implementation files; preserve specification extracts  |
| `pnpm test`         | Run content/contract, engine, and HTTP integration tests      |
| `pnpm test:e2e`     | Run baseline and two-guest round-opening browser checks       |
| `pnpm check`        | Run lint, formatting, types, Vitest, and production build     |
| `pnpm db:up`        | Start PostgreSQL and wait for its health check                |
| `pnpm db:check`     | Verify an authenticated database connection with `SELECT 1`   |
| `pnpm db:migrate`   | Apply pending migrations; safely repeat to confirm readiness  |
| `pnpm db:verify`    | Run isolated PostgreSQL integration tests and clean up        |
| `pnpm db:stop`      | Stop PostgreSQL without deleting its volume                   |

Install the Playwright browser once per machine with `pnpm exec playwright install chromium`. The E2E harness starts disposable PostgreSQL on 55433, a web app on 3100 with a separate `.next-e2e` directory, and a game service on 3101. Keep those ports free; do not run `db:verify` simultaneously. See [lobby verification](docs/lobby.md#validation-boundaries).

Ticket #1 tests cover canonical prices/defaults, malformed content, the real service-to-web path, and desktop/mobile introduction and retry states. They provide partial supporting evidence for AC-02, AC-05, AC-09, and AC-13. Ticket #2 adds database foundation evidence for AC-02, AC-09, AC-12, and AC-15 through `pnpm db:verify`. Neither suite demonstrates live initialization, scheduled effects, gameplay replay/recovery, or a complete round. Ticket #3 adds pure-engine evidence for AC-02, AC-08, and AC-16, including 500 seeded quote rebuilds; it does not demonstrate trade settlement, serialized service commands, or live-round acceptance.

## Workspace

- `apps/web`: Next.js and React app with Socket.IO client dependency.
- `apps/game-server`: Node/TypeScript service with authenticated guest sessions, durable lobby commands, and Socket.IO presence.
- `apps/commentary-worker`: reserved TypeScript package; no worker process or provider is implemented.
- `packages/engine`: framework-independent bot quote initialization/rebuilding and protected buys/sells with shared runtime contracts; see [engine API](packages/engine/README.md).
- `packages/contracts`: shared Zod schemas for baseline content, its public HTTP response, frozen rounds, baseline recovery, bot quotes, and protected buy/sell inputs/results.
- `packages/database`: PostgreSQL migrations, connection check, atomic frozen-round persistence, initialization recovery reads, and owned transactional lobby storage.
- `packages/game-content`: validated canonical assets, event facts/templates, and gameplay defaults.
- `tests/integration` and `tests/e2e`: baseline HTTP/browser checks and locations for future acceptance coverage.

Matt Pocock's skills are installed in the user's agent environment, separately from these project dependencies. Repository workflow configuration is documented in [issue tracker](docs/agents/issue-tracker.md), [triage labels](docs/agents/triage-labels.md), and [domain docs](docs/agents/domain.md).
