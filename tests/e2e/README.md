# Browser acceptance tests

Run `pnpm test:e2e` after installing Chromium with `pnpm exec playwright install chromium`. Playwright starts the real game service and web app on ports 3001 and 3000; stop `pnpm dev` first.

`market-baseline.spec.ts` checks the service-to-web introduction at desktop and 360px widths, exact prices, fictional-market notices, malformed responses, and keyboard retry after an unavailable response. Successful-page screenshots are saved under `test-results/` for visual inspection. Outage browser tests intercept the web response; the service integration tests separately exercise a real closed service connection.

These are supporting checks for ticket #1, not the complete player journey required by AC-17. Add multiplayer player-journey tests as gameplay is implemented.
