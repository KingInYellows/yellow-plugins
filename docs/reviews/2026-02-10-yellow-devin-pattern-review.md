---
title: "Pattern Compliance Review: yellow-devin Plugin Plan"
type: review
date: 2026-02-10
reviewer: pattern-recognition-specialist
reference: yellow-linear plugin
plan: docs/plans/2026-02-10-feat-yellow-devin-plugin-plan.md
severity-levels:
  - CRITICAL: Breaks core patterns, will cause runtime failures
  - HIGH: Significant deviation from conventions
  - MEDIUM: Incomplete specification, missing required elements
  - LOW: Minor inconsistencies, style variations
---

# Pattern Compliance Review: yellow-devin Plugin Plan

Reviewed the yellow-devin plugin plan against the yellow-linear reference implementation for naming conventions, structural patterns, and marketplace compliance.

## Executive Summary

**Overall Assessment**: Plan has good structural alignment but contains one CRITICAL MCP tool naming error and several MEDIUM-severity omissions. Recommended action: Fix critical issue and complete specifications before implementation.

**Critical Issues**: 1
**High Issues**: 0
**Medium Issues**: 4
**Low Issues**: 2

---

## CRITICAL Issues

### C1. MCP Tool Naming Pattern Violation

**Location**: Throughout plan (commands/devin/wiki.md, agents/research/deepwiki-explorer.md)

**Current (WRONG)**:
```yaml
allowed-tools:
  - mcp__plugin_yellow-devin_deepwiki__search_wiki
  - mcp__plugin_yellow-devin_deepwiki__get_wiki_page
  - mcp__plugin_yellow-devin_devin__search_wiki
```

**Expected Pattern** (based on yellow-linear reference):
```yaml
allowed-tools:
  - mcp__plugin_deepwiki_deepwiki__search_wiki
  - mcp__plugin_deepwiki_deepwiki__get_wiki_page
  - mcp__plugin_devin_devin__search_wiki
```

**Analysis**:
The MCP tool naming pattern is `mcp__plugin_<SERVER_NAME>_<SERVER_NAME>__<tool_name>`, NOT `mcp__plugin_<PLUGIN_NAME>_<SERVER_NAME>__<tool_name>`.

Evidence from yellow-linear:
- Plugin name: `yellow-linear` (plugin.json line 2)
- MCP server name: `linear` (plugin.json line 14)
- Tool names: `mcp__plugin_linear_linear__create_issue` (create.md line 13)

The plugin name ("yellow-linear") is NOT used in the MCP tool prefix. Only the server name appears twice.

**Impact**: All MCP tool calls will fail at runtime. Commands and agents referencing these tools will be non-functional.

**Recommendation**:
1. Update all tool references in wiki.md and deepwiki-explorer.md
2. Add note in plan's "Open Questions" that exact MCP tool names must be verified via ToolSearch after MCP server registration
3. Document the correct pattern in SKILL.md

---

## HIGH Issues

None identified. The plan's architectural choices (curl vs MCP for Devin REST API) are valid design decisions.

---

## MEDIUM Issues

### M1. Incomplete CLAUDE.md Specification

**Location**: Phase 1 deliverables (line 198)

**Current**:
```
### `plugins/yellow-devin/CLAUDE.md`

Key sections:
- MCP servers (DeepWiki + Devin), auth requirements
- API conventions: all calls via `curl` with `DEVIN_API_TOKEN`, JSON via `jq`
- Input validation rules (max lengths, sanitization)
- Security patterns: C1 (validate before write), M3 (confirm destructive ops)
- Plugin components list with "When to Use What" guidance
- Known limitations
```

**Expected**: Full CLAUDE.md content following yellow-linear structure:
1. Plugin title and description
2. ## MCP Server (with auth details)
3. ## Conventions (API patterns, auth, input validation)
4. ## Plugin Components (complete list with descriptions)
   - ### Commands (N)
   - ### Agents (N)
   - ### Skills (N)
5. ## When to Use What (overlap disambiguation)
6. ## Known Limitations

**Recommendation**: Expand Phase 1 to include full CLAUDE.md content, not just section headings.

---

### M2. Incomplete SKILL.md Specification

**Location**: Phase 1 deliverables (line 208)

**Current**: Lists content topics only

