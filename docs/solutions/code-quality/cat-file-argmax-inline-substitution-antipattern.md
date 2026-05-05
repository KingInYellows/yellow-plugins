---
title: "$(cat large-file)" Defeats Its Own ARG_MAX Safety Comment
date: 2026-05-04
category: code-quality
track: bug
problem: Inline $(cat "$FILE") as a shell argument is subject to ARG_MAX (~128KB per argument on Linux) — the very limit the pattern claims to avoid
tags: [argmax, shell, cat, inline-substitution, command-authoring, large-file, reliability]
components:
  - plugins/yellow-council/agents/review/gemini-reviewer.md
  - plugins/yellow-council/agents/review/opencode-reviewer.md
---

# `$(cat large-file)` Defeats Its Own ARG_MAX Safety Comment

## Problem

Two yellow-council reviewer agents contained this pattern:

```bash
# Pass file content — avoids shell argument size limits
cat "$PACK_FILE" | timeout 120 gemini -p "$(cat "$PACK_FILE")"
```

This has two independent bugs:

### Bug 1: Dead-code `cat |` pipe

The `cat "$PACK_FILE" |` on the left feeds stdin to `gemini`. But `gemini`
reads its prompt from the `-p` flag, not from stdin. The stdin pipe is
completely ignored. The comment "avoids shell argument size limits" implicitly
justifies the pipe (as if stdin avoids ARG_MAX) — but the actual argument
delivery is through `-p "$(cat "$PACK_FILE")"`, not stdin.

### Bug 2: `$(cat large-file)` IS subject to ARG_MAX

`$(cat "$PACK_FILE")` is a command substitution. The result is passed as a
single shell argument to `gemini -p`. On Linux, the kernel enforces a per-
argument limit of approximately 128KB (`MAX_ARG_STRLEN`, not just total
`ARG_MAX`). The agents set a pack budget of 100K characters — which approaches
this limit and will silently truncate or fail when the pack is near-full.

The comment claiming this pattern "avoids shell argument size limits" is wrong.
Command substitution in `$(...)` constructs the value in memory and passes it
as a single argument — fully subject to the per-argument limit.

Five reviewers flagged this in the same review wave (correctness, reliability,
comment-analyzer, security, adversarial roles).

## Why This Matters

Agents that review large pack files (diffs, concatenated source) approach the
100K budget by design. Any pack over ~128KB will either:
- Silently truncate the argument (kernel clips at `MAX_ARG_STRLEN`)
- Cause `E2BIG` / argument-too-long error, crashing the review step

Because the failure mode is silent truncation, the reviewer may produce a
result that covers only part of the pack without any error surfacing.

## Key Insight

**Stdin redirection (`cmd < "$FILE"`) is the correct way to pass large file
content.** It avoids argument limits entirely because the data goes through the
file descriptor, not the argument vector. `$(cat "$FILE")` is identical to
reading the file path directly — both are subject to the same limits.

## Fix

### Option A: stdin redirection (preferred when the tool supports it)

```bash
timeout 120 gemini < "$PACK_FILE"
```

If the tool reads prompt from stdin by default, this is the cleanest fix.

### Option B: `--prompt-file` flag (preferred when the tool offers it)

```bash
timeout 120 gemini --prompt-file "$PACK_FILE"
```

File-path flags pass the path as an argument (a few hundred bytes) and the
tool reads the file internally — no argument size limit applies.

### Option C: process substitution with explicit stdin flag

```bash
timeout 120 gemini -p "$(cat "$PACK_FILE")"   # WRONG — still hits limit

# If -p must be used and the tool doesn't have --prompt-file:
# split: write prompt to temp file, then pass path
PROMPT_TMP=$(mktemp)
printf '%s\n%s' "$SYSTEM_PROMPT" "$(cat "$PACK_FILE")" > "$PROMPT_TMP"
timeout 120 gemini --prompt-file "$PROMPT_TMP"
rm -f "$PROMPT_TMP"
```

### Remove the misleading comment

Any comment claiming `$(cat "$FILE")` avoids argument limits must be removed
or corrected. The safe pattern is stdin or a file-path flag; document that
instead.

## Detection

```bash
# Find inline $(cat ...) passed as a command argument (not in assignments)
rg '\$\(cat ' plugins/ --include='*.md' \
  | grep -v '^\s*[A-Z_]*=' \
  | grep -v '# .*read from'
```

When reviewing shell code that passes large file content:
1. Check whether the delivery path is stdin (`< file`), file-path flag
   (`--file`), or inline substitution (`$(cat file)`)
2. If inline substitution: check the budget comments — any claim that it
   "avoids ARG_MAX" is incorrect and must be removed

## Prevention

- [ ] Never use `$(cat "$LARGE_FILE")` as an inline argument when file content
      may approach 64KB — use `< "$FILE"` or a `--prompt-file` flag
- [ ] When a tool has both stdin and a `-p` flag, prefer stdin for large inputs
- [ ] Delete or correct any comment claiming `$(cat ...)` avoids argument limits
- [ ] Pack budget constants (e.g., 100K chars) should be compared against
      the target tool's actual input method to confirm the budget is safe

## Related Documentation

- MEMORY.md: "Command File Anti-Patterns" section — `$VAR in bash code blocks`
- `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
  — related shell execution model issues in command files
