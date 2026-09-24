# Issue tracker: GitHub

Track work in GitHub Issues for Kenneth882/DinoPump. Use the
gh CLI with --repo Kenneth882/DinoPump.

## Requirements and tickets

PROJECT_SPEC.md remains the complete requirements reference.
Use docs/spec/README.md to find focused specifications.

When a skill says "publish to the issue tracker", create a GitHub
issue. When it says "fetch the relevant ticket", read the issue,
its labels, and its comments.

Implementation tickets must identify their scope, relevant spec
sections, applicable acceptance IDs, validation, and blockers.
Work in dependency order.

Use native GitHub issue dependencies for blocking relationships.
If unavailable, record "Blocked by: #N, #N" in the issue body.
A ticket is unblocked when all its blockers are closed.

Tickets produced by /to-tickets are already prepared for
implementation; incoming reports and requests go through /triage.

## Operations

- Read: `gh issue view <number> --repo Kenneth882/DinoPump --comments`
- List: `gh issue list --repo Kenneth882/DinoPump --state open`
- Create: `gh issue create --repo Kenneth882/DinoPump --title "<title>" --body-file <path>`
- Comment: `gh issue comment <number> --repo Kenneth882/DinoPump --body-file <path>`
- Label: `gh issue edit <number> --repo Kenneth882/DinoPump --add-label "<label>"`
- Remove label: `gh issue edit <number> --repo Kenneth882/DinoPump --remove-label "<label>"`
- Close: `gh issue close <number> --repo Kenneth882/DinoPump`

Write multiline bodies to a file and pass --body-file.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding

Use one map issue labelled wayfinder:map and child issues labelled
wayfinder:research, wayfinder:prototype, wayfinder:grilling, or
wayfinder:task.

Link children as GitHub sub-issues. If unavailable, use a task list
on the map and a "Part of #N" reference on each child.

Choose the first open, unblocked, unassigned child in map order.
Claim it by assigning the driving developer. Resolve it by recording
the answer, closing the child, and adding a linked decision summary
to the map.
