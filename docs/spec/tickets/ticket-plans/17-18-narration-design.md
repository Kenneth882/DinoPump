# Tickets 17–18: Daily Roar narration design

Design discussion recorded October 15, 2026. This note records the choices approved during the design discussion. It is not
an implementation plan or passing acceptance evidence.

Sources: [ticket 17](../17-commentary-worker-and-fallback.md),
[ticket 18](../18-optional-validated-ai-narration.md),
[narrator contract](../../events-and-narration.md#narrator-contract),
[interface](../../interface.md), and the [domain glossary](../../../../CONTEXT.md).

## Agreed choices

- AI narration connects the fictional event to relevant recorded round context,
  providing an explanation beyond a variation of authored wording.
- Context covers affected assets' prices and aggregate executed trading activity.
  Player names, individual trading judgments and leaderboard commentary are
  excluded from this initial design.
- Preserve authored news and add a separate plain-text paragraph labeled
  “AI narration” inside the same source news card. The factual event information,
  numerical effects and original event timestamp stay fixed.
- Use a clear newsreader voice with light dinosaur humor. Understanding the
  recorded market facts takes priority over jokes or sports-style excitement.
- Preserve existing product boundaries: immediate authored news and complete
  gameplay without AI; narration has no authority over market state or results.

Ticket 17 owns worker processing, safe publication and fallback. Ticket 18 owns
the provider adapter, contextual generation and output validation. These choices
do not establish that either ticket is implemented.

## Context and delivery choices

- Use aggregate activity since the previous scheduled event, beginning at round
  opening for the first event.
- Freeze context when the source event is applied. Retries keep that context;
  later trades do not cause rewrites. Activity preceding an event must not be
  described as a response to it.
- Show “As of m:ss” for the captured context, using elapsed round time. Add late
  narration to the original event card, including after closing; it remains a
  historical explanation and cannot alter frozen results.
- If AI is disabled, unavailable or produces no accepted narration, retain the
  complete authored card. Do not show an empty AI section, persistent spinner or
  provider-error state.

## Documentation and implementation boundary

These approved requirements are aligned in PROJECT_SPEC.md sections 6, 10 and 12
and their exact focused extracts, and in the local ticket 17/18 reference copies.
The glossary contains domain definitions only. No application code or live GitHub
ticket was changed by this design discussion. The live tickets still need these
clarifications synchronized when tracker updates are requested.

No design questions from this interview remain open. Provider selection, exact
input fields, aggregation formulas and wire/storage shapes remain implementation
planning details constrained by these requirements and the existing narrator
contract. No new gameplay rule or narration trigger was added.
