# 19: Verify the complete accessible player journey at 360px

GitHub issue: [#19](https://github.com/Kenneth882/DinoPump/issues/19). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Two players can complete join→ready→trade→event→reconnect→results on desktop and at 360px, using keyboard controls and understandable connection/trade feedback.

## Scope and specification

Milestone 4; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §4, §5, §6, §9, §10, §12, §13.

Focused requirements: [product and scope](../product-and-scope.md), [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-10, AC-11, AC-13, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Implement/finish narrow-screen Market, Trade, Portfolio and News tabs while keeping countdown and connection state visible; the full trade ticket works at 360px.
- [ ] Keep every journey control keyboard usable with visible focus, readable contrast, textual/icon gain/loss cues and reduced-motion support.
- [ ] Announce trade results and connection changes appropriately without announcing every market tick; verify empty/stale/disconnected/resync states.
- [ ] Exercise session/lobby readiness, protected buys/sells, factual events, pending-fill reconnect and immutable results in two independent browser contexts.
- [ ] Verify template-first and same-item news enhancement states using synthetic published updates without requiring a provider/key; keep fictional currency visible throughout.
- [ ] Record playable-terminal gate evidence for AC-10/11/17 and a first-time join-to-first-trade usability check against the two-minute success target.

## Validation

Run the full Playwright journey at desktop and 360px, with deterministic synthetic fixtures/time control where appropriate. Include reconnect during a pending fill, no-key operation, keyboard-only navigation, reduced-motion and targeted accessibility review. Record exact results/limitations and run pnpm check.

## Blocked by

Blocked by: #14, #15, #16.

- [#14](https://github.com/Kenneth882/DinoPump/issues/14): Build the live market terminal with charts and quote depth
- [#15](https://github.com/Kenneth882/DinoPump/issues/15): Show private portfolios and provisional/shared rankings
- [#16](https://github.com/Kenneth882/DinoPump/issues/16): Send approved reactions and show public player activity
