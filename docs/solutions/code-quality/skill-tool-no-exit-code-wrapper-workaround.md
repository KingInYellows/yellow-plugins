---
title: 'Skill tool returns no exit code — wrapper command workaround'
date: 2026-05-18
category: code-quality
track: knowledge
problem: Claude Code Skill tool provides no machine-readable success/failure signal; wrapper commands cannot detect inner-skill failures
tags: [skill-tool, exit-code, wrapper-command, sweep, platform-constraint]
components: [yellow-review]
---

## Context

The Claude Code `Skill` tool invokes a named skill (by its `name:` frontmatter
value). It returns the skill's prose output but **no structured exit status**.
There is no `success: true/false` field, no exit code, and no stderr stream
distinguishable from normal output.

This was surfaced during the PR #539 review: 8 of 15 persona reviewers
independently flagged it as a problem in `/review:sweep` and `/review:sweep-all`.

## Consequences for Wrapper Commands

Commands that loop over N items and call `Skill(...)` per item cannot:

- Detect that a skill invocation failed mid-loop
- Distinguish "PR reviewed successfully" from "PR review errored out"
- Surface a reliable completion count vs failure count to the user

The result is that outcome labels like `swept` in a summary table are
**optimistic by construction** — they mean "skill was invoked," not "skill
succeeded."

## Applied Fix (PR #539)

Rename the outcome label from `swept` to `attempted` in the summary table, and
add a `Notes` column populated with any stderr-style error lines surfaced in the
skill's output. This makes the limitation explicit in the UX rather than hiding it.

Before:
```
| PR    | Status  |
|-------|---------|
| #539  | swept   |
```

After:
```
| PR    | Status    | Notes                          |
|-------|-----------|--------------------------------|
| #539  | attempted | codex reviewer degraded (401)  |
| #540  | attempted |                                |
```

## Platform Constraint

The underlying issue is a Claude Code platform limitation: `Skill` has no
exit-code API. This cannot be fixed in plugin authoring alone. The workaround
documented here is the correct approach until the platform adds structured
Skill responses.

## When to Apply

Whenever writing a command that:
- Calls `Skill(...)` in a loop over N items
- Needs to report aggregate success/failure to the user
- Uses labels that imply completion (e.g., "reviewed", "swept", "processed")

Replace completion-implying labels with attempt-implying labels (`attempted`,
`queued`, `dispatched`) and surface error text from skill output in a Notes
column or equivalent.

## Detection

Grep for completion-implying labels in sweep-style commands:

```bash
grep -r 'swept\|reviewed\|processed\|completed' plugins/yellow-review/commands/
```

Flag any that appear in table output columns where the value is set
unconditionally after a Skill call.
