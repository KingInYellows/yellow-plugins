---
title: "fix: Plugin ecosystem audit — MCP prefixes, descriptions, hooks, docs"
type: fix
date: 2026-02-26
---

# Plugin Ecosystem Audit

## Overview

Comprehensive audit and fix pass across all 11 yellow-plugins addressing 4 categories of issues: incorrect MCP tool prefixes (runtime breakage for marketplace users), silently truncated YAML descriptions, unsafe hook script patterns, and documentation drift. Organized as 4 category-based PRs landing in dependency order.

## Problem Statement

1. **MCP tool prefixes** in 3 plugins use shortened names that omit the plugin name segment, causing silent tool-call failures for any user who installs these plugins from the marketplace (works for the author only because of separate global MCP installs).
2. **YAML folded scalar descriptions** (`description: >`) in 35 files are silently truncated by Claude Code's frontmatter parser, meaning commands/agents have incomplete or missing descriptions visible to the LLM.
3. **Hook scripts** in yellow-ruvector use `set -eu` which can exit before printing required `{"continue": true}` JSON, potentially blocking session startup.
4. **Documentation drift** across several plugins: undocumented commands, missing timeouts, inconsistent URLs, missing cross-plugin dependency documentation.

## Proposed Solution

Four PRs, each addressing one class of issue across all affected plugins. Landing order: **PR 3 → PR 1 → PR 2 → PR 4** based on severity and dependency analysis.

## Landing Order Rationale

- **PR 3 first:** Hook `set -eu` can block entire sessions (SessionStart) — highest runtime severity, orthogonal to other PRs (no file overlap)
- **PR 1 second:** MCP prefix mismatches cause silent tool-call failures — second-highest severity. Files that need BOTH prefix fix and scalar fix are handled here to avoid double-touching
- **PR 2 third:** Folded scalar truncation is a load-time defect (visible but not session-blocking). Only handles files NOT already fixed in PR 1
- **PR 4 last:** Documentation-only changes; depends on PR 1 (correct prefixes for newly documented commands) and PR 3 (accurate hooks.json comment)

---

## PR 3: Hook Script Validation

**Branch:** `fix/hook-script-validation`

### Scope

8 hook scripts + 3 shared libs across 4 plugins.

### Hook Classification

| Script | Plugin | Hook Type | Has `set -e`? | Needs `json_exit()`? |
|---|---|---|---|---|
| `hooks/scripts/session-start.sh` | yellow-ruvector | SessionStart | YES (`set -eu`) | YES |
| `hooks/scripts/user-prompt-submit.sh` | yellow-ruvector | UserPromptSubmit | YES (`set -eu`) | YES |
| `hooks/scripts/post-tool-use.sh` | yellow-ruvector | PostToolUse | YES (`set -eu`) | YES |
| `hooks/scripts/stop.sh` | yellow-ruvector | Stop | YES (`set -eu`) | YES |
| `hooks/scripts/session-start.sh` | yellow-ci | SessionStart | NO (correct) | Has it |
| `hooks/scripts/session-start.sh` | yellow-debt | SessionStart | NO (correct) | Has it |
| `hooks/check-commit-message.sh` | gt-workflow | PostToolUse | NO (correct) | Has `exit_ok` |
| `hooks/check-git-push.sh` | gt-workflow | PreToolUse | NO (correct) | N/A (blocking) |

### Tasks

#### 3.1 Fix yellow-ruvector hook scripts (4 files)

For each of the 4 scripts:

- [ ] Replace `set -eu` with `set -uo pipefail`
- [ ] Add comment: `# Note: -e omitted intentionally — hook must output {"continue": true} on all paths`
- [ ] Add `json_exit()` helper function at top (after `set` line):
  ```bash
  json_exit() {
    local msg="${1:-}"
    [ -n "$msg" ] && printf '[ruvector] %s\n' "$msg" >&2
    printf '{"continue": true}\n'
    exit 0
  }
  ```
- [ ] Replace all bare `exit 0` / early returns with `json_exit "reason"`
- [ ] Verify `command -v jq` check exists at top of scripts that use jq
- [ ] Verify PostToolUse field paths: `.tool_input.command`, `.tool_result.exit_code` in `post-tool-use.sh`
- [ ] Verify `CLAUDE_PROJECT_DIR` unset warning in `session-start.sh`

Files:
- `plugins/yellow-ruvector/hooks/scripts/session-start.sh`
- `plugins/yellow-ruvector/hooks/scripts/user-prompt-submit.sh`
- `plugins/yellow-ruvector/hooks/scripts/post-tool-use.sh`
- `plugins/yellow-ruvector/hooks/scripts/stop.sh`

