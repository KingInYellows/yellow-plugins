---
title: "ruvector hooks rewritten to delegate to built-in CLI hooks"
category: code-quality
date: 2026-02-18
tags:
  - ruvector
  - hooks
  - cli
  - refactoring
  - yellow-ruvector
  - queue-management
problem_type: reimplemented-builtin
components:
  - plugins/yellow-ruvector/hooks/scripts/session-start.sh
  - plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh
  - plugins/yellow-ruvector/hooks/scripts/stop.sh
  - plugins/yellow-ruvector/CLAUDE.md
  - plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md
severity:
  critical: 0
  important: 3
  nice_to_have: 0
  total: 3
pr: direct-to-main
---

# ruvector hooks rewritten to delegate to built-in CLI hooks

## Problem Symptom

The yellow-ruvector plugin's 3 hook scripts totaled ~345 lines and reimplemented
queue management that ruvector already handles internally:

- **session-start.sh** (167 lines): Manual JSONL queue flushing with `flock`,
  `jq` dedup, `npx ruvector insert --namespace code --file <path>` (wrong CLI
  signature), stale queue cleanup, learnings retrieval via
  `npx ruvector search --namespace reflexion --limit 3 --query "..."` (also
  wrong)
- **post-tool-use.sh** (125 lines): Manual JSONL entry construction with `jq`,
  atomic append to `.ruvector/pending-updates.jsonl`, queue rotation at 10MB
  with `flock`
- **stop.sh** (53 lines): Queue entry counting, systemMessage delegation to
  memory-manager agent for flush (non-deterministic — Claude may not follow)

The CLI commands used were wrong (discovered in a prior fix — see related docs),
but more fundamentally, the entire queue management approach was unnecessary.

## Root Cause

ruvector provides built-in CLI hook commands that handle queue management, dedup,
flush, and session lifecycle internally:

```
npx ruvector hooks --help
  session-start    Initialize session, resume pending work
  session-end      Cleanup, export metrics
  post-edit        Record file edit event
  post-command     Record bash command outcome
  recall           Retrieve learnings by similarity
  remember         Store a learning
```

The plugin hooks were written before these commands were discovered. Instead of
thin wrappers around ruvector's CLI, they reimplemented queue management from
scratch — JSONL format, atomic appends, flock-based dedup, rotation at 10MB,
stale file cleanup, and agent delegation for flush.

## Investigation Steps

1. **Read all 3 hook scripts** — Found `session-start.sh` using
   `npx ruvector insert --namespace code --file <path>` and
   `npx ruvector search --namespace reflexion` — both wrong signatures
   (discovered in prior session fix)
2. **Ran `npx ruvector hooks --help`** — Discovered built-in hook subcommands:
   `session-start`, `session-end`, `post-edit`, `post-command`, `recall`,
   `remember`
3. **Ran `npx ruvector hooks post-edit --help`** — Confirmed it takes
   `--success <path>` and handles internal queue management
4. **Ran `npx ruvector hooks recall --help`** — Confirmed it takes
   `--top-k N "query"` and returns similarity-matched learnings
5. **Compared complexity** — 345 lines of manual queue management vs ~136 lines
   of thin wrappers delegating to ruvector's CLI

## Working Solution

### Rewrite: session-start.sh (167 → 59 lines)

<!-- prettier-ignore -->
**Before:** Manual flock-based queue flush, jq dedup, wrong CLI insert/search commands, stale queue cleanup
**After:** Two ruvector CLI calls

```bash
# Session recovery (ruvector handles queue flush internally)
npx ruvector hooks session-start --resume 2>/dev/null || {
  printf '[ruvector] hooks session-start failed\n' >&2
}

# Retrieve learnings via built-in similarity search
recent_learnings=$(npx ruvector hooks recall --top-k 3 \
  "recent mistakes and fixes" 2>/dev/null) || recent_learnings=""
skill_learnings=$(npx ruvector hooks recall --top-k 2 \
  "useful patterns and techniques" 2>/dev/null) || skill_learnings=""
```

Learnings are still wrapped in prompt injection fencing delimiters before
returning as `systemMessage`.

### Rewrite: post-tool-use.sh (125 → 53 lines)

