# Ticket #19: accessible desktop and 360px player journey

Scope: [issue #19](https://github.com/Kenneth882/DinoPump/issues/19),
[interface §6](../spec/interface.md), [recovery §9](../spec/api-and-recovery.md),
[narration §10](../spec/events-and-narration.md), and
[AC-10/11/13/17](../spec/verification.md). Started October 15, 2026 on `ticket19`
from `40fa323eaa0105c6641cbf1e7d937c5f0fa8c7e8`; blockers #14–16 were closed.

## Behavior

At widths up to 1100px, Market, Trade, Portfolio and News expose one panel at a
time. Native tab buttons support arrows with wraparound, Home/End, pointer and
keyboard activation, selected state, associated panels and a single tab stop.
Inactive panels are hidden from focus and the accessibility tree. The mounted
protected ticket retains its values across view/viewport changes. Desktop keeps
the three-column watchlist, chart/news and trade/depth arrangement, with private
portfolio and public leaderboard panels.

The sticky bar retains room, countdown, connection/quote freshness and the
fictional-currency notice. An always-mounted, polite atomic trade-status region
outside the panels reports pending reconciliation and settled/rejected outcomes,
including while News is selected. Connection changes have their own atomic
status; countdown seconds, charts, news, activity and market ticks do not become
live announcement streams. Existing textual gains/losses, focus rings and
reduced-motion rules remain in use. No rule, API, dependency or database change
was required. Unrelated pre-existing duplicate-file deletions were preserved.

## Evidence and acceptance mapping

The agreed test seam is the existing Playwright browser/authorized HTTP snapshot
boundary. The harness uses two isolated Chromium contexts, the actual game service
and web app, PostgreSQL 18.6 on loopback 55433 with random synthetic schemas, and
the existing test-only clock. No production data or provider credentials are used.

| AC    | Browser evidence                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-10 | Both clients agree on assets, quotes and public totals. A real committed multi-fill buy loses its delivery, remains pending while changing tabs, disconnects, and reconciles exactly one order with the original private cash/holdings. Missing freshness pauses trading until a fresh snapshot. Existing lobby/terminal suites also cover reordered batches, retries, empty depth and complete chart history. |
| AC-11 | Protected buys/sells settle through the real service. Closing while the guest is disconnected restores identical shared rankings, nine factual events and frozen owner holdings/marks. Full authorized results remain identical after reload and lobby reset. Existing portfolio/commentary suites cover ties, later rounds and durable late narration.                                                        |
| AC-13 | Immediate complete authored news has no empty AI section. Synthetic schema-valid updates enhance the same card with labeled plain text and historical time while retaining headline/facts/commentary/effects/timestamp and service state. Commentary suites separately exercise durable publication, missing-key fallback and late enhancement without changing results.                                       |
| AC-17 | Join, ready, start, protected trades, event, pending-fill reconnect and results run in independent 1600px desktop and 360px contexts. Keyboard events operate inputs/actions, tabs, watchlist and holdings disclosures. Reduced motion, narrow ticket bounds, focus, no horizontal overflow and a sticky status bar are checked.                                                                               |

The first-visit-to-first-successful-trade assertion uses real wall-clock time,
including readiness and the five-second countdown; each player must finish within
120 seconds. Exact timings are saved to `first-trade-timing.json` and attached to
the Playwright result. Initial focus is positioned by Playwright; actions and text
entry use keyboard events. This is an automated first-time-flow usability smoke
check, not an observed session with a new human player.

Targeted visual/accessibility review checks panel/control fit, text labels,
native input labels, tab relationships, visible amber focus, quiet high-frequency
updates and reduced motion. Calculated sRGB contrast ratios for the used opaque
palette: primary text on page 15.85:1, muted text on panels 9.77:1, amber headings
10.70:1, fern gains on lobby 10.83:1, loss text on panels 11.44:1, selected-tab text
11.34:1, and unselected-tab text 13.46:1. Disabled controls are excluded. These
checks do not constitute a full WCAG audit or a manual screen-reader session.

## Commands and results

- `pnpm test:e2e`: all **11 tests in 8 files passed** on the final application
  behavior, including no-key and durable-commentary suites.
- `pnpm test:e2e tests/e2e/journey.spec.ts`: final strengthened keyboard/focus
  journey **passed in 23.6 seconds**. First trade: desktop **10.121 seconds**,
  360px guest including pending-fill recovery **10.183 seconds**, both below 120.
- Typechecking ran repeatedly during implementation and passed. Local Markdown
  links and `git diff --check` passed; desktop, ticket and results screenshots
  were inspected. The trade-feedback test first failed while its status was
  hidden inside an inactive tab, then passed after moving it outside the panels.
- `pnpm check`: **passed** lint, formatting, all workspace/tool typechecks,
  **226 tests in 12 files**, and every production build (including Next/Turbopack).

## Standards review

Zero findings. The independent review found no documented-standard violations or
substantive baseline smells in the implementation diff from `40fa323`. It verified
service boundaries, mounted responsive panels, keyboard navigation and the
trade-status placement. Review did not rerun the completed test suites.

## Spec review

Zero findings. The independent review found the committed changes consistent with
ticket #19 and AC-10/11/13/17, with no unrequested gameplay or API changes. It
confirmed that automated usability and accessibility evidence is distinguished
from unrun human/screen-reader sessions. No code changed after either review.

Review totals: **0 Standards findings; 0 Spec findings; no unresolved issues on
either axis**.

## Boundaries

Screenshots, timing JSON and retained failure traces live under `test-results/`
(ignored by git). Synthetic enhancement packets test rendering only and are
replaced by real snapshot news during resync; durable publication/fallback is
covered by the commentary suites. Browser tests use Next's development server;
production compilation is checked separately. Eight-client load, deployment and
broader release readiness remain tickets #20–22. These results establish the
playable-terminal journey evidence, not every MVP acceptance criterion.
