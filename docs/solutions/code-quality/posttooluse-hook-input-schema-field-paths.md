---
title: 'PostToolUse Hook Input Schema Field Paths'
date: 2026-02-25
category: 'code-quality'
track: knowledge
problem: 'PostToolUse Hook Input Schema Field Paths'
tags:
  - code-quality
---

# PostToolUse Hook Input Schema Field Paths

> **Correction (2026-07-20):** the "PreToolUse path" column below (`.command`
> at root level) is itself unverified against a primary source — it was
> copied from `check-git-push.sh`'s own header comment, not confirmed
> against Claude Code's actual behavior. Official docs
> (code.claude.com/docs/en/hooks, fetched live 2026-07-20) show PreToolUse
> input nesting `command` under `tool_input` — the SAME shape as
> PostToolUse, not a different root-level shape. This repo's own
> `plugins/yellow-ruvector/hooks/scripts/pre-tool-use.sh` (a currently
> working PreToolUse hook) independently corroborates this: it reads
> `.tool_input.command` and `.tool_input.file_path`, not root-level
> equivalents. Read `.tool_input.command` for BOTH PreToolUse and
> PostToolUse; the table's "PreToolUse path" column is preserved below only
> as a record of what `check-git-push.sh` actually read (and, per
> characterization-testing scope in the gt-workflow Codex pilot shell 04,
> continues to read in its Node port) — not as guidance for new hooks. See
> `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`'s
> 2026-07-20 update for the related envelope-case-transform correction.

> **Update (2026-07-22):** The 2026-07-20 correction above establishes that
> PreToolUse should read `.tool_input.command`, matching PostToolUse — but
> knowing the right path and enforcing it are different problems.
> `plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js:28` reads
> `camelCaseEnvelope.command` (root-level) by design: its own header comment
> states this "reproduces plugins/gt-workflow/hooks/check-git-push.sh's logic
> exactly, including reading `command` at the envelope's top level (not
> `toolInput.command`) ... per this shell's characterization-testing
> charter; it is not corrected here." Real PreToolUse envelopes nest under
> `tool_input.command` (per the correction above), so this hook's git-push
> blocker never fires against a live Claude Code or Codex PreToolUse call —
> it only ever matched the shape the bash original (and the fixtures ported
> from it) assumed. See
> `docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`
> for why the parity harness validating this port never caught it. As of
> this writing this is an open finding pending a maintainer decision: fix
> the field path (breaking the characterization-testing charter) or keep it
> as documented, deliberately-preserved bash-parity behavior.

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
