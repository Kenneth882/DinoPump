# Performance, integrity, and operations

Read when implementing rate limits, identity constraints, access controls, logging, metrics, load tests, or release operations.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §11, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For session security and ownership loss, read [API and recovery](api-and-recovery.md). For hosting constraints, read [architecture](architecture.md). For release requirements, read [implementation](implementation.md).

Verification: AC-05, AC-08, AC-10, AC-14–AC-16, AC-18. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 11. Performance, integrity, and operations

MVP acceptance targets assume eight connected players and up to five submitted orders per player per second in the deployment region. Record the test environment when reporting results.

| Area | Target or rule |
| --- | --- |
| Order acknowledgement | p95 under 300ms, excluding client internet latency |
| Realtime delivery | p95 under 500ms from commit to connected clients in the test environment |
| Initial room snapshot | Under one second in the test environment |
| Scheduler accuracy | Within one second of due time under healthy operation |
| Order rate limit | Five/second/player with a burst of ten; reject excess before engine work |
| Reactions | One/second/player; approved identifiers only |
| Identity | Display names 2–20 characters, normalized and unique within the room |
| Session/access controls | Validate ownership and room membership for every command and snapshot |
| Integrity | No negative balances, duplicate fills, or partial transaction publication |
| Logging | Structured room, round, request, sequence, and job IDs; no session secrets |
| Metrics | Connected players, order latency/rejections, scheduler lag, DB failures, narration failures |

MVP manipulation controls are limited to no self-trading, no shorting, transaction limits, server authority, and an auditable log. Sophisticated collusion detection and manipulation-resistant closing marks are future work. Public competitive tournaments are outside this baseline.
