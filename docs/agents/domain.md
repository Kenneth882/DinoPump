# Domain docs

DinoPump uses one shared domain context across apps and packages.

## Before exploring

Read root CONTEXT.md, when present, and relevant decisions in
docs/adr/.

If these files do not exist, proceed silently. /domain-modeling
creates them when terms or decisions are resolved.

## Layout

- CONTEXT.md: shared domain glossary.
- docs/adr/: architectural decision records.

## Consumer rules

Use the glossary's terms in tickets, code discussions, and tests.
Note genuine vocabulary gaps for /domain-modeling.
Explicitly surface conflicts with an existing ADR.

Follow AGENTS.md for specification routing and requirements changes.
