---
title: "feat: Linear cross-plugin integration"
type: feat
date: 2026-02-22
brainstorm: docs/brainstorms/2026-02-22-linear-cross-plugin-integration-brainstorm.md
---

# feat: Linear Cross-Plugin Integration

## Overview

Four targeted additions that close the gap between Linear issues and the rest of the workflow toolchain. Architecture: caller-owns pattern — changes live in the plugin that initiates the workflow. No new plugin.

| # | Feature | Plugin | Type |
|---|---|---|---|
| 1 | Fix `/debt:sync` | yellow-debt | Edit existing command |
| 2 | `/linear:sync-all` | yellow-linear | New command |
| 3 | `/linear:delegate [issue-id]` | yellow-linear | New command |
| 4 | `/ci:report-linear [run?]` | yellow-ci | New command |

## Problem Statement

- **debt:sync is stubbed:** `ISSUE_ID="ISSUE_UUID_${TODO_ID}"` placeholders, Linear MCP calls commented out, `extract_frontmatter`/`update_frontmatter` helpers referenced but absent from `lib/validate.sh`, rollback uses `printf` instead of `AskUserQuestion`
- **Linear issues go stale:** merged PRs leave issues In Progress indefinitely; no batch status audit
- **Manual Devin handoff:** copying Linear issue context into a Devin prompt is manual and lossy
- **CI failures don't enter the backlog:** `failure-analyst` produces reports that disappear unless manually filed

## Proposed Solution

### Caller-Owns Architecture

Each integration lives in the plugin that *starts* the workflow. MCP tools are globally registered — any installed plugin can call `mcp__plugin_linear_linear__*` tools. Cross-plugin integration = correct placement + graceful degradation (fail-fast if partner plugin not installed).

**Graceful degradation canonical pattern** (from `chatprd:link-linear`):
```
Step 1: Attempt mcp__plugin_linear_linear__list_teams
        → If tool missing: print install instructions, stop
```

For Devin integration: check `DEVIN_SERVICE_USER_TOKEN` + `DEVIN_ORG_ID` env vars instead of MCP tool detection (yellow-devin uses curl/Bash, not MCP, for session creation).

---

## Implementation

### 1. Fix `/debt:sync` — `plugins/yellow-debt/commands/debt/sync.md`

**What's broken:**
- `allowed-tools` missing all `mcp__plugin_linear_linear__*` tools and `AskUserQuestion`
- `EXISTING_ISSUE=""` (always empty — dedup never fires)
- `ISSUE_ID="ISSUE_UUID_${TODO_ID}"` (placeholder UUID)
- `extract_frontmatter` / `update_frontmatter` helpers don't exist in `lib/validate.sh`
- Rollback uses `printf` instead of `AskUserQuestion`
- `list_teams` / `list_projects` MCP calls marked "(not implemented)"

**Changes:**

**allowed-tools additions:**
```yaml
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_projects
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_issue_labels
  - mcp__plugin_linear_linear__create_issue
  - mcp__plugin_linear_linear__create_issue_label
```

**Step 1 — Graceful degradation check:**
Attempt `list_teams`. If tool unavailable, print:
```
yellow-linear is not installed. Install it first:
  /plugin marketplace add KingInYellows/yellow-plugins yellow-linear
```

**Step 2 — Team/project resolution (replace stubs):**
- Call `list_teams`, match `--team` arg (case-insensitive), extract `teamId`
- Call `list_projects` filtered by team, match `--project` arg, extract `projectId`
- If no match, `AskUserQuestion` with list of teams/projects

**Step 3 — Label resolution (replace stub):**
- Call `list_issue_labels` for the team
- If "technical-debt" label exists, use its `id`
- If not found: `AskUserQuestion` — "Create 'technical-debt' label? [Yes / Choose existing / Skip]"
  - Yes → `create_issue_label` with name "technical-debt", color `#F59E0B`
  - Choose existing → present list via `AskUserQuestion`
  - Skip → create issues without label

**Step 4 — Replace frontmatter helpers with inline yq:**
```bash
# Replace extract_frontmatter calls:
linear_id=$(yq -r '.linear_issue_id // ""' "$todo_file")

# Replace update_frontmatter calls:
yq -i ".linear_issue_id = \"$ISSUE_ID\"" "$todo_file"
```

**Step 5 — Replace dedup stub:**
Call `list_issues` filtered by the "technical-debt" label, limit 50. Scan results for an issue whose `title` exactly matches the current finding's title. If found, skip creation and record as already-synced in the summary.

**Step 6 — Replace issue creation stub:**
Call `create_issue` with `{title, description, teamId, labelIds, projectId, priority}`.
Extract `id` and `identifier` from response. Write back to frontmatter via yq.

