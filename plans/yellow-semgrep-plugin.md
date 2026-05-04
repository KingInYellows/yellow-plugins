# Feature: yellow-semgrep Plugin — Automated Semgrep Finding Remediation

> **Status: Implemented (PR #122, merged)** — Plugin shipped at `plugins/yellow-semgrep/`. Subsequent: MCP migration to built-in subcommand (PR #155), `SEMGREP_APP_TOKEN` userConfig migration (`6254fcad`).

## Overview

Build a Claude Code plugin that automates the remediation lifecycle for Semgrep
"to-fix" findings: fetch from platform, analyze, apply fix (deterministic
autofix first, LLM fallback), verify via re-scan, and update triage state. The
plugin bridges the Semgrep MCP server (scanning), REST API (finding retrieval
and triage mutations), and CLI (local verification) into a unified workflow.

## Problem Statement

### Current Pain Points

- Findings marked "To fix" on the Semgrep AppSec Platform stagnate because the
  manual workflow (fetch → locate → fix → verify → triage) is tedious and
  error-prone
- Three incompatible integration surfaces (MCP, REST, CLI) with different auth,
  enum values, and pagination strategies
- No automated path from triage decision to code change to verification

### User Impact

Security engineers and developers spend significant time on the mechanical
aspects of remediation rather than the security analysis itself.

### Business Value

Reduce mean time to remediate security findings. Ensure findings do not
stagnate in "fixing" state indefinitely.

## Proposed Solution

### High-Level Architecture

Three-layer hybrid plugin following the convention-mirroring pattern
(yellow-devin style):

```
Layer 1: REACTIVE (read)         → REST API for finding retrieval
Layer 2: REMEDIATION (write code) → Semgrep CLI for autofix + LLM fallback
Layer 3: LIFECYCLE (write state)  → REST API for triage mutations
```

MCP server reserved for local scanning and verification only. REST API used
exclusively for all platform interactions (better pagination, dedup support,
triage mutations).

### Key Design Decisions

1. **REST-only for finding retrieval** — MCP `semgrep_findings` has no
   finding-by-ID filter and limited pagination. REST API has proper
   offset-based pagination and `dedup=true` support.
2. **SAST only for v1** — SCA findings require dependency upgrade strategies
   that differ fundamentally from code-level fixes.
3. **Convention-mirroring** — Inline curl in commands, shared patterns in skill.
   No shell library abstraction.
4. **Two composable agents** — `finding-fixer` (fix) + `scan-verifier` (verify)
   composed sequentially by commands.
5. **No session-start hook** — Users opt into finding checks via
   `/semgrep:status`.
6. **Deterministic-first fix strategy** — Semgrep `--autofix --dryrun` before
   LLM-generated fixes.

### Trade-offs Considered

| Decision | Alternative | Why Rejected |
|---|---|---|
| REST-only for listings | MCP + REST hybrid | MCP has no ID filter, limit=10 default, no dedup |
| Inline curl | Shell library | Over-engineering for 3-4 endpoints; no plugin precedent |
| Two agents | Single merged agent | Loses reusability of scan-verifier |
| No hook | Active session-start hook | Silent failures when no token/network; unnecessary latency |

## Implementation Plan

### Phase 1: Scaffolding (Foundation)

- [x] **1.1:** Create plugin directory structure
- [x] **1.2:** Write `plugin.json` manifest with MCP server registration
- [x] **1.3:** Write `package.json` (minimal 4-field pattern)
- [x] **1.4:** Write `CLAUDE.md` with conventions, component list, security rules
- [x] **1.5:** Register in marketplace.json

### Phase 2: Skill (Shared Infrastructure)

- [x] **2.1:** Write `skills/semgrep-conventions/SKILL.md` — overview, when to
  load, convention summary
- [x] **2.2:** Write `skills/semgrep-conventions/references/triage-states.md` —
  MCP ↔ REST enum mapping table
- [x] **2.3:** Write `skills/semgrep-conventions/references/api-reference.md` —
  REST endpoints, auth headers, rate limits, pagination, error codes
- [x] **2.4:** Write `skills/semgrep-conventions/references/fix-patterns.md` —
  fix-strategy decision tree, autofix vs LLM criteria, language-specific
  syntax checks

### Phase 3: Commands (Core Implementation)

- [x] **3.1:** Write `commands/semgrep/setup.md` — token validation, deployment
  slug detection, prerequisite checks, config caching
- [x] **3.2:** Write `commands/semgrep/status.md` — findings dashboard by triage
  state and severity
- [x] **3.3:** Write `commands/semgrep/scan.md` — local scan with comparison to
  platform findings
- [x] **3.4:** Write `commands/semgrep/fix.md` — single-finding fix lifecycle
- [x] **3.5:** Write `commands/semgrep/fix-batch.md` — iterative batch fix with
  approval between each

### Phase 4: Agents (Specialist Workers)

- [x] **4.1:** Write `agents/semgrep/finding-fixer.md` — deterministic autofix
  first, LLM fallback
- [x] **4.2:** Write `agents/semgrep/scan-verifier.md` — post-fix re-scan and
  regression detection

### Phase 5: Quality & Documentation

- [x] **5.1:** Write `README.md` — installation, quick start, env vars
- [x] **5.2:** Run `pnpm validate:schemas` to verify plugin and marketplace
- [x] **5.3:** Verify MCP tool names with ToolSearch after plugin install
- [x] **5.4:** Manually test `/semgrep:setup` with a real `SEMGREP_APP_TOKEN`

## Technical Specifications

### Files to Create

```
plugins/yellow-semgrep/
  .claude-plugin/
    plugin.json
  commands/
    semgrep/
      setup.md
      status.md
      scan.md
      fix.md
      fix-batch.md
  agents/
    semgrep/
      finding-fixer.md
      scan-verifier.md
  skills/
    semgrep-conventions/
      SKILL.md
      references/
        triage-states.md
        fix-patterns.md
        api-reference.md
  CLAUDE.md
  README.md
  package.json
```

Total: 16 files across 9 directories.

### Files to Modify

- `.claude-plugin/marketplace.json` — Add yellow-semgrep entry to plugins array

### Dependencies

- **External:** `SEMGREP_APP_TOKEN` env var (Web API scope, `sgp_` prefix)
- **CLI tools:** `curl`, `jq`, `semgrep` (all checked in setup)
- **MCP server:** `uvx semgrep-mcp` (registered in plugin.json, managed by
  Claude Code)

### File Specifications

#### 1.2: `plugin.json`

```json
{
  "name": "yellow-semgrep",
  "version": "1.0.0",
  "description": "Semgrep security finding remediation — fetch, fix, and verify 'to fix' findings from the Semgrep AppSec Platform",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/KingInYellows"
  },
  "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-semgrep",
  "repository": "https://github.com/KingInYellows/yellow-plugins",
  "license": "MIT",
  "keywords": ["semgrep", "security", "sast", "remediation", "mcp"],
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

#### 1.3: `package.json`

```json
{
  "name": "yellow-semgrep",
  "version": "1.0.0",
  "private": true,
  "description": "Semgrep security finding remediation for Claude Code"
}
```

#### 1.5: Marketplace entry

```json
{
  "name": "yellow-semgrep",
  "description": "Semgrep security finding remediation — fetch, fix, and verify 'to fix' findings from the Semgrep AppSec Platform",
  "version": "1.0.0",
  "author": { "name": "KingInYellows" },
  "source": "./plugins/yellow-semgrep",
  "category": "development"
}
```

#### 3.1: `/semgrep:setup` Specification

```yaml
---
name: semgrep:setup
description: "Validate SEMGREP_APP_TOKEN, test MCP connection, detect deployment slug, and cache configuration. Use when first installing the plugin, after token rotation, or on auth errors."
allowed-tools:
  - Bash
  - Skill
  - ToolSearch
  - AskUserQuestion
---
```

**Step 1: Validate Prerequisites**

```bash
for cmd in curl jq semgrep; do
  command -v "$cmd" >/dev/null 2>&1 || {
    printf 'ERROR: %s required but not found.\n' "$cmd" >&2; exit 1
  }
done
```

**Step 2: Validate Token**

Check `SEMGREP_APP_TOKEN` is set. Validate format: `^sgp_[a-zA-Z0-9]{20,}$`.
Never echo the token. Redact with `sed 's/sgp_[a-zA-Z0-9]*/***REDACTED***/g'`.

Hit `GET /api/v1/me` to validate Web API scope. Handle:
- curl exit 6/7/28: network failure
- 401: invalid token
- 404: token has CI scope, not Web API scope — show migration instructions
- 200: extract user info

**Step 3: Detect Deployment Slug**

Hit `GET /api/v1/deployments`. If multiple deployments returned, present
AskUserQuestion for selection. Cache selected slug.

**Step 4: Detect Repository Name**

Parse from `git remote get-url origin`. Support formats:
- `git@github.com:org/repo.git` → `org/repo`
- `https://github.com/org/repo.git` → `org/repo`
- `ssh://git@github.com/org/repo.git` → `org/repo`

Regex: `sed -E 's#.+[:/]([^/]+/[^/.]+)(\.git)?$#\1#'`

**Step 5: Verify MCP Tools**

Call `ToolSearch` with `"+semgrep"` to discover actual MCP tool names. Verify
at least `semgrep_scan` and `semgrep_findings` are available. Report expected
vs. actual names if mismatch.

**Step 6: Report**

Display results table:
```
Setup Results:
  Token:      valid (Web API scope)
  User:       user@example.com
  Deployment: my-org (slug: my-org)
  Repository: org/repo-name
  MCP Tools:  8 tools verified
  CLI:        semgrep v1.x.x
```

#### 3.2: `/semgrep:status` Specification

```yaml
---
name: semgrep:status
description: "Show findings dashboard grouped by triage state and severity. Use when user asks 'semgrep status', 'what needs fixing', 'how many findings', or wants to see the current state of findings."
argument-hint: '[--severity high,critical] [--repo org/name]'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---
```

**Data source:** REST API exclusively (proper pagination, dedup).

**Output format:**

```
Semgrep Findings Dashboard — org/repo-name (deployment: my-org)

By Triage State:
  To Fix (fixing):    12
  Open:               45
  Reviewing:           3
  Ignored:            28
  Fixed:             134

To-Fix Breakdown by Severity:
  CRITICAL:  2   HIGH:  5   MEDIUM:  4   LOW:  1

Top Rules (to-fix only):
  python.lang.security.audit.dangerous-eval     3 findings
  javascript.browser.security.xss.innerHTML     2 findings
  ...
```

Handle zero findings: "No findings in 'fixing' state for org/repo-name."

Paginate with `page_size=100`. Always pass `dedup=true`.

#### 3.3: `/semgrep:scan` Specification

```yaml
---
name: semgrep:scan
description: "Run local Semgrep scan and compare results with platform findings. Use when user says 'scan for issues', 'check security', or wants to verify local code against platform state."
argument-hint: '[--changed-only] [--severity error,warning]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
---
```

**Scan scope:**
- Default: full workspace via MCP `semgrep_scan`
- `--changed-only`: scope to `git diff --name-only HEAD` files
- Use `--metrics off` to prevent unintended telemetry

**Comparison:** Show local findings vs. platform "fixing" findings. Highlight
findings that exist locally but are not yet triaged on the platform.

#### 3.4: `/semgrep:fix` Specification

```yaml
---
name: semgrep:fix
description: "Fix a single Semgrep finding: fetch details, analyze vulnerability, apply fix (autofix or LLM), verify via re-scan, and update triage state. Use when user says 'fix finding 12345', 'remediate this issue', or references a specific finding ID."
argument-hint: '<finding-id>'
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - Task
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
---
```

**Workflow (10 steps):**

1. **Validate prerequisites:** Token set, deployment slug cached (or run
   setup). Finding ID is a positive integer: `^[0-9]+$`.

2. **Fetch finding details:** REST API
   `GET /findings?triage_state=fixing&dedup=true&page_size=100`. Filter
   client-side by `finding.id == $FINDING_ID`. If not found, report and exit.
   If finding is already `fixed`, report and offer to skip.

3. **Pre-fix scan:** Before attempting a fix, verify the finding is still
   present locally:
   ```bash
   semgrep scan --config "r/${CHECK_ID}" --json --metrics off "${FILE_PATH}"
   ```
   If finding NOT present locally: "Finding {id} is not present in local code.
   It may have already been fixed. [Mark as fixed on platform] [Skip]"

4. **Check file exists:** If `finding.path` does not exist locally, report:
   "File {path} not found in working tree. [Mark as fixed] [Skip] [Enter
   new path]"

