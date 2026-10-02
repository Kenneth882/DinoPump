# 2: Persist and verify a frozen round baseline

GitHub issue: [#2](https://github.com/Kenneth882/DinoPump/issues/2). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

A developer can migrate an isolated database, persist a synthetic round's immutable starting configuration and nine-event schedule, then read it back unchanged as the basis for a future live round.

## Scope and specification

Milestone 1; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §3, §4, §7, §8, §9, §10, §13, §15.

Focused requirements: [game content](../game-content.md), [round lifecycle](../round-lifecycle.md), [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-02, AC-09, AC-12, AC-15. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Add documented, repeatable migrations and a disposable synthetic integration database; the development database is not a disposable test database.
- [ ] Persist round identity, seed, rules/config/catalog versions, participants, exact initial asset/human/bot resources, and open/close deadlines through validated contracts.
- [ ] Generate and store the full seeded schedule with fixed catalog effects and facts before opening: nine due times at 60 through 540 seconds, none at 600 seconds.
- [ ] Round creation/readback is atomic and retry-safe; configuration changes affect future rounds while a persisted round retains its original configuration and selected outcomes.
- [ ] Establish the versioned event-log/projection sequence storage needed to reconstruct the baseline; later slices extend migrations for their own behavior.
- [ ] Provide a runnable verification path for baseline write/readback and migration readiness, and document it alongside existing local database setup.

## Validation

Use isolated PostgreSQL integration tests for a fresh migration, repeat migration, round-write rollback, duplicate initialization, deterministic schedule/readback, and frozen configuration. Run pnpm check plus the documented database validation command; do not claim live AC-02/09/15 yet.

## Blocked by

Blocked by: #1.

- [#1](https://github.com/Kenneth882/DinoPump/issues/1): Show the canonical four-asset market baseline
