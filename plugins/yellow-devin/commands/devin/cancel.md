---
name: devin:cancel
description: Terminate a running Devin session. Use when user wants to stop a session, says "cancel Devin", "stop the session", or "kill that task".
argument-hint: '<session-id>'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Cancel Devin Session

Terminate a Devin session after user confirmation (M3 destructive operation).

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are set. Check `jq` is
available. See `devin-workflows` skill for validation functions.

### Step 2: Get Session ID

Parse `$ARGUMENTS` for a session ID. If empty, ask user via AskUserQuestion.

Validate session ID with `validate_session_id` from `devin-workflows` skill.

### Step 3: Fetch Current Status (C1 Validation)

Before cancelling, verify the session exists and is cancellable:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Check curl exit code, HTTP status, jq parse.

**Terminal states** (`exit`, `error`):

- Report: "Session is already {status} — nothing to cancel."
- Stop.

**Cancellable states:** `new`, `claimed`, `running`, `suspended`, `resuming`.

### Step 4: Confirm Cancellation (M3 — Destructive Operation)

Display session summary:

- Session ID
- Title (if present)
- Current status
- ACUs consumed

Ask user to confirm via AskUserQuestion:

- "Cancel session {id}? This will terminate the session and any work in
  progress."
- Options: "Yes, cancel" / "No, keep running"

If user declines, stop without cancelling.

### Step 4.5: Re-validate Before Cancellation (TOCTOU Protection)

Re-fetch session status to prevent race conditions:

```bash
response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

If session is now in a terminal state (`exit`, `error`):

- Report: "Session already {status} — no cancellation needed."
- Exit cleanly.

If still cancellable, proceed.

### Step 5: Terminate Session

V3 uses HTTP DELETE (not POST cancel like V1):

```bash
response=$(curl -s --connect-timeout 5 --max-time 30 \
  -w "\n%{http_code}" \
  -X DELETE "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Check curl exit code, HTTP status, jq parse.

**Note:** DELETE is idempotent per HTTP spec — may return 200 even if already
terminated. Check the response `status` field to confirm actual state.

### Step 6: Report

Display cancellation confirmation with final session status from the response.

- "Session {id} terminated."
- Show final status and ACUs consumed.

## Error Handling

See `devin-workflows` skill for error handling patterns. All error output must
sanitize tokens.
