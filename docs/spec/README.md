# Focused project specifications

Use these documents to load the requirements for the feature being changed. [PROJECT_SPEC.md](../../PROJECT_SPEC.md) remains the complete human reference and the baseline source of truth. The focused files reproduce every numbered section without changing the requirements; source section numbers are preserved.

Before implementation, read [product and scope](product-and-scope.md), the relevant feature document below, and the applicable cases in [verification](verification.md). Follow a feature document's related links when the change crosses those boundaries. Read the original spec only when the task needs the full baseline or a discrepancy needs resolving.

| Work area | Focused document | Original sections |
| --- | --- | --- |
| Product and scope | [product-and-scope.md](product-and-scope.md) | 1, 2, 14, 15 |
| Game content | [game-content.md](game-content.md) | 3 |
| Round lifecycle and scoring | [round-lifecycle.md](round-lifecycle.md) | 4 |
| Market engine and liquidity | [market-engine.md](market-engine.md) | 5 |
| Interface and accessibility | [interface.md](interface.md) | 6 |
| Architecture and repository structure | [architecture.md](architecture.md) | 7 |
| Persistence and event model | [persistence.md](persistence.md) | 8 |
| API, realtime, sessions, and recovery | [api-and-recovery.md](api-and-recovery.md) | 9 |
| Scheduled events and AI narration | [events-and-narration.md](events-and-narration.md) | 10 |
| Performance, integrity, and operations | [operations.md](operations.md) | 11 |
| Verification and acceptance criteria | [verification.md](verification.md) | 12 |
| Implementation milestones and completion | [implementation.md](implementation.md) | 13 |

## Keeping the references aligned

- The focused files are exact extracts, with navigation notes above the source sections. Keep each numbered source section in exactly one focused file.
- For an approved requirement change, update the affected section in `PROJECT_SPEC.md` and its focused counterpart in the same change; update routes and acceptance mappings if the change affects them. Preserve `PROJECT_SPEC.md` as a complete, readable reference.
- If the two forms disagree, compare only the relevant original section, report the discrepancy, and align the focused copy to the original unless the user's current instruction explicitly changes the requirement.
- Preserve acceptance IDs. Update the rules version, specification, and applicable acceptance cases for settlement, rounding, scheduling, quote-generation, or scoring changes before using them in a new round.
- Specification text describes required behavior, not implementation status. Report what exists and what has been verified separately.
