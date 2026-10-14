# Tickets 12 and 13 merge verification

Resolved October 14, 2026 on `main`, combining client reconciliation at `f63e913`
with server recovery at `70d1344`.

The `submitOrder` resolution retains authorized original receipt readback before
rejecting new stale-round attempts. Integrity abort checks now use the requested
round's durable abort record before readback, so lobby reset cannot expose an
unverifiable old outcome. The regression first returned a damaged synthetic balance
after reset, then passed with `MARKET_CLOSED`; the healthy historical-retry test also
passes. This supports AC-05/07/10/12. The documentation keeps both client resync and
server projection/crash recovery descriptions.

The process crash helper now accepts the configured synthetic test port and passes
it to child services, preserving Ticket 12's independent worktree test harnesses.
The latency measurement checks exactly one committed scheduled news item rather
than requiring the explicit test tick to beat the live service timer. Its fake-clock
lag assertion remains zero; production scheduling is unchanged.

Validation uses Node 24.21.0/pnpm 10.34.5 and a disposable synthetic PostgreSQL
Compose project `dinopump-merge-12-13` on loopback port 55435. No development data or
credentials are used. A clean temporary source copy excludes pre-existing duplicate
` 2.*`/generated files; the originals are preserved. The original tree's full
web typecheck still encounters duplicate `.next/types` declarations.

- `pnpm check`: lint, formatting, types, 196 tests in 9 files, and production builds
  passed in the clean source copy.
- Targeted healthy and aborted historical-retry tests: both passed.
- Full database verification: all 93 tests across 9 files passed in 48.62 seconds,
  including process termination, ownership loss, projection repair, and the combined
  client/server regression suites. Disposable database cleanup completed.
- Browser verification: the four introduction tests passed in the full run. The
  multiplayer journey timed out during guest session restoration on that run, then
  passed unchanged on a focused retry in 1.9 minutes, covering trade/reconnect,
  events, final results, lobby reset, and a second round at 360px. All five browser
  cases have passing evidence; the initial full-run timeout remains recorded.
- Conflict markers removed; changed links resolve and focused persistence/API
  sections match the complete reference.

The first database run passed 92/93 cases and timed out in the existing latency
measurement. That measurement passed alone; the next full run caught its real
service timer winning the due-event race. The assertion was corrected to verify
committed behavior rather than scheduler call ownership. These initial failures
are retained as validation history, not passing evidence.
