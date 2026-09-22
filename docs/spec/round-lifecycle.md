# Round lifecycle and scoring

Read when implementing lobby readiness, host controls, countdown, round transitions, disconnect handling, marking, rankings, or results.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §4, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For commands and reconnect behavior, read [API and recovery](api-and-recovery.md). For persisted transitions and final results, read [persistence](persistence.md). For last-trade updates and close-boundary ordering, read [market engine](market-engine.md).

Verification: AC-01, AC-02, AC-05, AC-09, AC-11, AC-15, AC-17. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 4. Player journey and round rules

1. A player chooses a dinosaur avatar and a unique display name, then creates or joins the active room using its code.
2. The lobby shows players, the fictional-currency notice, and a short explanation of buying, selling, and scoring.
3. At least two connected players must mark themselves ready. The host starts a five-second countdown; joining and the participant list then lock.
4. If fewer than two players remain connected before opening, the countdown returns to the lobby. Otherwise the round opens for the locked participants.
5. Each participant begins with **D$10,000.00 cash and zero holdings**. The market remains open for **600 seconds**.
6. Players buy and sell whole units, follow the feed, and monitor their portfolios. New participants cannot join an open round; existing participants can reconnect.
7. Market events occur at elapsed seconds 60, 120, …, 540. There are nine events; no event occurs at the closing boundary.
8. At market close, orders stop, final marks are frozen, and the results screen appears.
9. The host can return the room to the lobby. The next round has a new ID, seed, balances, and readiness state; previous round data remains recorded.

### State machine

`LOBBY → COUNTDOWN → OPEN → SETTLING → FINISHED`

- A failed countdown returns to `LOBBY`.
- An unrecoverable integrity error moves the round to `ABORTED`; it must not declare a winner.
- The host has lobby controls only. Host status gives no trading privileges.
- In the lobby, a disconnected host is replaced after 15 seconds by the earliest-connected remaining player. Empty lobbies expire after five minutes.
- Disconnected round participants retain their cash and holdings and remain ranked. No automatic liquidation occurs.
- An open round continues even if all participants disconnect.

### Scoring

`portfolioValueCents = cashCents + Σ(quantity × finalOrCurrentMarkCents)`

`profitCents = portfolioValueCents − 1,000,000`

`returnPercent = profitCents / 1,000,000 × 100`

The mark is the latest completed trade price, or the initial price if no trade has occurred. Scheduled events can move executable quotes without immediately changing this mark. The UI must distinguish **last trade**, **bid**, and **ask**.

Rank by portfolio value descending. Equal values share a rank; stable display ordering uses join order and does not break the tie. Final holdings are marked, not forcibly sold. Bots are excluded from ranking. Live rankings are provisional because the most recent trade can influence valuation.
