---
title: 'PostToolUse Hook Input Schema Field Paths'
date: 2026-02-25
category: 'code-quality'
---

# PostToolUse Hook Input Schema Field Paths

## Problem

PostToolUse hooks receive a different JSON schema than PreToolUse hooks. A
common mistake is reading `.exit_code` or `.command` at the root level — those
paths return `null` or empty string in PostToolUse context, causing hooks to
silently skip their logic or misfire on every tool call.

## Detection

Look for PostToolUse hook scripts that read:

```bash
# WRONG — these are PreToolUse root paths, not PostToolUse paths
EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '.exit_code // 0')
COMMAND=$(printf '%s' "$INPUT" | jq -r '.command // ""')
```

Or any hook that declares `PostToolUse` in plugin.json but reads fields at the
root level without nesting under `.tool_input` or `.tool_result`.

## Fix

PostToolUse hook input schema nests fields as follows:

| Field            | PostToolUse path            | PreToolUse path  |
| ---------------- | --------------------------- | ---------------- |
| Bash command     | `.tool_input.command`       | `.command`       |
| Tool exit code   | `.tool_result.exit_code`    | (not applicable) |
| File path        | `.tool_input.file_path`     | `.file_path`     |
| Tool name        | `.tool_name`                | `.tool_name`     |

Correct PostToolUse field extraction:

```bash
# PostToolUse: command is nested under .tool_input
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

# PostToolUse: exit code is nested under .tool_result
EXIT_CODE=$(printf '%s' "$INPUT" | jq -r '.tool_result.exit_code // 0' 2>/dev/null)
```

For efficiency, parse all fields in a single jq invocation:

```bash
# shellcheck disable=SC2154
eval "$(printf '%s' "$INPUT" | jq -r '
  @sh "TOOL=\(.tool_name // "")",
  @sh "COMMAND=\(.tool_input.command // "" | .[0:200])",
  @sh "EXIT_CODE=\(.tool_result.exit_code // 0)"
')" 2>/dev/null || { printf '"'"'{"continue": true}\n'"'"'; exit 0; }
```

Confirmed against `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh`
line 36 and `plugins/gt-workflow/hooks/check-commit-message.sh` lines 19 and 34.

## Prevention

- Always note the hook type (`PreToolUse` vs `PostToolUse`) at the top of the
  script in a comment
- When writing a new PostToolUse hook, start by copying the field-extraction
  block from an existing PostToolUse hook (not a PreToolUse hook)
- Code review checklist: if hook type is `PostToolUse`, verify `.tool_input.*`
  and `.tool_result.*` nesting — never root-level `.command` or `.exit_code`
