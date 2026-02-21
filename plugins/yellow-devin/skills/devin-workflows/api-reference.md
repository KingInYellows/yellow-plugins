# Devin API V3 Reference

Base URL: `https://api.devin.ai/v3beta1/`

Authentication: `Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN`

Headers: `Content-Type: application/json` for all POST requests.

## Sessions — Organization Scope

### Create Session

```
POST /v3beta1/organizations/{org_id}/sessions
```

Permission: `ManageOrgSessions`

Request body (construct via jq):

```json
{
  "prompt": "Task description (required)",
  "title": "Short title for dedup (optional, max 80 chars)",
  "tags": ["optional", "tag-array"],
  "max_acu_limit": 50,
  "repos": ["owner/repo"]
}
```

Other optional fields (not used by this plugin):

- `advanced_mode`: `analyze`, `create`, `improve`, `batch`, `manage`
- `playbook_id`: string
- `knowledge_ids`: string array
- `secret_ids`: string array (use this, NOT `session_secrets`)
- `attachment_urls`: URI array
- `structured_output_schema`: JSON Schema (Draft 7)

**Forbidden fields (security):**

- `create_as_user_id`: Never use (impersonation risk)
- `session_secrets`: Never use (inline secrets leak in shell)

Response:

```json
{
  "session_id": "string",
  "url": "https://app.devin.ai/sessions/...",
  "status": "new",
  "org_id": "string",
  "user_id": "string|null",
  "tags": [],
  "created_at": 1234567890,
  "updated_at": 1234567890,
  "acus_consumed": 0.0,
  "pull_requests": [],
  "title": "string|null",
  "is_advanced": false,
  "is_archived": false,
  "parent_session_id": null,
  "child_session_ids": [],
  "structured_output": null
}
```

Notes:

- **No `idempotent` field** — V3 does not support idempotent session creation.
  Implement dedup by checking for active sessions with matching `title`.
- `acus_consumed` starts at 0.0 on creation.
- `pull_requests` is an empty array on creation.

### Get Session

```
GET /v3beta1/organizations/{org_id}/sessions/{devin_id}
```

Permission: `ViewOrgSessions`

Response: Same `SessionResponse` schema as create.

### Terminate Session

```
DELETE /v3beta1/organizations/{org_id}/sessions/{devin_id}
```

Permission: `ManageOrgSessions`

Notes:

- V3 uses DELETE (not POST cancel like V1)
- DELETE is idempotent by HTTP spec — may return 200 even if already terminated
- Check response `status` field to confirm actual state

### Archive Session

```
POST /v3beta1/organizations/{org_id}/sessions/{devin_id}/archive
```

Permission: `ManageOrgSessions`

Request body: None.

Response: `SessionResponse` with `is_archived: true`.

Notes:

- No unarchive endpoint documented in V3 beta
- Archived sessions remain queryable via list endpoint with filters

## Sessions — Enterprise Scope

### List Sessions

```
GET /v3beta1/enterprise/sessions
```

Permission: `ManageAccountSessions`

Query parameters:

**Pagination (cursor-based):**

- `first` (integer, default 100, max 200): Items per page
- `after` (string): Cursor for next page

**Filtering:**

- `session_ids` (string array): Filter by specific IDs
- `org_ids` (string array): **Always include DEVIN_ORG_ID** to prevent cross-org
  access
- `tags` (string array): Filter by tags
- `origins` (string array): `webapp`, `slack`, `teams`, `api`, `linear`, `jira`,
  `scheduled`, `other`
- `playbook_id` (string): Filter by playbook
- `schedule_id` (string): Filter by schedule

**Date filters (Unix timestamps):**

- `created_after` / `created_before`
- `updated_after` / `updated_before`

Response:

```json
{
  "items": [SessionResponse, ...],
  "has_next_page": true,
  "end_cursor": "cursor_string",
  "total": 42
}
```

Notes:

- Always filter by `org_ids` to prevent cross-org data access
- `total` is optional and may be null
- Use `first=10` for interactive listing, `first=100` for bulk operations

### Send Message

```
POST /v3beta1/enterprise/sessions/{devin_id}/messages
```

Permission: `ManageAccountSessions`

Request body:

```json
{
  "message": "Follow-up text here"
}
```

**Forbidden field:** `message_as_user_id` — never use (impersonation risk).

Response: `SessionResponse` with updated status.

Notes:

- **Auto-resumes suspended sessions** — sending a message to a `suspended`
  session automatically resumes it
- Session transitions: `suspended` → `resuming` → `running`
- Response may show `resuming` status immediately after message

## Tags

### Update Session Tags (V1 Endpoint)

```
PUT /v1/sessions/{session_id}/tags
```

Request body:

```json
{
  "tags": ["tag1", "tag2"]
}
```

Notes:

- V3-specific tag update endpoint not yet documented
- Try V3 org-scoped endpoint first during implementation
- Fall back to V1 endpoint if V3 doesn't have one
- Test that V1 endpoint accepts `cog_` tokens

## Pagination Pattern

```bash
list_with_pagination() {
  local base_url="$1"
  local cursor=""

  while true; do
    local url="${base_url}?first=10"
    url="${url}&$(jq -nr --arg org "$DEVIN_ORG_ID" '@uri "org_ids=\($org)"')"
    [ -n "$cursor" ] && url="${url}&after=${cursor}"

    # ... curl + error handling ...

    local has_next end_cursor
    has_next=$(printf '%s' "$body" | jq -r '.has_next_page')
    end_cursor=$(printf '%s' "$body" | jq -r '.end_cursor // empty')

    # Display items...

    if [ "$has_next" != "true" ] || [ -z "$end_cursor" ]; then
      break
    fi

    # Prompt user before next page
    cursor="$end_cursor"
  done
}
```

## Timestamp Formatting

V3 returns Unix timestamps (integers). Format for display:

```bash
format_timestamp() {
  local ts="$1"
  if [ -z "$ts" ] || ! printf '%s' "$ts" | grep -qE '^[0-9]+$'; then
    printf 'unknown'
    return
  fi
  local now
  now=$(date +%s)
  local diff=$((now - ts))
  if [ "$diff" -lt 60 ]; then
    printf 'just now'
  elif [ "$diff" -lt 3600 ]; then
    local mins=$((diff / 60))
    if [ "$mins" -eq 1 ]; then printf '1 minute ago'; else printf '%d minutes ago' "$mins"; fi
  elif [ "$diff" -lt 86400 ]; then
    local hrs=$((diff / 3600))
    if [ "$hrs" -eq 1 ]; then printf '1 hour ago'; else printf '%d hours ago' "$hrs"; fi
  else
    date -d "@$ts" '+%Y-%m-%d %H:%M' 2>/dev/null || \
      date -r "$ts" '+%Y-%m-%d %H:%M' 2>/dev/null || \
      printf '%s' "$ts"
  fi
}
```