5. **Check git state:** Run `git diff --name-only "${FILE_PATH}"` and
   `git diff --cached --name-only "${FILE_PATH}"`. If file has uncommitted
   changes: "File {path} has uncommitted changes. [Stash and proceed] [Abort]"

6. **Read context:** Read the affected file around `finding.line` (20 lines
   before/after). Fence the code and finding metadata:
   ```
   --- begin semgrep-finding (reference only) ---
   {finding JSON}
   --- end semgrep-finding ---
   ```

7. **Determine fix strategy:**
   - Try: `semgrep scan --config "r/${CHECK_ID}" --autofix --dryrun --metrics off "${FILE_PATH}"`
   - If autofix produces a diff:
     - Run language-specific syntax check on the proposed output
     - Show diff to user, ask approval via AskUserQuestion
   - If no autofix OR syntax check fails:
     - Spawn `finding-fixer` agent via Task with context:
       `{ check_id, severity, message, cwe, path, line, code_context }`

8. **Apply fix:**
   - Deterministic: `semgrep scan --config "r/${CHECK_ID}" --autofix --metrics off "${FILE_PATH}"`
   - LLM-based: Agent applies via Edit tool

9. **Verify fix:** Spawn `scan-verifier` agent via Task:
   - Re-scan with same rule: confirm finding is gone
   - Full rescan: check for newly introduced findings
   - If finding still present: offer to revert
     (`git checkout -- "${FILE_PATH}"`)
   - If new findings introduced: warn user, show new findings

