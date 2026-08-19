---
title: 'ruvector hooks init empty stdout blocks Cursor PreToolUse'
category: integration-issues
track: bug
problem: 'ruvector hooks init writes PreToolUse commands that print empty stdout; Cursor treats that as invalid JSON and blocks Shell and file edits'
date: 2026-08-19
tags:
  - ruvector
  - hooks
  - cursor
  - pretooluse
  - yellow-ruvector
---

# ruvector `hooks init` empty stdout blocks Cursor PreToolUse

## Problem Symptom

Any Cursor agent session that loads Claude Code hooks from
`~/.claude/settings.json` fails on the first Shell or file edit:

```text
Hook "npx ruvector@latest hooks pre-command ..." returned invalid JSON.
The command was blocked for safety.
```

`pnpm install`, worktree doctor, and even an edit of `settings.json` itself
are blocked. Claude Code in the same environment keeps working.

## Root Cause

`ruvector hooks init` (including `--minimal`) always overwrites
`hooks.PreToolUse` with commands of the form:

```text
npx ruvector@latest hooks pre-command "$TOOL_INPUT_command" 2>/dev/null || true
```

Those commands print nothing. Claude Code treats empty PreToolUse stdout as
allow. Cursor's Claude-plugin bridge requires a JSON permission object and
fails closed on empty or non-JSON stdout.

`--minimal` only skips env, permissions, MCP, statusline, and *advanced*
hooks. There is no `--no-hooks` flag. Core PreToolUse is unconditional.

`/ruvector:setup` used to run `hooks init --minimal --no-*` to create
`.ruvector/`. That is how the Cursor-breaking commands landed in user or
project `settings.json`. The yellow-ruvector plugin's own
`pre-tool-use.sh` already discarded RuVector stdout and printed
`{"continue": true}` — Claude never depended on the CLI printing a
permission decision.

This supersedes the setup recipe in
`ruvector-cli-and-mcp-tool-name-mismatches.md` that treated
`hooks init --minimal --no-*` as the correct initializer. Use `mkdir -p
.ruvector` instead.

## Working Solution

1. Plugin PreToolUse (and the other JSON hooks) emit dual-client allow
   JSON: `{"continue":true,"permission":"allow"}`. Claude reads
   `continue`; Cursor reads `permission`. Extra keys are ignored.
2. `/ruvector:setup` creates `.ruvector/` with `mkdir -p` and never calls
   `hooks init`.
3. `scripts/repair-cursor-pretooluse.sh` wraps leftover init-generated
   PreToolUse commands in user and project `settings.json` so they always
   print the dual-client payload. git-ai and PostToolUse entries are left
   alone. Re-running is a no-op.
4. After wrapping, start a new Cursor agent session so the repaired hooks
   are loaded.

Do not re-run `ruvector hooks init` after the repair — it overwrites the
wrapped commands.