**Step 7 — Replace rollback printf with AskUserQuestion:**
On mid-batch failure, use `AskUserQuestion` with options: "Retry failed items / Skip failed / Roll back created issues"
Rollback: the command already tracks `CREATED_ISSUES` array — delete via Linear UI link (Linear MCP has no `delete_issue`; note this limitation, provide direct URLs instead).

---

### 2. `/linear:sync-all` — `plugins/yellow-linear/commands/linear/sync-all.md`

New command. Pure Linear audit — no cross-plugin dependencies.

**Frontmatter:**
```yaml
---
name: linear:sync-all
description: "Audit open Linear issues and close ones with merged PRs. Use when you want to catch up on stale In Progress / In Review issues that were never transitioned to Done."
argument-hint: '[--team <name>]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__update_issue
---
```

**Workflow:**

**Step 1 — Resolve team:**
Match `--team` arg or auto-detect from git remote. `AskUserQuestion` if ambiguous.

**Step 2 — Fetch active statuses dynamically:**
Call `list_issue_statuses`. Never hardcode "In Progress" or "In Review". Filter to statuses with `type` in `["started", "inReview"]` or equivalent.

**Step 3 — Fetch open issues in those statuses:**
`list_issues` with status filter, limit 50. Warn if `pageInfo.hasNextPage` is true.

**Step 4 — For each issue, detect PR:**
Extract candidate branch names from `issue.identifier` (pattern: `feat/TEAM-123-*`, `fix/TEAM-123-*`).
```bash
gh pr list --search "head:$(echo "$IDENTIFIER" | tr '[:upper:]' '[:lower:]')" \
  --json number,state,mergedAt,title --limit 5
```
Classify each issue:
- PR merged → candidate for **Done**
- PR closed (not merged) → candidate for **Cancelled** or **Backlog**
- PR open → no change suggested
- No PR found → flag as potentially stale (no suggestion, just surface)

**Step 5 — Present findings and confirm:**
Display a table of proposed transitions. `AskUserQuestion` — "Apply these transitions? [Yes / Select individually / Cancel]"
For batch >5 issues: mandatory confirmation shows count and summary.

**Step 6 — Apply (H1 TOCTOU + rate limiting):**
For each update:
1. Re-fetch via `get_issue` (H1: compare status still matches what user saw)
2. If state changed: skip + report conflict
3. Apply `update_issue` with new `stateId`
4. Delay 200ms between writes; exponential backoff on 429

**Step 7 — Report:**
Show updated / skipped (conflicts) / skipped (no PR) / flagged (stale) counts.

---

### 3. `/linear:delegate [issue-id]` — `plugins/yellow-linear/commands/linear/delegate.md`