10. **Update triage state:** Only after user approves the verified fix:
    ```bash
    curl -s -X POST -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
      -H "Content-Type: application/json" \
      "https://semgrep.dev/api/v1/deployments/${SLUG}/triage" \
      -d "$(jq -n --argjson id "$FINDING_ID" '{
        issue_type: "sast",
        issue_ids: [$id],
        new_triage_state: "fixed",
        new_note: "Fixed via yellow-semgrep plugin"
      }')"
    ```
    Parse response for `succeeded`, `failed`, `skipped` arrays. Report
    accordingly.

**Commit message format:**

```
fix(security): resolve {check_id} in {path}

Finding-ID: {id}
Rule: {check_id}
Severity: {severity}
Fix-Type: autofix|llm
Verified: pass

Co-Authored-By: Claude <noreply@anthropic.com>
```

#### 3.5: `/semgrep:fix-batch` Specification

```yaml
---
name: semgrep:fix-batch
description: "Fix multiple 'to-fix' Semgrep findings with human approval between each fix. Use when user says 'fix all findings', 'batch fix', 'remediate everything', or wants to work through the to-fix queue."
argument-hint: '[--severity critical,high] [--max N] [--rule check-id]'
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - Task
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
---
```

**Workflow:**

1. Fetch all "fixing" findings via REST API with pagination
2. Apply filters from arguments (severity, rule, max count)
3. Group findings by file, then by rule within each file
4. Present summary table with finding count and ask to proceed
5. For each finding in order:
   - Execute the same 10-step flow as `/semgrep:fix`
   - Between each: AskUserQuestion with options:
     [Continue next] [Skip this] [Abort batch]
   - After each fix in the same file, re-fetch finding line numbers (they may
     have shifted)
