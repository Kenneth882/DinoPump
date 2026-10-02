# 11: Close rounds once, show results, and return to the lobby

GitHub issue: [#11](https://github.com/Kenneth882/DinoPump/issues/11). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

At the authoritative ten-minute boundary, trading stops and players see immutable shared ranks and final portfolios; the host can return to the lobby and start a genuinely new round.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §6, §8, §9, §10, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-01, AC-02, AC-05, AC-09, AC-11, AC-12, AC-14, AC-15, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Transition OPEN→SETTLING→FINISHED exactly once using server processing time; commands processed at/after close reject even if sent earlier.
- [ ] Process due events strictly before close, freeze marks/results/settlement sequence in one atomic batch, and never force-sell final holdings.
- [ ] Rank using frozen latest-trade/initial marks, share ties and stabilize display by join order; disconnected players remain ranked and bots are excluded.
- [ ] Expose authorized participant results and round:ended; show winner/tied winners, values, profit/return, owned cash/holdings and compact major-event timeline.
- [ ] Provide acknowledged runtime-validated host return-to-lobby behavior; reset readiness and create fresh round ID/seed/balances next time while retaining prior recorded data.
- [ ] Integrity failure reaches ABORTED with a clear safe client state and no declared winner; later commentary/reactions cannot modify final results.

## Validation

Test commands just before/at/after close, settlement retry and transaction rollback, no-trade/tied/disconnected rankings, results authorization and abort. Run two browser contexts through close/results/host reset and verify old results stay identical through a second round; run pnpm check and targeted integration/E2E.

## Blocked by

Blocked by: #10.

- [#10](https://github.com/Kenneth882/DinoPump/issues/10): Place durable protected trades from a minimal trade ticket