#### 3.2 Validate shared libs (3 files)

Shared libs are sourced, not executed directly. They must NOT:
- Use `set -e` (would propagate to sourcing script)
- Output `{"continue": true}` (that's the caller's job)
- Use `exit` (would terminate the sourcing script unexpectedly)

Validate:
- [ ] `plugins/yellow-ruvector/hooks/scripts/lib/validate.sh` — no `set -e`, no bare `exit`
- [ ] `plugins/yellow-ci/hooks/scripts/lib/validate.sh` — no `set -e`, no bare `exit`
- [ ] `plugins/yellow-ci/hooks/scripts/lib/redact.sh` — no `set -e`, no bare `exit`

#### 3.3 Validate already-correct hooks (4 files)

Spot-check that these maintain correct patterns:
- [ ] `plugins/yellow-ci/hooks/scripts/session-start.sh` — confirm `json_exit()` pattern, `set -uo pipefail`
- [ ] `plugins/yellow-debt/hooks/scripts/session-start.sh` — confirm `json_exit()` pattern, `set -uo pipefail`
- [ ] `plugins/gt-workflow/hooks/check-commit-message.sh` — confirm `exit_ok` pattern, `set -uo pipefail`
- [ ] `plugins/gt-workflow/hooks/check-git-push.sh` — confirm blocking exit pattern

#### 3.4 Validate non-hook scripts (2 files)

These are standalone scripts (not hooks) — different rules:
- [ ] `plugins/yellow-ruvector/scripts/install.sh` — general shell safety check
- [ ] `plugins/yellow-browser-test/scripts/install-agent-browser.sh` — general shell safety check
- [ ] `plugins/yellow-core/skills/git-worktree/scripts/worktree-manager.sh` — general shell safety check

#### 3.5 Run existing tests

- [ ] Run `plugins/yellow-ruvector/tests/` test suite
- [ ] Run `plugins/yellow-ci/tests/` test suite
- [ ] Run `plugins/yellow-debt/tests/` test suite (if exists)
- [ ] Run `pnpm validate:schemas` to confirm no manifest breakage

---

## PR 1: MCP Tool Prefix Fixes + Overlapping Scalar Fixes

**Branch:** `fix/mcp-tool-prefixes`

### Prefix Lookup Table (Authoritative)

| Plugin | Server Key | Correct Prefix |
|---|---|---|
| yellow-linear | `linear` | `mcp__plugin_yellow-linear_linear__` |
| yellow-chatprd | `chatprd` | `mcp__plugin_yellow-chatprd_chatprd__` |
| yellow-devin | `devin` | `mcp__plugin_yellow-devin_devin__` |
| yellow-devin | `deepwiki` | `mcp__plugin_yellow-devin_deepwiki__` |
| yellow-core | `context7` | `mcp__plugin_yellow-core_context7__` |

### Find-and-Replace Operations

| Old Prefix | New Prefix | Scope |
|---|---|---|
| `mcp__plugin_linear_linear__` | `mcp__plugin_yellow-linear_linear__` | yellow-linear, yellow-chatprd, yellow-ci, yellow-debt |
| `mcp__plugin_chatprd_chatprd__` | `mcp__plugin_yellow-chatprd_chatprd__` | yellow-chatprd |
| `mcp__plugin_devin_devin__` | `mcp__plugin_yellow-devin_devin__` | yellow-devin |
| `mcp__plugin_deepwiki_deepwiki__` | `mcp__plugin_yellow-devin_deepwiki__` | yellow-devin |
| `mcp__plugin_compound-engineering_context7__` | `mcp__plugin_yellow-core_context7__` | yellow-research |

### Tasks

#### 1.1 Fix yellow-linear (10 files — all also need scalar fix)

For each file: fix MCP prefix AND convert `description: >` to single-line string.

Commands (7):
- [ ] `plugins/yellow-linear/commands/linear/create.md`
- [ ] `plugins/yellow-linear/commands/linear/delegate.md`
- [ ] `plugins/yellow-linear/commands/linear/plan-cycle.md`
- [ ] `plugins/yellow-linear/commands/linear/status.md`
- [ ] `plugins/yellow-linear/commands/linear/sync.md`
- [ ] `plugins/yellow-linear/commands/linear/sync-all.md`
- [ ] `plugins/yellow-linear/commands/linear/triage.md`

