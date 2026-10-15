# Scheduled events and AI narration

Read when implementing seeded events, scheduling, immediate news templates, commentary jobs, provider integration, validation, or fallback behavior.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §10, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For event timing, read [round lifecycle](round-lifecycle.md). For reference-price effects and quote rebuilding, read [market engine](market-engine.md). For atomic job creation, read [persistence](persistence.md). For overdue events after restart, read [API and recovery](api-and-recovery.md).

Verification: AC-09, AC-11, AC-13, AC-15, AC-18. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 10. Scheduled events and AI narration

### Event authority

At round creation, a seeded selection produces the full event schedule from a versioned catalog. Default individual shocks range from −1,500 to +1,500 basis points. Each scheduled event has an ID, due time, affected symbols, fixed effects, and fictional facts. Selection and effects are recorded before the round opens.

The scheduler applies effects exactly once, updates reference prices and quotes, publishes the factual template immediately, and enqueues narration. A commentary failure must never delay or roll back a market event.

### Narrator contract

AI narration connects the fictional event to affected assets' prices and aggregate executed trading activity. It provides useful recorded round context beyond a variation of authored wording. Inputs include only approved fictional asset/catalog facts, actual reference-price effects, last executed prices, and separately labeled aggregate observed trade statistics for affected assets. Exclude player names, individual trading judgments, leaderboard commentary, session secrets and raw user text.

Use activity since the previous scheduled event, or since round opening for the first event. Freeze the context when the source event is applied, including its capture time and the activity window. Retries use that same context; later trades do not change it or trigger regeneration. Prior activity must not be described as a player response to an event that had not yet occurred. Reference-price effects and executed last-trade prices remain distinct.

Output is schema-validated JSON with `headline` (maximum 100 characters) and `commentary` (maximum 400 characters). Use a clear newsreader voice with light dinosaur humor; understanding recorded market facts takes priority over jokes or sports-style excitement. Do not invent completed trades, confuse quote changes with last-trade changes, issue real-world recommendations, or imply external facts.

- Default provider timeout: five seconds; at most two attempts per event.
- Failed, invalid, unsafe, or unavailable output leaves the complete authored template in place, without an empty AI section, persistent spinner or provider-error state.
- Accepted generated commentary appears as a separate plain-text paragraph labeled “AI narration” within the original source news card. Preserve its authored headline, facts, commentary, numerical effects and original timestamp; a generated headline never replaces the authored headline. Label the captured context “As of m:ss” using elapsed round time. Late publication, including after closing, remains commentary about that historical context and cannot modify results.
- Retrying a job updates the same news item rather than producing a duplicate item.
- The worker's database role can access narration inputs/jobs and write commentary; it cannot change balances, quotes, trades, reference prices, or results.
- The LLM has no trading tools and cannot emit accepted game commands. No executable HTML or scripts are permitted in commentary.
- Save provider/model identifier, prompt version, duration, and validation outcome for debugging. The round must be fully playable without an API key.
