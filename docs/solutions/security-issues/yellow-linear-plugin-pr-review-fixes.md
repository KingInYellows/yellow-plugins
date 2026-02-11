---
title: "Yellow-Linear Plugin PR Review Resolution: 21 Automated Reviewer Comments"
category: security-issues
tags:
  - pr-review
  - plugin-validation
  - mcp-integration
  - linear-plugin
  - config-schema
  - tool-naming
  - automated-reviewers
module: plugins/yellow-linear
symptom: "21 unresolved PR review threads from 3 automated reviewers (Gemini, CodeAnt, Devin) covering non-functional commands, schema violations, inconsistent tool naming, and missing documentation patterns"
root_cause: "Second-pass review caught issues missed in first round: disable-model-invocation left on 2/5 commands, plugin.json missing extended schema fields, commands using short tool names instead of full MCP prefixes, agent docs lacking edge-case guidance"
date: "2026-02-10"
---

# Yellow-Linear Plugin PR Review Resolution

## Problem

PR #6 received 21 unresolved review threads from 3 automated reviewers after the initial multi-agent code review (which fixed 19 issues). The most critical findings:

- **sync.md and plan-cycle.md** had `disable-model-invocation: true`, making them completely non-functional (printed markdown instead of executing)
- **plan-cycle.md and triage.md** were missing `Bash` in `allowed-tools`, breaking team auto-detection
- **plugin.json** was missing required extended schema fields (`entrypoints`, `compatibility`, `permissions`)
- Commands used short tool names (`get_issue`) instead of full MCP-prefixed names (`mcp__plugin_linear_linear__get_issue`)

### Reviewer Breakdown

| Reviewer | Threads | Focus |
|----------|---------|-------|
| Gemini (`gemini-code-assist`) | 5 | Schema/config compliance |
| CodeAnt (`codeant-ai`) | 11 | Documentation quality, tool name consistency |
| Devin (`devin-ai-integration`) | 5 | Functional bugs, documentation accuracy |

## Investigation

Fetched all unresolved threads via GraphQL:

```bash
bash scripts/get-pr-comments 6
```

Read all 11 affected files and categorized threads into 5 groups:

1. **Critical bugs (4):** `disable-model-invocation` flags + missing `Bash` tool
2. **Schema fixes (5):** plugin.json structure + marketplace.json `id` field
3. **Tool name consistency (6):** Short names → full MCP-prefixed names
4. **Agent/skill docs (6):** Edge cases, read-only clarification, SKILL.md headings
5. **Documentation (2):** Review doc accuracy + PR description test plan

## Root Cause

The first review round (19 findings) focused on security patterns (C1 validation, TOCTOU, input sanitization) and caught most issues. This second round caught:

1. **Incomplete first-round fix:** `disable-model-invocation: true` was removed from triage, create, and status — but missed on sync and plan-cycle
2. **Extended schema gap:** plugin.json used minimal official format, not the project's extended schema requiring `entrypoints`, `compatibility`, `permissions`
3. **Naming convention drift:** Commands written with Linear API shorthand before MCP naming requirements were established
4. **Documentation standards gap:** No enforced checklist for agent edge cases or SKILL.md section structure

## Solution

### Approach

All 21 threads were straightforward text edits — no subagent delegation needed. Read all files, made edits directly, committed atomically, then batch-resolved threads.

### Fix 1: Critical Bugs (sync.md, plan-cycle.md, triage.md)

Removed `disable-model-invocation: true` from sync.md and plan-cycle.md. Added `Bash` to `allowed-tools` in plan-cycle.md and triage.md.

### Fix 2: Schema Compliance (plugin.json, marketplace.json)

Rewrote plugin.json with full extended schema:

```json
{
  "entrypoints": {
    "commands": ["commands/linear/create.md", "commands/linear/sync.md", ...],
    "agents": ["agents/workflow/linear-issue-loader.md", ...],
    "skills": ["skills/linear-workflows/SKILL.md"],
    "mcpServers": ["config/linear.mcp.json"]
  },
  "compatibility": { "claudeCodeMin": "2.0.0" },
  "permissions": [
    { "scope": "network", "reason": "...", "domains": ["mcp.linear.app"] },
    { "scope": "shell", "reason": "...", "commands": ["git", "gh"] }
  ]
}
```

Created `config/linear.mcp.json` for external MCP server config. Added `id` field to all 3 marketplace.json entries.

### Fix 3: Tool Name Consistency (sync.md, status.md)

