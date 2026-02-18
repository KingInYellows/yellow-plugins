---
title:
  'Yellow-Linear Plugin Multi-Agent Code Review: Security, Architecture &
  Quality Hardening'
category: security-issues
tags:
  - plugin-quality
  - security-hardening
  - linear-integration
  - mcp-security
  - agent-configuration
  - input-validation
  - code-review-workflow
  - bulk-operations
module: plugins/yellow-linear
symptom:
  'Missing C1 validation before API writes, weak issue ID regex, no $ARGUMENTS
  input sanitization, CRLF line endings, agents missing allowed-tools,
  disable-model-invocation blocking agent accessibility, TOCTOU vulnerabilities
  in bulk operations, code duplication across 6+ files'
root_cause:
  'First-draft plugin implementation lacked security-first design patterns
  adapted from shell-script context (yellow-core) to MCP integration context
  (yellow-linear). No established MCP plugin security checklist existed.'
date: '2026-02-10'
---

# Yellow-Linear Plugin Multi-Agent Code Review

## Problem

PR #6 adds the `yellow-linear` plugin (5 commands, 3 agents, 1 skill)
integrating the Linear MCP server into the Claude Code plugin marketplace. A
6-agent parallel code review identified **19 issues** across security,
architecture, and quality domains that needed resolution before merge.

### Symptoms

- No ownership validation (C1) before `update_issue` calls in triage,
  plan-cycle, and status commands
- Issue ID regex `[A-Z]+-[0-9]+` accepted unbounded input (e.g.,
  `AAAAAAA-999999999`)
- `$ARGUMENTS` used directly without length limits, format validation, or HTML
  stripping
- All 12 files had CRLF line endings (no `.gitattributes`)
- 3 agents missing `allowed-tools` frontmatter (no least-privilege enforcement)
- `disable-model-invocation: true` on 3 commands blocked agent accessibility
- Bulk operations in triage/plan-cycle had weak TOCTOU mitigation
- Team detection bash snippet duplicated in 6 files
- Status command eagerly fetched all projects and milestones without pagination

## Investigation

### Multi-Agent Parallel Review

Launched 6 specialized agents simultaneously for maximum coverage:

| Agent                          | Focus                                     | Findings                                              |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------- |
| pattern-recognition-specialist | Code patterns, duplication, conventions   | CRLF endings, code duplication, regex weakness        |
| architecture-strategist        | Structure, skill extraction, overlap      | Team detection dedup, command/agent overlap docs      |
| security-sentinel              | Input validation, ownership, TOCTOU       | C1 gaps, $ARGUMENTS sanitization, TOCTOU in bulk ops  |
| agent-native-reviewer          | Agent accessibility, tool permissions     | disable-model-invocation, missing allowed-tools       |
| code-simplicity-reviewer       | YAGNI, unnecessary complexity             | Milestone fetch removal, error handling consolidation |
| performance-oracle             | Pagination, batch operations, rate limits | Progressive loading, parallel fetching, rate limiting |

### Findings Synthesis

19 unique findings deduplicated from 6 agent reports:

**P1 Critical (5):** CRLF line endings, missing C1 validation, no input
validation, weak TOCTOU, status command over-fetching

**P2 Important (7):** disable-model-invocation blocking agents, missing
allowed-tools, weak regex, team detection duplication, error handling
duplication, sync/agent overlap, team disambiguation

**P3 Nice-to-have (7):** Skill references in agents, trigger clauses on all
commands, bulk rate limiting docs, input validation section in skill,
exponential backoff in error handling, progressive disclosure pattern, "When to
Use What" docs

## Root Cause

The plugin was authored without adapting security patterns from the shell-script
domain (yellow-core PR #5) to the MCP integration domain. Key gap: no "MCP
plugin security checklist" existed. Shell script patterns (path traversal,
format string injection) were well-documented, but MCP-specific patterns (C1
ownership validation, TOCTOU in API bulk ops, agent tool permissions) had no
established template.

## Solution

### 1. Line Ending Normalization

```bash
# Fix existing files
find plugins/yellow-linear -type f -exec sed -i 's/\r$//' {} +

# Prevent recurrence
cat > .gitattributes << 'EOF'
* text=auto eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
EOF
```

### 2. C1 Validation (Ownership Before Writes)

Added `get_issue` to `allowed-tools` and inserted validation step before every
`update_issue` call in triage, plan-cycle, and status commands:

```markdown
**Validate and apply (C1 + H1):** Before each `update_issue` call:

1. **Validate ownership (C1):** Call `get_issue` to verify the issue exists and
   belongs to the user's workspace. If not found or access denied, skip and
   warn.
2. **Detect concurrent changes (H1):** Compare re-fetched state against what
   user saw. If modified fields changed, present conflict with
   Skip/Override/Cancel.
3. **Apply:** Call `update_issue` only for validated, non-conflicting issues.
4. **Rate limit:** Add brief delay between writes for batches >5 issues.
```

### 3. Input Validation on $ARGUMENTS

Each command now validates its arguments before use:

- **create.md:** Max 500 characters, strip HTML tags
- **triage.md:** Max 200 characters, strip HTML tags
- **plan-cycle.md:** Alphanumeric + spaces + hyphens only, max 100 characters
- **sync.md:** Must match `[A-Z]{2,5}-[0-9]{1,6}` format exactly

Validation rules consolidated in `linear-workflows` skill under "Input
Validation" section.

### 4. TOCTOU Mitigation (H1 Pattern)

Replaced generic "check for concurrent changes" with explicit protocol in triage
and plan-cycle:

