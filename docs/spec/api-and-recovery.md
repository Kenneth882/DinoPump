# API, realtime, sessions, and recovery

Read when implementing HTTP routes, Socket.IO messages, authentication, authorization, acknowledgements, snapshots, reconnects, restart recovery, or room ownership.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §9, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For lifecycle commands, read [round lifecycle](round-lifecycle.md). For transaction and sequence invariants, read [persistence](persistence.md). For rate limits and identity constraints, read [operations](operations.md). For due-event and close ordering, read [market engine](market-engine.md).

Verification: AC-01, AC-02, AC-05, AC-07, AC-08, AC-10–AC-12, AC-14, AC-15, AC-17, AC-18. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 9. API and realtime contract

All commands use runtime validation. The server derives player identity from the session and never trusts a player ID supplied in a payload. Guest sessions use secure, HttpOnly cookies in the same-site deployment; validate WebSocket origin and session expiry. Default session lifetime: 24 hours.

### HTTP surface

- `GET /api/market-baseline`: public read-only introduction content. Return `schemaVersion: 1`, `contentVersion`, `rulesVersion`, and the four `assets` with `symbol`, `name`, `description`, `iconId`, and `initialPriceCents`. Omit rules, event catalogs/schedules, and player/session data. Serve uncached responses. The web app forwards this route to the service at request time and validates the shared response contract; upstream failure, timeout, or malformed content returns HTTP 503 with `MARKET_INFORMATION_UNAVAILABLE` and no fallback prices.
- `POST /api/session`: create guest identity and session.
- `POST /api/rooms`: create the active room, or return a clear active-room conflict.
- `POST /api/rooms/:code/join`: join the lobby or reconnect an existing participant.
- `GET /api/rooms/:code/snapshot`: retrieve authorized current room state.
- `GET /api/rounds/:roundId/results`: retrieve results for a participant.
- `GET /healthz` and `GET /readyz`: process health and readiness to serve.

### Socket.IO messages

| Direction | Message | Essential payload |
| --- | --- | --- |
| Client → server | `room:ready` | `ready`, `requestId` |
| Client → server | `round:start` | `requestId` |
| Client → server | `order:submit` | `roundId`, `requestId`, `symbol`, `side`, `quantity`, `protectionPriceCents` |
| Client → server | `reaction:send` | Approved `reactionId` |
| Client → server | `room:resync` | `roundId`, `lastSequence` |
| Server → client | `room:snapshot` | Complete visible state, `sequence`, `serverTime`, deadlines |
| Server → client | `market:batch` | Ordered public changes, start/end sequence, `serverTime` |
| Server → client | `order:result` | Private order status, fills, balances, `requestId`, committed sequence |
| Server → client | `news:update` | Source event ID, facts, copy, narration status |
| Server → client | `presence:update` | Connection/readiness status |
| Server → client | `round:ended` | Immutable results and settlement sequence |
| Server → client | `command:error` | Stable error code, safe message, optional `requestId` |

Every command receives an acknowledgement carrying its request ID and outcome. Public batches contain a complete sequence envelope even when some event details are private; private holdings/order details are delivered only to their owner. Leaderboard portfolio totals and executed trade activity are public within the room.

### Scheduled-event delivery (ticket #9 stage)

Opening snapshots include `round.news`, the ordered authored news for already-applied events. Each item has `sourceEventId`, `roundId`, `scheduledEventId`, source `sequence`, `dueAtMs`, `appliedAtMs`, `catalogEventId`, `facts`, `headline`, `commentary`, `iconId`, actual reference `effects` (`symbol`, `beforeCents`, `afterCents`, `changeBps`), and `narrationStatus: "pending"`. Pending narration leaves the authored copy immediately visible; worker publication is a later slice.

`market:batch` carries `roundId`, `startSequence`, `endSequence`, `serverTime`, complete public `assets` and `quotes` at that batch's end, and its applied `news`. Public assets contain symbol, reference price, and last-trade price only. The service emits a complete committed batch followed by `news:update` for each source item. Clients apply market and template news together, deduplicate by source ID, and request a snapshot on a sequence gap or round change. Room snapshot sequence and round market sequence remain distinct. No future schedule, job input, engine ledger, or other player's holdings appears in these payloads.

