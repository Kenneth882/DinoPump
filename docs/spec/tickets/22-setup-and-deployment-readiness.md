# 22: Complete fresh-checkout setup and deployment readiness

GitHub issue: [#22](https://github.com/Kenneth882/DinoPump/issues/22). Reference snapshot: October 2, 2026. Follow GitHub for current status, discussion, and evidence; update this copy when scope or blockers change.

## What to build

A fresh checkout can run web, authoritative service, separate worker and PostgreSQL from documented commands, with a production hosting/configuration plan that preserves persistent connections and safe recovery.

## Scope and specification

Milestone 6; baseline 1.0. Reuse existing scaffolding and preserve MVP boundaries and frozen-round rules.

Complete reference: [PROJECT_SPEC.md](../../../PROJECT_SPEC.md), §1, §2, §7, §8, §9, §10, §11, §12, §13, §15.

Focused requirements: [product and scope](../product-and-scope.md), [architecture](../architecture.md), [persistence](../persistence.md), [api and recovery](../api-and-recovery.md), [events and narration](../events-and-narration.md), [operations](../operations.md), [verification](../verification.md), [implementation](../implementation.md). Read [implementation milestones](../implementation.md) and [verification](../verification.md).

Applicable acceptance IDs: AC-10, AC-12, AC-13, AC-14, AC-15, AC-17, AC-18. Listed ACs identify required behavior, not passing evidence; distinguish partial/engine-only results from full service/browser acceptance.

## Acceptance criteria

- [ ] Verify pinned supported tooling, frozen install, migrations, isolated test setup, all four process start commands and complete example environment configuration on a fresh checkout.
- [ ] Document same-site secure-cookie/origin configuration, restricted worker role, optional provider credentials, readiness checks and production startup/migration order without committing secrets.
- [ ] Provide concrete hosting/deployment configuration and instructions for a long-running game service with persistent Socket.IO connections and committed-state recovery.
- [ ] Document normal shutdown/restart, ownership/database failure handling, persistent storage and results retention; no destructive database reset is part of ordinary setup.
- [ ] Keep complete human/focused specifications aligned with baseline and record setup/release status accurately, linking the actual acceptance evidence.
- [ ] Close the MVP definition-of-done gate only after all acceptance evidence passes; any actual push/deploy or destructive operation requires explicit authorization.

## Validation

Rehearse documented installation/start/migration/test/no-key round commands in a fresh isolated checkout using synthetic data. Validate production configuration/recovery assumptions against the selected hosting target and check documentation links/source coverage. Run final configured checks; record any hosting validation requiring a separate authorized deployment.

## Blocked by

Blocked by: #21.

- [#21](https://github.com/Kenneth882/DinoPump/issues/21): Record an eight-client round and the complete acceptance gates
