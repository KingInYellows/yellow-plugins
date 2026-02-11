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
  - Skill
  - AskUserQuestion
---

# Delegate Task to Devin

Create a new Devin session with the provided task description.

## Workflow

### Step 1: Validate Prerequisites

Check `jq` is available:
```bash
command -v jq >/dev/null || { echo "ERROR: jq required. Install: https://jqlang.github.io/jq/download/"; exit 1; }
```

Validate `DEVIN_API_TOKEN` is set and matches format `^apk_(user_)?[a-zA-Z0-9_-]{20,128}$`. See `devin-workflows` skill for the validation function. If invalid, show setup instructions with link to `https://devin.ai/settings/api`.

### Step 2: Get Task Description

If `$ARGUMENTS` is empty, ask user for the task description via AskUserQuestion.

Validate prompt length: max 8000 characters. On overflow, report actual character count and the maximum — never silently truncate.

### Step 3: Enrich Context (Optional)

If the user is in a git repository, gather context to include:
- Current branch name: `git branch --show-current`
- Repository remote URL: `git remote get-url origin 2>/dev/null`

Prepend context to prompt if available:
```
Repository: {remote_url}
Branch: {branch_name}

Task: {user_prompt}
```

### Step 4: Create Session

Construct JSON payload via `jq` and POST to Devin API:

```bash
jq -n --arg prompt "$PROMPT" '{prompt: $prompt, idempotent: true}' | \
  curl -s --connect-timeout 5 --max-time 60 \
    -w "\n%{http_code}" \
    -X POST "https://api.devin.ai/v1/sessions" \
    -H "Authorization: Bearer $DEVIN_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

### Step 5: Handle Response

1. Check curl exit code — retry transient network failures (exit 6, 7, 28) up to 3 times
2. Extract HTTP status code from `-w` output
3. Parse response body with `jq` — check jq exit code
4. Extract `session_id`, `status`, `url`, `is_new_session`

See `devin-workflows` skill for complete error handling patterns.

### Step 6: Report

Display:
- Session ID
- Devin web URL (clickable link)
- Initial status
- If `is_new_session` is false, note that an existing session was returned (idempotent)

Suggest: "Use `/devin:status {session_id}` to check progress."

## Error Handling

See `devin-workflows` skill for common error handling patterns (token validation, curl errors, HTTP status codes, jq parse errors).
