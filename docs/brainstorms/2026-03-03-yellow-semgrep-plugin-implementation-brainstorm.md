# Brainstorm: yellow-semgrep Plugin Implementation

**Date:** 2026-03-03
**Status:** Ready for planning
**Source research:** `docs/research/semgrep-to-fix-fixer-claude-code-plugin-mcp.md`
**Source solution:** `docs/solutions/integration-issues/semgrep-mcp-appsec-plugin-architecture.md`

---

## What We're Building

A full yellow-semgrep plugin that bridges the Semgrep MCP server, REST API, and
CLI into a unified remediation workflow within the yellow-plugins Claude Code
plugin system. The plugin automates the lifecycle of "to fix" findings:
fetch from platform, analyze, apply fix (deterministic autofix first, LLM
fallback), verify via re-scan, and update triage state.

### Plugin Surface Area

| Type | Name | Purpose |
|---|---|---|
| Command | `/semgrep:setup` | Validate token, detect deployment slug, cache config |
| Command | `/semgrep:status` | Dashboard: findings by triage state and severity |
| Command | `/semgrep:scan` | Local scan, compare with platform findings |
| Command | `/semgrep:fix` | Fix single finding: fetch, analyze, fix, verify, triage |
| Command | `/semgrep:fix-batch` | Iterative batch: human approval between each fix |
| Agent | `finding-fixer` | Deterministic autofix first, LLM fallback for complex fixes |
| Agent | `scan-verifier` | Post-fix re-scan and regression detection |
| Skill | `semgrep-conventions` | State mappings, API patterns, fix strategy decision tree |
| MCP Server | `semgrep` | `uvx semgrep-mcp` with `SEMGREP_APP_TOKEN` env var |

### Three-Layer Architecture

```
Layer 1: REACTIVE (read)
  MCP semgrep_findings(status=ISSUE_TAB_FIXING) -> list "to fix" findings
  REST GET /findings?triage_state=fixing&dedup=true -> cross-check + details

Layer 2: REMEDIATION (write code)
  CLI: semgrep scan --autofix --dryrun -> deterministic fix preview
  CLI: semgrep scan --config "r/{check_id}" --json -> post-fix verification
  LLM fallback: Edit tool for findings without autofix

Layer 3: LIFECYCLE (write state)
  REST POST /deployments/{slug}/triage -> mark fixed after verification
```

---

## Why This Approach

### Convention-Mirroring (yellow-devin pattern)

We chose to model yellow-semgrep directly after yellow-devin's proven structure:
inline curl for REST API calls in each command, with shared conventions (auth
headers, error handling, rate limiting, input validation, state enum mappings)
documented in the `semgrep-conventions` skill.

**Why this over alternatives:**

- **vs. Centralized Shell Library:** A `lib/semgrep-api.sh` with exported
  functions would be DRY, but no existing plugin uses this pattern. It sets a
  new precedent for 3-4 endpoints -- over-engineering. Shell function libraries
  are fragile (sourcing paths, variable scoping). If we had 10+ endpoints, this
  would make sense. We don't.

- **vs. Hybrid (inline + batch helper):** Extracting a helper script only for
  `fix-batch.md` is pragmatic but introduces two patterns in one plugin. The
  batch command can handle its own iteration with inline logic and the skill's
  rate-limiting conventions. Consistency wins.

**The skill is the single source of truth.** The `semgrep-conventions` skill
contains the state enum mappings (MCP vs REST), auth header patterns, rate
limiting rules, input validation regexes, and the fix-strategy decision tree.
Commands reference the skill rather than re-documenting these patterns. Both
humans reading the plugin and Claude executing it use the same reference.

### Two Separate Agents

`finding-fixer` and `scan-verifier` stay as separate, composable agents rather
than merging into a single `semgrep-remediation` agent.

**Rationale:**
- Commands compose them: `/semgrep:fix` calls `finding-fixer` then
  `scan-verifier` sequentially
- Each agent has a single responsibility with clear inputs/outputs
- `scan-verifier` can be reused independently (e.g., after manual fixes or
  from `/semgrep:scan`)
- Matches the two-phase nature of the workflow: write code, then verify code

### No Session-Start Hook

We dropped the session-start hook that would check for pending "fixing"
findings on every Claude Code session start. Users run `/semgrep:status`
manually when they want to check.

**Rationale:**
- Requires valid `SEMGREP_APP_TOKEN` and network access -- silently fails or
  adds latency when either is missing
- Not every session is about security remediation -- the hook would fire
  unnecessarily in most sessions
- Simplifies the plugin structure (no `hooks/` directory needed)
- `/semgrep:status` gives a richer dashboard than a hook one-liner ever could

---

## Key Decisions

### 1. Full plugin in one pass

Build all 5 commands, 2 agents, and 1 skill in a single implementation cycle.
The solution doc is detailed enough to execute without phasing. The commands
have clear boundaries and the skill provides shared infrastructure.