6. After batch completes, show summary:
   ```
   Batch Results:
     Fixed:   8
     Skipped: 2
     Failed:  1
     Remaining to-fix: 1
   ```

**Rate limiting:** 1-second delay between REST API calls. Max `page_size=100`
per request.

**Batch size:** Default max 10 findings per batch (configurable via `--max`).

#### 4.1: `finding-fixer` Agent

```yaml
---
name: finding-fixer
description: "Security finding fix specialist. Applies deterministic autofix first, falls back to LLM-generated fix. Shows diff for approval before applying. Spawned by /semgrep:fix and /semgrep:fix-batch."
model: inherit
color: yellow
allowed-tools:
  - Bash
  - Read
  - Edit
  - Grep
  - Glob
  - Skill
  - AskUserQuestion
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
  - mcp__plugin_yellow-semgrep_semgrep__get_abstract_syntax_tree
---
```

**Responsibilities:**
1. Read the affected code and understand the vulnerability from the finding
   message, CWE, and rule ID
2. Check if the rule has a built-in `fix:` autofix via `--autofix --dryrun`
3. If autofix available: validate syntax, show diff
4. If no autofix: generate a minimal, targeted code fix using context from the
   finding. Use AST tool if needed for complex code structure. Show diff.
5. Apply the fix via Edit tool after user approval
6. Never modify code outside the immediate scope of the finding
7. Never add comments like "// FIXED:" or "// Security fix" — the commit
   message captures provenance

