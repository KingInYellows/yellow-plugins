---
name: devin:message
description: >
  Send a follow-up message to an active Devin session. Use when user wants
  to give Devin additional context, says "tell Devin to...", "update Devin",
  or "send message to session".
argument-hint: "<session-id> <message>"
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Send Message to Devin Session

Send a follow-up message to provide additional context, instructions, or course corrections to an active Devin session.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_API_TOKEN` is set and matches format, and ensure `jq` is installed using the standard `command -v jq` pattern from the `devin-workflows` skill.

### Step 2: Parse Arguments

Parse `$ARGUMENTS`:
- First token is the session ID
- Remaining text is the message

If session ID or message is missing, prompt via AskUserQuestion.

### Step 3: Validate Inputs

- **Session ID:** Must match `^ses_[a-zA-Z0-9]{20,64}$`
- **Message:** Max 2000 characters. On overflow, report actual count vs maximum — never truncate.

### Step 4: Verify Session State (C1 Validation)

Fetch session status to confirm it's in a messageable state:

```bash
response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "https://api.devin.ai/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $DEVIN_API_TOKEN")
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}
```

The session must be `running` or `blocked` to accept messages. If not in a messageable state, determine the appropriate error message:

**Terminal states** (`finished`, `stopped`, `failed`):
- Report "Session is {status} — cannot send messages to a completed session."
- Stop.

**Not-yet-running states** (`queued`, `started`):
- Report "Session is {status} — waiting to start. Try again shortly or use /devin:status to monitor."
- Stop.

### Step 5: Send Message

Construct JSON via `jq` and POST:

```bash
response=$(jq -n --arg msg "$MESSAGE" '{message: $msg}' | \
  curl -s --connect-timeout 5 --max-time 30 \
    -w "\n%{http_code}" \
    -X POST "https://api.devin.ai/v1/sessions/$SESSION_ID/messages" \
    -H "Authorization: Bearer $DEVIN_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-)
curl_exit=$?
http_status=${response##*$'\n'}
body=${response%$'\n'*}
```

Check curl exit code, HTTP status, jq parse.

### Step 6: Report

Display confirmation that the message was sent. Include session status after sending.

Suggest: "Use `/devin:status {session_id}` to check progress."

## Error Handling

See `devin-workflows` skill for common error handling patterns.
