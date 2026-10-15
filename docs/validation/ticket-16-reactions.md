# Ticket #16: preset reactions and public player activity

Implementation started October 15, 2026 on `ticket16` from
`21cc0c9436c6016bff911c2d26082d01e84c75a9` after blocker #12 was closed.
Scope: [issue #16](https://github.com/Kenneth882/DinoPump/issues/16) and its
[implementation plan](../spec/tickets/ticket-plans/16-preset-reactions-and-activity-plan.md).
Requirements: [interface](../spec/interface.md),
[reaction API](../spec/api-and-recovery.md#preset-reaction-delivery-ticket-16-stage),
[persistence](../spec/persistence.md), and [operations](../spec/operations.md).
This slice supports AC-05, AC-10, AC-11 and AC-17 in
[verification](../spec/verification.md).

## Implemented behavior

Strict shared contracts fix three approved reactions. An acknowledged command
uses the current authenticated subscription, lightweight owned sender/recipient
authorization, and a separate player-wide one-second cooldown retained across
sockets and reconnects. Rejected attempts do not extend it. Publication includes
only a server ID, room/round, sender, approved reaction and time. No reaction
writes a market batch/event, order, trade, result or projection.

Synchronized room controls remain available in lobby, countdown, market and
terminal views. Volatile sends are never buffered offline or automatically retried.
A lost acknowledgement reports uncertainty. The independent browser channel
validates context, ignores duplicates/stale callbacks, bounds items and deduplication
memory, expires visible items after ten seconds and clears transients on recovery
or context changes. It cannot update market freshness, cursors or pending orders.
Controls use native keyboard buttons, existing visible focus and reduced-motion
styles; incoming reactions are not a screen-reader announcement stream.

A lower public activity panel derives one entry per accepted public fill, including
actor, buy/sell, units, symbol, unit price, executed total and bot counterparty.
Multi-level orders remain separate fills. Snapshot replacement recovers the latest
30 fills without duplicating covered batches; rejected/zero-fill orders add none.
The existing tape and private portfolio continue to use their established paths.
No dependency, migration, engine rule or rules version changed.

## Validation

Agreed seams: shared runtime contracts, real Socket.IO/PostgreSQL, and the existing
two-browser/snapshot journey. Environment: Node 24.21.0, pnpm 10.34.5,
PostgreSQL 18.6, Playwright 1.63.0/Chromium. Harnesses use only synthetic random
schemas in Compose project `dinopump-ticket16`, loopback port 55436 and temporary
container storage. Database/browser harnesses run sequentially and clean up their
own container. Development data and pre-existing duplicate files are preserved.

- `pnpm check`: passed lint, formatting, workspace/tool types, **197 tests in
  10 files**, and every production build, including the default Turbopack build.
- `DINOPUMP_TEST_PROJECT=dinopump-ticket16 DINOPUMP_TEST_PORT=55436 pnpm db:verify`:
  **105 tests in 10 files passed**, 60.02 seconds.
- Focused `pnpm test:e2e reactions.spec.ts` with the same isolated harness:
  **passed**, 41.7-second complete journey.
- `DINOPUMP_TEST_PROJECT=dinopump-ticket16 DINOPUMP_TEST_PORT=55436 pnpm test:e2e`:
  **all 8 tests in 5 files passed**. The reactions journey passed again in 38.2
  seconds; lobby/recovery, introduction, portfolio and terminal regressions passed.
- Standards/specification reviews: recorded separately below.

Service coverage includes 999ms/1,000ms boundaries, independent players and multiple
sockets/reconnect, rejected input and forged identity, expired sender/recipient,
removed membership, expired room, and lost database ownership. A reaction-only
comparison preserves both authorized snapshots and exact persisted market/history/
result records before and after closing, including a prior multi-fill trade.

The browser journey covers lobby/open/terminal reactions, keyboard entry at 360px
with reduced motion, multi-fill buy and sell activity, rejected/zero-fill absence,
duplicate delivery, no resend after uncertain acknowledgement, reaction traffic
without market freshness, reconnect, an event, transient bounds/expiry, immutable
results, reset, and a fresh round. Market hashes compare each owner's complete
round projection (including private portfolio), excluding volatile server time
and room presence/visibility. Immutable terminal responses are compared in full.
Public reaction schemas and captured peer packets exclude private request IDs and
session credentials. Desktop and narrow screenshots were inspected; controls and
activity fit without horizontal overflow.

## Validation history and boundaries

The first contract and service cases failed because the reaction schemas/handler
did not yet exist; the first activity case failed at its missing empty state.
Each passed after implementation. A broader browser hash initially included room
visibility sequence; captured responses showed identical market fields with a
presence-only sequence change. The assertion was corrected to the plan's market
projection boundary and the complete journey passed. These failures are retained
as history, not passing evidence. The cooldown test was then strengthened to send
from simultaneous sockets; the final targeted service file passed all **5 tests**
in 1.97 seconds, followed by disposable database cleanup.

Full accessibility/mobile-tab, deployment-region eight-player load, narration and
release/milestone gates remain their separate tickets. Transient reaction delivery
has no restart replay or durable order-style idempotency guarantee.

## Standards review

No documented-standard breaches or material correctness concerns. The review
confirmed shared runtime contracts, authoritative identity/recipient authorization,
package boundaries, owned publication, and synchronized full/focused specs.

One optional low-priority smell: participant-label lookup in the activity panel
resembles the existing trade tape lookup. These small view-local lookups retain
the tape's existing sentence-case bot label and fallback; a shared label helper is
optional cleanup and does not affect acceptance.

Standards: **0 hard violations, 1 optional smell**.

## Specification review

No actionable findings: approved identifiers, current sender/recipient checks,
player-wide cooldown, acknowledgements, transient isolation, synchronized controls
and public-fill activity match issue #16 and its plan. Public payloads exclude
private order identities, portfolios and credentials. Full and focused specs agree.

Specification: **0 missing, incorrect or out-of-scope requirements identified**.
Reviews used independent parallel readers against staged changes from `21cc0c9`;
review did not substitute for execution of the validation gates above.
