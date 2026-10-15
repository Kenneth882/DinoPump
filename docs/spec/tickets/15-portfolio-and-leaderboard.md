# 15: Show private portfolios and provisional/shared rankings

GitHub issue: [#15](https://github.com/Kenneth882/DinoPump/issues/15). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Each player sees their own cash, holdings, P/L and marked portfolio while the room sees provisional portfolio totals and shared ranks; final results remain frozen after close.

## Scope and specification

Milestone 4; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §6, §8, §9, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-04, AC-10, AC-11, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Render the owner's cash/holdings, portfolio value, profit and return from authoritative marks; use an explicit no-holdings state.
- [ ] Render public portfolio totals and live leaderboard as provisional, with equal-value shared ranks and stable join-order display.
- [ ] Do not expose another player's private holdings, order IDs, balances beyond specified public totals, or session credentials in browser payloads.
- [ ] Scheduled quote changes alone do not change marks; explain last-trade valuation through clear player-facing labels.
- [ ] Extend results with frozen value/profit/return and remaining owned cash/holdings plus major events; reconnect/reset preserves old results.
- [ ] Gains/losses use text or icons as well as color, with readable numeric formatting and keyboard-accessible panels.

## Validation

Two-browser tests inspect each owner's private data and permitted public totals, no-trade valuations, buy/sell P/L, shared ties, disconnect rankings and immutable results after reconnect/reset. Compare displayed values to exact engine/result fixtures; run pnpm check and targeted E2E.

## Blocked by

Blocked by: #12.

- [#12](https://github.com/Kenneth882/DinoPump/issues/12): Resynchronize clients and reconcile pending trades

## Local implementation evidence

The terminal now renders the owner's authorized portfolio with last-trade marks,
marked holdings values, authoritative value/profit/return, and an explicit empty
state. The public leaderboard shows provisional shared ranks in server/join order,
permitted totals, and offline players. Closing uses the same presentation with
frozen marks/results and the committed major-event timeline. No engine rules,
persistence records, or delivery contracts changed.

- The portfolio browser journey passed from its initial failing slices through
  exact buy/sell P/L, unchanged marks after scheduled news, separate owner resources,
  public payload filtering, disconnected ranks, close/reconnect/reload, immutable
  historical results after reset/new rounds, and shared no-trade final winners.
- `pnpm test:e2e`: all seven browser tests passed against isolated synthetic rooms,
  including the existing lobby/recovery and terminal regressions. Portfolio and
  results screenshots were captured at desktop and 360px widths.
- Lint, formatting, typechecking, and all 196 unit/service tests passed. All non-web
  package builds and `pnpm --filter @dinopump/web exec next build --webpack` passed.
- `pnpm check` remains incomplete: the default Turbopack production compilation
  stalled and was stopped, as observed on ticket #14. The successful Webpack build
  is separate evidence; it is not a passing default `pnpm check` run.
- Standards review: zero findings. Spec review: zero findings. The focused interface
  section matches the complete reference, and affected documentation links resolve.

This supports the ticket's AC-04/10/11/17 contributions. It does not establish load
acceptance or completion of the later activity/mobile-tab tickets.
