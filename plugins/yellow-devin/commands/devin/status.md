---
name: devin:status
description: Check status of Devin sessions. Use when user asks "how's Devin doing", "check Devin status", "is my task done", or "what's the progress".
argument-hint: '[session-id] [--tag TAG] [--status STATUS] [--archived]'
allowed-tools:
  - Bash
  - Skill
  - AskUserQuestion
---

# Check Devin Session Status

Show status and progress for a specific session or list recent sessions.

## Workflow

### Step 1: Validate Prerequisites

Validate `DEVIN_SERVICE_USER_TOKEN` and `DEVIN_ORG_ID` are set. See
`devin-workflows` skill for validation functions.

Check `jq` is available:

```bash
command -v jq >/dev/null 2>&1 || {
  printf 'ERROR: jq required. Install: https://jqlang.github.io/jq/download/\n' >&2
  exit 1
}
```

### Step 2: Determine Mode

Parse `$ARGUMENTS`:

- **If a session ID is provided:** Validate with `validate_session_id` from
  `devin-workflows` skill, then fetch that specific session.
- **If empty (or only flags):** List recent sessions.

Parse optional flags:

- `--tag TAG` — filter list by tag
- `--status STATUS` — filter by status (e.g., `running`, `exit`, `error`)
- `--archived` — include archived sessions

### Step 3a: Single Session Status

Fetch from V3 org-scoped endpoint:

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"

response=$(curl -s --connect-timeout 5 --max-time 10 \
  -w "\n%{http_code}" \
  -X GET "${ORG_URL}/sessions/${SESSION_ID}" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
```

Check curl exit code, HTTP status, jq parse — see `devin-workflows` skill.

**Display format:**

```text
Session: {session_id}
Title:   {title}
Status:  {status}
URL:     {url}
ACUs:    {acus_consumed} ACUs
Tags:    {tags, comma-separated}
Created: {created_at, formatted}
Updated: {updated_at, formatted}
```

If `is_archived` is true, show `[ARCHIVED]` badge after status.

**PRs table** (if `pull_requests` array is non-empty):

```text
PRs:
  #  | State  | URL
  1  | open   | github.com/org/repo/pull/42
  2  | merged | github.com/org/repo/pull/43
```

**Structured output** (if `structured_output` is present, format as JSON).

**Special handling by status:**

- `suspended` — highlight and suggest: "Session is paused. Send a message with
  `/devin:message {id}` to auto-resume it."
- `error` — show error context and suggest remediation
- `exit` — show completion summary and any artifacts
- `new`/`claimed` — note session is initializing

Use the `format_timestamp` helper from `devin-workflows` skill api-reference to
format Unix timestamps as relative time for recent sessions, absolute date for
older ones.

### Step 3b: List Recent Sessions

Fetch from V3 enterprise endpoint with cursor pagination:

```bash
ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"
url="${ENTERPRISE_URL}/sessions?first=10"
url="${url}&$(jq -nr --arg org "$DEVIN_ORG_ID" '@uri "org_ids=\($org)"')"
```

Apply filters if provided:

- `--tag TAG` → append `&tags=TAG`
- `--status STATUS` → not a direct API filter; filter client-side from response
  (note: filters the fetched page only — sessions with that status may exist on
  subsequent pages)
- `--archived` → include archived sessions in display (by default, hide
  `is_archived: true` sessions)

Check curl exit code, HTTP status, jq parse.

**Display as table:**

```text
Session ID     | Status    | Title          | ACUs  | PRs | Created
abc123def4...  | running   | Auth feature   | 2.50  | 1   | 2h ago
def456ghi7...  | exit      | Bug fix #42    | 1.20  | 1   | 5h ago
ghi789jkl0...  | suspended | Refactor API   | 0.80  | 0   | 1d ago
```

If no sessions found, report "No recent Devin sessions found."

**Pagination:** If `has_next_page` is true, ask via AskUserQuestion:

- "Showing 10 sessions. Show more?"
- Options: "Yes, show next page" / "No, that's enough"

If user wants more, fetch next page using `end_cursor` from response.

## Error Handling

See `devin-workflows` skill for error handling patterns. All error output must
sanitize tokens.