<!-- prettier-ignore -->
**Before:** Manual JSONL construction, atomic append, queue rotation with flock
**After:** Case-based delegation to ruvector CLI

```bash
case "$TOOL" in
  Edit|Write)
    npx ruvector hooks post-edit --success "$file_path" 2>/dev/null || true
    ;;
  Bash)
    if [ "$exit_code" -eq 0 ]; then
      npx ruvector hooks post-command --success "$command_text" 2>/dev/null || true
    else
      npx ruvector hooks post-command --error "exit code $exit_code" \
        "$command_text" 2>/dev/null || true
    fi
    ;;
esac
```

### Rewrite: stop.sh (53 → 24 lines)

<!-- prettier-ignore -->
**Before:** Count queue entries, build systemMessage asking Claude to invoke memory-manager agent
**After:** Single CLI call

```bash
npx ruvector hooks session-end 2>/dev/null || {
  printf '[ruvector] hooks session-end failed\n' >&2
}
```

### Documentation updates

- **CLAUDE.md**: Replaced queue format/rotation conventions with hook
  architecture description. Updated hook descriptions and known limitations.
  Removed stale references to systemMessage delegation and flock-based flushing.
- **SKILL.md** (ruvector-conventions): Replaced Queue Format section (JSONL
  schema, append rules, rotation, flock) with Hook Architecture section
  describing the CLI delegation pattern.

## Prevention Strategies

### 1. Check for built-in hook/plugin support first

Before reimplementing functionality in a wrapper, always check if the wrapped
tool has built-in integration support:

```bash
npx <tool> hooks --help      # Built-in hook commands?
npx <tool> plugin --help     # Plugin integration API?
npx <tool> integration --help # Integration helpers?
```

This should be the FIRST step when writing hook scripts for any external tool.

### 2. Thin wrapper principle for hook scripts

Claude Code hooks should be thin wrappers that:

1. Parse hook input JSON (via `jq`)
2. Check preconditions (`.ruvector/` exists, CLI available)
3. Delegate to the wrapped tool's CLI
4. Return `{"continue": true}` with optional `systemMessage`

Complex logic (queue management, dedup, rotation, agent delegation) belongs in
the wrapped tool, not the hook. If a hook needs `flock`, queue files, or
multi-step processing, that's a signal the wrapped tool should handle it.

### 3. Verify CLI command signatures empirically

Always run `<tool> <cmd> --help` before writing code that calls CLI commands.
Don't assume flag names or argument order from training data or documentation
that may be outdated.

```bash
npx ruvector hooks post-edit --help    # Discover actual flags
npx ruvector hooks recall --help       # Discover actual query format
```

### 4. Line count as a code smell for hooks

If a Claude Code hook script exceeds ~60 lines, it's likely reimplementing what
the wrapped tool should handle internally. Step back and check for built-in
support before adding more complexity.

| Script          | Before | After | Reduction |
| --------------- | ------ | ----- | --------- |
| session-start   | 167    | 59    | -65%      |
| post-tool-use   | 125    | 53    | -58%      |
| stop            | 53     | 24    | -55%      |
| **Total**       | **345**| **136**| **-61%** |

## Files Changed (5 total)

- `plugins/yellow-ruvector/hooks/scripts/session-start.sh` — Complete rewrite
- `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh` — Complete rewrite
- `plugins/yellow-ruvector/hooks/scripts/stop.sh` — Complete rewrite
- `plugins/yellow-ruvector/CLAUDE.md` — Conventions, hook descriptions, known
  limitations
- `plugins/yellow-ruvector/skills/ruvector-conventions/SKILL.md` — Queue Format
  → Hook Architecture

## Related Documentation

- [ruvector CLI and MCP tool name mismatches](../integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md) —
  Prior fix that discovered the correct CLI commands and MCP tool names
- [yellow-ruvector multi-agent code review](../security-issues/yellow-ruvector-plugin-multi-agent-code-review.md) —
  Earlier security review that established shell script patterns used in hooks
- [yellow-ci shell security patterns](./yellow-ci-shell-security-patterns.md) —
  Shell script security patterns applicable to hook scripts
