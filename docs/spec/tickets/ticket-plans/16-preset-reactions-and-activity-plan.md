# Ticket 16 implementation plan: preset reactions and public activity

Prepared October 15, 2026 against `25a95f97f4a5b7086ff388db2ae6ad6eb21ca406`
(merged ticket #15, PR #35). Local branch: `ticket16`; working tree was clean.

Ticket: [Send approved reactions and show public player activity](../16-preset-reactions-and-activity.md).
Tracker: [GitHub issue #16](https://github.com/Kenneth882/DinoPump/issues/16).

## Start here

Read [issue-tracker instructions](../../../agents/issue-tracker.md), then refresh
the issue, comments, and blocker status. Planning found #16 open, labeled
`ready-for-agent`, with no comments. Its sole declared blocker, #12, is still
open, although client reconciliation code and specifications are present in this
checkout. The tracker requires blockers to be closed before implementation:
reconcile that status against #12's acceptance evidence before starting. This
plan does not close the issue or claim its acceptance gates pass.

Inspect status and diff and record the implementation starting commit. Reuse
`ticket16` if its base remains suitable. Preserve unrelated work and duplicate
` 2.*` files; use the canonical files identified below. Planning does not authorize
pushing or deploying.

Read [product boundaries](../../product-and-scope.md),
[interface](../../interface.md), [persistence](../../persistence.md),
[API/recovery](../../api-and-recovery.md), [operations](../../operations.md),
[verification](../../verification.md), and [milestones](../../implementation.md).
These correspond to PROJECT_SPEC.md sections 2, 6, 8, 9, 11, 12, and 13.
Read [web instructions](../../../../apps/web/AGENTS.md) and installed Next.js
documentation before browser implementation.

## Outcome and boundaries

Authorized room members can send approved dinosaur reactions and see the same
public executed-trade activity. The server validates each command, derives the
sender from the session, and allows one reaction per second per player across
all sockets. Reactions never enter market event history or alter prices, quotes,
balances, orders, scoring, or frozen results.

Use the three prescribed examples as the initial fixed catalog: “Big roar,”
“Tiny arms, big gains,” and “Meteor incoming.” No free-text chat, custom reactions,
direct messages, AI-generated reactions, or durable social-history system.
Keep the existing trade tape and portfolio functionality. The full narrow-screen
tab redesign belongs to #19; these new controls must still work at 360px.

## Existing integration points

| Area | Reuse and constraint |
| --- | --- |
| Shared contracts | `packages/contracts/src/lobby.ts` provides strict command, snapshot, and error schemas. Add a focused reaction contract module and export it through the package entry point. No reaction schemas currently exist. |
| Realtime owner | `apps/game-server/src/lobby-realtime.ts` owns subscriptions, command serialization, and delivery. Its `members` map identifies sockets but is not sufficient evidence of current authorization. |
| Authorization | `packages/database/src/lobby.ts` validates sessions and room membership in owned store operations. `publication` revalidates each recipient. Add a narrow authorization operation if needed; avoid rebuilding full market snapshots for every reaction. |
| Rate limiting | `LobbyStore.consumeOrderToken` is an existing player-wide pattern, but the order budget has a different rate and burst. Reactions need an independent limit. |
| Public activity | Snapshots already contain the latest 30 public fills, and complete market batches carry new fills. Each has sequence, symbol, units, price, executed total, buyer, and seller. `system:bot` identifies the counterparty. |
| Browser recovery | `apps/web/app/lobby.tsx` validates snapshots/batches, owns the socket, and handles connection generations and round changes. Reaction receipt must not advance those market cursors or count as market freshness evidence. |
| Terminal | `apps/web/app/market-terminal.tsx` already renders a recent trade tape with player names and bot counterparties. Add the lower activity/reaction panel using the same accepted public fills. |
| Tests | Reuse real Socket.IO/PostgreSQL fixtures in `tests/integration/lobby-http.database.test.ts` and the two-browser fixture used by `tests/e2e/terminal.spec.ts` and `portfolio.spec.ts`. |

## Proposed contract details to settle before coding

The specification fixes approved identifiers, authorization, acknowledgements,
and the rate, but does not define the complete wire shapes or retry lifetime.
The following are proposed implementation details, not existing API guarantees.
Resolve any disagreement affecting a public contract before implementing it;
then document the chosen behavior in both specification forms.

- Use strict `reaction:send { requestId, reactionId }`, with a canonical UUID
  request ID and identifiers `big-roar`, `tiny-arms-big-gains`, and
  `meteor-incoming`. The API table currently lists only the essential reaction
  identifier, while its general command rule requires a request ID.
- Add `reaction:published` with a server-generated reaction ID, room code,
  current round ID or null, authenticated player ID, approved reaction ID, and
  server timestamp. Send labels from the fixed shared catalog; never accept
  client-provided names, timestamps, identities, markup, or arbitrary text.
  Keep the sender's command request ID out of the shared event.
- Acknowledge acceptance with the request ID and published reaction ID. Use
  safe stable errors such as `INVALID_REQUEST`, `UNAUTHENTICATED`, `FORBIDDEN`,
  `RATE_LIMITED`, and `SERVICE_UNAVAILABLE`. Supply reaction-appropriate messages;
  current lobby errors mention names/lobby actions and are not suitable copy.
- Enforce at least 1,000ms between accepted reactions for a player, with no
  burst, shared across their sockets. A rejected attempt does not publish or
  extend the successful-send cooldown. Retain cooldown state across socket
  reconnects; bound and expire it independently of socket removal.
- Treat delivery as transient. Do not buffer sends while offline, automatically
  retry a timed-out reaction, or replay missed reactions after reconnect/restart.
  Correlate acknowledgement IDs and report uncertainty after timeout. This
  avoids promising durable order-style idempotency for social messages. Document
  that request IDs correlate acknowledgements rather than durable receipts.
- Permit authorized members of an active room to react in the lobby, countdown,
  open round, and terminal view; expired rooms/sessions cannot send or receive.
  Place the compact controls in a shared room surface so closing reactions can
  be tested against frozen results. No host-only permission or market-open rule
  is specified for reactions. Clear visible transient items on context change.
- Bound the displayed reaction list, for example to 20 recent items with a
  ten-second display lifetime. These are presentation limits, not market rules.
  No database migration or new market event is expected.

## Implementation slices

Use one failing public behavior at a time, followed by the smallest working
implementation. If using the TDD skill, the existing browser/snapshot seam is
already authorized; agree on any additional public service seam required by that
skill before writing tests. Do not replace real transport/authorization coverage
with mocks of the implementation.

1. **Define the approved catalog and acknowledged command.** Add shared runtime
   schemas for command, acceptance, published event, and error. Validate unknown
   identifiers, free-text/extra fields, malformed IDs, and forged identity. Keep
   exports usable by both service and browser without importing engine internals.
   Done: a real authorized socket receives a correlated acceptance and another
   authorized participant receives exactly the permitted public event.

2. **Authorize and limit before publication.** Revalidate sender session and
   membership for each command, and recipients immediately before delivery.
   Respect store ownership/readiness failure; do not publish on stale cached
   membership or a lost database owner. Use the existing serialized owner path
   without calling engine commands, persisting a market batch, or advancing
   market/room visibility sequences solely for a reaction. Keep rate-limit state
   bounded, separate from order tokens, and keyed to authenticated player identity.
   Done: simultaneous sockets for one player share a single allowance; another
   player retains their own allowance; 999ms fails and 1,000ms succeeds. Expired
   senders and recipients, nonmembers, malformed commands, and unavailable
   ownership produce no reaction broadcast or market mutation. Reconnect cannot
   reset the player's cooldown. Use synthetic clocks, not wall-clock sleeps.

3. **Render transient reactions safely.** Add compact labeled buttons with
   visible focus, pending/cooldown feedback, and safe errors. Disable sending
   while disconnected or awaiting an authorized snapshot. Validate incoming
   events, reject wrong room/round context and stale connection callbacks,
   deduplicate by published reaction ID, and bound list/timer memory. Never use
   reaction traffic to restore trading connectivity or clear an order's pending
   state. Clean up timers/listeners and clear transients on reset/new round.
   Done: both browsers see permitted labels attributed to the authenticated
   player; timeout/reconnect does not queue a later surprise send. Keyboard and
   reduced-motion use remain clear without focus jumps, flashing, or a live
   announcement for every incoming reaction.

4. **Show public executed-player activity.** Derive activity from already
   validated, completely applied public fills, ordered by round and sequence.
   Show actor, buy/sell direction, symbol, executed units/price/total, and bot
   counterparty. Render one entry per fill; do not invent an order grouping that
   requires private request IDs. Multi-level orders legitimately produce several
   fill entries. Use the existing 30-fill bound, an explicit empty state, and
   snapshot replacement after reconnect. Keep reactions visibly distinct from
   executed facts and avoid implying a total ordering between the two channels.
   Done: rejected/zero-fill requests create no executed activity; duplicate
   batches/snapshots do not duplicate entries; public payloads contain no private
   requests, protections, holdings, cash balances, or credentials.

5. **Prove market independence through the complete journey.** Add a focused
   `tests/e2e/reactions.spec.ts` using real service-backed browsers, one at desktop
   size and one at 360px with reduced motion. Join/ready/open, exchange reactions,
   execute a multi-fill buy and a sell, observe public activity, apply an event,
   reconnect, finish, react again, and reset. Compare public activity against
   authorized snapshots and ensure private owner fields stay owner-only. Lost
   transient reactions need not reappear; executed activity must recover.
   Done: reactions change neither authoritative market state nor immutable final
   results, including after reconnect/reload and a later round. Late events from
   the previous room/round do not populate the new view.

6. **Document, validate, review.** Update the relevant numbered sections in
   PROJECT_SPEC.md and the exact focused counterparts together, plus test README
   files and the ticket's evidence. Keep this plan distinguishable from completed
   validation. When implementing through `$implement`, run its required standards
   and specification review against the recorded start, address findings, and
   commit the scoped reviewed change locally.

## Validation map and commands

| Acceptance | Required evidence for this ticket |
| --- | --- |
| AC-05 | Strict approved IDs; forged/free-text input rejected; stable safe acknowledgements/errors; session expiry, membership, sender/recipient authorization, and one-per-second player-wide limits. |
| AC-10 | Two clients agree on permitted reactions and committed activity; private fields stay isolated; duplicate delivery, reconnect, and context changes do not corrupt market synchronization. |
| AC-11 | Reactions before/after close do not change marks, balances, ranks, stored results, or market sequences/history. |
| AC-17 | Two-browser join → ready → trade → event → reconnect → results journey includes keyboard reaction controls, readable activity, reduced motion, and 360px layout. |

For unchanged-state assertions, compare a canonical projection of market data:
round ID, market sequence, assets, quotes, fills, portfolio, and totals. Exclude
server time, heartbeat time, and presence from its hash; compare both owners'
authorized projections. Hold the synthetic clock between scheduler deadlines
while testing reaction-only effects. After settlement, compare the complete
authorized immutable results per owner. At the service/database seam also assert
that reactions append no market events, batches, orders, trades, or result rows;
matching visible hashes alone would miss unintended persistence.

Use Node 24 and pnpm 10.34.5. Run targeted contract/service/browser cases while
iterating, then the completion commands:

```sh
pnpm check
pnpm db:verify
pnpm test:e2e
```

`pnpm check` excludes the database suite. Database verification and browser tests
must run sequentially because both use disposable PostgreSQL on port 55433.
The browser runner isolates each spec with a fresh schema/service; a focused run
is `pnpm test:e2e reactions.spec.ts`. Do not reset development data or change the
production round duration. Preserve builds without a running database or AI key.

Previous tickets encountered a stalled default Turbopack production build. Retry
the required command and report its actual outcome. If it remains blocked,
`pnpm --filter @dinopump/web exec next build --webpack` and
`pnpm -r --filter '!@dinopump/web' build` provide separate build evidence; they do
not turn an incomplete `pnpm check` into a pass. Preserve unrelated dev servers
and generated-file changes while diagnosing.

This document is a plan, not passing acceptance evidence. The full accessibility,
eight-player load, narration, and release gates remain their own tickets.
