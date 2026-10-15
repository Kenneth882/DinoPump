# Commentary worker and optional narration (tickets #17–18)

The game service commits complete authored news and a frozen narration input with
each scheduled effect. A separate worker leases jobs. The game service's existing
250ms owned queue first commits and delivers market changes, then publishes
completed output in a separate transaction to the same news card.
Neither a running worker nor an AI key is needed to play.

## Local setup

Use the Node/pnpm versions pinned in the root package. Follow the database and web
setup in [README](../README.md), then:

1. Choose a separate PostgreSQL login and unique password. Add
   `COMMENTARY_DATABASE_URL` to a separate ignored root `.env.commentary`, targeting the same
   database/schema as `DATABASE_URL` with that separate login. URL-encode password
   characters, then run `chmod 600 .env.commentary`. Keep the game-service
   credential in `.env`; optional provider settings go in `.env.commentary` below.
2. Run `pnpm db:migrate`. Migration 7 creates the `dinopump_commentary` NOLOGIN
   permission group and schema-scoped functions. The migration operator needs
   CREATEROLE as well as schema ownership; use an operator credential for setup.
3. Run `pnpm db:worker-role` with the database operator's `DATABASE_URL` to create
   the separate login and grant that group. This operator command loads both
   environment files; the worker loads only `.env.commentary`. An existing login retains its password
   and privileges; use a fresh dedicated login. The worker rejects excess table
   privileges at startup.
4. Run `pnpm dev` for web/service and, in another terminal, `pnpm worker`.
   The worker loads only `.env.commentary`. Stop it with Ctrl-C. For a compiled
   process, run `pnpm build` then `pnpm --filter @dinopump/commentary-worker start`.

### Optional provider

Core play defaults to disabled narration. To enable the OpenAI adapter, add these
settings to the ignored `.env.commentary` file only:

```dotenv
COMMENTARY_PROVIDER=openai
OPENAI_API_KEY=replace_with_your_private_provider_key
COMMENTARY_MODEL=your_pinned_responses_model_snapshot
```

Use an available Responses model supporting structured JSON output. Pin its
snapshot in your deployment configuration; no model is silently selected for you.
Missing credentials, a missing/invalid model, or an unsupported provider leaves
narration disabled. Remove `COMMENTARY_PROVIDER` to disable calls. Never put the
key in the game-service environment, a browser variable, or a committed file.

The adapter uses Node's built-in fetch and the
[Responses API](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
with `store: false`, no tools, one request per leased attempt and the worker's
five-second abort signal. There is no SDK or hidden transport retry. HTTP errors
use the existing persisted retry schedule; refusals/incomplete or malformed
responses retain authored news. No live credential is needed for validation.

`NarrationProvider.generate(request, signal)` is the replaceable external boundary;
`FactCheckedNarrator` validates its output before the worker can publish it.
The model selects an affected asset and a complete approved contextual passage,
optionally adding approved light dinosaur humor. Passages distinguish reference
changes from last executed prices and describe aggregate activity as preceding
the source event. Exact passage membership and JSON field limits are checked
locally, including pairing the headline with its asset. Arbitrary free-form prose
is rejected even when it sounds plausible: this conservative vocabulary makes
factual validation deterministic. The authored event still supplies the full
fictional account; the added paragraph supplies recorded trading context.

Only an explicit projection of approved authored facts and frozen asset/context
fields is sent. Source/round IDs, player identities, credentials and future
events are omitted. Provenance is supplied locally, never trusted from the model.

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
  Publication failure cannot roll back opening, due effects or closing, or
  disconnect clients. Optional statements have a 100ms timeout and a 50ms lock
  timeout so stalled publication work does not monopolize the owner queue.
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
`pnpm test:e2e commentary.spec.ts commentary-no-key.spec.ts` verifies complete
fallback cards, a full no-key round, and late fact-checked narration in two
browsers, including 360px, trading, reconnect and closing. Pure provider tests
cover JSON/length checks, exact factual passage membership, private-field
exclusion, configuration, structured requests and refusal/incomplete output.
The synthetic provider needs no external key.

These checks support the narration portions of AC-09/11/13/14/18. They do not
establish eight-client load or release acceptance. Live provider availability,
model access and latency require a configured account; all local acceptance
evidence uses synthetic responses and no external key.

Recorded results: [ticket #17 validation](validation/ticket-17-commentary.md).
See also [ticket #18 validation](validation/ticket-18-narration.md).