Replaced 8 short tool references with full MCP-prefixed names:
- `get_issue` → `mcp__plugin_linear_linear__get_issue`
- `list_comments` → `mcp__plugin_linear_linear__list_comments`
- `create_comment` → `mcp__plugin_linear_linear__create_comment`
- `list_issue_statuses` → `mcp__plugin_linear_linear__list_issue_statuses`
- `list_initiatives` → `mcp__plugin_linear_linear__list_initiatives`
- `get_initiative` → `mcp__plugin_linear_linear__get_initiative`
- `list_initiative_updates` → `mcp__plugin_linear_linear__list_initiative_updates`
- `create_initiative_update` → `mcp__plugin_linear_linear__create_initiative_update`

### Fix 4: Agent/Skill Documentation

- **linear-explorer.md:** Added "Explicitly state when no relevant issues are found" + clarified read-only constraint
- **linear-issue-loader.md:** Clarified detached HEAD handling + fixed "Recent Comments (3)" → "(up to 5)"
- **linear-pr-linker.md:** Clarified validation-failure stop behavior (stop without calling write tools)
- **SKILL.md:** Added "What It Does" and "When to Use" section headings

### Fix 5: Documentation Accuracy

- Updated review doc to correctly state all 5 commands had `disable-model-invocation` removed
- Fixed PR description test plan from "All 5 commands have `disable-model-invocation: true`" to "No commands have `disable-model-invocation: true`"

### Execution

```bash
# Edit all 11 files, create 1 new file (config/linear.mcp.json)
# Single atomic commit
git commit -m "fix: resolve 21 PR review comments for yellow-linear plugin"

# Push via Graphite
gt submit --no-interactive

# Batch-resolve all 23 threads via GraphQL
for thread_id in <all-ids>; do
  bash scripts/resolve-pr-thread "$thread_id"
done

# Verify
bash scripts/get-pr-comments 6  # Returns []
```

## Files Modified (12)

| File | Changes |
|------|---------|
| `commands/linear/sync.md` | Removed disable flag, 4x full MCP tool names |
| `commands/linear/plan-cycle.md` | Removed disable flag, added Bash |
| `commands/linear/triage.md` | Added Bash to allowed-tools |
| `commands/linear/status.md` | 2x full MCP tool names for initiatives |
| `.claude-plugin/plugin.json` | Full rewrite: entrypoints, compatibility, permissions |
| `.claude-plugin/marketplace.json` | Added `id` to all 3 plugin entries |
| `config/linear.mcp.json` | **NEW** — External MCP server config |
| `agents/research/linear-explorer.md` | No-results guidance, read-only clarification |
| `agents/workflow/linear-issue-loader.md` | Detached HEAD, comments heading |
| `agents/workflow/linear-pr-linker.md` | Validation-failure stop behavior |
| `skills/linear-workflows/SKILL.md` | Added section headings |
| Review doc | Fixed disable-model-invocation scope claim |

## Prevention

### Pre-Submission Checklist (Extended)

Building on the MCP Plugin Security Checklist from the first review round:

- [ ] No `disable-model-invocation: true` on any command that needs LLM execution
- [ ] Every tool referenced in command body is listed in `allowed-tools` (including `Bash`)
- [ ] All MCP tool references use full `mcp__<server>__<tool>` format, never short names
- [ ] `plugin.json` includes `entrypoints`, `compatibility`, `permissions` per extended schema
- [ ] `repository` field is an object `{ "type": "git", "url": "..." }`, not a string
- [ ] `mcpServers` defined in separate config file and referenced via `entrypoints.mcpServers`
- [ ] All marketplace.json plugin entries have `id` field
- [ ] Agent docs include edge case handling (no results, detached HEAD, validation failures)
- [ ] SKILL.md has "What It Does" and "When to Use" headings
- [ ] PR description test plan claims match actual code state

### Automated Reviewer Triage

When handling automated reviewer comments in bulk:

1. **Fetch via GraphQL** — `get-pr-comments` returns only unresolved, non-outdated threads
2. **Read all affected files first** — understand full context before making changes
3. **Categorize by severity** — fix critical bugs first, then schema, then docs
4. **Edit directly for simple changes** — subagents add overhead for text replacements
5. **Single atomic commit** — all related fixes in one commit
6. **Batch-resolve threads** — loop through all thread IDs via `resolve-pr-thread`
7. **Verify empty** — re-run `get-pr-comments` to confirm `[]`

## Related Documentation

- [First review round (19 findings)](./yellow-linear-plugin-multi-agent-code-review.md) — Multi-agent code review for PR #6
- [PR #5 review (yellow-core)](./claude-code-plugin-review-fixes.md) — Shell script security patterns
- [Plugin validation guide](/docs/plugin-validation-guide.md) — Schema and allowed-tools validation
- [Validation guide](/docs/validation-guide.md) — Marketplace catalog validation
- [Skill authoring guide](/plugins/yellow-core/skills/create-agent-skills/SKILL.md) — Agent/skill quality standards
- PR #6: feat: add yellow-linear plugin with 5 commands, 3 agents, and 1 skill
