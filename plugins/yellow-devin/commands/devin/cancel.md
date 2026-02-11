---
name: devin:cancel
description: >
  Terminate a running Devin session. Use when user wants to stop a session,
  says "cancel Devin", "stop the session", or "kill that task".
argument-hint: "<session-id>"
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Cancel Devin Session

Terminate a running Devin session after user confirmation.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_API_TOKEN` is set and matches format. See `devin-workflows` skill.

### Step 2: Get Session ID

Parse `$ARGUMENTS` for a session ID. If empty, ask user via AskUserQuestion.

Validate session ID format: `^ses_[a-zA-Z0-9]{20,64}$`. Reject if invalid.

### Step 3: Fetch Current Status (C1 Validation)

Before cancelling, verify the session exists and is in a cancellable state:

```bash
curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "https://api.devin.ai/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $DEVIN_API_TOKEN"
```

Check curl exit code, HTTP status, jq parse.

If session is already in a terminal state (`finished`, `stopped`, `failed`):
- Report "Session is already {status} — nothing to cancel."
- Stop.

### Step 4: Confirm Cancellation (M3 — Destructive Operation)

Display session summary:
- Session ID
- Current status
- How long it has been running

Ask user to confirm cancellation via AskUserQuestion:
- "Cancel session {id}? This will terminate the session and any work in progress."
- Options: "Yes, cancel" / "No, keep running"

If user declines, stop without cancelling.

### Step 5: Cancel Session

```bash
curl -s --connect-timeout 5 --max-time 30 \
  -w "\n%{http_code}" \
  -X POST "https://api.devin.ai/v1/sessions/$SESSION_ID/cancel" \
  -H "Authorization: Bearer $DEVIN_API_TOKEN"
```

**Note:** If `POST .../cancel` returns 404 or 405, try `DELETE /v1/sessions/{id}` as fallback — the correct endpoint needs verification during implementation.

Check curl exit code, HTTP status.

### Step 6: Report

Display cancellation confirmation or error. If successful, show final session status.

## Error Handling

See `devin-workflows` skill for common error handling patterns.