The existing `room:resync { code, requestId }` acknowledgement remains supported during this stage. Full pending-order reconciliation and the round-based resync command are implemented in the later client-recovery ticket.

### Durable trading delivery (ticket #10 stage)

`order:submit` is a strict object with exactly `roundId`, `requestId`, `symbol`, `side`, `quantity`, and `protectionPriceCents`. UUID identities are canonicalized to lowercase. The authenticated session supplies player identity; quantities and prices must be safe whole integers. Frozen bounds are enforced by the engine; valid attempts outside those bounds receive a durable `INVALID_ORDER` rejection.

Successful acknowledgements and owner-only `order:result` use the same immutable result: submitted fields, original `sequence`, `status` (`FILLED`, `PARTIALLY_FILLED`, `NO_LIQUIDITY_WITHIN_PROTECTION`, or `REJECTED`), nullable `rejectionCode`, `fills`, `filledQuantity`, `remainingQuantity`, `totalValueCents`, nullable exact `averagePrice: { numeratorCents, denominatorUnits }`, and `portfolio: { cashCents, holdings }` after that order. Filled values and the average ratio agree exactly with the fills. A durable rejection is a result, not a transport error. Errors use `{ error, message, requestId? }`: malformed inputs use `INVALID_REQUEST`, excess submissions use `RATE_LIMITED`, changed identities use `IDEMPOTENCY_CONFLICT`, and unavailable/integrity failures use `SERVICE_UNAVAILABLE`. No internal validation details or credentials are exposed.

The player-wide token budget applies before matching and durable readback, across all sockets: five tokens/second, capacity ten. A rate-limited retry preserves its original payload and identity. Authorized identical requests retrieve the original outcome before rechecking funds, quotes, or closing time; a retry never republishes an execution. New valid attempts drain due effects first. At/after close, settlement precedes new immutable `MARKET_CLOSED` outcomes anchored to committed state, with no new fills. Room visibility sequence advances for each new outcome. Verified terminal rounds remain ready.

Opened snapshots add `tradingRules: { rulesVersion, prices, orders }` from the active frozen configuration, `quoteUpdatedAtMs`, `trades` (last 30 public fills), `totals` (marks-based public rankings), `portfolioSequence`, and `recentOrders` (up to 20 original outcomes belonging only to the requesting player). This visible bound never truncates durable identities; an older pending request can be resolved by unchanged authenticated resubmission. Public fills contain `sequence`, `symbol`, `quantity`, `priceCents`, `totalValueCents`, `buyerId`, and `sellerId`; the bot identity is `system:bot`. Public totals contain only player ID, join order, rank, portfolio value, profit and display return percentage. Holdings, request IDs and protection prices remain private.

Every `market:batch` adds its public `trades`, complete `totals`, and `quoteUpdatedAtMs`; its sequence envelope includes private-only rejected batches. A `room:heartbeat { serverTime, roundId, sequence }` supplies fresh authorized connectivity evidence every second during healthy publication, independently of quote age. Three seconds without freshness evidence pauses trading and requests a snapshot. Reconnect or an acknowledgement timeout requests an authoritative snapshot before retrying the frozen original request. A snapshot's recent outcome may resolve it directly. Private results and snapshots advance portfolios only by their private sequence; older retry outcomes can confirm an order without regressing newer balances. New submissions are disabled while pending, disconnected, unsynchronized or at/after close.

### Closing, results, and lobby reset (ticket #11 stage)

The owned processor settles at `serverNow >= closesAt`, after applying events due strictly before close. `SETTLING` and `FINISHED` lifecycle records, the complete settlement batch, frozen results, and room visibility commit together. Terminal rounds remain ready once verified; outages never extend deadlines. New orders at/after close return durable zero-fill `MARKET_CLOSED` outcomes after settlement. Original authorized retries retain their original outcome and sequence. Earlier migration-5 deadline rejections remain readable.

`GET /api/rounds/:roundId/results` requires a valid guest session belonging to the original locked participant set, including after lobby reset or a subsequent round. Responses are uncached and runtime-validated. Finished results contain `status`, `roundId`, `closesAtMs`, `marks`, `settlementSequence`, `rankings` with frozen display names, and an ordered `timeline` of committed source IDs, sequences, due times, authored headlines, facts, and effects. Each response adds only the authenticated owner's `playerId` and final `portfolio`. Public ranks/values/profit/return are shared; other cash/holdings, receipts, protections, and credentials remain private. Before completion, the route returns `INVALID_ROOM_STATE`; nonparticipants receive `FORBIDDEN`.

