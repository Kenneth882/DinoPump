# DinoPump

A dinosaur-themed multiplayer market game built around fictional assets and virtual Dino Dollars. Players trade on the Pangaea Exchange, react to prehistoric news, and compete for the highest portfolio value in a ten-minute round.

The market engine is deterministic and server-controlled. AI provides optional narration of recorded events.

## Project specification

Read [PROJECT_SPEC.md](./PROJECT_SPEC.md) for the MVP scope, game rules, architecture, data contracts, interface requirements, acceptance criteria, and implementation milestones.

For feature-specific work, use the [focused specification index](./docs/spec/README.md). Agent guardrails and task-to-spec routing live in [AGENTS.md](./AGENTS.md). The complete project specification remains the human reference.

Current status: the read-only Pangaea Exchange introduction loads four canonical assets and initial prices from the game service. Shared runtime schemas validate versioned assets, all documented gameplay defaults, and the authored event catalog. Invalid content prevents service startup; service outages show an unavailable state with Retry. Gameplay, database migrations, and narration are not implemented. Milestone 1 is not yet complete.

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
pnpm dev
```

The read-only introduction and its tests do not require PostgreSQL or an AI key; you can skip the two database commands for ticket #1. Start Docker Desktop before `pnpm db:up`. Open <http://127.0.0.1:3000> for the web app. The service responds at <http://127.0.0.1:3001/health>; this checks process liveness only, not database readiness or gameplay. `Ctrl+C` stops the development processes. Run `nvm use` when opening a new terminal in this repository; installing Node with nvm does not replace your system Node.

The root `.env` contains synthetic local database credentials and is ignored by Git. PostgreSQL **18.6** runs in Docker, binds only to `127.0.0.1:55432`, and stores data in the `dinopump_postgres-data` volume. `pnpm db:stop` stops PostgreSQL while preserving its data. If port 55432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL` in `.env`. No AI API key is needed.

## Baseline content and service connection

`packages/game-content/src/index.ts` owns the baseline: content version `1.0`, rules version `1.0`, and the four approved event effects (FERN +500, AMBR +500, VOLC −500, BONE +500 basis points). `loadBaseline()` validates the entire dataset and returns an independent copy. Future round creation must persist and freeze its own snapshot; no rounds exist yet. Tune authored content under a new content version and follow the specification's rules-version requirements when changing gameplay. Keep authored facts/templates consistent with effects; prose is never interpreted as an instruction.

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
| `pnpm test`         | Run content/contract and HTTP integration tests               |
| `pnpm test:e2e`     | Run baseline browser checks against both apps                 |
| `pnpm check`        | Run lint, formatting, types, Vitest, and production build     |
| `pnpm db:up`        | Start PostgreSQL and wait for its health check                |
| `pnpm db:check`     | Verify an authenticated database connection with `SELECT 1`   |
| `pnpm db:stop`      | Stop PostgreSQL without deleting its volume                   |

Install the Playwright browser once per machine with `pnpm exec playwright install chromium`. The E2E configuration starts its own web app on port 3000 and game service on port 3001, so stop `pnpm dev` first.

Ticket #1 tests cover canonical prices/defaults, malformed content, the real service-to-web path, and desktop/mobile introduction and retry states. They provide partial supporting evidence for AC-02, AC-05, AC-09, and AC-13; they do not demonstrate live initialization, scheduled effects, narration fallback during play, or a complete round. The test command now fails if no tests exist. Run `pnpm check` and `pnpm test:e2e` for this change. AC-12, AC-14, AC-15, AC-17, and AC-18 remain unverified.

## Workspace

- `apps/web`: Next.js and React app with Socket.IO client dependency.
- `apps/game-server`: Node/TypeScript service scaffold with Socket.IO installed; realtime commands are not wired yet.
- `apps/commentary-worker`: reserved TypeScript package; no worker process or provider is implemented.
- `packages/engine`: reserved framework-independent engine package with no runtime dependencies.
- `packages/contracts`: shared Zod schemas for baseline content and its public HTTP response.
- `packages/database`: PostgreSQL driver and connection check; schema/migrations remain to be implemented.
- `packages/game-content`: validated canonical assets, event facts/templates, and gameplay defaults.
- `tests/integration` and `tests/e2e`: baseline HTTP/browser checks and locations for future acceptance coverage.

Matt Pocock's skills are installed in the user's agent environment, separately from these project dependencies. Repository workflow configuration is documented in [issue tracker](docs/agents/issue-tracker.md), [triage labels](docs/agents/triage-labels.md), and [domain docs](docs/agents/domain.md).
