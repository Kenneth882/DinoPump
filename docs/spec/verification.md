# Verification and acceptance criteria

Read before selecting tests or declaring a feature complete. Use the original AC identifiers in test plans and reports.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §12, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

Read the feature document that owns the behavior under test. For milestone gates and release completion, read [implementation](implementation.md).

Verification: AC-01–AC-18 are defined below. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 12. Verification and acceptance criteria

Use pure engine tests for deterministic rules, database integration tests for atomicity/recovery, and browser tests for the player journey. Test seeded command sequences and boundary cases rather than only mirroring implementation functions.

| ID | Required acceptance criterion |
| --- | --- |
| AC-01 | Two to eight guests can enter a lobby; a ninth is rejected; an open round rejects new participants. |
| AC-02 | A valid start initializes exactly four assets, D$10,000 per player, and the configured bot resources once. |
| AC-03 | A buy fills the cheapest eligible asks and updates buyer and bot ledgers correctly. At asks D$40.40 and D$40.80, buying 150 units fills 100 and 50 for D$6,080.00. With a D$41.00 protection, buyer cash becomes D$3,920.00. |
| AC-04 | Selling owned units fills highest eligible bids and transfers the exact cash and units; overselling and underfunded buys have no ledger effects. |
| AC-05 | Invalid values, unknown assets, unauthenticated commands, and closed-round orders are rejected with stable codes. |
| AC-06 | Price protection produces correct full, partial, and zero-fill outcomes; no fill violates the submitted protection. |
| AC-07 | Duplicate requests, including retries after restart, return the original outcome without additional fills; changed payloads with reused IDs fail. |
| AC-08 | Concurrent submissions are serialized; seeded stress runs preserve cash/unit conservation and all nonnegative-balance invariants. |
| AC-09 | Nine scheduled events apply exactly once and affect only configured reference prices; generated prose cannot alter state. |
| AC-10 | Every client receives consistent market state; reconnecting during a fill resolves pending orders and restores the authoritative snapshot. |
| AC-11 | Closing-boundary orders are handled consistently; rankings match frozen marks; ties share ranks; late commentary cannot change results. |
| AC-12 | Replaying committed events produces identical balances, holdings, reference/last prices, quotes, and final rankings. |
| AC-13 | Narrator timeout, invalid JSON, misleading copy rejection, and missing credentials preserve immediate template news and uninterrupted play. |
| AC-14 | A crash before commit produces no trade; a crash after commit but before broadcast is recovered without duplication. |
| AC-15 | Restart after missed event deadlines catches up in order; restart after close settles once and rejects new orders. |
| AC-16 | Quote reservations never exceed bot resources, including near price limits and deliberately exhausted liquidity. |
| AC-17 | The complete join → ready → trade → event → reconnect → results journey passes in two browser sessions and at a 360px viewport. |
| AC-18 | An eight-client load run meets the stated latency targets and an end-to-end round runs without an LLM key. |
