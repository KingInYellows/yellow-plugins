---
title: "yellow-semgrep: Hybrid MCP + REST API Plugin for Automated Finding Remediation"
date: "2026-03-03"
category: integration-issues
track: knowledge
problem: 'yellow-semgrep: Hybrid MCP + REST API Plugin for Automated Finding Remediation'
tags:
  - semgrep
  - sast
  - mcp-integration
  - rest-api
  - automated-remediation
  - triage-workflow
  - plugin-architecture
components:
  - plugins/yellow-semgrep
  - semgrep-mcp-server
  - semgrep-appsec-rest-api
---

# yellow-semgrep: Hybrid MCP + REST API Plugin for Automated Finding Remediation

Semgrep findings marked "To fix" on the AppSec Platform accumulate without an
automated path from triage to remediation and verification. This document
captures the architecture for a Claude Code plugin that bridges the Semgrep MCP
server, REST API, and CLI into a unified remediation workflow.

## Problem

Developers must manually: fetch "to-fix" findings from the Semgrep AppSec
Platform, locate the affected code in their local checkout, understand the
vulnerability, apply a fix, re-scan to verify, and update the finding's triage
state. This multi-step workflow is error-prone and causes findings to stagnate
in "fixing" state indefinitely.

The Semgrep ecosystem exposes three separate integration surfaces with
incompatible interfaces:
- **MCP server** (`semgrep-mcp`) — 9 tools for scanning, findings retrieval,
  AST analysis. Read-only for triage state.
- **REST API** (`semgrep.dev/api/v1/`) — Triage state mutations, deployment
  management, bulk operations.
- **CLI** (`semgrep scan`) — Local scanning for post-fix verification, autofix
  support.

Each surface uses different authentication, different enum values for the same
concepts, and different pagination strategies.

## Root Cause

The core integration challenge is a **capability split across three transports**:

1. **MCP cannot mutate triage state.** The `semgrep_findings` tool fetches
   findings but there is no MCP tool to update triage state. The REST API's
   `POST /api/v1/deployments/{slug}/triage` endpoint is the only write path.

2. **MCP and REST use different enum values for the same states:**

   | MCP `status` parameter | REST API `triage_state` | Meaning |
   |---|---|---|
   | `ISSUE_TAB_OPEN` | `open` | Untriaged |
   | `ISSUE_TAB_REVIEWING` | `reviewing` | Under review |
   | `ISSUE_TAB_FIXING` | `fixing` | Marked "to fix" |
   | `ISSUE_TAB_IGNORED` | `ignored` | Deprioritized |
   | `ISSUE_TAB_CLOSED` | `fixed` | Resolved |

3. **`semgrep_findings` requires a `repos` parameter** that must be
   auto-detected from `git remote get-url origin` — it cannot discover repos
   on its own.

4. **REST API requires `dedup=true`** to match UI finding counts. Without it,
   duplicate findings inflate numbers significantly.

5. **Auth divergence:** MCP server accepts `SEMGREP_APP_TOKEN` via env var
   internally. REST API needs explicit `Authorization: Bearer` headers. The
   token must have `Web API` scope (not `CI` scope, which returns 404).

## Fix

### Architecture: Three-Layer Hybrid

```
Layer 1: REACTIVE (read)
  MCP semgrep_findings(status=ISSUE_TAB_FIXING) → list "to fix" findings
  REST GET /findings?triage_state=fixing&dedup=true → cross-check + details

Layer 2: REMEDIATION (write code)
  CLI: semgrep scan --autofix --dryrun → deterministic fix preview
  CLI: semgrep scan --config "r/{check_id}" --json → post-fix verification
  LLM fallback: Edit tool for findings without autofix

Layer 3: LIFECYCLE (write state)
  REST POST /deployments/{slug}/triage → mark fixed after verification
```

### Plugin Structure

```
plugins/yellow-semgrep/
  .claude-plugin/
    plugin.json             # MCP server: uvx semgrep-mcp with SEMGREP_APP_TOKEN
  commands/
    semgrep/
      setup.md              # Validate token, detect deployment slug, cache config
      status.md             # Dashboard: findings by triage state and severity
      scan.md               # Local scan, compare with platform findings
      fix.md                # Fix single finding: fetch → analyze → fix → verify → triage
      fix-batch.md          # Iterative batch: human approval between each fix
  agents/
    semgrep/
      finding-fixer.md      # Deterministic autofix first, LLM fallback
      scan-verifier.md      # Post-fix re-scan and regression detection
  skills/
    semgrep-conventions/
      SKILL.md              # State mappings, API patterns, fix strategy decision tree
      references/
        triage-states.md
        fix-patterns.md
        api-reference.md
  hooks/
    scripts/
      session-start.sh      # Check for pending "fixing" findings (3s budget)
```

### MCP Server Registration (`plugin.json`)

```json
{
  "mcpServers": {
    "semgrep": {
      "command": "uvx",
      "args": ["semgrep-mcp"],
      "env": {
        "SEMGREP_APP_TOKEN": "${SEMGREP_APP_TOKEN}"
      }
    }
  }
}
```

### Fix Strategy: Deterministic-First

