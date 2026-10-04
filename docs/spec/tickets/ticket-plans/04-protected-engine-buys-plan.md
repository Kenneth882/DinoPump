# Ticket 4 implementation plan: protected engine buys

Saved October 4, 2026 from the implementation sequence discussed in chat.

Ticket: [Execute protected buys atomically in the engine](../04-protected-engine-buys.md).
Tracker: [GitHub issue #4](https://github.com/Kenneth882/DinoPump/issues/4).

## Start here

Use `/implement` in a fresh session in this repository, with this plan as context:

```text
/implement GitHub issue #4 in Kenneth882/DinoPump.
Follow docs/spec/tickets/ticket-plans/04-protected-engine-buys-plan.md.
Check that blocker #3 is closed first.
```

Before implementation, read the current issue and comments, verify that
[blocker #3](https://github.com/Kenneth882/DinoPump/issues/3) is closed, and inspect
the existing engine, shared contracts, tests, and git diff. Read the repository
instructions, [product boundaries](../../product-and-scope.md), and the focused
requirements linked from ticket 4, especially the
[market rules](../../market-engine.md) and
[acceptance criteria](../../verification.md).

## Implementation sequence

Work one test-first slice at a time: write a failing behavior test, implement the
smallest complete behavior, then refactor with the tests passing.

1. **Start with AC-03's exact protected-buy example.** With 1,000,000 cents of
   buyer cash and 4,100-cent protection, buy 150 units: 100 at 4,040 cents and
   50 at 4,080 cents. Assert 608,000 cents spent, 392,000 cents remaining,
   150 units received, and the matching bot cash and unit transfers.
2. **Add validation and conservative funding checks.** Cover whole quantities
   1–500, known assets, valid integer protection prices, matching round, and OPEN
   status with stable outcomes. Require cash for the full requested quantity
   times maximum unit price before filling, including when a partial fill would
   be affordable. Rejections leave ledgers unchanged.
3. **Cover full, partial, and zero fills.** Keep submitted protection fixed,
   including for stale quotes. Consume eligible asks cheapest first, then by
   creation sequence and stable quote ID. Execute at resting quote prices,
   prevent self-trading, and keep quotes fixed throughout an order. Cancel any
   unfilled remainder. Report filled/remaining quantity, total value, and
   volume-weighted average price. No eligible liquidity returns
   `NO_LIQUIDITY_WITHIN_PROTECTION` without ledger changes.
4. **Complete the deterministic state transition.** Return all fill, ledger,
   reference, and quote changes as one complete result. After fills, set the
   last price to the latest fill and move the reference +10 basis points once
   per order, with half-up rounding and clamping. Rebuild covered quotes using
   the existing quote engine and the specification's rebuild rules.
5. **Exercise invariants and boundaries.** Test exact integer settlement,
   conservation of cash and units, nonnegative balances, finite bot resources,
   covered reservations, exhausted liquidity, price limits, deterministic
   results, and unchanged inputs. Include seeded scenarios where useful.
6. **Validate and review.** Run the targeted engine tests and `pnpm check`.
   Complete `/code-review` against the implementation's starting point, address
   findings, and report evidence against the applicable ACs.

## Scope and completion evidence

Applicable acceptance IDs: **AC-03, AC-05, AC-06, AC-08, AC-16**. The funding
rejection tests also support the underfunded-buy requirement in AC-04.

Keep this work at the pure engine boundary and preserve existing package
boundaries and frozen-round rules. Follow the repository's specification and
rules-version requirements for settlement, rounding, or quote-generation changes.

This plan records intended work; no implementation or validation is claimed by
saving it. Engine tests provide engine-level evidence only. Service serialization,
database commit/recovery, browser trading, and a complete playable round require
their own later integration work and acceptance evidence. Report unrun or failing
checks explicitly.
