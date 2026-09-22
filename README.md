# DinoPump

A dinosaur-themed multiplayer market game built around fictional assets and virtual Dino Dollars. Players trade on the Pangaea Exchange, react to prehistoric news, and compete for the highest portfolio value in a ten-minute round.

The market engine is deterministic and server-controlled. AI provides optional narration of recorded events.

## Project specification

Read [PROJECT_SPEC.md](./PROJECT_SPEC.md) for the MVP scope, game rules, architecture, data contracts, interface requirements, acceptance criteria, and implementation milestones.

For feature-specific work, use the [focused specification index](./docs/spec/README.md). Agent guardrails and task-to-spec routing live in [AGENTS.md](./AGENTS.md). The complete project specification remains the human reference.

Current status: development tooling and workspace scaffolding are installed. The web app has a placeholder page and the game service has a process-liveness endpoint. Gameplay, shared game schemas/content, database migrations, and narration are not implemented. Milestone 1 is not yet complete.

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

Start Docker Desktop before `pnpm db:up`. Open <http://127.0.0.1:3000> for the web app. The service responds at <http://127.0.0.1:3001/health>; this checks process liveness only, not database readiness or gameplay. `Ctrl+C` stops the development processes. Run `nvm use` when opening a new terminal in this repository; installing Node with nvm does not replace your system Node.

The root `.env` contains synthetic local database credentials and is ignored by Git. PostgreSQL **18.6** runs in Docker, binds only to `127.0.0.1:55432`, and stores data in the `dinopump_postgres-data` volume. `pnpm db:stop` stops PostgreSQL while preserving its data. If port 55432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL` in `.env`. No AI API key is needed.

## Development commands

| Command             | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `pnpm dev`          | Start the web app and service scaffold                        |
| `pnpm build`        | Compile workspace packages and build the Next.js app          |
| `pnpm lint`         | Run ESLint across application and tooling code                |
| `pnpm typecheck`    | Check application, package, and test/tool configuration types |
| `pnpm format:check` | Check formatting without changing files                       |
| `pnpm format`       | Format implementation files; preserve specification extracts  |
| `pnpm test`         | Run Vitest unit/integration tests; currently allows no tests  |
| `pnpm test:e2e`     | Run Playwright tests once player-journey tests are added      |
| `pnpm check`        | Run lint, formatting, types, Vitest, and production build     |
| `pnpm db:up`        | Start PostgreSQL and wait for its health check                |
| `pnpm db:check`     | Verify an authenticated database connection with `SELECT 1`   |
| `pnpm db:stop`      | Stop PostgreSQL without deleting its volume                   |

Install the Playwright browser once per machine with `pnpm exec playwright install chromium`. The E2E configuration starts its own web app on port 3000, so stop `pnpm dev` first.

No gameplay tests exist yet. A successful empty Vitest run demonstrates tool startup only; it does not satisfy any acceptance criterion. `pnpm test:e2e` reports no tests until browser tests are added. Add real tests as behavior is implemented, then remove `--passWithNoTests` from the root test script. The current setup supports §7 architecture and §13 setup requirements; AC-12, AC-14, AC-15, AC-17, and AC-18 remain unverified.

## Workspace

- `apps/web`: Next.js and React app with Socket.IO client dependency.
- `apps/game-server`: Node/TypeScript service scaffold with Socket.IO installed; realtime commands are not wired yet.
- `apps/commentary-worker`: reserved TypeScript package; no worker process or provider is implemented.
- `packages/engine`: reserved framework-independent engine package with no runtime dependencies.
- `packages/contracts`: reserved shared contract package with Zod installed.
- `packages/database`: PostgreSQL driver and connection check; schema/migrations remain to be implemented.
- `packages/game-content`: reserved asset, event, and configuration package.
- `tests/integration` and `tests/e2e`: locations for future acceptance coverage.

Matt Pocock's skills are installed in the user's agent environment, separately from these project dependencies. Issue-tracker and documentation-workflow configuration is a separate setup task.
