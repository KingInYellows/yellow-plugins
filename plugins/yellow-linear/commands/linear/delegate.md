---
name: linear:delegate
description: "Delegate a Linear issue to a Devin AI session. Use when you want to hand off an issue to Devin for autonomous implementation. Requires Devin credentials (DEVIN_SERVICE_USER_TOKEN, DEVIN_ORG_ID)."
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

# Delegate Linear Issue to Devin

Fetch a Linear issue and create a Devin AI session with full context for
autonomous implementation.

## Requirements

- `DEVIN_SERVICE_USER_TOKEN` environment variable set (`cog_` prefix)
- `DEVIN_ORG_ID` environment variable set
- `jq` and `curl` available

## Arguments

- `[issue-id]` — Linear issue identifier (e.g., `ENG-123`). If omitted,
  extracted from current branch name.

## Workflow

### Step 1: Validate Devin Credentials (Graceful Degradation)

```bash
if [ -z "${DEVIN_SERVICE_USER_TOKEN:-}" ] || [ -z "${DEVIN_ORG_ID:-}" ]; then
  printf 'Devin credentials not found.\n'
  printf 'Install yellow-devin and set the following environment variables:\n'
  printf '  DEVIN_SERVICE_USER_TOKEN=cog_...\n'
  printf '  DEVIN_ORG_ID=...\n'
  printf '\nInstall: /plugin marketplace add KingInYellows/yellow-plugins yellow-devin\n'
  exit 1
fi
```

Validate token format:
```bash
if ! printf '%s' "$DEVIN_SERVICE_USER_TOKEN" | grep -qE '^cog_[A-Za-z0-9]{20,}$'; then
  printf 'ERROR: DEVIN_SERVICE_USER_TOKEN format invalid (expected cog_...)\n' >&2
  exit 1
fi
```

Validate org ID (non-empty, no shell-special characters):
```bash
if ! printf '%s' "$DEVIN_ORG_ID" | grep -qE '^[a-zA-Z0-9_-]{1,128}$'; then
  printf 'ERROR: DEVIN_ORG_ID format invalid\n' >&2
  exit 1
fi
```

### Step 2: Resolve Issue ID (C1 Validation)

Extract issue ID from `$ARGUMENTS`. If empty, extract from branch name:
```bash
BRANCH=$(git branch --show-current 2>/dev/null)
ISSUE_ID=$(printf '%s' "$BRANCH" | grep -oE '[A-Z]{2,5}-[0-9]{1,6}' | head -1)
```

Validate format: `^[A-Z]{2,5}-[0-9]{1,6}$`. Strip any HTML. If still empty or
invalid, prompt via `AskUserQuestion`.

**C1 validation**: Call `get_issue` with the resolved ID. If not found or access
denied, stop with an error message. Do not proceed with an unverified issue.

### Step 3: Display Issue and Confirm Delegation

Display the issue summary:
```
Issue:       ENG-123 — Add user authentication
Priority:    High
Status:      Backlog
Description: <first 300 chars of description>
```

Use `AskUserQuestion` — "Delegate this issue to Devin? [Yes / Cancel]"

If Yes, also ask: "Any additional instructions for Devin? (Leave blank to skip)"
Collect the optional free-text input via the "Other" option.

### Step 4: Build Enriched Devin Prompt

Construct the session prompt:

```
Repository: <git remote get-url origin>
Branch: <suggest branch name: feat/<TEAM-ID-lowercase>-<slug from title>>

Issue: <identifier> — <title>
Priority: <priority label>

## Description
<full issue description>

## Acceptance Criteria
<extracted from issue description if present, or issue body>

## Branch Naming Convention
Use: feat/<TEAM-IDENTIFIER>-<short-slug>
Example: feat/eng-123-add-user-auth

<additional instructions from user if provided>
```

Get the full description from the `get_issue` response (already fetched in Step 2).

Validate combined prompt length:
```bash
PROMPT_LEN=${#PROMPT}
if [ "$PROMPT_LEN" -gt 8000 ]; then
  # Truncate description to fit within 8000 chars total
  printf '[delegate] Prompt truncated to 8000 chars\n' >&2
fi
```

### Step 5: Create Devin Session via REST API

```bash
ORG_URL="https://api.cognition.ai/enterprise/orgs/${DEVIN_ORG_ID}"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${ORG_URL}/sessions" \
  -H "Authorization: Bearer ${DEVIN_SERVICE_USER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg prompt "$PROMPT" \
    --argjson tags '["linear"]' \
    '{prompt: $prompt, tags: $tags}')")
```

Extract HTTP status code (last line) and body (remaining):
```bash
HTTP_STATUS=$(printf '%s' "$RESPONSE" | tail -1)
BODY=$(printf '%s' "$RESPONSE" | head -n -1)
```

**Retry on network failure** (curl exit 6/7/28): exponential backoff 1s → 2s → 4s,
max 3 attempts. On 429: apply backoff and retry. On 4xx other than 429: stop with
error message (do not retry — likely auth or validation issue).

Extract session details:
```bash
SESSION_ID=$(printf '%s' "$BODY" | jq -r '.session_id // .id // empty')
SESSION_URL=$(printf '%s' "$BODY" | jq -r '.url // empty')
```

If `SESSION_ID` is empty after successful HTTP response, report the raw response
and exit.

### Step 6: Post Comment on Linear Issue (M3)

Build comment content:
```
🤖 Delegated to Devin

**Session:** <SESSION_URL>
**Status:** Starting

**Branch convention:** feat/<team-id-lowercase>-<description>
```

**Dedup check**: Call `list_comments` on the issue. Scan for any existing comment
whose body contains `SESSION_URL`. If found, skip comment creation and report
"Comment already posted."

**M3 confirmation**: Display the comment above via `AskUserQuestion` — "Post this
comment to the Linear issue? [Yes / No]"

If Yes: Call `create_comment` with the built body.

### Step 7: Suggest Status Transition (Optional)

Use `AskUserQuestion` — "Transition issue to In Progress? [Yes / No]"

If Yes:
1. Call `list_issue_statuses` for the issue's team
2. Find the status whose `type` is `started` (In Progress equivalent)
3. **H1 re-fetch**: Call `get_issue` again to check current status
4. If status has changed since Step 2: report the new status and skip the update
5. If still same: Call `update_issue` with the new `stateId`

### Step 8: Report

```
✓ Devin session created
  Session: <SESSION_URL>
  Issue:   ENG-123 — Add user authentication

Next steps:
  - Monitor session: /devin:status <SESSION_ID>
  - Send instructions: /devin:message <SESSION_ID> <message>
  - Check PR: gh pr list --search "head:eng-123"
```

## Security Patterns

- **Credential validation**: Token format checked before any API call
- **C1**: `get_issue` validates issue exists before delegation
- **H1**: Re-fetch before status transition
- **M3**: `AskUserQuestion` before both `create_comment` and `update_issue`
- **Token never echoed**: All token references use env var only; never print or
  log the token value
- **No shell injection**: Prompt built via `jq -n --arg`, not string interpolation

## Error Handling

| Error | Action |
|-------|--------|
| Devin credentials missing | Exit at Step 1 with install instructions |
| Token format invalid | Exit with format guidance |
| Issue not found (C1 fail) | Exit with "Issue ENG-123 not found in Linear" |
| Curl network error | Retry up to 3x with exponential backoff |
| 401 / 403 from Devin API | Exit: "Check DEVIN_SERVICE_USER_TOKEN is valid" |
| 429 from Devin API | Backoff and retry |
| Session URL missing in response | Show raw response, exit |
| Status transition conflict (H1) | Skip transition, report new current status |
