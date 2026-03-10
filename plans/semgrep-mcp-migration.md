# Feature: Migrate semgrep MCP from deprecated standalone to built-in subcommand

## Problem Statement

The yellow-semgrep plugin uses `uvx semgrep-mcp` (the standalone PyPI package)
to run its MCP server. This package was **archived on October 28, 2025** and is
no longer maintained. The Semgrep team moved the MCP server into the main
`semgrep` binary as the `semgrep mcp` subcommand (available in v1.146.0+).

Running the deprecated standalone package likely causes API failures due to
stale client code, and prevents users from getting MCP bug fixes and new tools.

### Impact

- MCP tools may fail or return unexpected errors (the "wrong call" issue)
- No upstream fixes for the deprecated `semgrep-mcp` package
- Requires `uvx`/`uv` as an extra dependency when `semgrep` alone would suffice
- Setup doesn't verify MCP readiness tied to semgrep version

## Current State

### plugin.json MCP config (broken)
```jsonc
"mcpServers": {
  "semgrep": {
    "command": "uvx",
    "args": ["semgrep-mcp"],
    "env": { "SEMGREP_APP_TOKEN": "${SEMGREP_APP_TOKEN}" }
  }
}
```

### Setup command
- Installs `semgrep` CLI via pipx/pip
- Does NOT check semgrep version for MCP capability
- Verifies MCP tools via ToolSearch but can't fix the root cause if they fail

### REST API endpoints
All endpoints (`/api/v1/me`, `/deployments`, `/deployments/{slug}/findings`,
`/deployments/{slug}/triage`) are **correct and current** — no changes needed.

## Proposed Solution

1. Change plugin.json to use `semgrep mcp` instead of `uvx semgrep-mcp`
2. Add version check to setup (ensure semgrep >= 1.146.0 for MCP support)
3. Update install script to enforce minimum version
4. Verify tool names match between standalone and built-in MCP server
5. Update documentation

## Implementation Plan

### Phase 1: MCP Server Config Migration

- [ ] **1.1:** Update `plugins/yellow-semgrep/.claude-plugin/plugin.json`
  - Change `"command": "uvx"` → `"command": "semgrep"`
  - Change `"args": ["semgrep-mcp"]` → `"args": ["mcp"]`
  - Keep env block unchanged

  ```json
  "mcpServers": {
    "semgrep": {
      "command": "semgrep",
      "args": ["mcp"],
      "env": { "SEMGREP_APP_TOKEN": "${SEMGREP_APP_TOKEN}" }
    }
  }
  ```

- [ ] **1.2:** Verify tool name compatibility
  - Install semgrep >= 1.146.0 locally
  - Run `semgrep mcp` and compare available tool names against expected list
  - Expected tools in current code:
    - `semgrep_scan`
    - `semgrep_findings`
    - `semgrep_scan_with_custom_rule`
    - `get_abstract_syntax_tree`
    - `semgrep_rule_schema`
    - `get_supported_languages`
    - `semgrep_scan_supply_chain`
    - `semgrep_whoami`
  - If tool names differ, update all references across commands/agents/skills

### Phase 2: Setup Command — Version Check & MCP Verification

- [ ] **2.1:** Add minimum version constant to setup.md
  - `MIN_SEMGREP_VERSION="1.146.0"` (required for `semgrep mcp` subcommand)

- [ ] **2.2:** Add version comparison after semgrep install/detection (between
  current Step 0 and Step 1)
  ```bash
  installed=$(semgrep --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  min="1.146.0"
  # Note: sort -V requires GNU coreutils or a compatible sort (macOS, FreeBSD, OpenBSD).
  # Not portable to all BSDs (e.g. NetBSD). Acceptable here since setup targets Linux/macOS.
  if [ "$(printf '%s\n' "$min" "$installed" | sort -V | head -1)" != "$min" ]; then
    # installed < min — warn that MCP features require upgrade
  fi
  ```
  - If version is below minimum: warn that MCP tools won't work, suggest upgrade
  - If version is at/above minimum: proceed normally

