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

### Recovery behavior

- The browser reconnects automatically with backoff, then requests a fresh snapshot before enabling trades.
- Socket reconnection alone is not proof that no messages were lost. A sequence gap, reordered batch, or round ID change triggers resynchronization.
- The snapshot includes the player's recent order outcomes so a pending order can be reconciled. A timed-out submit retries the same ID; it never creates a second order.
- Capture the snapshot at sequence N and deliver only subsequent buffered batches after it, avoiding a subscribe/snapshot race.
- After restart, rebuild from committed data and process overdue scheduled events in due-time order before accepting commands. If closing time has passed, process events due strictly before close, then settle. Server outages do not extend the round.
- Use a database ownership lock to prevent two game processes from operating the same room. Loss of ownership or database availability disables writes and trading until safe recovery.