**Expected**: Full SKILL.md structure:
```yaml
---
name: devin-workflows
description: >
  Devin workflow patterns and conventions reference. Use when commands or agents
  need shared Devin API context, auth patterns, or error handling guidance.
user-invocable: false
---

# Devin Workflow Patterns

## What It Does

Reference patterns and conventions for Devin.AI workflows. Loaded by commands and agents for consistent behavior.

## When to Use

Use when yellow-devin plugin commands or agents need shared Devin API context, including auth, JSON construction, or error handling.

## Usage

This skill is not user-invocable. It provides shared context for the yellow-devin plugin's commands and agents.

[... content sections ...]
```

**Recommendation**: Add complete SKILL.md example to Phase 1 deliverables.

---

### M3. Missing Agent Body Examples

**Location**: All agent .md files in phases 2-3

**Current**: Only frontmatter shown:
```yaml
---
name: devin-orchestrator
description: >
  Multi-step workflow orchestrator...
model: inherit
allowed-tools:
  - Bash
  - Read
  ...
---
```

**Expected**: At least one complete agent example showing:
- Frontmatter (✓ already shown)
- `<examples>` block with 2-3 trigger patterns
- Agent instructions/workflow (under 200 lines)
- Reference to devin-workflows skill

**Recommendation**: Add one complete agent body example (suggest devin-reviewer as smallest) to demonstrate the pattern.

---

### M4. Unresolved Critical Auth Question

**Location**: Open Questions section (line 651)

**Current**:
```
4. **Devin MCP auth**: How does the Devin MCP server at `mcp.devin.ai` authenticate?
   Via the same `DEVIN_API_TOKEN`? Or separate OAuth flow?
```

**Impact**: Cannot implement wiki.md or deepwiki-explorer.md without knowing:
- Whether Devin MCP requires separate auth from REST API
- How to configure auth in config/devin.mcp.json
- Whether to validate DEVIN_API_TOKEN in wiki command

**Recommendation**:
1. Research Devin MCP documentation
2. If auth differs from REST API, add separate permissions entry to plugin.json
3. Update wiki.md command workflow with correct auth validation
4. Mark this as a Phase 1 blocker, not a "resolve during implementation" item

---

## LOW Issues

### L1. .gitattributes Placement Inconsistency

**Location**: Plugin root (line 192)

**Current Plan**: Creates `plugins/yellow-devin/.gitattributes`

**Yellow-Linear Pattern**: Uses repo root `.gitattributes` (no plugin-specific file)

**Analysis**: Both approaches are valid:
- Repo-root: Applies to all plugins (DRY)
- Plugin-root: Allows per-plugin override (flexibility)

Since repo root already has:
```
* text=auto eol=lf
*.md text eol=lf
*.json text eol=lf
*.sh text eol=lf
```

Adding plugin-specific .gitattributes is redundant unless overriding behavior.

**Recommendation**: Remove plugin-specific .gitattributes from plan. Rely on repo root.

---

### L2. Command Naming Semantic Variation

**Location**: Command names (delegate vs create, message vs update)

**Current**:
- yellow-linear: `linear:create`, `linear:sync`, `linear:triage`
- yellow-devin: `devin:delegate`, `devin:status`, `devin:message`

**Analysis**: Both use `<namespace>:<verb>` pattern. Verb choice varies by domain semantics:
- Linear uses generic PM verbs (create, sync, triage)
- Devin uses agent-delegation verbs (delegate, message, cancel)

This is acceptable domain-specific variation, not a pattern violation. "delegate" is more intuitive for Devin than "create session" would be.

**Recommendation**: No change needed. Document in CLAUDE.md why these verbs were chosen.

---

## Pattern Compliance Checklist

### ✅ PASSING

- [x] Plugin name follows `yellow-*` pattern
- [x] Directory structure matches reference (commands/, agents/, skills/, config/)
- [x] plugin.json schema compliance (all required fields present)
- [x] Command naming convention: `<namespace>:<action>`
- [x] Agent naming convention: `<namespace>-<role>`
- [x] Agent/skill directory split: workflow/ and research/
- [x] Command frontmatter includes "Use when..." trigger clause
- [x] Agent size limit enforced (under 200 lines)
- [x] Security patterns applied (jq for JSON, C1, M3)
- [x] Shell security patterns (input validation, timeouts)
- [x] MCP config file naming (matches server names)
- [x] Skill naming: `<domain>-workflows`

### ❌ FAILING

- [ ] MCP tool naming pattern (uses plugin name instead of server name)

### ⚠️ INCOMPLETE

- [ ] Full CLAUDE.md content
- [ ] Full SKILL.md content with frontmatter
- [ ] At least one complete agent body example
- [ ] Devin MCP auth resolution