`room:snapshot` adds nullable `terminal` with the same participant-specific result, and `round:ended` delivers it after commit. Clients accept it only for their visible round with complete settlement sequence coverage; snapshots recover missed terminal delivery. Results use frozen marks, not mutable quotes or narration. Aborted snapshots omit the unverifiable market view and contain only `{ status: "ABORTED", roundId, message }`, with a fixed safe explanation and no winner. Integrity abort metadata is stored independently when replay cannot safely append to market history. Database/ownership failures stop writes; they cannot fabricate settlement or abort without ownership.

The host sends acknowledged `room:return-to-lobby { roundId, requestId }` from `FINISHED` or a safely recorded `ABORTED` round. Its transaction resets all readiness, clears countdown/current-round pointers, restores lobby host/expiry deadlines from presence, and retains historical data. Identical successful retries return the original acknowledgement even after a later round starts; changed content conflicts and stale new resets cannot affect another round. New starts freeze fresh IDs, seeds, configuration, and resources. The browser clears prior round state on authoritative round changes and ignores late old-round order/terminal messages.

### Client resynchronization (ticket #12 stage)

`room:resync` accepts the strict `{ roundId, lastSequence, requestId? }` object. `roundId` is a UUID or null when no market round is visible; `lastSequence` is a nonnegative safe integer market cursor, independent of the top-level room visibility sequence. UUIDs are canonicalized to lowercase. A supplied request ID is echoed in `{ requestId?, snapshot }` or a safe command error. The legacy `{ code, requestId }` command remains supported. Cursors identify what the client saw; stale or changed-round cursors retrieve the current authorized subscription's snapshot and never select another room or grant historical access.

Subscription, snapshot capture, mutations and publication share the owned queue. Capture a complete authorized snapshot at market sequence N, then publish only complete subsequent committed batches after N. Durable batches buffer commits while the captured snapshot awaits delivery. Every publication revalidates sessions and membership and selects only the owner's recent outcomes, portfolio and terminal resources, including closing, abort and lobby reset.

The browser validates both the snapshot event and the correlated acknowledgement, ignores acknowledgements from previous connection attempts, and stays paused until a snapshot covers the newest observed facts for its round. Missing or reordered sequence ranges and changed round IDs request another snapshot; fully covered duplicate batches have no effect. Lifecycle evidence invalidates earlier snapshot captures; recovery then requires a newly correlated read covering that round's highest observed cursor. Retain validated pending receipts received during resynchronization until authorized state is complete. A private order receipt cannot render newer resources ahead of its complete public batch. Three seconds without authorized freshness evidence marks quotes stale and pauses trading; transport failures and explicit server disconnects reconnect with bounded backoff. Countdown time continues from the most recent server clock and frozen deadlines while connectivity recovers.

Pending retries retain the exact original round, request ID, symbol, side, quantity and protection. Snapshot outcomes resolve recent requests; unchanged authenticated resubmission resolves requests outside the recent-outcome bound. An original participant may retrieve their recorded receipt after lobby reset or a subsequent round, but new stale-round attempts still fail and newcomers gain no historical access. A pending old receipt can confirm only its original request; it cannot replace a new round's visible resources or results.

### Recovery behavior

- The browser reconnects automatically with backoff, then requests a fresh snapshot before enabling trades.
- Socket reconnection alone is not proof that no messages were lost. A sequence gap, reordered batch, or round ID change triggers resynchronization.
- The snapshot includes the player's recent order outcomes so a pending order can be reconciled. A timed-out submit retries the same ID; it never creates a second order.
- Capture the snapshot at sequence N and deliver only subsequent buffered batches after it, avoiding a subscribe/snapshot race.
- After restart, rebuild from committed data and process overdue scheduled events in due-time order before accepting commands. If closing time has passed, process events due strictly before close, then settle. Server outages do not extend the round.
- Use a database ownership lock to prevent two game processes from operating the same room. Loss of ownership or database availability disables writes and trading until safe recovery.