**Reference:** Follow conventions in the `semgrep-conventions` skill.

#### 4.2: `scan-verifier` Agent

```yaml
---
name: scan-verifier
description: "Post-fix verification specialist. Re-scans with the specific rule to confirm finding is resolved, then full-scans for regressions. Spawned by /semgrep:fix after a fix is applied."
model: sonnet
color: green
allowed-tools:
  - Bash
  - Read
  - Skill
  - mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
---
```

**Responsibilities:**
1. Re-scan the fixed file with the specific rule:
   `semgrep scan --config "r/${CHECK_ID}" --json --metrics off "${FILE_PATH}"`
2. Parse JSON output. If finding still present: report FAIL with details
3. Full rescan of modified file:
   `semgrep scan --config auto --json --metrics off "${FILE_PATH}"`
4. If new findings introduced at modified lines: report WARNING with details
5. Return structured result: `{ status: "pass"|"fail"|"warning", details }`

#### 2.1-2.4: `semgrep-conventions` Skill

```yaml
---
name: semgrep-conventions
description: "Shared conventions for Semgrep integration — triage state mappings, API patterns, fix strategy decision tree, rate limits, and security rules. Use when commands or agents need Semgrep-specific validation, error handling, or API reference."
user-invokable: false
---
```

**Content structure:**
- When this skill loads (loaded by all `/semgrep:*` commands and both agents)
- Triage state mapping table (MCP ↔ REST ↔ UI)
- Token validation: format regex `^sgp_[a-zA-Z0-9]{20,}$`, redaction pattern
- REST API base URL, auth header pattern, rate limit (60 req/min)
- curl three-layer error check pattern (exit code, HTTP status, jq)
- JSON construction via `jq` (never string interpolation)
- Content fencing for API responses and finding data
- Fix-strategy decision tree (autofix → syntax check → LLM fallback)
- Language-specific syntax checks (Python: `ast.parse`, JS: `node --check`,
  etc.)
- Commit message format with structured metadata
- Finding ID validation: `^[0-9]+$`
- Repo name extraction regex for git remote URLs
- Severity mapping: `SEVERITY_CRITICAL` → `critical` → `ERROR`

#### 1.4: `CLAUDE.md` Structure

Follow yellow-devin's pattern exactly:
- Required Environment Variables
- MCP Servers
- Conventions (API calls, JSON construction, shell quoting, input validation,
  error handling, write safety, never-do rules)
- Plugin Components (Commands, Agents, Skills)
- Semgrep Triage State Values (table)
- When to Use What (capability → command/agent mapping)
- Known Limitations
- Dependencies

## Acceptance Criteria

1. `pnpm validate:schemas` passes with yellow-semgrep registered
2. `/semgrep:setup` validates a real `SEMGREP_APP_TOKEN`, detects deployment
   slug, reports MCP tool availability
