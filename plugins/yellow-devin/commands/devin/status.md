---
name: devin:status
description: >
  Check status of Devin sessions. Use when user asks "how's Devin doing",
  "check Devin status", "is my task done", or "what's the progress".
argument-hint: "[session-id]"
allowed-tools:
  - Bash
  - Skill
---

# Check Devin Session Status

Show status and progress for a specific session or list recent sessions.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_API_TOKEN` is set and matches format. See `devin-workflows` skill for validation.

### Step 2: Determine Mode

Parse `$ARGUMENTS`:
- **If a session ID is provided:** Validate format `^ses_[a-zA-Z0-9]{20,64}$`, then fetch that specific session.
- **If empty:** List recent sessions.

### Step 3a: Single Session Status

```bash
curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "https://api.devin.ai/v1/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $DEVIN_API_TOKEN"
```

Check curl exit code, HTTP status, jq parse — see `devin-workflows` skill.

Display:
- **Session ID**
- **Status** (with human-readable meaning from session status table in skill)
- **Devin URL** (clickable link)
- **PR URL** (if `pull_request_url` is present — show prominently)
- **Status info** (if `status_info` is present)
- **Structured output** (if `structured_output` is present, format as JSON)

Special handling:
- If status is `blocked` — highlight and suggest `/devin:message {id}` to unblock
- If status is `failed` — show error info and suggest remediation
- If status is `finished` — show completion summary and any artifacts

### Step 3b: List Recent Sessions

```bash
curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "https://api.devin.ai/v1/sessions?limit=10" \
  -H "Authorization: Bearer $DEVIN_API_TOKEN"
```

Check curl exit code, HTTP status, jq parse.

Display a compact table:
```
Session ID    | Status   | Created         | PR
ses_abc123... | running  | 2 hours ago     | —
ses_def456... | finished | 5 hours ago     | github.com/...
ses_ghi789... | blocked  | 1 day ago       | —
```

If no sessions found, report "No recent Devin sessions found."

## Error Handling

See `devin-workflows` skill for common error handling patterns.
