---
name: devin:delegate
description: Create a Devin session with a task prompt. Use when user wants to delegate work to Devin, says "have Devin do X", "send this to Devin", or "delegate to Devin".
argument-hint: '<task description> [--tags t1,t2] [--max-acu N]'
allowed-tools:
  - Bash
  - Read
  - Skill
  - AskUserQuestion
---

# Delegate Task to Devin

Create a new Devin V3 session with the provided task description.

## Workflow

### Step 1: Validate Prerequisites

Check `jq` is available:

```bash
command -v jq >/dev/null 2>&1 || {
  printf 'ERROR: jq required. Install: https://jqlang.github.io/jq/download/\n' >&2
  exit 1
}
```

Validate `DEVIN_SERVICE_USER_TOKEN` is set and matches `cog_` prefix format. If
it starts with `apk_`, show migration message directing user to create a service
user. See `devin-workflows` skill for the `validate_token` function.

Validate `DEVIN_ORG_ID` is set and matches format. See `devin-workflows` skill
for the `validate_org_id` function.

### Step 2: Parse Arguments

Parse `$ARGUMENTS` for:

- **Task description:** All text not matching flags below
- **`--tags t1,t2`:** Optional comma-separated tags (max 10, each max 32 chars,
  alphanumeric + dashes)
- **`--max-acu N`:** Optional integer ACU limit

If task description is empty after parsing, ask user via AskUserQuestion.

Validate prompt length: max 8000 characters. On overflow, report actual count vs
maximum — never silently truncate.

### Step 3: Enrich Context

Generate a title from the first ~80 characters of the prompt (truncate at word
boundary).

If in a git repository, gather:

- Repository remote: `git remote get-url origin 2>/dev/null`
- Current branch: `git branch --show-current 2>/dev/null`

Extract `owner/repo` from remote URL for the `repos` field. Prepend context to
the prompt:

```
Repository: {remote_url}
Branch: {branch_name}

Task: {user_prompt}
```

Re-validate combined prompt length stays within 8000 characters.

### Step 4: Dedup Check (No idempotent Field in V3)

Before creating, search recent sessions for a matching title in active states:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ENTERPRISE_URL}/sessions?first=5&$(printf 'org_ids=%s' "$DEVIN_ORG_ID")" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Check for active sessions (status `new`, `claimed`, or `running`) with a
matching title. If found, ask via AskUserQuestion:

- "Similar session already active: {title} ({status}). Create a new one anyway?"
- Options: "Yes, create new" / "No, show existing"

If user declines, display the existing session details and stop.

### Step 5: Create Session

Construct JSON payload via `jq` and POST to V3 org-scoped endpoint:

```bash
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

# Build payload — only include optional fields if present
payload=$(jq -n \
  --arg prompt "$PROMPT" \
  --arg title "$TITLE" \
  --argjson tags "$TAGS_JSON" \
  --argjson repos "$REPOS_JSON" \
  '{prompt: $prompt, title: $title, tags: $tags, repos: $repos}')

# Add max_acu_limit if specified
if [ -n "$MAX_ACU" ]; then
  payload=$(printf '%s' "$payload" | jq --argjson acu "$MAX_ACU" '. + {max_acu_limit: $acu}')
fi

printf '%s' "$payload" | \
  curl -s --connect-timeout 5 --max-time 60 \
    -w "\n%{http_code}" \
    -X POST "${ORG_URL}/sessions" \
    -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

### Step 6: Handle Response

1. Check curl exit code — retry transient failures (exit 6, 7, 28) up to 3
   times with backoff
2. Extract HTTP status from `-w` output
3. Parse response body with `jq` — check jq exit code
4. Extract `session_id`, `status`, `url`, `title`

See `devin-workflows` skill for complete error handling patterns (all three
layers).

### Step 7: Report

Display:

- **Session ID**
- **Title**
- **Devin URL** (clickable link)
- **Status** (initial status, likely `new`)
- **ACUs:** 0.00 (initial)
- **Tags** (if any were set)

Suggest: "Use `/devin:status {session_id}` to check progress."

## Error Handling

See `devin-workflows` skill for error handling patterns (token validation, curl
errors, HTTP status codes, jq parse errors). All error output must sanitize
tokens: `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`.
