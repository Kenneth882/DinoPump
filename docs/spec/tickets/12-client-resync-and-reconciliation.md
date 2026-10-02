# 12: Resynchronize clients and reconcile pending trades

GitHub issue: [#12](https://github.com/Kenneth882/DinoPump/issues/12). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

A disconnected browser automatically reconnects, restores an authoritative authorized snapshot, resolves any pending trade, and resumes only after the visible market is fully synchronized.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §4, §5, §6, §8, §9, §12, §13.

Focused requirements: [round lifecycle](../round-lifecycle.md), [market engine](../market-engine.md), [interface](../interface.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-05, AC-07, AC-10, AC-11, AC-14, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Implement room:resync and complete room:snapshot with round ID, sequence, server time/deadlines, public state and the owner's private state/recent outcomes.
- [ ] Capture snapshot at sequence N while buffering subsequent complete batches; prevent the subscribe/snapshot race and never render half a batch.
- [ ] Detect missing/reordered sequences and round-ID changes; request a fresh snapshot instead of guessing from a reconnected socket.
- [ ] Reconnect with backoff, keep trades disabled during disconnect/resync, and reconcile timed-out submits using their original request IDs and payloads.
- [ ] Mark quotes stale after three seconds without fresh connectivity evidence; retain visible connection state and server-synchronized countdown.
- [ ] Preserve authorization and private/public filtering for every snapshot and buffered/private message, including when reconnect happens after closing or lobby reset.

## Validation

Inject disconnects during fill commit/acknowledgement, lost/reordered/duplicate batches, a commit during snapshot capture and round changes. Verify authoritative equality, one fill, pending outcome recovery and private-data isolation in database/service tests and two-browser E2E; run pnpm check.

## Blocked by

Blocked by: #11.

- [#11](https://github.com/Kenneth882/DinoPump/issues/11): Close rounds once, show results, and return to the lobby
