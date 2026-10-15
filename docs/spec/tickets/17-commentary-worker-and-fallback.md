# 17: Run a leased commentary worker with safe fallback publication

GitHub issue: [#17](https://github.com/Kenneth882/DinoPump/issues/17). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

The separate worker safely processes persisted narration jobs and updates the existing news item, while missing credentials or worker failures leave immediate authored news and gameplay uninterrupted.

## Scope and specification

Milestone 5; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §6, §7, §8, §9, §10, §11, §12, §13.

Focused requirements: [interface](../interface.md), [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-09, AC-11, AC-13, AC-14, AC-18. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Approved narration design clarification (October 15, 2026)

See the [agreed design](ticket-plans/17-18-narration-design.md) and the aligned
interface/narrator requirements in PROJECT_SPEC.md sections 6 and 10. Preserve
complete authored news and append a separate “AI narration” paragraph with an
“As of m:ss” context label. Context covers affected assets and aggregate executed
activity since the previous event (round opening for the first), frozen when the
source event is applied. Exclude player names, individual trading judgments and
leaderboard commentary. Use a clear newsreader voice with light dinosaur humor.
Later trades do not cause rewrites; late narration remains historical, including
after closing. Disabled/unavailable/invalid AI leaves the complete authored card
without an empty AI section, persistent spinner or provider-error state.

These local design clarifications are not a claim that acceptance checks pass or
that the live GitHub issue has been updated.

## Acceptance criteria

- [ ] Add a runnable separate worker and documented local start/setup alongside web/service/database; core gameplay starts with no API key.
- [ ] Claim persisted jobs using leases and bounded attempts/next-attempt times, recover abandoned leases, and prevent competing workers from publishing duplicate news.
- [ ] Use a restricted database role that reads only approved narration inputs/jobs and writes commentary; database permissions prohibit changing balances, quotes, trades, references or results.
- [ ] Preserve frozen narration context across worker retries and append accepted commentary without replacing authored content; retain historical context labels on late publication.
- [ ] Publish commentary through the authoritative service's ordered news-update path; update the same source news item without changing its timestamp, factual effects or result state.
- [ ] Handle absent credentials, unavailable worker/provider and retry exhaustion by retaining the authored template; never block market processing.
- [ ] Record safe source/job IDs, provider/model identifier, prompt version, duration and validation status; deliver provenance/status to clients and render any generated copy as plain text labeled AI narration.

## Validation

Integration tests cover two workers, lease expiry/crash, publication retry, absent credentials and read/write role denials. Verify one news item per source, template-first rendering, unchanged market/result state after late publication and independently runnable worker setup; run pnpm check and targeted integration/E2E. Cover the narration cases added under AC-09/11/13/14/18 in [verification](../verification.md).

## Blocked by

Blocked by: #11.

- [#11](https://github.com/Kenneth882/DinoPump/issues/11): Close rounds once, show results, and return to the lobby
