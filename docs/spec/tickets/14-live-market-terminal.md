# 14: Build the live market terminal with charts and quote depth

GitHub issue: [#14](https://github.com/Kenneth882/DinoPump/issues/14). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Players can inspect all four assets, switch the selected market, compare executable depth with last trades, follow accurate charts and tape, and place protected trades from the terminal.

## Scope and specification

Milestone 4; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §3, §4, §5, §6, §9, §10, §12, §13.

Focused requirements: [product and scope](../product-and-scope.md), [game content](../game-content.md), [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-03, AC-04, AC-06, AC-09, AC-10, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Integrate a desktop three-column watchlist/chart-news/trade-depth terminal using the existing synchronized client and durable trade ticket.
- [ ] Show opening change and last trade separately from bid and ask; expose actual covered bot depth and unavailable-liquidity states.
- [ ] Build line charts from the initial point plus executed trades only; render event markers without inventing price changes or autonomous trades.
- [ ] Show recent trade tape, exact executed totals/average prices and bot counterparties using committed public facts.
- [ ] Retain room, countdown, connection state, virtual-currency label and visible quote staleness; provide no-trade/no-news/empty-depth states.
- [ ] Use the specified dark jungle/volcanic, amber/fern visual direction with readable numbers; keep keyboard focus and reduced-motion behavior functional from the first UI slice.

## Validation

Browser tests compare watchlist/depth/tape/chart with authoritative snapshots across trades, idle scheduled events, selection changes and reconnect. Verify stale/unavailable states and protection survives quote changes; run pnpm check and targeted E2E.

## Blocked by

Blocked by: #12.

- [#12](https://github.com/Kenneth882/DinoPump/issues/12): Resynchronize clients and reconcile pending trades
