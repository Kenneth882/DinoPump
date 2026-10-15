# Ticket #18: optional fact-checked narration

Validated locally on October 15, 2026 with Node 24.21.0, pnpm 10.34.5,
PostgreSQL 18.6 in disposable Compose storage, and Playwright Chromium on macOS.
All data, keys and provider responses were synthetic. No live AI request was made.

| Check                              | Result                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| Targeted provider/validator tests  | Passed 29 tests across two files                                    |
| Targeted commentary database tests | Passed 21 tests                                                     |
| Narration browser journeys         | Passed both two-browser journeys at desktop and 360px               |
| `pnpm check`                       | Passed lint, formatting, types, 226 tests and all production builds |
| `pnpm db:verify`                   | Passed 126 tests across 11 files                                    |

The replaceable provider receives an explicit projection of fictional catalog
facts and the frozen affected-asset context. It has no tools, player identities,
session credentials, raw user text, future events or leaderboard data. The
optional OpenAI Responses adapter uses built-in fetch, disabled response storage,
bounded output, no SDK retries and the existing five-second worker abort signal.
Missing configuration disables calls. A model snapshot is an explicit deployment
setting, with no default model or live account requirement for gameplay.

The model selects a complete factual passage for an affected asset, optionally
with approved light dinosaur humor. Exact local membership checks require the
correct headline/passage pair and enforce the 100/400-character JSON limits.
This intentionally conservative vocabulary rejects arbitrary prose rather than
claiming that a keyword filter can prove its truth. Accepted passages include
reference changes, a separately identified last execution (or no lifetime
execution), and preceding-window aggregate units/fills/value. They add trading
context beyond the complete authored source, which always remains visible.

Provider cases cover malformed JSON, overlength fields, invented trades,
reference/last-price confusion, pre-event activity misrepresented as a reaction,
real-world advice, external claims, scripts, prompt injection, individual
judgments, extra commands, forged provenance, wrong-asset headlines, refusal,
incomplete output, zero window activity and exclusion of injected private fields.
Integration checks preserve exact authored news and immutable engine history,
publish valid frozen inputs after later trading/closing without changing results,
and bound actual adapter outages to two persisted attempts across fresh workers.
Retries send identical captured inputs despite later trades. The existing
five-second hung-call case now exercises the fact-checking provider boundary.
Existing cases retain lease fencing, role permissions, publication recovery and
first/preceding-window coverage from ticket #17.

The no-key browser journey joins/readies two guests, executes trades before and
after an event, receives all nine events, reconnects, closes, drains all narration
jobs as disabled, checks immutable results and complete authored cards, and
reloads without any AI section. The second journey publishes approved narration
into its original card after closing, with the historical context label,
unchanged authored copy/time, stable card count and unchanged results.
Both journeys advance a test-only clock through the normal round deadlines;
they do not measure ten minutes of wall-clock operation or provider latency.

This demonstrates the ticket #18 narration cases for AC-09, AC-11 and AC-13 and
the no-key end-to-end part of AC-18. The combined ticket #17/#18 evidence supports
the narration milestone's AC-09/13 gate. Eight-client latency/load acceptance,
live provider model access/latency and deployment remain outside this evidence.
No gameplay rules or frozen-round configuration changed.