Agents (3 — 2 need scalar fix):
- [ ] `plugins/yellow-linear/agents/workflow/linear-issue-loader.md`
- [ ] `plugins/yellow-linear/agents/workflow/linear-pr-linker.md` (also scalar fix)
- [ ] `plugins/yellow-linear/agents/research/linear-explorer.md` (also scalar fix)

#### 1.2 Fix yellow-chatprd (8 files — all also need scalar fix)

Commands (6):
- [ ] `plugins/yellow-chatprd/commands/chatprd/create.md`
- [ ] `plugins/yellow-chatprd/commands/chatprd/link-linear.md` (references BOTH chatprd AND linear prefixes)
- [ ] `plugins/yellow-chatprd/commands/chatprd/list.md`
- [ ] `plugins/yellow-chatprd/commands/chatprd/search.md`
- [ ] `plugins/yellow-chatprd/commands/chatprd/setup.md`
- [ ] `plugins/yellow-chatprd/commands/chatprd/update.md`

Agents (2):
- [ ] `plugins/yellow-chatprd/agents/workflow/document-assistant.md`
- [ ] `plugins/yellow-chatprd/agents/workflow/linear-prd-bridge.md` (references BOTH chatprd AND linear prefixes)

#### 1.3 Fix yellow-devin (1 file)

- [ ] `plugins/yellow-devin/commands/devin/wiki.md` — fix both `mcp__plugin_deepwiki_deepwiki__` and `mcp__plugin_devin_devin__` prefixes. Also fix the incorrect formula documentation in the command body if present.

#### 1.4 Fix cross-plugin Linear references (2 files)

- [ ] `plugins/yellow-ci/commands/ci/report-linear.md` — `mcp__plugin_linear_linear__` → `mcp__plugin_yellow-linear_linear__`
- [ ] `plugins/yellow-debt/commands/debt/sync.md` — `mcp__plugin_linear_linear__` → `mcp__plugin_yellow-linear_linear__`

#### 1.5 Rewire yellow-research context7 (2 files)

- [ ] `plugins/yellow-research/agents/research/code-researcher.md` — `mcp__plugin_compound-engineering_context7__` → `mcp__plugin_yellow-core_context7__`
- [ ] `plugins/yellow-research/commands/research/code.md` — same prefix replacement

Also update yellow-research CLAUDE.md to note the dependency is now on yellow-core (not compound-engineering).

#### 1.6 Check CLAUDE.md files for stale prefixes

- [ ] `grep -r 'mcp__plugin_linear_linear\|mcp__plugin_chatprd_chatprd\|mcp__plugin_devin_devin\|mcp__plugin_deepwiki_deepwiki\|mcp__plugin_compound-engineering_context7' plugins/*/CLAUDE.md` — fix any matches

#### 1.7 Validate

- [ ] `rg 'mcp__plugin_linear_linear__' plugins/` — expect 0 matches
- [ ] `rg 'mcp__plugin_chatprd_chatprd__' plugins/` — expect 0 matches
- [ ] `rg 'mcp__plugin_devin_devin__' plugins/` — expect 0 matches
- [ ] `rg 'mcp__plugin_deepwiki_deepwiki__' plugins/` — expect 0 matches
- [ ] `rg 'mcp__plugin_compound-engineering_context7__' plugins/` — expect 0 matches
- [ ] `pnpm validate:schemas`

---

## PR 2: Remaining Folded Scalar Description Fixes

**Branch:** `fix/folded-scalar-descriptions`

Files that were already fixed in PR 1 are excluded. This PR handles the remaining scalar-only files.

### Scalar Conversion Rule

When converting `description: >` to single-line:
1. Join all continuation lines with spaces into a single string
2. If the result contains colons, wrap in double quotes
3. If the result contains double quotes, wrap in single quotes
4. Keep the full semantic content — do not truncate
5. Target: under 200 characters preferred, up to 300 acceptable for complex descriptions

### Files (scalar-only — no prefix issues)

#### yellow-ruvector (6 commands)
- [ ] `plugins/yellow-ruvector/commands/ruvector/search.md`
- [ ] `plugins/yellow-ruvector/commands/ruvector/index.md`
- [ ] `plugins/yellow-ruvector/commands/ruvector/status.md`
- [ ] `plugins/yellow-ruvector/commands/ruvector/learn.md`
- [ ] `plugins/yellow-ruvector/commands/ruvector/setup.md`
- [ ] `plugins/yellow-ruvector/commands/ruvector/memory.md`

