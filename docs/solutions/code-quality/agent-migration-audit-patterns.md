---
title: 'Agent Migration Audit Patterns'
date: 2026-02-25
category: 'code-quality'
tags:
  - agent-authoring
  - refactoring
  - migration
  - tool-restrictions
  - invocation-sites
  - cwd
  - pr-review
  - yellow-core
pr_url: 'https://github.com/KingInYellows/yellow-plugins/pull/71'
---

# Agent Migration Audit Patterns

3 patterns discovered during PR #71 review of `feat/knowledge-compounder-agent`
(migrating `learning-compounder` inline logic to a dedicated `knowledge-compounder`
agent). All patterns apply to any refactor that extracts agent logic into a new file.

## Problem

When logic is extracted from an inline section of one file (e.g., a step inside
a command or orchestrator) into a dedicated agent file, several categories of
silent breakage occur:

1. Not all invocation sites are updated to reference the new agent
2. Per-phase tool restrictions that were enforced by the original file's structure
   are not reproduced in the new agent file
3. Path checks written relative to CWD fail in the new agent's spawn context

These bugs are silent — the command runs, the LLM proceeds, and the failure
surfaces as wrong behavior rather than an error.

## Detection

Before merging any PR that extracts logic to a new agent file:

- `grep -r "step 10\|compound\|learning-compounder\|<old-name>"` across ALL
  command and orchestrator files that previously contained the inline logic.
  Every invocation site must reference the new agent.
- Diff the original inline section's tool list against the new agent's
  `allowed-tools`. Every restriction (e.g., Phase 1 read-only: `[Read, Grep, Glob]`)
  must be explicitly reproduced.
- Grep the new agent file for any path that does not start with `$GIT_ROOT` or
  an absolute variable. Relative paths like `docs/solutions` are CWD-dependent.

---

## S1 — Audit All Invocation Sites When Extracting Logic

**Problem:** `review-pr.md` had a Step 10 that called the inline compounding
logic. When the logic was extracted to `knowledge-compounder`, `review-all.md`
was updated to spawn the new agent, but `review-pr.md` Step 10 was silently
deleted instead of updated. The single-PR flow lost compounding entirely.

**Fix:** When extracting inline logic to a dedicated agent, enumerate all
callers before starting the migration. A simple grep is sufficient:

```bash
grep -r "step 10\|compound\|<old-inline-name>" \
  plugins/<plugin>/commands/ plugins/<plugin>/agents/
```

After migration, every result must either reference the new agent or have a
documented reason for omission.

**Rule:** Extracting logic to a new file does not automatically update all
callers. Enumerate callers first; update all of them.

---

## S2 — Reproduce Per-Phase Tool Restrictions in the New Agent

**Problem:** The original `compound.md` restricted Phase 1 extraction subagents
to `allowed-tools: [Read, Grep, Glob]` — no Write, Edit, or Task. This
prevented accidental file mutations during the read-only analysis phase. When
the logic was moved to `knowledge-compounder.md`, the restriction was not
reproduced. The new agent's Phase 1 subagents inherited the full tool set.

**Fix:** Treat every security or safety constraint in the original as a
migration checklist item:

```
[ ] Phase X tool restriction: [Read, Grep, Glob] only — reproduced in new agent
[ ] Prompt injection fences — all four components present in new agent
[ ] M3 confirmation gates — reproduced with explicit cancel handlers
[ ] mkdir -p before Write — reproduced in new agent
[ ] Post-Write existence check — reproduced in new agent
```

Run a structural diff between the original inline section and the new agent
file, looking specifically for security constraints (allowed-tools lists,
AskUserQuestion gates, injection fences).

**Rule:** When migrating multi-phase logic, audit each security and safety
constraint from the original. Constraints are silent — their absence produces
no error, only subtly wrong behavior.

---

## S3 — Establish GIT_ROOT Before Any Path Operations

**Problem:** The new `knowledge-compounder.md` used a relative path
(`docs/solutions`) in its Phase 0 existence check. When spawned as a subagent
via Task, CWD is determined by the spawn context and may not be the repo root.
The check silently found no existing docs and proceeded as if starting fresh.

**Fix:** Establish `GIT_ROOT` as the first executable step in any agent that
operates on repo paths:

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  printf '[knowledge-compounder] Error: not inside a git repo.\n' >&2
  exit 1
}
```

Then use only absolute paths derived from `$GIT_ROOT`:

```bash
# WRONG
[ -d "docs/solutions" ]

# RIGHT
[ -d "$GIT_ROOT/docs/solutions" ]
```

**Rule:** In any agent that can be spawned as a subagent, CWD is unknown at
authoring time. Always establish `GIT_ROOT` first and derive all paths from it.
This applies to `mkdir -p`, `[ -f ]`, `[ -d ]`, Write target paths, and any
Bash path construction.

---

## Prevention

### Pre-Commit Checklist for Agent Extraction Refactors

Before committing a PR that moves inline logic to a new agent file:

- [ ] All callers of the original inline logic identified via `grep`
- [ ] Every caller updated to reference the new agent (none silently deleted)
- [ ] New agent file has explicit `GIT_ROOT` derivation as its first executable step
- [ ] All paths in the new agent use `$GIT_ROOT/...` not relative paths
- [ ] Per-phase tool restrictions from the original are reproduced in the new agent
- [ ] Prompt injection fences (all 4 components) reproduced in the new agent
- [ ] M3 confirmation gates with explicit cancel handlers reproduced
- [ ] `mkdir -p "$GIT_ROOT/<dir>"` before every Write in the new agent
- [ ] Post-Write `[ -f "$TARGET" ]` existence checks reproduced in the new agent

### When to Run

- On any PR whose title contains "extract", "migrate", "move", "refactor", or
  "rename" applied to agent or command files
- When an agent goes from inline steps → dedicated `.md` file
- When a command delegates to a new agent where it previously ran inline logic

---

## Related Documentation

- `docs/solutions/code-quality/brainstorm-orchestrator-agent-authoring-patterns.md` —
  S1 (exit 1), S2 (injection fence sandwich), S4 (M3 cancel path), S5 (post-Write check)
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` —
  subagent_type naming, ToolSearch for deferred tools, allowed-tools scope
- `docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md` —
  Task delegation patterns, allowed-tools placement

**MEMORY.md sections:**
- "Multi-Phase Orchestrator Agent Patterns" — exit 1, injection fence, M3 cancel, post-Write check
- "Command File Anti-Patterns" — subagent_type naming, ToolSearch requirement
- "Agent Workflow Security Patterns" — path traversal in derived paths
