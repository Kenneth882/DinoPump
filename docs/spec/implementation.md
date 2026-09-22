# Implementation milestones and completion

Read when planning implementation, selecting the next milestone, creating setup instructions, or assessing release readiness.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §13, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For MVP boundaries, read [product and scope](product-and-scope.md). For package/service structure, read [architecture](architecture.md). For the exact acceptance cases, read [verification](verification.md).

Verification: Use the milestone gates and MVP definition of done below. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 13. Implementation milestones

Deliver in dependency order. A milestone is complete only when its behavior can be demonstrated and its relevant acceptance criteria pass.

1. **Foundation and content:** establish the TypeScript workspace, shared schemas, four assets, event catalog, configuration, database migrations, and local setup instructions.
2. **Deterministic engine:** implement bot quotes, protected market orders, atomic settlement, reference changes, marking, and engine tests. Gate: AC-03–08 and AC-16 at engine level.
3. **Authoritative room service:** add sessions, lobby/round lifecycle, persisted command processing, Socket.IO, event scheduling, ownership lock, and recovery. Gate: AC-01–02, AC-07–12, AC-14–15 at service level.
4. **Playable terminal:** implement lobby, market dashboard, trade ticket, chart, portfolio, leaderboard, preset reactions, reconnect states, and results. Gate: AC-10–11 and AC-17.
5. **Narration:** implement immediate templates, jobs worker, provider adapter, output validation, and provenance labels. Gate: AC-09 and AC-13.
6. **Release readiness:** complete the eight-player load run, accessibility review, crash/recovery verification, deployment instructions, and configuration/secrets documentation. Gate: all acceptance criteria.

### MVP definition of done

- A fresh checkout can start the frontend, game service, worker, and PostgreSQL using documented commands and an example environment file.
- Two browsers can complete the full round; an eight-player test has been recorded.
- All required acceptance criteria pass, with results and known limitations documented.
- No external AI credential is required for core gameplay.
- The deployed services support persistent connections and recovery from committed state.
- The fictional nature of the assets and currency is visible throughout the player experience.
