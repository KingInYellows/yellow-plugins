---
title: 'Hook set -e Causes Unexpected Exit Before JSON Output'
date: 2026-02-26
category: 'code-quality'
---

# Hook set -e Causes Unexpected Exit Before JSON Output

## Problem

Claude Code hooks (SessionStart, PostToolUse) must output `{"continue": true}`
on every exit path. `set -euo pipefail` — the standard safe-scripting preamble
— introduces a silent failure mode: any command that exits non-zero causes the
script to terminate immediately via `-e` before the required JSON line is
printed. This blocks Claude Code session startup (for SessionStart hooks) or
causes unexpected hook failures (for PostToolUse hooks).

Example: a SessionStart hook with `set -euo pipefail` and this code:

```bash
cache_age=$(( now - stat_mtime ))   # stat_mtime unset → arithmetic error → exit 1
```

The script exits at the arithmetic expression. No `{"continue": true}` is
output. Claude Code blocks the entire session.

This pattern appeared in three hooks across two plugins in the same review
session:

- `plugins/yellow-ci/hooks/scripts/session-start.sh` — SessionStart, `set -euo pipefail`
- `plugins/yellow-debt/hooks/scripts/session-start.sh` — SessionStart, `set -euo pipefail`
- `plugins/gt-workflow/hooks/check-commit-message.sh` — PostToolUse, `set -euo pipefail`

## Detection

Search for hooks that use `set -euo pipefail` or `set -e`:

```bash
grep -r 'set -e' plugins/*/hooks/scripts/*.sh plugins/*/hooks/*.sh
```

Any hook script that outputs `{"continue": true}` (or any JSON) must NOT use
`-e`. Look for:

```bash
set -euo pipefail   # WRONG in any hook that must output JSON
set -eu             # Also wrong if -e is present
```

Also look for SessionStart hooks that output plain text instead of JSON:

```bash
grep -r 'printf.*\[' plugins/*/hooks/scripts/session-start.sh  # plain text output
grep -r '{"continue"' plugins/*/hooks/scripts/session-start.sh  # check JSON is present
```

## Fix

### 1. Remove `-e` from hooks that must output JSON

```bash
# WRONG — -e can exit before JSON output on any non-zero command
set -euo pipefail

# RIGHT — keep -u (unset variable errors) and -o pipefail, drop -e
set -uo pipefail
# Note: -e is omitted intentionally. Hooks must always output {"continue": true}
# on every exit path. set -e would terminate the script before that output on
# any unexpected non-zero command.
```

### 2. Centralize all exits with a json_exit() helper

Rather than scattering `printf '{"continue": true}\n'` on every early-exit
path, define a helper at the top of the script:

```bash
#!/bin/bash
# session-start.sh — <description>
# Note: set -e intentionally omitted — hook must output {"continue": true} on all paths.
set -uo pipefail

json_exit() {
  local msg="${1:-}"
  if [ -n "$msg" ]; then
    printf '[component] %s\n' "$msg" >&2
  fi
  printf '{"continue": true}\n'
  exit 0
}

# Early exit: not applicable to this project
if [ ! -d ".github/workflows" ]; then
  json_exit
fi

# Early exit: tool not available
if ! command -v gh >/dev/null 2>&1; then
  json_exit "gh not found, skipping"
fi

# ... rest of logic ...

# Final output (SessionStart with systemMessage)
if [ -n "$output" ]; then
  jq -n --arg msg "$output" '{systemMessage: $msg, continue: true}'
else
  json_exit
fi
```

The helper guarantees that:
- Every exit outputs `{"continue": true}`
- Warning messages go to stderr (not contaminating the JSON stdout)
- The pattern is consistent across all exit paths

### 3. SessionStart must output JSON, not plain text

SessionStart hooks output `{"continue": true}` (or `{"systemMessage": "...",
"continue": true}` to inject context). They must NOT output plain text:

```bash
# WRONG — plain text output is not a valid SessionStart response
printf '[yellow-ci] CI: %d failure(s) detected.\n' "$count"
exit 0

# RIGHT — wrap content in systemMessage JSON
if [ -n "$output" ]; then
  jq -n --arg msg "$output" '{systemMessage: $msg, continue: true}'
else
  printf '{"continue": true}\n'
fi
```

PostToolUse hooks that only need to continue (no output to Claude) use:

```bash
printf '{"continue": true}\n'
```

## Prevention

- Every new hook script: start from a template that has `set -uo pipefail` (no
  `-e`) and defines `json_exit()` before the first line of logic
- Pre-PR checklist item: grep the hook for `set -e` — reject if found
- Code review: verify that every `exit` statement in a hook is via `json_exit`
  or a line that explicitly prints `{"continue": true}` first
- SessionStart-specific: verify the hook outputs JSON (not plain text) by
  running it manually and checking stdout

## Related

- `MEMORY.md` — "Bash Hook & Validation Patterns": `SessionStart hooks must
  output {"continue": true} on all error paths`
- `docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md`
- PR #72: SessionStart `{"continue": true}` requirement first documented
- This review session: pattern extended with `-e` root cause and `json_exit()`
  helper
