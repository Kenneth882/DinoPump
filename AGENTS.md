# DinoPump agent instructions

These instructions apply throughout this repository. Follow the user's current task, then use the specifications below to constrain implementation. The project starts from a proposed specification; inspect the repository before assuming a service, command, or dependency exists.

## Read the requirements for the work

Before changing application behavior:

1. Read [product and scope](docs/spec/product-and-scope.md) for the MVP boundaries.
2. Read the relevant feature specification from the table below. If a change spans areas, read each affected document and the related sections it links to.
3. Read the affected acceptance criteria in [verification](docs/spec/verification.md). Identify the applicable AC IDs before implementing and use them to select validation.

For documentation-only work, read the documents being changed and their source sections. For an unfamiliar task, use the [spec index](docs/spec/README.md) to find the owning area.

| When working on… | Read… |
| --- | --- |
| MVP boundaries, baseline decisions, future features | [Product and scope](docs/spec/product-and-scope.md) |
| Assets, symbols, initial prices, theme, event catalog content | [Game content](docs/spec/game-content.md) |
| Lobby, host, readiness, countdown, round states, scoring, results | [Round lifecycle](docs/spec/round-lifecycle.md) |
| Orders, protection, fills, rounding, bot liquidity, quote reservations | [Market engine](docs/spec/market-engine.md) |
| Screens, trade ticket, charts, portfolio, responsive UI, accessibility | [Interface](docs/spec/interface.md) |
| Workspace setup, packages, dependencies, service boundaries, hosting | [Architecture](docs/spec/architecture.md) |
| Database, migrations, events, transactions, projections, replay | [Persistence](docs/spec/persistence.md) |
| HTTP, Socket.IO, sessions, authorization, snapshots, reconnect, restart | [API and recovery](docs/spec/api-and-recovery.md) |
| Scheduled events, news templates, commentary jobs, LLM integration | [Events and narration](docs/spec/events-and-narration.md) |
| Rate limits, logging, metrics, performance, operational integrity | [Operations](docs/spec/operations.md) |
| Tests, acceptance evidence, regression validation | [Verification](docs/spec/verification.md) |
| Implementation order, milestone gates, setup and release completion | [Implementation](docs/spec/implementation.md) |

`PROJECT_SPEC.md` is the user's complete reference. Use focused specs during feature work; consult the relevant original section to resolve discrepancies. Follow the [documentation synchronization rules](docs/spec/README.md#keeping-the-references-aligned) when requirements change. Do not remove, replace with links, or silently rewrite the full reference.

## Product and integrity guardrails

- Keep work within the requested feature and MVP. Deferred features require an explicit task; choose routine implementation details within the baseline without adding new gameplay rules.
- Preserve fictional assets and nonredeemable Dino Dollars. Real-money flows, brokerage integrations, wallets, leverage, and short selling are outside the product boundary.
- Keep the server authoritative. Client inputs request actions; the server validates identity, permissions, values, round state, and execution order.
- Keep settlement deterministic with integer cents, whole units, and integer basis points. Preserve finite bot resources, covered reservations, nonnegative balances, and cash/unit conservation.
- Commit complete order/event batches atomically and broadcast after commit. Preserve idempotency, ordered recovery, and immutable final results across retries and restarts.
- Keep AI limited to narration of recorded facts. Gameplay must remain fully playable without an API key; narration cannot mutate market state or delay scheduled effects.
- Protect session credentials and private player data. Enforce the API specification's ownership and visibility rules; keep secrets out of source, logs, fixtures, and browser payloads.
- For changes to settlement, rounding, scheduling, quote generation, or scoring, update the rules version, both specification forms, and affected acceptance cases before applying the change to a new round. Freeze configuration for an active round.

## Working guardrails

- Inspect the current files and git diff before editing. Preserve unrelated and uncommitted work; keep changes scoped to the task.
- Follow existing package boundaries. Keep the engine independent of frameworks, transport, persistence, and narration; use shared runtime-validated contracts across service boundaries.
- Discover actual setup, build, lint, type-check, and test commands from repository configuration. When introducing tooling, document runnable setup commands and pin supported versions.
- Use synthetic data for tests. Require explicit authorization before destructive database operations, deleting user work, rewriting shared git history, pushing, or deploying. Ordinary local implementation and reversible fixes can proceed within the task.
- Resolve routine choices from the specs and existing code. If a missing or conflicting requirement changes gameplay, security, or a public contract, describe the concrete conflict and request clarification while continuing independent work.

## Completion criteria

- Validate the changed behavior against its applicable AC IDs: pure tests for engine rules, database integration tests for transactions/recovery, and browser tests for player journeys. Run available checks appropriate to the change; for documentation-only work, verify links, source coverage, and consistency.
- Treat unrun or failing checks as incomplete evidence. Report what ran, the results, and any remaining blocker; never infer that a written acceptance criterion already passes.
- Keep affected specs and setup instructions aligned with approved changes. Preserve the complete human reference and stable acceptance IDs.
- Finish with the behavior changed, the relevant spec/AC references, validation performed, and material limitations. A milestone is complete only when its required behavior is demonstrated and its gates pass.