#### yellow-browser-test (4 commands)
- [ ] `plugins/yellow-browser-test/commands/browser-test/test.md`
- [ ] `plugins/yellow-browser-test/commands/browser-test/setup.md`
- [ ] `plugins/yellow-browser-test/commands/browser-test/report.md`
- [ ] `plugins/yellow-browser-test/commands/browser-test/explore.md`

#### yellow-ci (scalar-only files — report-linear already in PR 1)
- [ ] `plugins/yellow-ci/commands/ci/runner-health.md`
- [ ] `plugins/yellow-ci/commands/ci/diagnose.md`
- [ ] `plugins/yellow-ci/commands/ci/status.md`
- [ ] `plugins/yellow-ci/commands/ci/lint-workflows.md`
- [ ] `plugins/yellow-ci/commands/ci/runner-cleanup.md`
- [ ] `plugins/yellow-ci/agents/maintenance/runner-diagnostics.md`
- [ ] `plugins/yellow-ci/agents/ci/failure-analyst.md`
- [ ] `plugins/yellow-ci/agents/ci/workflow-optimizer.md`

#### yellow-review (1 command)
- [ ] `plugins/yellow-review/commands/review/resolve-pr.md`

### Validate

- [ ] `rg '^description: [>|]' plugins/` — expect 0 matches
- [ ] `pnpm validate:schemas`

---

## PR 4: Documentation & Consistency Fixes

**Branch:** `fix/docs-and-consistency`

### Tasks

#### 4.1 gt-workflow consistency
- [ ] Remove `.git` suffix from `repository` URL in `plugins/gt-workflow/.claude-plugin/plugin.json`
- [ ] Add `"timeout": 1` to the PreToolUse hook definition in `plugins/gt-workflow/.claude-plugin/plugin.json` (matching the PostToolUse timeout of 1s)

#### 4.2 yellow-ruvector hooks.json comment
- [ ] Add `"_comment": "Reference only — Claude Code reads inline hooks from plugin.json"` to `plugins/yellow-ruvector/hooks/hooks.json`

#### 4.3 yellow-linear CLAUDE.md updates
- [ ] Document the `delegate` command in the Commands section
- [ ] Document the `sync-all` command in the Commands section

#### 4.4 Standardize cross-plugin dependency documentation

For each plugin that depends on another, ensure CLAUDE.md has a `## Cross-Plugin Dependencies` section with:
- Required plugin name
- Which commands/agents need it
- Graceful degradation behavior

Plugins to update:
- [ ] `plugins/yellow-chatprd/CLAUDE.md` — verify yellow-linear dependency documented
- [ ] `plugins/yellow-ci/CLAUDE.md` — add yellow-linear dependency for `report-linear`
- [ ] `plugins/yellow-debt/CLAUDE.md` — verify yellow-linear dependency for `sync`
- [ ] `plugins/yellow-research/CLAUDE.md` — update from compound-engineering to yellow-core for context7
- [ ] `plugins/yellow-review/CLAUDE.md` — verify yellow-core dependency documented

#### 4.5 yellow-core context7 wiring consideration
- [ ] Add `mcp__plugin_yellow-core_context7__resolve-library-id` and `mcp__plugin_yellow-core_context7__query-docs` to `best-practices-researcher` agent's `allowed-tools` (it currently uses WebSearch/WebFetch but context7 is available in the session)
- [ ] Add `ToolSearch` to allowed-tools if not present

#### 4.6 Validate
- [ ] `pnpm validate:schemas`
- [ ] Review all modified CLAUDE.md files for accuracy

---

## Acceptance Criteria

- [ ] All MCP tool prefixes follow the formula `mcp__plugin_{pluginName}_{serverName}__{toolName}` — verified by `rg` returning 0 matches for old prefixes
- [ ] No `.md` files under `plugins/` use `description: >` or `description: |` — verified by `rg '^description: [>|]' plugins/` returning 0 matches
- [ ] All hook scripts that output JSON use `set -uo pipefail` (no `-e`) and define a `json_exit()` helper
- [ ] `pnpm validate:schemas` passes after all 4 PRs land
- [ ] All cross-plugin dependencies are documented in CLAUDE.md files
- [ ] yellow-linear CLAUDE.md documents all 7 commands

## References

- Brainstorm: `docs/brainstorms/2026-02-26-plugin-ecosystem-audit-brainstorm.md`
- MCP naming: `docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md`
- Hook patterns: `docs/solutions/code-quality/hook-set-e-and-json-exit-pattern.md`
- Frontmatter: `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
- Plugin validation: `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`
