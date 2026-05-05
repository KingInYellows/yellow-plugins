## What We're Building

> **Historical record (2026-05-04).** This document is the pre-verification
> audit of the `semgrep-mcp-migration` plan. The runtime verification step
> (Phase 1.2) has since been completed — see the same PR that introduces
> this doc for the closing changes. The "1 item genuinely remaining"
> framing below describes state at audit time, not current state.

A completion audit for the `semgrep-mcp-migration` plan. The migration replaced
the deprecated `uvx semgrep-mcp` standalone package with the built-in
`semgrep mcp` subcommand (available in semgrep v1.146.0+). This document
captures the true remaining scope after cross-referencing the plan file against
actual codebase state.

## Why This Approach

The plan banner and checkbox state were significantly out of date. A direct
codebase audit showed that Phase 2 (version checks in setup.md) and all of
Phase 4 (documentation updates) are fully implemented despite being marked open
in the plan. The only remaining work is a single runtime verification step that
cannot be automated without a live semgrep install.

## Remaining Work

### Punch List (as of 2026-05-04)

**Genuinely remaining: 1 item**

#### 1.2 — Runtime tool name verification (open, cannot be resolved without live semgrep)

The plan requires: install semgrep >= 1.146.0 locally, run `semgrep mcp`, and
confirm that the 8 tool names exposed by the built-in MCP server match the
names referenced throughout the plugin.

Expected tool names hard-coded in `setup.md` Step 5 (the only file that
listed all 8 by name; `CLAUDE.md` listed them in its "Provides:" bullet,
but `commands/` and `agents/` reference individual tools by their MCP
prefix at point-of-use rather than via a central list):

- `semgrep_scan`
- `semgrep_findings`
- `semgrep_scan_with_custom_rule`
- `get_abstract_syntax_tree`
- `semgrep_rule_schema`
- `get_supported_languages`
- `semgrep_scan_supply_chain`
- `semgrep_whoami`

If any names differ: update all references in scan.md, fix.md, fix-batch.md,
finding-fixer.md, scan-verifier.md, setup.md Step 5 expected list, CLAUDE.md
tool list, and SKILL.md (semgrep-conventions). The grep pattern to find all
current references:

```
rg "semgrep_scan|semgrep_findings|semgrep_scan_with_custom|get_abstract_syntax|semgrep_rule_schema|get_supported_languages|semgrep_scan_supply|semgrep_whoami" plugins/yellow-semgrep/
```

**Verdict:** Until this runtime check is done, all tool-name references are
assumed correct (no contradicting evidence found). If the built-in server uses
identical names to the former standalone package, this item closes with no file
changes.

---

### Items Completed But Marked Open in Plan (plan/code drift)

These were listed as outstanding in the plan banner and Phase 2/4 checkboxes
but are fully implemented in the codebase:

| Plan Item | Status | Evidence |
|---|---|---|
| 2.1 `MIN_SEMGREP_VERSION` constant in setup.md | Done | Line 69 of setup.md: `MIN_SEMGREP_VERSION="1.146.0"` |
| 2.2 Version comparison after semgrep install | Done | `version_gte()` function + AskUserQuestion branch in Step 0 |
| 2.3 Step 5 diagnostics (version-aware MCP failure messages) | Done | setup.md lines 228-234 |
| 4.1 CLAUDE.md MCP Servers section | Done | "Built-in MCP server via `semgrep mcp` (requires v1.146.0+)" |
| 4.2 README.md prerequisites | Done | Version table present; 1.146.0+ referenced |
| 4.3 semgrep-conventions SKILL.md | Done | No `uvx` or `semgrep-mcp` references found |
| 4.4 setup.md Step 5 expected tool list | Done | All 8 tools listed with full MCP prefix |
| 4.5 CHANGELOG.md migration entry | Done | v2.0.0 entry documents the breaking change |

The plan banner text ("Outstanding work: tool name validation (Phase 1.2) and
documentation updates (Phase 4)") should be updated to reflect that Phase 4 is
complete and Phase 2 is complete. Only 1.2 remains.

### Stale References (not bugs, but worth noting)

- CHANGELOG.md has `uvx semgrep-mcp` in the migration description text under
  v2.0.0 — this is intentional historical context, not a stale active reference.
- CLAUDE.md line 32 mentions "The standalone `semgrep-mcp` PyPI package was
  archived Oct 2025" — correct historical note, not a stale active reference.

## Key Decisions

1. **Plan banner update is low priority.** The stale banner is cosmetic. The
   actual code is correct. Update it when closing 1.2 so both land together.

2. **Tool name verification approach.** Two viable paths:
   - Run `semgrep mcp --tools` or inspect MCP server JSON schema locally (fast,
     requires semgrep installed)
   - Trust that the Semgrep team preserved tool names when moving from standalone
     to built-in (low risk given active usage, no reported breakage)
   The pragmatic path is to do the live check once and close 1.2 if names match.

3. **No further code changes needed** unless tool name verification reveals a
   mismatch. The migration is functionally complete.

## Open Questions

1. **Have any users reported MCP tool failures post-migration?** If not, the
   tool names are likely correct and 1.2 is a formality.

2. **Does `semgrep mcp` accept a `--list-tools` or `--tools` flag** to enumerate
   available tools without starting the full MCP server? If not, verification
   requires actually connecting to the MCP server via Claude Code's tool
   discovery (ToolSearch in a live session).

3. **Should the plan file checkboxes and banner be updated as a follow-up
   commit**, or should that be bundled with the 1.2 verification PR?