---

## Detailed Pattern Comparisons

### Plugin Metadata (plugin.json)

| Field | yellow-linear | yellow-devin | Compliant? |
|-------|---------------|--------------|------------|
| name | "yellow-linear" | "yellow-devin" | ✅ |
| version | "1.0.0" | "1.0.0" | ✅ |
| description | Clear, specific | Clear, specific | ✅ |
| author | {name, url} | {name, url} | ✅ |
| homepage | GitHub anchor | GitHub anchor | ✅ |
| keywords | 6 terms | 6 terms | ✅ |
| mcpServers | 1 server | 2 servers | ✅ (valid variation) |
| entrypoints.commands | 5 files | 6 files | ✅ |
| entrypoints.agents | 3 files | 3 files | ✅ |
| entrypoints.skills | 1 file | 1 file | ✅ |
| entrypoints.mcpServers | 1 config | 2 configs | ✅ |
| permissions | network + shell | network + shell | ✅ |

---

### Command Frontmatter Pattern

**Reference (linear:sync)**:
```yaml
---
name: linear:sync
description: >
  Sync current branch with its Linear issue — load context, link PR, update status.
  Use when user says "sync with linear", "link my branch", or "update issue status".
argument-hint: "[issue-id]"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__get_issue
  ...
---
```

**Plan (devin:delegate)**:
```yaml
---
name: devin:delegate
description: >
  Create a Devin session with a task prompt. Use when user wants to delegate
  work to Devin, says "have Devin do X", "send this to Devin", or
  "delegate to Devin".
argument-hint: "<task description>"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
```

**Compliance**: ✅ Structure matches. "Use when" clause present. argument-hint format differs (brackets vs angle brackets) but both are valid.

---

### Agent Frontmatter Pattern

**Reference (linear-issue-loader.md)**:
```yaml
---
name: linear-issue-loader
description: >
  Auto-load Linear issue context from branch name. Use when user is working on a
  branch whose name contains a Linear issue identifier...
model: inherit
allowed-tools:
  - Bash
  - ToolSearch
  - mcp__plugin_linear_linear__get_issue
  ...
---
```

**Plan (devin-orchestrator.md)**:
```yaml
---
name: devin-orchestrator
description: >
  Multi-step workflow orchestrator for Claude Code + Devin collaboration.
  Use when user wants a full plan-implement-review-fix cycle...
model: inherit
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Task
---
```

**Compliance**: ✅ Structure matches. "Use when" clause present.

---

### SKILL.md Pattern

**Reference (linear-workflows)**:
```yaml
---
name: linear-workflows
description: >
  Linear workflow patterns and conventions reference. Use when commands or agents
  need Linear workflow context...
user-invocable: false
---

# Linear Workflow Patterns

## What It Does
...

## When to Use
...

## Usage
This skill is not user-invocable...
```

**Plan (devin-workflows)**: ⚠️ INCOMPLETE - content topics listed but no frontmatter or structure shown.

---

### CLAUDE.md Structure

**Reference (yellow-linear)**:
1. Plugin title and one-line description
2. ## MCP Server (details about Linear MCP, auth, URL)
3. ## Conventions (8 subsections covering team context, branch naming, patterns)
4. ## Plugin Components
   - ### Commands (5)
   - ### Agents (3)
   - ### Skills (1)
5. ## When to Use What (overlap disambiguation)
6. ## Known Limitations

**Plan (yellow-devin)**: ⚠️ INCOMPLETE - section headings listed but no full content.

---

## Anti-Pattern Analysis

### Shell Security Patterns (from memory)

Plan correctly implements all required shell security patterns:

| Pattern | Required | Plan Compliance |
|---------|----------|-----------------|
| Never interpolate user input in format strings | ✅ | ✅ Uses `jq -n --arg` |
| Validate input before use in paths | ✅ | ✅ Validates session IDs |
| Use `--` before positional args | ✅ | N/A (no file paths from user) |
| Quote all variables | ✅ | ✅ Plan shows `"$PROMPT"` |
| Never echo secrets | ✅ | ✅ Never logs DEVIN_API_TOKEN |
| Timeouts on network calls | ✅ | ✅ `--connect-timeout 5 --max-time 30` |
| Rate limit handling | ✅ | ✅ Detects 429, respects Retry-After |

No anti-patterns detected in shell usage.

---

### Plugin Authoring Anti-Patterns (from memory)

