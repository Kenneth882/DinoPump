# 18: Add bounded, fact-checked optional AI narration

GitHub issue: [#18](https://github.com/Kenneth882/DinoPump/issues/18). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

When configured, an optional provider adds playful Daily Roar narration grounded in recorded facts; timeout, unsafe/misleading output or invalid JSON preserves the existing template.

## Scope and specification

Milestone 5; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §2, §3, §6, §7, §8, §10, §11, §12, §13.

Focused requirements: [product and scope](../product-and-scope.md), [game content](../game-content.md), [interface](../interface.md), [architecture](../architecture.md), [persistence](../persistence.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-09, AC-11, AC-13, AC-18. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Implement a replaceable provider adapter using only approved fictional asset/catalog facts, actual reference effects and separately labeled observed trade statistics.
- [ ] Exclude session secrets, raw user text and unnecessary player data; give the model no trading tools and never parse prose as executable commands.
- [ ] Validate JSON headline length ≤100 and commentary ≤400; reject misleading invented trades, quote/last-price confusion, real-world recommendations, external-fact implications and executable content.
- [ ] Use five-second provider timeout and at most two attempts per event across worker retries; retain authored copy for failed/invalid/unsafe/unavailable output.
- [ ] Render approved generated text as plain text with AI narration/source linkage and persisted provider/model/prompt/duration/validation provenance.
- [ ] Complete narration milestone evidence for AC-09 and AC-13, including a full no-key gameplay path; choose/pin a provider SDK only when needed and document configuration.

## Validation

Use synthetic adapter responses for timeout, malformed JSON, overlength fields, misleading copy, injection/script content, provider outage and missing credentials; assert bounded attempts and exact preservation of gameplay/results/template news. A stub provider exercises accepted publication; no live credential is needed for validation. Run pnpm check and narration integration/E2E.

## Blocked by

Blocked by: #17.

- [#17](https://github.com/Kenneth882/DinoPump/issues/17): Run a leased commentary worker with safe fallback publication