3. `/semgrep:status` displays findings dashboard grouped by triage state and
   severity from the REST API
4. `/semgrep:fix <id>` can remediate a SAST finding end-to-end: fetch → check
   local → fix (autofix or LLM) → verify → triage update
5. `/semgrep:fix-batch` iterates through multiple findings with user approval
   between each
6. `/semgrep:scan` runs a local scan and shows results
7. All API responses are fenced per AGENTS.md content fencing rules
8. `SEMGREP_APP_TOKEN` is never echoed in output or error messages
9. Each fix produces a separate git commit with structured metadata
10. `dedup=true` is passed in all REST API finding queries

## Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| Token not set | Clear error directing to platform → API Tokens |
| Token has CI scope (404 on REST) | Error with migration instructions |
| No deployment found | Error: "No Semgrep deployment found for this token" |
| Multiple deployments | AskUserQuestion selection, cache choice |
| Git remote not configured | Error: "Cannot detect repository. Specify with --repo" |
| Finding references deleted file | "File not found. [Mark fixed] [Skip] [Enter path]" |
| Git working tree dirty on target file | "[Stash and proceed] [Abort]" |
| Autofix produces syntax errors | Discard, fall back to LLM |
| LLM fix does not resolve finding | Revert via `git checkout -- path`, report failure |
| LLM fix introduces new findings | Warn user, show new findings, ask to proceed |
| Finding already fixed locally (stale) | "Not present locally. [Mark fixed] [Skip]" |
| Finding ID not found in API response | "Finding {id} not found in 'fixing' state" |
| Triage POST returns partial failure | Parse succeeded/failed/skipped, report each |
| Rate limit (429) | Wait 60s, retry once |
| Same-file findings in batch | Re-fetch line numbers after each fix in same file |
| User rejects fix in batch | Skip finding, continue to next |
| Network failure mid-batch | Report progress, suggest re-running |
| Zero findings in "fixing" state | "No findings to fix. Run /semgrep:status to check." |

## Security Considerations

1. **Token never echoed:** Redact with `sed 's/sgp_[a-zA-Z0-9]*/***REDACTED***/g'`
2. **Triage POST uses explicit issue_ids:** NEVER use filter-based bulk triage
   without explicit IDs — prevents accidental mass state changes
3. **Content fencing:** All finding data, API responses, and code context from
   the affected file must be fenced per AGENTS.md rules
4. **JSON via jq:** Never interpolate user input or finding data into JSON
   strings — always use `jq --arg` / `jq --argjson`
5. **No curl -v or --trace:** Would leak Authorization headers
6. **Metrics off:** Pass `--metrics off` to all `semgrep scan` invocations
7. **Token validation uses REST `GET /api/v1/me`:** The built-in `semgrep mcp`
   server (v1.146.0+) does not expose a `whoami` tool, so REST is the only
   path for token validation. Historically, the standalone `semgrep-mcp`
   package's `semgrep_whoami` tool worked only with OAuth JWTs (not `sgp_`
   API tokens), which is why REST was already the correct choice.
8. **MCP tool name verification:** Must verify tool names empirically with
   ToolSearch after install — do not hardcode assumed names

## References

- [Brainstorm](../docs/brainstorms/2026-03-03-yellow-semgrep-plugin-implementation-brainstorm.md)
- [Research](../docs/research/semgrep-to-fix-fixer-claude-code-plugin-mcp.md)
- [Solution Doc](../docs/solutions/integration-issues/semgrep-mcp-appsec-plugin-architecture.md)
- [Plugin Template](../docs/plugin-template.md)
- [MCP Tool Naming Patterns](../docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md)
- [Shell Security Patterns](../docs/solutions/code-quality/yellow-ci-shell-security-patterns.md)
- [AGENTS.md](../AGENTS.md) — Content fencing, credential handling, tool naming
- [Semgrep API Docs](https://semgrep.dev/api/v1/docs/)
- Reference plugin: `plugins/yellow-devin/` (convention-mirroring source)
