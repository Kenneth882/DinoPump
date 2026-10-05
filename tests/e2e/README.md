# Browser acceptance tests

Run `pnpm test:e2e` after installing Chromium with `pnpm exec playwright install chromium`. The harness starts disposable PostgreSQL on 55433, migrates a random synthetic schema, and starts the real game service and web app on ports 3101 and 3100. The web app uses `.next-e2e` so an existing development server can remain running. The harness removes its disposable container afterward; do not run `db:verify` concurrently.

`market-baseline.spec.ts` checks the service-to-web introduction at desktop and 360px widths, exact prices, fictional-market notices, malformed responses, and keyboard retry after an unavailable response. Successful-page screenshots are saved under `test-results/` for visual inspection. Outage browser tests intercept the web response; the service integration tests separately exercise a real closed service connection.

These are supporting checks for ticket #1, not the complete player journey required by AC-17. Add multiplayer player-journey tests as gameplay is implemented.

`lobby.spec.ts` demonstrates two independent guests creating/joining the same room,
keyboard submission, real Socket.IO delivery, offline/reconnect and reload with
unchanged player IDs, readiness, host-only start, countdown, identical opening
resources/quotes, and a 360px layout. It saves both lobby and opening screenshots.
Run it alone with `pnpm test:e2e tests/e2e/lobby.spec.ts`. This supports AC-01/02 and
opening-only AC-10/17. Read [lobby contracts and setup](../../docs/lobby.md) for
scope and deployment.
