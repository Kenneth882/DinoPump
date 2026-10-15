# Commentary worker (ticket #17)

The game service commits complete authored news and a frozen narration input with
each scheduled effect. A separate worker leases jobs. The game service's existing
250ms owned queue publishes completed output to the same news card after commit.
Neither a running worker nor an AI key is needed to play.

## Local setup

Use the Node/pnpm versions pinned in the root package. Follow the database and web
setup in [README](../README.md), then:

1. Choose a separate PostgreSQL login and unique password. Add
   `COMMENTARY_DATABASE_URL` to a separate ignored root `.env.commentary`, targeting the same
   database/schema as `DATABASE_URL` with that separate login. URL-encode password
   characters, then run `chmod 600 .env.commentary`. This file contains only the
   worker URL; keep the game-service credential in `.env`.
2. Run `pnpm db:migrate`. Migration 7 creates the `dinopump_commentary` NOLOGIN
   permission group and schema-scoped functions. The migration operator needs
   CREATEROLE as well as schema ownership; use an operator credential for setup.
3. Run `pnpm db:worker-role` with the database operator's `DATABASE_URL` to create
   the separate login and grant that group. This operator command loads both
   environment files; the worker loads only `.env.commentary`. An existing login retains its password
   and privileges; use a fresh dedicated login. The worker rejects excess table
   privileges at startup.
4. Run `pnpm dev` for web/service and, in another terminal, `pnpm worker`.
   The worker loads only its restricted URL. Stop it with Ctrl-C. For a compiled
   process, run `pnpm build` then `pnpm --filter @dinopump/commentary-worker start`.

The runnable worker currently records disabled-provider fallback. Ticket #18 owns
provider selection, credentials, factual-output validation and live generation.
No provider SDK or API-key variable is introduced here. Its adapter seam is
`Narrator.narrate(input, signal)`, which must return accepted, fact-checked output
or a typed fallback. Synthetic adapters exercise accepted publication in tests.

## Storage and recovery

- Approved inputs contain authored fictional facts and affected assets only.
  Activity aggregates actual fills since the previous applied event (opening for
  the first), with sequence boundaries to distinguish overdue events sharing a
  capture time. Buy/sell counts refer to human direction against the bot. Last
  executed price is null before any fill; the frozen initial price is separate.
- Context freezes when the event is applied. Later trades and retries never
  rebuild it. Historical jobs without versioned context are retained as fallback.
- Claims use `FOR UPDATE SKIP LOCKED`, a unique lease token, a 15-second lease, and
  at most two persisted attempts. Provider calls are bounded to five seconds.
  Unavailable/timeout outcomes retry after one second; disabled/invalid outcomes
  terminate. Expired final attempts become fallback on the next worker poll.
- Completion requires the current unexpired lease. Accepted output and attempts
  commit before publication. The owner retries publication independently without
  another provider call; restart or missed broadcast recovers from snapshots.
- Authored `news_items`, market history and results remain immutable. Separate
  immutable `commentary_publications` enrich delivery. Late output can publish
  after closing. Old-round output remains recorded after lobby reset and cannot
  appear in the new round. No market sequence or result changes.
- The role has only schema USAGE and EXECUTE on claim/completion functions. It
  cannot read sessions, full round state or future schedules, mutate job inputs or
  attempt limits, or change balances, quotes, trades, references or results.
- Safe logs and stored attempt provenance use source/job IDs, attempt number,
  provider, model, prompt version, duration and validation status. Provider errors,
  generated copy, session credentials and database URLs are never logged.

## Evidence and limits

`pnpm check` runs formatting/lint, type checks, pure/service tests and builds.
`pnpm db:verify` covers real PostgreSQL leases, permission denials, retry schedules,
frozen activity windows, publication rollback/restart and immutable late results.
`pnpm test:e2e commentary.spec.ts` verifies complete fallback cards and late
labeled narration in two browsers, including 360px, a trade, reconnect and closing.
The synthetic provider needs no external key.

These checks support ticket #17's AC-09/11/13/14/18 cases. They do not establish
#18's factual validation, full narration milestone completion, eight-client load
or release acceptance.

Recorded results: [ticket #17 validation](validation/ticket-17-commentary.md).
