# Browser acceptance tests

Run `pnpm test:e2e` after installing Chromium with `pnpm exec playwright install chromium`. The harness starts disposable PostgreSQL on 55433, migrates a random synthetic schema, and starts the real game service and web app on ports 3101 and 3100. The web app uses `.next-e2e` so an existing development server can remain running. The harness removes its disposable container afterward; do not run `db:verify` concurrently.

`market-baseline.spec.ts` checks the service-to-web introduction at desktop and 360px widths, exact prices, fictional-market notices, malformed responses, and keyboard retry after an unavailable response. Successful-page screenshots are saved under `test-results/` for visual inspection. Outage browser tests intercept the web response; the service integration tests separately exercise a real closed service connection.

These are supporting checks for ticket #1, not the complete player journey required by AC-17. Add multiplayer player-journey tests as gameplay is implemented.

`lobby.spec.ts` demonstrates two independent guests creating/joining the same room,
keyboard submission, real Socket.IO delivery, offline/reconnect and reload with
unchanged player IDs, readiness, host-only start, countdown, identical opening
resources/quotes, and a 360px layout. It saves both lobby and opening screenshots.
Run it alone with `pnpm test:e2e tests/e2e/lobby.spec.ts`. The journey now includes
protected trades, immediate event news, stale connectivity, lost submissions and
postcommit delivery, out-of-order snapshots/batches/receipts, close, host reset,
and fresh rounds. Packet faults operate at the real WebSocket boundary. Pending
retries preserve their original content and late packets cannot replace newer
resources. These browser checks support AC-05/07/10/11/14/17; full process-crash
recovery and load acceptance remain separate tickets. Read [lobby contracts and setup](../../docs/lobby.md) for
scope and deployment.

For concurrent checkouts, set both `DINOPUMP_TEST_PROJECT` and
`DINOPUMP_TEST_PORT` as shown in the lobby setup document. Run database and browser
harnesses sequentially and reserve ports 3100/3101 exclusively for the browser run.