New command. Linear → Devin handoff. Uses curl (matching yellow-devin's `delegate.md` pattern) rather than Devin MCP tools, since yellow-devin's session creation uses the REST API directly.

**Frontmatter:**
```yaml
---
name: linear:delegate
description: "Delegate a Linear issue to a Devin AI session. Use when you want to hand off an issue to Devin for implementation. Requires yellow-devin credentials (DEVIN_SERVICE_USER_TOKEN, DEVIN_ORG_ID)."
argument-hint: '[issue-id]'
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_linear_linear__get_issue
  - mcp__plugin_linear_linear__list_issue_statuses
  - mcp__plugin_linear_linear__update_issue
  - mcp__plugin_linear_linear__create_comment
  - mcp__plugin_linear_linear__list_comments
---
```

**Workflow:**

**Step 1 — Validate Devin credentials (graceful degradation):**
```bash
if [ -z "${DEVIN_SERVICE_USER_TOKEN:-}" ] || [ -z "${DEVIN_ORG_ID:-}" ]; then
  echo "Devin credentials not found. Install yellow-devin and set:"
  echo "  DEVIN_SERVICE_USER_TOKEN=cog_..."
  echo "  DEVIN_ORG_ID=..."
  exit 1
fi
```
Token must match `^cog_[A-Za-z0-9]{20,}$`.

**Step 2 — Resolve and validate issue (C1):**
Extract issue ID from `$ARGUMENTS` or `git branch --show-current`.
Validate format: `^[A-Z]{2,5}-[0-9]{1,6}$`. Strip HTML from any argument.
Call `get_issue` — if not found, stop with error.

**Step 3 — Display issue and confirm:**
Show: identifier, title, priority, description, acceptance criteria.
`AskUserQuestion` — "Delegate this issue to Devin?" with optional additional context field.

**Step 4 — Build enriched Devin prompt:**
```
Repository: <git remote url>
Branch: feat/<TEAM-ID>-<slug> (create this branch if it doesn't exist)
Issue: <identifier> — <title>
Priority: <priority>

Description:
<issue description>

Acceptance Criteria:
<extracted from description or issue fields>

Additional context:
<user-provided from Step 3>
```
Validate combined prompt ≤ 8000 chars; truncate description if needed.

**Step 5 — Create Devin session via REST API:**
```bash
ORG_URL="https://api.cognition.ai/enterprise/orgs/${DEVIN_ORG_ID}"
RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${ORG_URL}/sessions" \
  -H "Authorization: Bearer ${DEVIN_SERVICE_USER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg prompt "$PROMPT" \
    --argjson tags '["linear"]' \
    '{prompt: $prompt, tags: $tags}')")
```
Retry on curl exit 6/7/28 (network), exponential backoff 1s/2s/4s, max 3 attempts.
Extract session `id` and `url` from response.

**Step 6 — Add comment on Linear issue (M3 — show before writing):**
Build comment:
```
🤖 Delegated to Devin

Session: <session url>
Status: Starting

Branch convention: feat/<TEAM-ID>-<description>
```
Check existing comments via `list_comments` for dedup (any comment containing the session URL).
`AskUserQuestion` — "Post this comment to the Linear issue? [Yes / No]"
If yes: `create_comment`.

**Step 7 — Suggest status transition:**
`AskUserQuestion` — "Transition to In Progress? [Yes / No]"
If yes: `list_issue_statuses`, find In Progress state, `update_issue` (H1: re-fetch first).

---

### 4. `/ci:report-linear [run?]` — `plugins/yellow-ci/commands/ci/report-linear.md`

New command. CI failure → Linear bug. Reuses `failure-analyst` agent for diagnosis.

**Frontmatter:**
```yaml
---
name: ci:report-linear
description: "Diagnose a CI failure and create a Linear bug issue. Use when CI has failed and you want to track the fix in Linear. Requires yellow-linear to be installed."
argument-hint: '[run-id] [--repo owner/name]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
  - Task
  - mcp__plugin_linear_linear__list_teams
  - mcp__plugin_linear_linear__list_issues
  - mcp__plugin_linear_linear__list_issue_labels
  - mcp__plugin_linear_linear__create_issue
  - mcp__plugin_linear_linear__create_issue_label
---
```

**Workflow:**

**Step 1 — Graceful degradation check:**
Attempt `list_teams`. If tool unavailable:
```
yellow-linear is not installed. Install it first:
  /plugin marketplace add KingInYellows/yellow-plugins yellow-linear
```

**Step 2 — Resolve team and run ID:**
Auto-detect team from git remote (same pattern as other linear commands).
If `$ARGUMENTS` contains a run ID matching `^[1-9][0-9]{0,19}$`, use it.
Otherwise, fetch latest failed run: `gh run list --status failure --limit 1 --json databaseId`.

**Step 3 — Diagnose via failure-analyst agent:**
```
Delegate to Task: failure-analyst agent
  Pass: run ID, run URL, repo, branch, failed job names
  Receive: structured failure report (F-code, root cause, affected files)
```

**Step 4 — Check for duplicate Linear issue:**
Call `list_issues` filtered by "ci-failure" label and open status.
Search for existing issue with matching workflow name in title.
If duplicate found: display the existing issue URL and stop. Let the user decide whether to update it manually or proceed to creating a new one by re-running the command.

**Step 5 — Propose bug to user (M3):**
Build proposed issue:
```
Title: fix(ci): <workflow name> failing — <F-code root cause>
Description:
## CI Failure Report

**Run:** <run URL>
**Workflow:** <name>
**Branch:** <branch>
**Failed step:** <step name>
**Pattern:** <F-code>

### Root Cause
<failure-analyst summary>

### Error Output
<truncated error — max 1000 chars>

### Suggested Fix
<failure-analyst recommendation>
```
Display to user. `AskUserQuestion` — "Create this Linear issue? [Yes / Edit title / Cancel]"

**Step 6 — Resolve "ci-failure" label:**
Same pattern as debt:sync: `list_issue_labels` → find or create "ci-failure" label.

**Step 7 — Create issue:**
Call `create_issue`. Return identifier and URL.
Offer: "Run `/linear:delegate <identifier>` to hand this to Devin?"

---

## Technical Considerations

### MCP Tool Naming
All Linear MCP tools use prefix `mcp__plugin_linear_linear__*` because the Linear MCP server (hosted at `https://mcp.linear.app/mcp`) is a standalone plugin with `name: linear` and server key `linear`.

### Devin API (for `/linear:delegate`)
Session creation uses the V3 REST API via curl — NOT Devin MCP tools. This matches the pattern established in `yellow-devin/commands/devin/delegate.md`. Benefits: no dependency on yellow-devin being installed, no uncertain MCP tool names.

### Description Format
New commands must use **single-line** description strings (NOT `description: >` folded scalar). Per project memory, the folded scalar is not parsed by Claude Code's frontmatter parser.

### No plugin.json changes needed
All three plugins rely on auto-discovery. No `commands` array in their manifests.

### `yq` dependency for debt:sync
The existing `debt:sync` uses `yq` for frontmatter parsing. This dependency should be documented but already exists in the command.

---

## Acceptance Criteria

### `/debt:sync` (fixed)
- [ ] Calls `mcp__plugin_linear_linear__list_teams` as Step 1; fails fast if yellow-linear not installed
- [ ] Resolves team by name (case-insensitive) via `list_teams`; prompts if no match
- [ ] Resolves project by name via `list_projects`; prompts if no match
- [ ] Resolves "technical-debt" label via `list_issue_labels`; offers to create if missing
- [ ] Dedup check: `list_issues` filtered by label + title match before creating
- [ ] Creates issue via `create_issue` with real response extraction
- [ ] Writes real `linear_issue_id` back to todo frontmatter via `yq`
- [ ] Rollback prompt via `AskUserQuestion` (not printf) on mid-batch failure
- [ ] `allowed-tools` includes all `mcp__plugin_linear_linear__*` tools called

### `/linear:sync-all`
- [ ] Fetches active statuses dynamically (no hardcoded status names)
- [ ] Detects PR merge/close via `gh pr list` by issue identifier pattern
- [ ] Presents proposed transitions table before any writes
- [ ] H1 TOCTOU re-fetch + conflict detection before each `update_issue`
- [ ] Rate limiting: 200ms delay between writes, exponential backoff on 429
- [ ] Description is single-line string (not folded scalar)

### `/linear:delegate`
- [ ] Validates `DEVIN_SERVICE_USER_TOKEN` (`cog_` prefix) and `DEVIN_ORG_ID` before any work
- [ ] C1: calls `get_issue` to validate issue exists before proceeding
- [ ] Enriched prompt includes repo, branch convention, title, description, AC
- [ ] Creates session via Devin REST API (curl), not MCP tools
- [ ] Dedup: checks `list_comments` before posting comment
- [ ] M3: `AskUserQuestion` before `create_comment`
- [ ] M3: `AskUserQuestion` before `update_issue` status transition
- [ ] Graceful degradation message includes install instructions for yellow-devin
- [ ] Description is single-line string

### `/ci:report-linear`
- [ ] Step 1: `list_teams` as graceful degradation check
- [ ] Delegates to `failure-analyst` agent via Task
- [ ] Dedup check: searches existing "ci-failure" issues before creating
- [ ] M3: proposes full issue content via `AskUserQuestion` before `create_issue`
- [ ] Finds or creates "ci-failure" label
- [ ] Returns Linear issue URL at completion
- [ ] Description is single-line string
- [ ] `Task` in allowed-tools (required for failure-analyst delegation)

## Dependencies & Risks

**yellow-linear must be installed** for debt:sync and ci:report-linear. Both check and fail fast with instructions.

**yellow-devin credentials** (`DEVIN_SERVICE_USER_TOKEN`, `DEVIN_ORG_ID`) must be set for `/linear:delegate`. Command validates at Step 1.

**`yq` must be installed** for debt:sync frontmatter operations. Already a dependency in existing command — document in README.

**Linear MCP has no `delete_issue`** — rollback in debt:sync can only provide issue URLs for manual deletion, not automate it. Mention this limitation explicitly in the rollback `AskUserQuestion`.

**Branch name detection for sync-all is heuristic** — if branch names don't follow `type/TEAM-123-*` convention, PRs won't be found. Surface these as "no PR found / potentially stale" and let user handle manually.

## Implementation Order

1. `/linear:sync-all` — standalone, tests the pattern, no external dependencies
2. Fix `/debt:sync` — stub already exists, wiring is mechanical
3. `/ci:report-linear` — new command, follows established patterns
4. `/linear:delegate` — most complex (Devin API + branch convention question)

## References

### Internal
- Graceful degradation pattern: `plugins/yellow-chatprd/commands/chatprd/link-linear.md`
- Devin REST API pattern: `plugins/yellow-devin/commands/devin/delegate.md`
- C1/H1/M3 security patterns: `plugins/yellow-linear/skills/linear-workflows/SKILL.md`
- failure-analyst agent: `plugins/yellow-ci/agents/ci/failure-analyst.md`
- MCP tool naming: `docs/solutions/integration-issues/mcp-bundled-server-tool-naming-and-plugin-authoring-patterns.md`