- [ ] **2.3:** Update Step 5 (Verify MCP Tools) to give better diagnostics
  - If MCP tools not found AND semgrep version < minimum: "Upgrade semgrep to
    v1.146.0+ for MCP support: `pipx upgrade semgrep`"
  - If MCP tools not found AND semgrep version >= minimum: "MCP server failed
    to start. Check SEMGREP_APP_TOKEN and try restarting Claude Code."

### Phase 3: Install Script — Minimum Version

- [ ] **3.1:** Update `scripts/install-semgrep.sh`
  - Add `MIN_VERSION="1.146.0"` constant
  - After successful install, compare installed version against minimum
  - If installed version < minimum: warn and suggest upgrade command
  - If already installed but below minimum: offer to upgrade
    (`pipx upgrade semgrep` or `pip install --upgrade semgrep`)

- [ ] **3.2:** Add upgrade path for existing installs
  - Currently the script exits early if semgrep is already installed
  - Change: if installed but below `MIN_VERSION`, offer to upgrade
  - Keep the early exit only if version is >= minimum

### Phase 4: Documentation & Conventions

- [ ] **4.1:** Update `CLAUDE.md` MCP Servers section
  - Change "Local stdio server via `uvx semgrep-mcp`" to
    "Built-in MCP server via `semgrep mcp` (requires v1.146.0+)"

- [ ] **4.2:** Update `README.md` prerequisites/setup section

- [ ] **4.3:** Update `semgrep-conventions` SKILL.md if any tool names changed

- [ ] **4.4:** Update setup.md Step 5 expected tool list if names differ

- [ ] **4.5:** Update CHANGELOG.md with migration entry

## Technical Details

### Files to Modify

- `plugins/yellow-semgrep/.claude-plugin/plugin.json` — MCP server command
- `plugins/yellow-semgrep/commands/semgrep/setup.md` — Version check + diagnostics
- `plugins/yellow-semgrep/scripts/install-semgrep.sh` — Min version + upgrade
- `plugins/yellow-semgrep/CLAUDE.md` — MCP server docs
- `plugins/yellow-semgrep/README.md` — User-facing docs
- `plugins/yellow-semgrep/CHANGELOG.md` — Version notes

### Conditionally Modified (if tool names change)

- `plugins/yellow-semgrep/commands/semgrep/scan.md` — MCP tool references
- `plugins/yellow-semgrep/commands/semgrep/fix.md` — MCP tool references
- `plugins/yellow-semgrep/agents/semgrep/finding-fixer.md` — Tool names
- `plugins/yellow-semgrep/agents/semgrep/scan-verifier.md` — Tool names
- `plugins/yellow-semgrep/skills/semgrep-conventions/SKILL.md` — References

### No Changes Needed

- REST API endpoints (all correct and current)
- curl error handling patterns (working correctly)
- Triage state mappings (unchanged)
- Token validation (unchanged)

## Acceptance Criteria

1. `plugin.json` uses `semgrep mcp` instead of `uvx semgrep-mcp`
2. `/semgrep:setup` checks semgrep version >= 1.146.0 and warns if below
3. Install script offers upgrade path for outdated semgrep installs
4. MCP tools discovered by ToolSearch work correctly after migration
5. All tool name references match the built-in MCP server's actual tool names
6. No `uvx` or `semgrep-mcp` references remain in the plugin

## Edge Cases

- User has semgrep installed but < 1.146.0 → warn, offer upgrade, degrade gracefully
- User has no semgrep installed → install latest (will be >= 1.146.0)
- User has `uvx semgrep-mcp` still installed globally → no conflict, plugin.json
  takes precedence
- `semgrep mcp` subcommand not available in their version → clear error message
  pointing to upgrade

## References

- [Semgrep MCP archived repo](https://github.com/semgrep/mcp) — archived Oct 28, 2025
- Migration note: "moved from standalone repo to the main semgrep repository"
- Minimum version for `semgrep mcp`: v1.146.0+
- `plugins/yellow-semgrep/.claude-plugin/plugin.json` — current MCP config
- `plugins/yellow-semgrep/commands/semgrep/setup.md` — current setup workflow
- `plugins/yellow-semgrep/scripts/install-semgrep.sh` — current install script
