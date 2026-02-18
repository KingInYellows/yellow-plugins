---
name: devin:message
description: Send a follow-up message to an active Devin session. Use when user wants to give Devin additional context, says "tell Devin to...", "update Devin", or "send message to session".
argument-hint: '<session-id> <message>'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Send Message to Devin Session

Send a follow-up message to provide additional context, instructions, or course
corrections to a Devin session.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are set. Check `jq` is
available. See `devin-workflows` skill for validation functions.

### Step 2: Parse Arguments

Parse `$ARGUMENTS`:

- First token is the session ID
- Remaining text is the message

If session ID or message is missing, prompt via AskUserQuestion.

### Step 3: Validate Inputs

- **Session ID:** Validate with `validate_session_id` from `devin-workflows`
  skill — `^[a-zA-Z0-9_-]{8,64}$`
- **Message:** Max 2000 characters. On overflow, report actual count vs maximum
  — never truncate.

### Step 4: Verify Session State (C1 Validation)

Fetch session status from V3 org-scoped endpoint:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Check session status against messageable states:

**Messageable states:**

- `running` — proceed normally
- `suspended` — inform user: "Session is suspended. Sending a message will
  auto-resume it." Then proceed.

**Not messageable:**

- `resuming` — report: "Session is resuming. Wait a moment and try again, or
  use `/devin:status {id}` to check."
- `new`, `claimed` — report: "Session is {status} — waiting to start. Try again
  shortly or use `/devin:status` to monitor."
- `exit`, `error` (terminal) — report: "Session is {status} — cannot send
  messages to a completed session."

### Step 5: Send Message

Construct JSON via `jq` and POST to V3 enterprise endpoint:

```bash
ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"

response=$(jq -n --arg msg "$MESSAGE" '{message: $msg}' | \
  curl -s --connect-timeout 5 --max-time 30 \
    -w "\n%{http_code}" \
    -X POST "${ENTERPRISE_URL}/sessions/${SESSION_ID}/messages" \
    -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-)
```

**Never use the `message_as_user_id` field** — impersonation risk.

Check curl exit code, HTTP status, jq parse — see `devin-workflows` skill.

### Step 6: Report

Display confirmation with updated session status from the response.

If the session was `suspended` and is now `resuming`:

- "Message sent. Session is resuming from suspended state."
- Suggest: "Use `/devin:status {id}` to check when it's running."

Otherwise:

- "Message sent to session {id}."
- Show current status.
- Suggest: "Use `/devin:status {id}` to check progress."

## Error Handling

See `devin-workflows` skill for error handling patterns. All error output must
sanitize tokens.