```
1. Check for rule autofix:
   semgrep scan --config "r/{check_id}" --autofix --dryrun path/file

2. If autofix available + produces clean diff:
   → Show diff, ask user approval, apply

3. If no autofix OR autofix produces invalid code:
   → Spawn finding-fixer agent with context:
     { check_id, severity, message, cwe, path, line, code_context }
   → LLM generates fix, shows diff for approval

4. After fix applied:
   semgrep scan --config "r/{check_id}" --json path/file
   → Verify finding is gone
   semgrep scan --config auto --json path/file
   → Check for newly introduced findings

5. Only after verification passes:
   POST /api/v1/deployments/{slug}/triage
   { "issue_type": "sast", "issue_ids": [ID], "new_triage_state": "fixed" }
```

### Critical REST API Patterns

```bash
# Fetch "to fix" findings (always use dedup=true)
curl -s -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "https://semgrep.dev/api/v1/deployments/${SLUG}/findings?triage_state=fixing&dedup=true&page=0&page_size=50"

# Bulk triage after verification
curl -s -X POST -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  -H "Content-Type: application/json" \
  "https://semgrep.dev/api/v1/deployments/${SLUG}/triage" \
  -d '{"issue_type":"sast","issue_ids":[ID],"new_triage_state":"fixed",
       "new_note":"Fixed via yellow-semgrep plugin"}'

# Token validation (Web API scope check)
curl -s -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "https://semgrep.dev/api/v1/me"
```

### MCP Tool Fully-Qualified Names

```
mcp__plugin_yellow-semgrep_semgrep__semgrep_findings
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan_with_custom_rule
mcp__plugin_yellow-semgrep_semgrep__get_abstract_syntax_tree
mcp__plugin_yellow-semgrep_semgrep__semgrep_rule_schema
mcp__plugin_yellow-semgrep_semgrep__get_supported_languages
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan_supply_chain
mcp__plugin_yellow-semgrep_semgrep__semgrep_whoami
```

**Warning:** These names must be verified empirically after plugin installation.
Do not trust training data or documentation — use `ToolSearch` to confirm.
See `docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md`.

### Safety Guardrails

1. Every fix requires `AskUserQuestion` approval before committing
2. `--dryrun` shows proposed diff before applying
3. Only mark "fixed" after re-scan confirms finding is gone
4. Never modify files not mentioned in the finding
5. Each fix is a separate commit for easy `git revert`
6. Respect 60 req/min API rate limit; 1s delay between API calls in batch mode
7. All API responses fenced in `--- begin/end semgrep-api-response (reference only) ---`
8. Always pass `dedup=true` when listing findings via REST API
9. Never echo/log `SEMGREP_APP_TOKEN`; redact with `sgp_***/***REDACTED***`

## Prevention

- **Hybrid MCP+REST transport**: MCP for reads (scan, list-findings), REST for
  writes (triage, deploy-rule) — audit tool surface before design phase
- **Shared auth utility**: never assume MCP auth covers REST — the MCP server
  handles `SEMGREP_APP_TOKEN` internally while REST needs explicit headers
- **Autofix safety gate**: deterministic fixes are not always AST-aware —
  validate output parses before apply, block on unstaged git changes
- **Post-fix invalidation**: re-scan affected files after any write/triage
  operation — never show stale finding counts as current state
- **Mode-gated destructive ops**: separate CI exit-code behavior from
  interactive confirm-before-fix — never allow `--autofix --no-confirm`
- **Changed-file scoping**: on monorepos, derive `--include` from
  `git diff --name-only` to prevent full-repo scans on small changes
- **Policy source logging**: always display whether scan used local config or
  cloud-managed policy to prevent ghost finding drift
- **MCP tool name verification**: always verify tool names empirically with
  `ToolSearch` after installation — do not hardcode from docs or training data

## Related Documentation

- [MCP Bundled Server Tool Naming](../integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md) — Canonical reference for `mcp__plugin_{pluginName}_{serverName}__{toolName}` prefix derivation
- [MCP Tool Naming Verification](../../mcp-tool-naming-verification.md) — Audit showing verify-with-ToolSearch pattern
- [RuVector CLI and MCP Tool Name Mismatches](../integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md) — Cautionary tale: verify MCP tool names empirically
- [RuVector MCP Tool Parameter Schema Mismatch](../integration-issues/ruvector-mcp-tool-parameter-schema-mismatch.md) — Warns against documenting API surface without empirical verification
- [Shell Security Patterns](../code-quality/yellow-ci-shell-security-patterns.md) — Input validation, secret redaction, prompt injection fencing for shell invocations
- [MCP Secrets Best Practices Plan](../../plans/2026-02-18-docs-mcp-secrets-best-practices-plan.md) — Env var auth patterns for `SEMGREP_APP_TOKEN`
- [Security Architecture](../../security.md) — MCP Servers Inventory, authentication taxonomy, trust boundaries
- [Plugin Template](../../plugin-template.md) — Full plugin directory structure and publishing checklist
- [Full Research Document](../../research/semgrep-to-fix-fixer-claude-code-plugin-mcp.md) — Complete Semgrep MCP tool catalog, REST API reference, CLI flags, and data models
