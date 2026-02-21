---
name: devin:archive
description: Archive a Devin session. Use when user wants to clean up old sessions, says "archive session", "hide session", or "clean up Devin sessions".
argument-hint: '<session-id>'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Archive Devin Session

Archive a session to hide it from default listing. Archived sessions remain
accessible via `/devin:status --archived`.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are set. Check `jq` is
available. See `devin-workflows` skill for validation functions.

### Step 2: Get Session ID

Parse `$ARGUMENTS` for a session ID. If empty, ask user via AskUserQuestion.

Validate with `validate_session_id` from `devin-workflows` skill.

### Step 3: Verify Session Exists (C1 Validation)

Fetch session to confirm it exists and check current state:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

If `is_archived` is already true:

- Report: "Session {id} is already archived."
- Stop.

### Step 4: Archive Session

POST to V3 archive endpoint (no request body):

```bash
response=$(curl -s --connect-timeout 5 --max-time 30 \
  -w "\n%{http_code}" \
  -X POST "${ORG_URL}/sessions/${SESSION_ID}/archive" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Check curl exit code, HTTP status, jq parse — see `devin-workflows` skill.

### Step 5: Report

Display confirmation:

- "Session {id} archived."
- Show title and final status.
- Suggest: "Use `/devin:status --archived` to view archived sessions."

## Error Handling

See `devin-workflows` skill for error handling patterns. All error output must
sanitize tokens.
