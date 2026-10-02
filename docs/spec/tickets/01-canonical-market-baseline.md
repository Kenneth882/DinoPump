# 1: Show the canonical four-asset market baseline

GitHub issue: [#1](https://github.com/Kenneth882/DinoPump/issues/1). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

The placeholder page becomes a read-only introduction to Pangaea Exchange showing the four canonical assets and initial prices, using the same validated, versioned content that future rounds consume.

## Scope and specification

Milestone 1; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §2, §3, §5, §6, §7, §10, §13, §15.

Focused requirements: [product and scope](../product-and-scope.md), [game content](../game-content.md), [market engine](../market-engine.md), [interface](../interface.md), [architecture](../architecture.md), [events and narration](../events-and-narration.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-02, AC-05, AC-09, AC-13. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Reuse the installed workspace, Next.js app, game-service scaffold, Zod, and pinned tooling; do not repeat initial setup or introduce new gameplay.
- [ ] Provide runtime-validated canonical assets: FERN/Fern Farms at 4,000 cents, AMBR/Amber Works at 7,500, VOLC/Volcano Energy at 10,000, and BONE/Fossil Finds at 2,500.
- [ ] Version and validate default rules/configuration, authored event facts/templates and icon identifiers; effects use known symbols and integer basis points within the baseline shock range.
- [ ] Consume the same validated asset content across the service and read-only web view; retain the fictional-market notice and clearly indicate that live rounds are not available yet.
- [ ] Keep the engine independent of transport, persistence, narration, and UI; do not add configuration/game-mode controls to the player interface.
- [ ] Add meaningful content/contract tests and remove empty-test success once actual tests exist; update setup/status instructions only where behavior changes.

## Validation

Run content and contract tests for malformed symbols/effects, exact prices and defaults; verify the service-to-web read-only content path; run pnpm check. These tests support the listed ACs but do not demonstrate live-round acceptance.

## Blocked by

None (can start immediately).
