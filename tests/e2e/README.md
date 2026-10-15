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

`terminal.spec.ts` covers ticket #14 through the browser/snapshot seam: all four
watchlist assets, covered depth, opening changes, idle event markers without
invented trade points, exact multi-fill totals/averages, sell rejection, public
bot counterparties, keyboard selection, 35 committed fills surviving the 30-fill
tape window, reconnect/reload, stale connectivity, and a 360px viewport. Empty
quote ladders and missing freshness are synthetic WebSocket response faults;
ordinary depth, executions, charts, and recovery use the real service. It saves
`terminal-desktop.png` and `terminal-360.png`. This supports AC-03/04/06/09/10/17;
it does not establish full release/load acceptance or the later mobile tab UI.

The harness discovers selected spec files and runs each with a fresh synthetic
schema and clock. Each gets its own service process and active room, so multiple
multiplayer suites cannot contend for the MVP's single room. Use `pnpm test:e2e`
for all browser specs or `pnpm test:e2e tests/e2e/terminal.spec.ts` for this slice.

`portfolio.spec.ts` covers ticket #15 at the same browser/snapshot boundary:
opening shared ties, worked multi-fill buy/sell P/L and holdings values, quote-only
news with unchanged marks, both owners' private resources, disconnected rankings,
keyboard disclosures and 360px layout, frozen closing marks and event history,
reconnect/reload at close, immutable participant results after reset/new rounds,
and shared no-trade winners. It checks received HTTP/WebSocket bodies for private
order or credential leaks and the permitted public-total fields. Screenshots
include marked portfolios and frozen results at desktop and 360px widths. These
checks support AC-04/10/11/17, not the later load or complete mobile-tab gates.

`reactions.spec.ts` covers ticket #16 through the agreed browser/snapshot seam:
preset reactions in lobby, open and results views, keyboard and reduced-motion
use at 360px, public multi-fill buy/sell activity, rejected/zero-fill absence,
duplicate delivery, bounded transient expiry, uncertain acknowledgement without
resend, reaction traffic without market freshness, reconnect, events, settlement,
reset and a later round. It compares both owners' authoritative market projections
and immutable results, checks shared payload privacy, and saves desktop/360px
screenshots. Run it alone with `pnpm test:e2e reactions.spec.ts`. Reaction loss is
transient; committed activity must recover. These support AC-05/10/11/17 for this
slice, not full release/load or mobile-tab acceptance.
