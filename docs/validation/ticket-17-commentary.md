# Ticket #17: leased commentary worker

Validated locally on October 15, 2026 with Node 24.21.0, pnpm 10.34.5,
PostgreSQL 18.6 (the disposable Compose test database), and Playwright Chromium.
All data and provider responses were synthetic; no AI credential was used.

| Check                              | Result                                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                       | Passed lint, formatting, types, 197 tests across 10 files, and all production builds                                         |
| `pnpm db:verify`                   | Passed 117 tests across 11 files, including 12 commentary cases                                                              |
| `pnpm test:e2e commentary.spec.ts` | Passed one two-browser journey at desktop and 360px                                                                          |
| Final worker setup hardening       | Typecheck passed; targeted real-login process test passed after separating worker environment and checking excess privileges |
| Focused specifications             | Updated persistence/API extracts match the corresponding full reference sections exactly                                     |

The worker/database cases exercise default disabled fallback, two processors,
expired and abandoned leases, stale completion rejection, two persisted attempts,
retry timing, safe provenance, frozen first/preceding event windows, zero activity,
exact deadline ordering, later trades, publication rollback/restart, invalid
executable output, and a hung provider concurrent with market closing. The real
process case exercises the role provisioner, rejection of a privileged connection,
and processing with a separate restricted LOGIN. SQL permission checks reject
private reads and market/result/job-input mutation.

The browser journey joins and readies two guests, executes a protected trade,
receives authored news with no AI section, records no-key fallback, reconnects,
closes, and receives accepted synthetic narration in the original historical
card. Authored copy/time, card count, context label and immutable results are
checked; reload recovers narration from the authorized snapshot.

This supports the ticket #17 portions of AC-09, AC-11, AC-13, AC-14 and AC-18.
Ticket #18 still owns the live provider, contextual generation and factual/semantic
validation (including misleading copy and real-world recommendations). These
results do not establish eight-client latency/load acceptance or completion of the
entire narration milestone. No deployment or live GitHub issue update was made.
