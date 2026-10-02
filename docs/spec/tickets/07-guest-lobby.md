# 7: Create guest sessions and a shared eight-player lobby

GitHub issue: [#7](https://github.com/Kenneth882/DinoPump/issues/7). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

Guests choose a dinosaur avatar and display name, create or join the single active room by code, and see the same authorized lobby and connection state in multiple browsers.

## Scope and specification

Milestone 3; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §2, §4, §6, §7, §8, §9, §11, §12, §13.

Focused requirements: [product and scope](../product-and-scope.md), [round lifecycle](../round-lifecycle.md), [interface](../interface.md), [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [operations](../operations.md), [verification](../verification.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-01, AC-05, AC-10, AC-17. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Implement session/create-room/join/snapshot HTTP behavior and corresponding runtime-validated client flow; concurrent creates cannot produce multiple active rooms.
- [ ] Store hashed session secrets and 24-hour expiry; use secure HttpOnly cookies in same-site production and documented safe local-development behavior.
- [ ] Normalize names of 2–20 characters and enforce room uniqueness; display avatars, room code, concise instructions and fictional-currency notice.
- [ ] Enforce room membership, session expiry and WebSocket origin on commands and snapshots; derive player identity server-side and return safe stable errors.
- [ ] Allow two through eight lobby guests, reject a ninth, and preserve existing identity on reconnect without allocating a new player slot.
- [ ] Persist host/lobby lifecycle records, transfer a disconnected lobby host after 15 seconds to the earliest-connected remaining player, and expire an empty lobby after five minutes.
- [ ] Provide authenticated Socket.IO presence/lobby snapshots without private credentials; keep transient presence separate from the market event stream.

## Validation

Isolated database/service tests cover concurrent room creation, normalized-name collisions, capacity, expiry, forged identities/origins, unauthorized snapshots, host transfer and empty-lobby deadlines. Two-browser tests demonstrate create/join and reconnect into the lobby; run pnpm check and targeted E2E.

## Blocked by

Blocked by: #2.

- [#2](https://github.com/Kenneth882/DinoPump/issues/2): Persist and verify a frozen round baseline
