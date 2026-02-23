---
name: workflows:brainstorm
description: Explore a feature or problem through iterative Q&A and optional research before planning. Produces docs/brainstorms/<date>-<topic>-brainstorm.md for /workflows:plan to auto-detect.
argument-hint: '[feature description or topic]'
allowed-tools:
  - Bash
  - Task
---

# /workflows:brainstorm

## Pre-Flight

```bash
mkdir -p docs/brainstorms || {
  printf '[brainstorm] Error: docs/brainstorms/ not writable. Run from project root.\n' >&2
  exit 1
}
```

If the above exits non-zero, stop. Do not delegate.

## Delegate

Delegate to the `brainstorm-orchestrator` agent with `$ARGUMENTS`.
