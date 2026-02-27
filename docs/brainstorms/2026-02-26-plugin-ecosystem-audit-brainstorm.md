# Plugin Ecosystem Audit & Optimization

**Date:** 2026-02-26
**Status:** Ready for planning

## What We're Building

A comprehensive audit and fix pass across all 11 yellow-plugins to ensure cohesive operation, correct Claude Code configuration, validated scripts, and optimized descriptions. This addresses issues discovered during a full ecosystem scan.

## Why This Approach

Category-based PRs (grouped by issue type, not by plugin) provide clean review boundaries and atomic rollback. Each PR addresses one class of issue across all affected plugins.

## Key Decisions

1. **Scope:** Fix everything — critical, moderate, and minor issues
2. **Script audit:** Full validation of all hook scripts against MEMORY.md patterns
3. **Context7 wiring:** Rewire yellow-research to use yellow-core's context7 (`mcp__plugin_yellow-core_context7__*`) instead of external compound-engineering reference
4. **Cross-plugin deps:** Improve documentation only (no runtime checks). Standardize CLAUDE.md dependency sections
5. **Delivery:** One PR per issue category

## Findings by Category

### PR 1: MCP Tool Prefix Fixes (Critical)

Affected plugins: yellow-linear, yellow-chatprd, yellow-devin, yellow-ci (report-linear), yellow-research (context7)

**Problem:** Commands and agents reference MCP tools using incorrect prefixes that omit the plugin name. Correct formula: `mcp__plugin_{pluginName}_{serverName}__{toolName}`.

| Plugin | Current prefix | Correct prefix |
|---|---|---|
| yellow-linear | `mcp__plugin_linear_linear__*` | `mcp__plugin_yellow-linear_linear__*` |
| yellow-chatprd | `mcp__plugin_chatprd_chatprd__*` | `mcp__plugin_yellow-chatprd_chatprd__*` |
| yellow-devin (devin) | `mcp__plugin_devin_devin__*` | `mcp__plugin_yellow-devin_devin__*` |
| yellow-devin (deepwiki) | `mcp__plugin_deepwiki_deepwiki__*` | `mcp__plugin_yellow-devin_deepwiki__*` |
| yellow-ci (report-linear) | `mcp__plugin_linear_linear__*` | `mcp__plugin_yellow-linear_linear__*` |
| yellow-research (context7) | `mcp__plugin_compound-engineering_context7__*` | `mcp__plugin_yellow-core_context7__*` |

**Files to update:** All command `.md` and agent `.md` files in these plugins that contain `allowed-tools` lists with MCP tool references. Also fix the incorrect formula documentation in yellow-devin's wiki.md.

### PR 2: Folded Scalar Description Fixes (Moderate)

Affected plugins: yellow-ruvector, yellow-browser-test, yellow-linear, yellow-chatprd, yellow-ci, yellow-debt (if any), yellow-review

**Problem:** `description: >` (YAML folded scalar) and multi-line single-quoted strings silently truncate at first newline in Claude Code's frontmatter parser. Descriptions must be single-line.

**Scope:** ~30+ command and agent `.md` files. Convert all folded scalar descriptions to single-line strings.

### PR 3: Hook Script Validation (Moderate)

Plugins with hooks: gt-workflow (2 scripts), yellow-ruvector (4 scripts), yellow-ci (1 script), yellow-debt (1 script)

**Validate against MEMORY.md patterns:**
- `set -e` must NOT be used in hooks that output JSON — use `set -uo pipefail`
- `json_exit()` helper pattern for centralized exits
- `command -v jq` check at top of scripts using jq
- SessionStart hooks must output `{"continue": true}` on ALL error paths
- PostToolUse field paths: `.tool_input.command` and `.tool_result.exit_code`
- EXIT_CODE jq-parse fallback must fail-closed (default to 1, not 0)
- `CLAUDE_PROJECT_DIR` unset warning in SessionStart hooks
- Prompt injection fencing for untrusted content
- CRLF line ending check

### PR 4: Documentation & Consistency Fixes (Minor)

**Issues to address:**
- gt-workflow: Remove `.git` suffix from repository URL in plugin.json
- gt-workflow: Add timeout to PreToolUse hook definition
- yellow-ruvector: Add `_comment` to hooks/hooks.json
- yellow-linear: Document `delegate` and `sync-all` commands in CLAUDE.md
- Standardize cross-plugin dependency documentation in CLAUDE.md files
- yellow-core: Consider wiring context7 MCP tools into `best-practices-researcher` agent's `allowed-tools`

## Open Questions

- None — all decisions captured above.

## Next Steps

Run `/workflows:plan` to generate implementation plans for each PR category.