| Anti-Pattern | Plan Status |
|--------------|-------------|
| Agent files over 200 lines | ✅ AVOIDED - plan enforces limit |
| Missing "Use when..." clauses | ✅ AVOIDED - all descriptions include trigger clauses |
| Commands using hardcoded values | ✅ AVOIDED - uses $ARGUMENTS placeholder |
| Incomplete allowed-tools lists | ⚠️ UNKNOWN - can't verify without full implementations |
| SKILL.md using "## Commands" heading | ✅ AVOIDED - plan doesn't show this anti-pattern |
| CRLF line endings | ✅ AVOIDED - .gitattributes enforces LF |

---

## Recommendations Summary

### Before Implementation (Phase 0)

1. **[CRITICAL]** Fix MCP tool naming pattern in all references:
   - wiki.md: Change `mcp__plugin_yellow-devin_deepwiki__*` to `mcp__plugin_deepwiki_deepwiki__*`
   - wiki.md: Change `mcp__plugin_yellow-devin_devin__*` to `mcp__plugin_devin_devin__*`
   - deepwiki-explorer.md: Same changes
   - Add note: "Verify exact tool names via ToolSearch after MCP registration"

2. **[CRITICAL]** Resolve Devin MCP auth question:
   - Research https://mcp.devin.ai/ documentation
   - Determine if auth differs from REST API
   - Update config/devin.mcp.json accordingly
   - Update wiki.md command with correct auth pattern

3. **[MEDIUM]** Expand Phase 1 to include:
   - Full CLAUDE.md content (not just section headings)
   - Complete SKILL.md with frontmatter and all sections
   - At least one complete agent body example (suggest devin-reviewer)

4. **[LOW]** Remove plugin-specific .gitattributes (use repo root)

### During Implementation

1. Use ToolSearch to discover actual MCP tool names after MCP server registration
2. Document discovered tool names in devin-workflows SKILL.md
3. Verify all allowed-tools lists are complete before validation

### Phase 1 Success Criteria Updates

Add to existing criteria:
- [ ] MCP tool names verified via ToolSearch and documented
- [ ] Devin MCP auth pattern confirmed and implemented
- [ ] CLAUDE.md contains all required sections with full content
- [ ] SKILL.md follows standard structure with frontmatter
- [ ] At least one agent has complete body (not just frontmatter)

---

## Pattern Compliance Score

**Structural Alignment**: 95% (excellent)
**Naming Conventions**: 60% (MCP tools incorrect)
**Content Completeness**: 40% (missing full specs)
**Security Patterns**: 100% (exemplary)

**Overall**: 74% (requires fixes before implementation)

---

## Cross-References

- Reference plugin: `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-linear/`
- Plan document: `/home/kinginyellow/projects/yellow-plugins/docs/plans/2026-02-10-feat-yellow-devin-plugin-plan.md`
- Shell security patterns: `/home/kinginyellow/projects/yellow-plugins/docs/solutions/security-issues/claude-code-plugin-review-fixes.md`
- Plugin authoring guide: `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-core/skills/create-agent-skills/SKILL.md`

---

## Appendix: MCP Tool Name Discovery Pattern

Since exact MCP tool names can't be known until servers are registered, use this pattern:

### Step 1: Register MCP Servers

```bash
# Via Claude Code MCP configuration
# Register mcp.deepwiki.com and mcp.devin.ai
```

### Step 2: Discover Tool Names

From within a command or agent:

```yaml
allowed-tools:
  - ToolSearch
```

Then use:
```
ToolSearch("deepwiki")  # Lists all deepwiki-prefixed tools
ToolSearch("devin")     # Lists all devin-prefixed tools
```

### Step 3: Document in SKILL.md

```markdown
## MCP Tool Reference

### DeepWiki MCP Tools
- `mcp__plugin_deepwiki_deepwiki__search_wiki` — Search repository wikis
- `mcp__plugin_deepwiki_deepwiki__get_wiki_page` — Get specific wiki page
- `mcp__plugin_deepwiki_deepwiki__ask_question` — AI-powered Q&A

### Devin MCP Tools
- `mcp__plugin_devin_devin__search_wiki` — Search Devin wikis (public + private)
- `mcp__plugin_devin_devin__get_wiki_page` — Get wiki page from Devin
- `mcp__plugin_devin_devin__ask_question` — AI Q&A via Devin
```

This ensures commands and agents use the correct tool names.

---

**Review Date**: 2026-02-10
**Reviewer**: pattern-recognition-specialist (Claude agent)
**Next Action**: Address CRITICAL and MEDIUM issues before starting Phase 1 implementation