### 2. REST API via inline curl (convention-mirroring)

Each command embeds its own curl calls for REST API operations. Shared patterns
(auth headers, error handling, rate limiting, `dedup=true`, input validation)
are documented in the `semgrep-conventions` skill and referenced by commands.
This mirrors yellow-devin's established pattern.

### 3. Two composable agents

`finding-fixer` owns the fix lifecycle (check autofix, apply or LLM fallback,
show diff, get approval). `scan-verifier` owns post-fix validation (re-scan
target file, check for regressions, report pass/fail). Commands compose them
sequentially.

### 4. No session-start hook

Users opt in to finding checks via `/semgrep:status`. No automatic API calls
on session start.

### 5. Deterministic-first fix strategy

The `finding-fixer` agent always tries `semgrep scan --autofix --dryrun` before
falling back to LLM-generated fixes. This is documented in the skill's
fix-strategy decision tree. Deterministic fixes are faster, reproducible, and
auditable.

### 6. Safety guardrails (from solution doc)

- Every fix requires user approval via `AskUserQuestion` before applying
- `--dryrun` shows proposed diff before applying
- Only mark "fixed" after re-scan confirms finding is gone
- Never modify files not mentioned in the finding
- Each fix is a separate commit for easy `git revert`
- Respect 60 req/min API rate limit; 1s delay between API calls in batch mode
- All API responses fenced in injection delimiters
- Always pass `dedup=true` when listing findings via REST API
- Never echo/log `SEMGREP_APP_TOKEN`; redact with `sgp_***/***REDACTED***`

### 7. MCP server registration

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

MCP tool names must be verified empirically with `ToolSearch` after installation
-- do not hardcode from docs or training data.

### 8. Skill reference structure

```
skills/
  semgrep-conventions/
    SKILL.md              # Overview, when to load, conventions summary
    references/
      triage-states.md    # MCP <-> REST enum mappings table
      fix-patterns.md     # Fix-strategy decision tree, autofix vs LLM criteria
      api-reference.md    # REST endpoints, auth headers, rate limits, pagination
```

---

## Open Questions

1. **`semgrep-mcp` version pinning:** Should `plugin.json` pin a specific
   version of `semgrep-mcp` (e.g., `uvx semgrep-mcp==0.9.0`) or use latest?
   The MCP server is now bundled in the main semgrep CLI (`semgrep mcp`) --
   should we prefer that invocation instead of `uvx semgrep-mcp`?

2. **Deployment slug auto-detection:** The `/semgrep:setup` command needs to
   detect the deployment slug. The solution doc suggests deriving it from the
   Semgrep platform. Should setup cache this in a local dotfile
   (`.semgrep-plugin.json`) or rely on re-detection each time? Other plugins
   (yellow-devin) use env vars exclusively.

3. **Batch fix ordering:** When `/semgrep:fix-batch` processes multiple
   findings, should it prioritize by severity (critical first), by file
   (minimize context switching), or by rule (group similar fixes)? The solution
   doc does not specify ordering.

4. **Regression scope in scan-verifier:** After fixing a finding, the
   scan-verifier re-scans the affected file. Should it also scan files that
   import/depend on the modified file, or is single-file verification
   sufficient for v1?

5. **MCP tool name prefix:** The solution doc lists expected tool names like
   `mcp__plugin_yellow-semgrep_semgrep__semgrep_findings`. These must be
   verified after installation. If the actual names differ, commands and agents
   will need updating. Plan should include a verification step.

---

## Brainstorm Q&A Log

**Q1: Full plugin or MVP-first?**
A: Full plugin -- implement everything from the solution doc in one pass.

**Q2: REST API pattern -- inline curl, wrapper script, or decide later?**
A: Decide during implementation (no strong preference from user).

**Q3: Two agents or single merged agent?**
A: Two agents as specified -- `finding-fixer` and `scan-verifier` stay separate,
composed by commands.

**Q4: Session-start hook behavior?**
A: No hook -- skip entirely. Users run `/semgrep:status` manually.

**Approach chosen: Convention-Mirroring (Approach A)**
Model after yellow-devin: inline curl in commands, shared conventions in skill.
Recommended over centralized shell library (over-engineering for 3-4 endpoints)
and hybrid approach (inconsistent patterns within one plugin).

---

## Next Step

Run `/workflows:plan` against this brainstorm to produce a sequenced
implementation plan with file-level tasks.

**Input documents for planning:**
- This brainstorm: `docs/brainstorms/2026-03-03-yellow-semgrep-plugin-implementation-brainstorm.md`
- Research: `docs/research/semgrep-to-fix-fixer-claude-code-plugin-mcp.md`
- Solution: `docs/solutions/integration-issues/semgrep-mcp-appsec-plugin-architecture.md`
- Plugin template reference: `docs/plugin-template.md`
- Existing plugin to mirror: `plugins/yellow-devin/`