1. Batch fetch current state of all selected issues
2. Compare every field being modified against what user saw
3. Present conflicts with specific diff and three options (Skip / Override /
   Cancel All)
4. Rate-limit writes: 200ms delay between updates for batches >5

### 5. Issue ID Regex Hardening

Changed from `[A-Z]+-[0-9]+` (case-insensitive) to `[A-Z]{2,5}-[0-9]{1,6}`
(case-sensitive) across all files: CLAUDE.md, sync.md, issue-loader.md,
pr-linker.md, linear-workflows SKILL.md.

### 6. Agent Accessibility

**Removed `disable-model-invocation: true`** from all 5 commands (triage,
create, status, sync, and plan-cycle). Added "Use when..." trigger clauses to
all 5 commands and 3 agents.

**Added `allowed-tools` frontmatter** to all 3 agents with least-privilege
lists:

- `linear-issue-loader`: `Bash`, `ToolSearch`, `get_issue`, `list_comments`,
  `list_teams`
- `linear-explorer`: `Bash`, `ToolSearch`, `list_issues`, `list_projects`,
  `list_teams`, `list_users`, `list_cycles`
- `linear-pr-linker`: `Bash`, `ToolSearch`, `get_issue`, `update_issue`,
  `create_comment`, `list_issue_statuses`

### 7. Code Deduplication

Replaced team detection bash snippets in 6 files with skill references:

```markdown
Auto-detect team from git remote repo name. Match against `list_teams` (see
"Team Context" in `linear-workflows` skill).
```

Consolidated error handling patterns into `linear-workflows` skill with:

- Exponential backoff: 1s, 2s, 4s for rate limits
- Categorized errors: authentication, rate limiting, not found, validation
- Bulk operation failure recovery

### 8. Status Command Optimization

- Removed milestone fetching (YAGNI — not part of core workflow)
- Added progressive loading: show top 5 projects, offer to load more
- Added parallel fetching guidance for project details + issues simultaneously

### 9. Documentation

- Added "When to Use What" section to CLAUDE.md clarifying command vs agent
  overlap
- Added team disambiguation rules (case-sensitive exact match, prompt on
  multiple)
- Added input validation section to `linear-workflows` skill

## Files Modified

| File                                     | Changes                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `.gitattributes`                         | **NEW** — LF enforcement                                                    |
| `plugins/yellow-linear/CLAUDE.md`        | Team disambiguation, input validation, "When to Use What"                   |
| `commands/linear/triage.md`              | C1+H1 validation, allowed-tools fix, trigger clause, input validation       |
| `commands/linear/plan-cycle.md`          | C1+H1 validation, allowed-tools fix, input validation                       |
| `commands/linear/status.md`              | C1 validation, progressive loading, YAGNI milestone removal                 |
| `commands/linear/create.md`              | Trigger clause, input validation, skill references                          |
| `commands/linear/sync.md`                | Regex fix, input validation, skill references                               |
| `agents/workflow/linear-issue-loader.md` | allowed-tools, regex fix, skill reference                                   |
| `agents/workflow/linear-pr-linker.md`    | allowed-tools, regex fix, skill reference                                   |
| `agents/research/linear-explorer.md`     | allowed-tools, skill reference, read-only enforcement                       |
| `skills/linear-workflows/SKILL.md`       | Regex, team disambiguation, input validation, error handling, rate limiting |
| `.claude-plugin/plugin.json`             | CRLF fix only                                                               |

## Verification

```bash
# All changes validated
pnpm validate:schemas  # All plugins valid

# Line endings verified
find plugins/yellow-linear -type f -exec file {} \; | grep -c CRLF  # 0
```

## Prevention

### MCP Plugin Security Checklist

For future plugins integrating MCP servers:

- [ ] `.gitattributes` with `* text=auto eol=lf`
- [ ] C1 validation: `get_*` before every `update_*` / `create_*` / `delete_*`
      call
- [ ] Input validation: max-length, format regex, HTML stripping on all
      `$ARGUMENTS`
- [ ] TOCTOU mitigation (H1): fetch-compare-prompt-update for bulk operations
- [ ] Rate limiting: delays for batches >5, exponential backoff on 429s
- [ ] Regex hardening: bounded character classes, case-sensitive where
      appropriate
- [ ] Agent `allowed-tools`: least-privilege tool list in frontmatter
- [ ] No `disable-model-invocation: true` on commands that agents should access
- [ ] "Use when..." trigger clause on every agent and command description
- [ ] Code deduplication: common patterns extracted to skills, commands
      reference skills
- [ ] Progressive loading for list operations (top N, offer pagination)

### Multi-Agent Review Pattern

The 6-agent parallel review caught issues no single reviewer would find:

- **Security + Architecture** overlap found C1 gaps and suggested skill
  extraction
- **Performance + Simplicity** overlap identified YAGNI violations and
  pagination needs
- **Agent-native + Pattern** overlap caught accessibility blockers and
  convention violations

Recommended for all plugin PRs going forward.

## Related Documentation

- [PR #5 Review (yellow-core)](./claude-code-plugin-review-fixes.md) —
  Established shell script security patterns
- [Plugin Validation Guide](/docs/plugin-validation-guide.md) — Schema and
  manifest validation rules
- [Validation Guide](/docs/validation-guide.md) — Marketplace catalog validation
- [Skill Authoring Guide](/plugins/yellow-core/skills/create-agent-skills/SKILL.md)
  — Agent/skill quality standards
- PR #6: feat: add yellow-linear plugin with 5 commands, 3 agents, and 1 skill
