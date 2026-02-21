---
title: "Migrate yellow-devin plugin to Devin V3 API"
type: feat
date: 2026-02-18
deepened: 2026-02-18
---

# Migrate yellow-devin Plugin to Devin V3 API

## Enhancement Summary

**Deepened on:** 2026-02-18
**Research sources:** Devin V3 API docs (8 pages), security audit (21 findings),
5 institutional learnings, plugin authoring patterns from 3 sibling plugins

### Key Improvements from Deepening

1. **`idempotent` field does NOT exist in V3** — delegate command must handle
   duplicate prevention differently (see Phase 2a)
2. **Scheduled sessions are UI-only** — no API endpoints exist. `/devin:schedule`
   must be dropped from scope (see Phase 3c)
3. **V3 archive endpoint confirmed** — POST to
   `/organizations/{org_id}/sessions/{devin_id}/archive`, no request body,
   requires `ManageOrgSessions` permission
4. **V3 create session has rich new fields** — `advanced_mode`, `max_acu_limit`,
   `repos`, `session_secrets`, `tags`, `title`, `attachment_urls`
5. **New V3-specific security vectors identified** — `create_as_user_id`
   impersonation, `session_secrets` leakage, enterprise scope cross-org access
6. **Skill frontmatter rules** — must use `user-invokable` (k not c),
   single-line descriptions only

### Resolved Open Questions

| # | Question | Answer |
|---|----------|--------|
| 4 | Archive endpoint? | **Confirmed:** `POST /v3beta1/organizations/{org_id}/sessions/{devin_id}/archive`, no body |
| 5 | Schedule endpoints? | **No API exists.** Scheduled sessions are UI-only. Drop `/devin:schedule` command |
| 8 | `idempotent` field? | **Does NOT exist in V3.** Must handle duplicate prevention via `title` + status check |

### Remaining Open Questions

| # | Question | Verify How |
|---|----------|-----------|
| 1 | Session ID format | Make one V3 API call, inspect `session_id` field |
| 2 | Response field name | Check if create response uses `session_id` or `devin_id` |
| 3 | V3 tag endpoint | Try PUT on V3 base URL; fall back to V1 tag endpoint if needed |
| 6 | MCP auth with `cog_` | Test `mcp.devin.ai` with `cog_` token in Authorization header |
| 7 | Org-level list endpoint | Try `GET /v3beta1/organizations/{org_id}/sessions` |

---

## Overview

Full rewrite of the yellow-devin plugin from Devin V1 API to V3 API (beta).
Drops V1 support entirely. Adds new commands for V3-exclusive features: session
archiving and tagging. Incorporates all P1/P2 security findings from the
pre-implementation audit plus V3-specific security hardening.

## Problem Statement / Motivation

Devin's console now marks API keys as "Legacy" and directs users to V3 service
users. V3 provides full RBAC, dedicated service accounts, ACU tracking, and
multi-organization support. Our plugin currently targets V1 exclusively. Users
setting up the plugin for the first time will encounter the V3 migration message
and have no path forward.

## Proposed Solution

Rewrite all 5 existing commands, 1 agent, and 1 skill to target V3 endpoints.
Add 2 new commands for V3 features (archive, tag). Update auth to use service
user tokens (`cog_` prefix) with org-scoped endpoints.

### Research Insights

**Beta API integration patterns:**

- Centralize all endpoint URLs in the shared skill file — when V3 graduates
  from beta (URL changes from `/v3beta1/` to `/v3/`), only one file needs
  updating
- Use defensive response parsing: `jq -r '.field // empty'` with fallbacks for
  fields that may be added/removed between beta iterations
- Log the API version in error context dumps so users can report issues with
  version info

**Institutional learnings applied:**

- From `ruvector-cli-and-mcp-tool-name-mismatches.md`: Always verify API
  endpoints empirically before referencing in plugin files. Run actual API calls
  during implementation, don't trust docs alone
- From `skill-frontmatter-attribute-and-format-requirements.md`: Use
  `user-invokable` (with k), keep descriptions single-line
- From `claude-code-plugin-manifest-validation-errors.md`: `repository` must be
  plain string, hooks must be inline, no unknown keys in manifests
- From `yellow-ci-shell-security-patterns.md`: Multi-layer input validation
  pattern — quick reject, empty check, newline check, canonical resolution

---

## Technical Approach

### Architecture

All V3 endpoints are org-scoped: `/v3beta1/organizations/{org_id}/...`

Two env vars required:

- `DEVIN_SERVICE_USER_TOKEN` — Service user credential (`cog_` prefix)
- `DEVIN_ORG_ID` — Organization ID for all API paths

Two endpoint scopes available:

- **Organization:** `/v3beta1/organizations/{org_id}/sessions/...` — session
  CRUD, archive
- **Enterprise:** `/v3beta1/enterprise/sessions/...` — cross-org listing,
  messaging

Our plugin uses **organization scope** for session CRUD and **enterprise scope**
for listing and messaging (as confirmed by V3 docs).

### Research Insights — Architecture

**Scope selection rationale:**

- Create/Get/Terminate/Archive require `ManageOrgSessions` permission — org
  scope
- List all sessions requires enterprise scope (cross-org visibility)
- Send message uses enterprise scope per V3 docs
- **Permission implication:** The service user needs BOTH org-level
  (`ManageOrgSessions`) and enterprise-level (`ManageAccountSessions`)
  permissions. Document this in setup instructions.

**Fallback strategy:** If enterprise endpoints return 403 (insufficient
permissions), fall back to org-scoped equivalents where they exist. The status
command should try org-level list first, then enterprise if org-level returns 404
or is unavailable.

### V3 API Endpoint Map

| Operation | V1 Endpoint | V3 Endpoint | Scope | Permission |
|-----------|-------------|-------------|-------|------------|
| Create session | `POST /v1/sessions` | `POST /v3beta1/organizations/{org_id}/sessions` | Org | ManageOrgSessions |
| Get session | `GET /v1/sessions/{session_id}` | `GET /v3beta1/organizations/{org_id}/sessions/{devin_id}` | Org | ViewOrgSessions |
| List sessions | `GET /v1/sessions?limit=N` | `GET /v3beta1/enterprise/sessions` | Enterprise | ManageAccountSessions |
| Send message | `POST /v1/sessions/{session_id}/messages` | `POST /v3beta1/enterprise/sessions/{devin_id}/messages` | Enterprise | ManageAccountSessions |
| Cancel/Terminate | `POST /v1/sessions/{session_id}/cancel` | `DELETE /v3beta1/organizations/{org_id}/sessions/{devin_id}` | Org | ManageOrgSessions |
| Archive session | N/A | `POST /v3beta1/organizations/{org_id}/sessions/{devin_id}/archive` | Org | ManageOrgSessions |
| Update tags | `PUT /v1/sessions/{session_id}/tags` | TBD (verify V3 tag endpoint) | TBD | TBD |

### V3 Session Status Values

| V3 Status | Meaning | Terminal? | Messageable? | Cancellable? |
|-----------|---------|-----------|--------------|--------------|
| `new` | Created, waiting to start | No | No | Yes |
| `claimed` | Initializing | No | No | Yes |
| `running` | Actively working | No | Yes | Yes |
| `suspended` | Paused (cost saving) | No | Yes (auto-resumes) | Yes |
| `resuming` | Waking from suspended | No | No (wait) | Yes |
| `exit` | Completed successfully | Yes | No | No |
| `error` | Failed | Yes | No | No |

### Research Insights — Status Handling

**`suspended` → auto-resume flow:** When a message is sent to a suspended
session, V3 automatically resumes it. The session transitions:
`suspended` → `resuming` → `running`. The message endpoint returns the
updated `SessionResponse` immediately, but the session may still be in
`resuming` state. The orchestrator should poll after messaging a suspended
session until it reaches `running` before proceeding.

**Edge case — `resuming` timeout:** If a session stays in `resuming` for more
than 60 seconds, treat it as a potential error. Report to user and suggest
checking the Devin web UI.

### V3 Session Response Schema

New/changed fields vs V1:

```json
{
  "session_id": "string",
  "url": "string",
  "status": "new|claimed|running|suspended|resuming|exit|error",
  "org_id": "string",
  "user_id": "string|null",
  "tags": ["string"],
  "created_at": 1234567890,
  "updated_at": 1234567890,
  "acus_consumed": 1.5,
  "pull_requests": [
    { "pr_url": "https://github.com/...", "pr_state": "open" }
  ],
  "title": "string|null",
  "is_advanced": false,
  "is_archived": false,
  "parent_session_id": "string|null",
  "child_session_ids": ["string"],
  "structured_output": {}
}
```

Key differences from V1:

- `pull_request_url` (string) → `pull_requests` (array of objects with
  `pr_url` and `pr_state`)
- `status_info` → removed (use `title` instead)
- `is_new_session` → removed (no `idempotent` field in V3)
- Timestamps are Unix integers, not ISO strings
- New fields: `org_id`, `tags`, `acus_consumed`, `is_archived`,
  `parent_session_id`, `child_session_ids`, `is_advanced`

### V3 Create Session — New Optional Fields

V3 session creation supports significantly more parameters than V1:

| Field | Type | Purpose | Use in Plugin? |
|-------|------|---------|---------------|
| `prompt` | string | Task description | Yes (required) |
| `tags` | string[] | Session categorization | Yes (via --tags flag) |
| `title` | string | Human-readable title | Yes (auto-generate from prompt) |
| `max_acu_limit` | integer | Cost cap | Yes (via --max-acu flag) |
| `repos` | string[] | Repository references | Yes (auto-detect from git remote) |
| `advanced_mode` | enum | Agent type | No (default is fine) |
| `playbook_id` | string | Playbook association | Defer to v2 |
| `knowledge_ids` | string[] | Knowledge base | Defer to v2 |
| `session_secrets` | object[] | Inline secrets | No (security risk — use secret_ids) |
| `secret_ids` | string[] | Pre-stored secrets | Defer to v2 |
| `create_as_user_id` | string | Impersonation | No (privilege escalation risk) |
| `attachment_urls` | string[] | File attachments | Defer to v2 |

### Research Insights — Create Session

**No `idempotent` field in V3.** This is a breaking change from V1. To prevent
accidental duplicate sessions:

1. Before creating, search recent sessions for matching `title` in
   `new`/`claimed`/`running` status
2. If a match is found, ask user: "Similar session already exists: {title}
   ({status}). Create a new one anyway?"
3. Use `title` field (auto-generated from first ~80 chars of prompt) as the
   dedup key

**`max_acu_limit` as cost guard:** Add optional `--max-acu <limit>` flag to
`/devin:delegate`. This sets a hard cap on session cost. Suggest documenting a
sensible default (e.g., 10 ACUs) in setup instructions.

**`repos` auto-detection:** Populate from `git remote get-url origin` when in a
git repo. This gives Devin context about which repository the task relates to.

### V3 Pagination

V3 uses cursor-based pagination (not offset):

```
GET /v3beta1/enterprise/sessions?first=10&after=cursor_abc
```

Response includes `has_next_page`, `end_cursor`, optional `total`.

### Research Insights — Pagination

**Cursor pagination in shell scripts:**

```bash
# Pattern for cursor-based pagination in shell
list_sessions() {
  local cursor=""
  local page=1

  while true; do
    local url="${ENTERPRISE_URL}/sessions?first=10"
    [ -n "$cursor" ] && url="${url}&after=${cursor}"

    local response
    response=$(curl -s --connect-timeout 5 --max-time 10 \
      -w "\n%{http_code}" -X GET "$url" \
      -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN")
    # ... error handling ...

    local items has_next end_cursor
    items=$(printf '%s' "$body" | jq -r '.items')
    has_next=$(printf '%s' "$body" | jq -r '.has_next_page')
    end_cursor=$(printf '%s' "$body" | jq -r '.end_cursor // empty')

    # Display items...

    if [ "$has_next" != "true" ] || [ -z "$end_cursor" ]; then
      break
    fi

    # Ask user before fetching next page
    cursor="$end_cursor"
    page=$((page + 1))
  done
}
```

**Best practice:** Don't auto-paginate silently. Show "Page 1 of N (showing
10 sessions). Show more?" via AskUserQuestion. Prevents runaway API calls.

**Filtering support:** V3 list endpoint supports rich filtering. Add useful
filters to `/devin:status`:

- `--tag <tag>` — filter by tag
- `--status <status>` — filter by status (running, exit, error)
- `--archived` — include archived sessions (excluded by default)

---

### Implementation Phases

#### Phase 1: Foundation (Skill + Auth)

Rewrite the shared skill and validation patterns. Everything else depends on
this.

**Files:**

- `skills/devin-workflows/SKILL.md` — New base URL, token format (`cog_`),
  org ID validation, V3 status values, updated validation functions, updated
  curl patterns
- `skills/devin-workflows/api-reference.md` — Complete rewrite for V3 endpoints
- `skills/devin-workflows/error-codes.md` — Update error patterns, add
  V3-specific errors (422 validation error)

**Token validation update:**

```bash
validate_token() {
  local token="$1"
  if [ -z "$token" ]; then
    printf 'ERROR: DEVIN_SERVICE_USER_TOKEN not set\n' >&2
    printf 'Create a service user: Enterprise Settings > Service Users\n' >&2
    printf 'Then: export DEVIN_SERVICE_USER_TOKEN='\''cog_...'\''\n' >&2
    return 1
  fi
  # Detect V1 key and show migration error
  if printf '%s' "$token" | grep -qE '^apk_'; then
    printf 'ERROR: V1 API key detected (apk_ prefix)\n' >&2
    printf 'V3 requires a service user token (cog_ prefix)\n' >&2
    printf 'Create one: Enterprise Settings > Service Users\n' >&2
    printf 'Docs: https://docs.devin.ai/api-reference/v3/overview\n' >&2
    return 1
  fi
  if ! printf '%s' "$token" | grep -qE '^cog_[a-zA-Z0-9_-]{20,128}$'; then
    printf 'ERROR: DEVIN_SERVICE_USER_TOKEN has invalid format\n' >&2
    printf 'Expected: cog_... (service user credential)\n' >&2
    return 1
  fi
}
```

**Org ID validation:**

```bash
validate_org_id() {
  local org_id="$1"
  if [ -z "$org_id" ]; then
    printf 'ERROR: DEVIN_ORG_ID not set\n' >&2
    printf 'Find your org ID: Enterprise Settings > Organizations\n' >&2
    printf 'Then: export DEVIN_ORG_ID='\''org_...'\''\n' >&2
    return 1
  fi
  if ! printf '%s' "$org_id" | grep -qE '^[a-zA-Z0-9_-]{4,64}$'; then
    printf 'ERROR: DEVIN_ORG_ID has invalid format\n' >&2
    return 1
  fi
}
```

**Session ID validation update (V3 uses `devin_id`):**

```bash
validate_session_id() {
  local sid="$1"
  # V3 session ID format TBD — verify empirically during implementation
  # Using permissive alphanumeric check until format confirmed
  if [ -z "$sid" ]; then
    printf 'ERROR: Session ID required\n' >&2
    return 1
  fi
  if ! printf '%s' "$sid" | grep -qE '^[a-zA-Z0-9_-]{8,64}$'; then
    printf 'ERROR: Invalid session ID format: %s\n' "$sid" >&2
    return 1
  fi
}
```

**Base URL pattern:**

```bash
DEVIN_API_BASE="https://api.devin.ai/v3beta1"
ORG_URL="${DEVIN_API_BASE}/organizations/${DEVIN_ORG_ID}"
ENTERPRISE_URL="${DEVIN_API_BASE}/enterprise"
```

**Security patterns from audit (incorporated into skill):**

- C1: Explicit rule — never use `-v`, `--trace` flags with curl
- C5: Error message sanitization — `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`
- H6: Token format validation (cog_ prefix check with apk_ migration message)
- H9: curl exit code checking on every call
- C6: Exponential backoff on 429 (max 5 retries)

### Research Insights — Phase 1

**V3-specific error code: 422 Validation Error.** V3 returns
`HTTPValidationError` with structured details when request validation fails.
Add to error-codes.md:

```bash
422)
  printf 'ERROR: Request validation failed (422)\n' >&2
  # Extract validation details from V3 error format
  local detail
  detail=$(printf '%s' "$body" | jq -r '.detail[]? | "\(.loc | join(".")): \(.msg)"' 2>/dev/null)
  if [ -n "$detail" ]; then
    printf 'Details:\n%s\n' "$detail" >&2
  fi
  exit 1 ;;
```

**Skill frontmatter requirements (from institutional learning):**

```yaml
---
name: devin-workflows
description: Devin V3 API workflow patterns and conventions. Use when commands or agents need Devin API context, session management, or error handling.
user-invokable: false
---
```

- `user-invokable` (with **k**, not c)
- `description` must be single-line (no YAML folded scalars)

#### Phase 2: Core Commands (Migrate Existing 5)

Rewrite each command to use V3 endpoints. Each command references the updated
skill.

##### 2a: `/devin:delegate` → `commands/devin/delegate.md`

Changes:

- POST to `${ORG_URL}/sessions` instead of `/v1/sessions`
- Auth header: `Bearer $DEVIN_SERVICE_USER_TOKEN`
- **No `idempotent` field** — implement dedup check: search recent sessions by
  title before creating
- Add `title` field: auto-generate from first ~80 chars of prompt
- Add `--tags` support: comma-separated tags passed as JSON array
- Add `--max-acu` support: integer ACU cap via `max_acu_limit` field
- Auto-populate `repos` from `git remote get-url origin`
- Response: Extract `session_id` from SessionResponse
- Report `acus_consumed` (likely 0 at creation, but include for consistency)

**Request body construction (V3):**

```bash
jq -n \
  --arg prompt "$PROMPT" \
  --arg title "$TITLE" \
  --argjson tags "$TAGS_JSON" \
  --argjson repos "$REPOS_JSON" \
  '{prompt: $prompt, title: $title, tags: $tags, repos: $repos}' | \
  curl -s --connect-timeout 5 --max-time 60 \
    -w "\n%{http_code}" \
    -X POST "${ORG_URL}/sessions" \
    -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```

### Research Insights — Delegate

**Duplicate prevention without `idempotent`:**

```bash
# Before creating, check for similar active sessions
existing=$(curl -s --connect-timeout 5 --max-time 10 \
  -X GET "${ENTERPRISE_URL}/sessions?first=5" \
  -H "Authorization: Bearer $DEVIN_SERVICE_USER_TOKEN" | \
  jq -r --arg title "$TITLE" \
  '.items[] | select(.title == $title and (.status == "new" or .status == "claimed" or .status == "running")) | .session_id')

if [ -n "$existing" ]; then
  # Ask user via AskUserQuestion
  # "Session with same title already active: $existing. Create anyway?"
fi
```

**`max_acu_limit` as safety net:** Consider adding a default ACU limit in
CLAUDE.md conventions (e.g., 50 ACU) that can be overridden per-command. This
prevents runaway costs from orchestrator auto-retry loops.

##### 2b: `/devin:status` → `commands/devin/status.md`

Changes:

- Single session: GET `${ORG_URL}/sessions/${SESSION_ID}`
- List sessions: GET `${ENTERPRISE_URL}/sessions?first=10`
- Display V3 status values directly
- PR display as table format:

```
PRs:
  #  | State  | URL
  1  | open   | github.com/org/repo/pull/42
  2  | merged | github.com/org/repo/pull/43
```

- Show `acus_consumed` in output (format as "X.XX ACUs")
- Show `tags` if present (comma-separated)
- Show `[ARCHIVED]` badge if `is_archived` is true
- Show `title` if present
- Cursor-based pagination for list mode with "Show more?" prompt
- Add `--tag`, `--status`, `--archived` filter flags

**Single session output format:**

```
Session: {session_id}
Title:   {title}
Status:  {status}
URL:     {url}
ACUs:    {acus_consumed}
Tags:    {tags}
Created: {created_at formatted}

PRs:
  #  | State  | URL
  1  | open   | github.com/org/repo/pull/42
```

**List output format:**

```
Session ID     | Status    | Title          | ACUs  | PRs
ses_abc123...  | running   | Auth feature   | 2.50  | 1
ses_def456...  | exit      | Bug fix #42    | 1.20  | 1
ses_ghi789...  | suspended | Refactor API   | 0.80  | 0
```

### Research Insights — Status

**Timestamp formatting:** V3 returns Unix timestamps. Format them as relative
time for recent sessions ("2 hours ago") and absolute date for older ones:

```bash
format_timestamp() {
  local ts="$1"
  local now
  now=$(date +%s)
  local diff=$((now - ts))
  if [ "$diff" -lt 3600 ]; then
    printf '%d minutes ago' $((diff / 60))
  elif [ "$diff" -lt 86400 ]; then
    printf '%d hours ago' $((diff / 3600))
  else
    date -d "@$ts" '+%Y-%m-%d %H:%M' 2>/dev/null || date -r "$ts" '+%Y-%m-%d %H:%M' 2>/dev/null
  fi
}
```

##### 2c: `/devin:message` → `commands/devin/message.md`

Changes:

- POST to `${ENTERPRISE_URL}/sessions/${SESSION_ID}/messages`
- V3 auto-resumes suspended sessions on message — update messageable states:
  `running` and `suspended` are messageable
- `resuming` state: advise waiting ("Session is resuming, try again in a few
  seconds")
- `new`/`claimed`: still not messageable ("Session hasn't started yet")
- Response returns full `SessionResponse` — show updated status after message
- V3 request body has optional `message_as_user_id` — **never use this** (same
  as `create_as_user_id` impersonation risk)

### Research Insights — Message

**Auto-resume UX flow:** When messaging a `suspended` session, the UX should
be:

1. Display: "Session is suspended. Sending message will auto-resume it."
2. Send the message
3. Response returns updated status (likely `resuming`)
4. Display: "Message sent. Session is resuming."
5. Suggest: "Use `/devin:status {id}` to check when it's running."

This is a better UX than V1's `blocked` state because the user doesn't need
to manually intervene.

##### 2d: `/devin:cancel` → `commands/devin/cancel.md`

Changes:

- **DELETE** `${ORG_URL}/sessions/${SESSION_ID}` (V3 uses DELETE, not POST)
- TOCTOU: re-fetch status after user confirmation (H2 from audit)
- Terminal states for V3: `exit`, `error`
- Cancellable states: `new`, `claimed`, `running`, `suspended`, `resuming`

### Research Insights — Cancel

**DELETE vs POST semantic difference:** V3 uses HTTP DELETE which is idempotent
by RFC 7231. If the session is already terminated, DELETE may return 200 (not
404). Check the response status field to confirm actual termination rather than
relying solely on HTTP status code.

**`suspended` sessions:** Cancelling a suspended session should work without
needing to resume it first. Verify this during implementation — if DELETE on
suspended returns an error, resume first then cancel.

##### 2e: `/devin:wiki` → `commands/devin/wiki.md`

Changes:

- Test if `mcp.devin.ai` accepts `cog_` tokens
- If yes: update auth references
- If no: document limitation, keep DeepWiki as primary fallback
- Update CLAUDE.md MCP section with findings

### Research Insights — Wiki

**MCP auth testing approach:** The Devin MCP server at `mcp.devin.ai` may use
a different auth mechanism than the REST API. Test empirically:

1. Try calling a DeepWiki tool with `cog_` token in headers
2. If 401/403: MCP may use OAuth or a separate token type
3. Document findings regardless of outcome

**From ruvector MCP learning:** Always verify MCP tool names empirically. The
registered tool names follow the pattern
`mcp__plugin_<key>_<key>__<tool>` but exact names may differ from expected.
Use ToolSearch during first use.

#### Phase 3: New Commands (V3 Features)

##### 3a: `/devin:archive` → `commands/devin/archive.md` (NEW)

Archive a Devin session. Archived sessions are hidden from default listing but
remain accessible.

```
/devin:archive <session-id>
```

- POST `${ORG_URL}/sessions/${SESSION_ID}/archive` — **confirmed**, no request
  body
- Requires `ManageOrgSessions` permission
- Response returns updated `SessionResponse` with `is_archived: true`
- Show confirmation: "Session {id} archived."
- Suggest: "Use `/devin:status --archived` to view archived sessions."

**Note:** No unarchive endpoint has been found in V3 docs. Remove `--undo`
flag from scope. If unarchive is needed later, investigate V3 session update
endpoints.

### Research Insights — Archive

**Archive is a soft operation** — sessions remain queryable via the list
endpoint with appropriate filters. No M3 confirmation needed (reversible if
unarchive endpoint exists, and even without it the data isn't deleted).
Downgrade from M3 to Low safety tier.

##### 3b: `/devin:tag` → `commands/devin/tag.md` (NEW)

Manage session tags.

```
/devin:tag <session-id> add <tag1> [tag2...]
/devin:tag <session-id> remove <tag1>
/devin:tag <session-id> list
```

- Tags can be set at session creation (via `/devin:delegate --tags`)
- For post-creation tag management, try V3 org-scoped endpoint first; fall
  back to V1's `PUT /v1/sessions/{id}/tags` if V3 doesn't have a dedicated
  tag update endpoint
- Tag validation: alphanumeric + dashes, max 32 chars per tag, max 10 tags
- Show current tags after modification

### Research Insights — Tags

**Tag implementation strategy:** Since V3 creation supports `tags` and the list
endpoint filters by `tags`, the most important use case is covered. The `add`
and `remove` subcommands depend on finding a tag update endpoint. If no V3
endpoint exists:

- `add`: GET current tags → append → PUT via V1 endpoint (if it works with
  `cog_` token)
- `remove`: GET current tags → filter → PUT
- `list`: GET session → display `.tags` array

**Tag naming convention:** Suggest lowercase-with-dashes format in help text.
Example: `project-auth`, `sprint-42`, `bug-fix`.

##### 3c: `/devin:schedule` — **DROPPED FROM SCOPE**

~~Create scheduled (recurring) Devin sessions.~~

**Research finding:** Scheduled sessions are **UI-only** — no API endpoints
exist. The Devin product guide confirms schedules are managed exclusively
through the Settings > Schedules web UI.

**Action:** Remove from scope. Add to CLAUDE.md Known Limitations:
"Scheduled sessions are UI-only — manage at Settings > Schedules in the Devin
web app."

#### Phase 4: Agent Update

##### 4a: `devin-orchestrator` → `agents/workflow/devin-orchestrator.md`

Changes:

- All API calls use V3 endpoints via updated skill patterns
- Poll terminal states: `exit` (success), `error` (failure)
- Handle `suspended` state: message auto-resumes, but track the
  `suspended → resuming → running` transition with a 60s timeout
- PR handling: iterate `pull_requests` array, review all PRs via `gh pr diff`
- TOCTOU fixes from audit C3: state validation before every action
- ACU tracking: report `acus_consumed` in progress updates and final summary
- Context dump sanitization: `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`
- Use `max_acu_limit` when creating sessions to prevent cost overruns during
  auto-retry loops

### Research Insights — Orchestrator

**Suspended session handling in orchestrator flow:**

The orchestrator's poll loop needs to handle `suspended` differently from V1's
`blocked`:

- V1 `blocked`: Required user intervention → orchestrator notified user
- V3 `suspended`: Cost-saving pause → orchestrator should auto-resume by
  sending a "continue" message, then wait for `running` state

```
Poll loop state handling:
  new/claimed  → wait (normal startup)
  running      → wait (working)
  suspended    → send message "continue" → poll for running (60s timeout)
  resuming     → wait (max 60s, then escalate)
  exit         → success, proceed to review
  error        → failure, report and exit
```

**ACU cost tracking enhancement:**

```
ORCHESTRATION SUMMARY:
  Session: {id}
  Iterations: {n}/3
  Total ACUs: {acus_consumed}
  PRs created: {count}
  Final status: {status}
```

**Multi-PR review:** When the orchestrator finds multiple PRs in the
`pull_requests` array, review each one:

```bash
for pr_url in $(printf '%s' "$body" | jq -r '.pull_requests[].pr_url'); do
  # Extract owner/repo/number from URL
  pr_ref=$(printf '%s' "$pr_url" | sed -E 's|.*/([^/]+/[^/]+)/pull/([0-9]+)|\1 \2|')
  repo=$(printf '%s' "$pr_ref" | cut -d' ' -f1)
  number=$(printf '%s' "$pr_ref" | cut -d' ' -f2)
  gh pr diff "$number" -R "$repo"
done
```

#### Phase 5: Plugin Metadata

##### 5a: `CLAUDE.md`

- Update all env var references: `DEVIN_API_TOKEN` → `DEVIN_SERVICE_USER_TOKEN`
- Add `DEVIN_ORG_ID` to conventions
- Update token format: `^cog_[a-zA-Z0-9_-]{20,128}$`
- Update session ID format (based on V3 findings)
- Add V3 status values table
- Add new commands to component list (7 total, not 8 — schedule dropped)
- Update "When to Use What" table with archive and tag
- Update MCP section with findings from wiki auth investigation
- Update Known Limitations (add: schedule is UI-only, V3 is beta)
- Add required permissions section: `ManageOrgSessions` +
  `ManageAccountSessions`

##### 5b: `.claude-plugin/plugin.json`

- Version bump to `2.0.0` (breaking change — V1 dropped)
- Update description to mention V3
- MCP servers unchanged (DeepWiki + Devin endpoints stay the same)
- Ensure `repository` is plain string (not object)
- No hooks needed (no file changes)

##### 5c: `README.md`

- Update setup instructions: service user creation, env var names, required
  permissions
- Add V3 migration note for existing users
- Document new commands (archive, tag)
- Remove schedule from docs
- Add troubleshooting section for common V3 errors (wrong token prefix,
  missing org ID, insufficient permissions)

---

## V3-Specific Security Considerations

These are NEW security vectors introduced by V3 that were not in the original
V1 security audit:

### S1: `create_as_user_id` Impersonation (HIGH)

**Risk:** V3 allows service users with `ImpersonateOrgSessions` permission to
create sessions on behalf of other users. If our plugin ever exposes this
parameter, it enables privilege escalation.

**Mitigation:** Never include `create_as_user_id` in session creation. Add
explicit rule to skill: "Never use `create_as_user_id` — sessions should
always be created as the service user itself."

### S2: `session_secrets` Leakage (HIGH)

**Risk:** V3 supports inline `session_secrets` in the create request body. If
used, secrets would appear in shell history, curl command output, and error
messages.

**Mitigation:** Never use `session_secrets`. Instead, direct users to
pre-configure secrets via the Devin UI and reference them by `secret_ids`.
Add explicit rule: "Never pass secrets inline via `session_secrets`."

### S3: Enterprise Scope Cross-Org Access (MEDIUM)

**Risk:** Enterprise endpoints (`/v3beta1/enterprise/sessions`) can list and
message sessions across ALL organizations. If the service user has enterprise
permissions, it could access sessions from other orgs.

**Mitigation:** When listing sessions, always filter by `org_ids` parameter
matching `DEVIN_ORG_ID`. Add `--argjson org_ids '["'$DEVIN_ORG_ID'"]'` to
list queries.

### S4: ACU Data as Financial Information (LOW)

**Risk:** `acus_consumed` is financial data. If exposed in logs or error
messages, it reveals cost information.

**Mitigation:** Display ACU data to the user (it's useful), but exclude from
error context dumps.

### S5: Cursor Token Validation (LOW)

**Risk:** Pagination cursors from V3 responses are opaque strings. If a user
provides a crafted cursor, it could cause unexpected API behavior.

**Mitigation:** Only use cursors from actual API responses, never from user
input. The cursor is managed internally by the pagination loop.

---

## Acceptance Criteria

### Functional Requirements

- [ ] All 5 existing commands work with V3 endpoints
- [ ] Token validation accepts `cog_` prefix, rejects `apk_` with migration
  message
- [ ] Org ID validated on every API call
- [ ] `/devin:delegate` auto-generates title, supports --tags and --max-acu
- [ ] `/devin:delegate` checks for duplicate active sessions by title
- [ ] `/devin:status` shows ACUs, tags, PR table, archived badge, title
- [ ] `/devin:status` uses cursor-based pagination with "Show more?" prompt
- [ ] `/devin:status` supports --tag, --status, --archived filter flags
- [ ] `/devin:message` auto-resumes suspended sessions with clear UX
- [ ] `/devin:cancel` uses DELETE method with TOCTOU protection
- [ ] `/devin:archive` archives sessions via confirmed endpoint
- [ ] `/devin:tag` manages tags (add/remove/list)
- [ ] Orchestrator agent works with V3 status values, PR arrays, and suspended
  auto-resume
- [ ] Wiki command tested with `cog_` token auth
- [ ] No `/devin:schedule` command (UI-only, documented in Known Limitations)

### Security Requirements (from Audit + V3-Specific)

- [ ] C1: No `-v` or `--trace` in any curl call
- [ ] C2/C4: `validate_session_id()` used before every API call with session ID
- [ ] C3: Orchestrator has TOCTOU state validation before every action
- [ ] C5: Error messages sanitize `cog_` tokens via sed
- [ ] C6: Exponential backoff on 429 (max 5 retries, max 300s total wait)
- [ ] H2: Cancel command re-validates state after user confirmation
- [ ] H5: Message command verifies send success
- [ ] H6: Token format validated (not just non-empty check)
- [ ] H9: curl exit code checked on every API call
- [ ] S1: `create_as_user_id` never used
- [ ] S2: `session_secrets` never used (use `secret_ids` only)
- [ ] S3: Enterprise list always filters by `org_ids`
- [ ] S4: ACU data excluded from error context dumps

### Quality Gates

- [ ] `pnpm validate:plugins` passes
- [ ] All command frontmatter has correct `allowed-tools` lists
- [ ] All descriptions have "Use when..." trigger clauses
- [ ] Skill descriptions are single-line (not YAML folded scalars)
- [ ] Skill uses `user-invokable` (with k)
- [ ] LF line endings (`.gitattributes` enforced)
- [ ] Agent under 120 lines
- [ ] `repository` in plugin.json is plain string

## Dependencies & Prerequisites

- Devin V3 API access (service user token with `cog_` prefix)
- Organization ID from Devin Enterprise Settings
- Service user requires permissions: `ManageOrgSessions` (org-level) +
  `ManageAccountSessions` (enterprise-level, for list/message)
- V3 API must be accessible (currently beta — may have availability gaps)
- `jq` and `curl` available in user's shell

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| V3 beta endpoints change | Medium | High | Centralize API patterns in skill — single file to update |
| V3 session ID format differs from assumed | Medium | Low | Use permissive validation initially, tighten after empirical testing |
| MCP server doesn't accept `cog_` tokens | Medium | Medium | Keep DeepWiki as primary wiki source, document limitation |
| V3 rate limits differ from V1 | Low | Medium | Exponential backoff handles any rate limit scheme |
| Enterprise endpoint requires higher permission | Medium | Medium | Fall back to org-scoped endpoints where possible |
| No unarchive endpoint | Medium | Low | Document as one-way operation until Devin adds unarchive |
| V3 tag update endpoint doesn't exist | Medium | Low | Fall back to V1 tag PUT endpoint with `cog_` token |
| V3 `suspended` cancel doesn't work | Low | Low | Resume first, then cancel |

## Implementation Order

```
Phase 1: Skill + Auth foundation
  ├── SKILL.md (base URL, token validation, status values)
  ├── api-reference.md (V3 endpoints — complete rewrite)
  └── error-codes.md (V3 errors + 422 handling)

Phase 2: Core commands (sequential — each validates against updated skill)
  ├── delegate.md (create session, dedup check, new fields)
  ├── status.md (get/list sessions, pagination, filters)
  ├── message.md (send message, auto-resume UX)
  ├── cancel.md (DELETE method, TOCTOU protection)
  └── wiki.md (MCP auth test with cog_ token)

Phase 3: New commands
  ├── archive.md (confirmed endpoint)
  └── tag.md (endpoint TBD — may need V1 fallback)

Phase 4: Agent
  └── devin-orchestrator.md (V3 statuses, PR array, suspended handling)

Phase 5: Metadata
  ├── CLAUDE.md (env vars, permissions, known limitations)
  ├── plugin.json (version bump to 2.0.0)
  └── README.md (setup guide, migration note, troubleshooting)
```

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-02-18-devin-v3-api-migration-brainstorm.md`
- Security audit: `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md`
- Plugin validation: `docs/solutions/build-errors/claude-code-plugin-manifest-validation-errors.md`
- Shell security patterns: `docs/solutions/code-quality/yellow-ci-shell-security-patterns.md`
- Skill frontmatter rules: `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
- MCP name mismatches: `docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md`
- Existing plugin: `plugins/yellow-devin/` (all files rewritten)
- Linear plugin patterns: `plugins/yellow-linear/` (command/agent conventions)

### External References

- [Devin API Overview](https://docs.devin.ai/api-reference/overview) — V1/V2/V3 comparison
- [V3 API Overview](https://docs.devin.ai/api-reference/v3/overview) — Beta documentation
- [V3 Authentication](https://docs.devin.ai/api-reference/authentication) — `cog_` token format
- [V3 Usage Examples](https://docs.devin.ai/api-reference/v3/usage-examples) — Code samples
- [V3 Create Session](https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions) — Full request/response schema
- [V3 Get Session](https://docs.devin.ai/api-reference/v3/sessions/get-organizations-session) — Response schema
- [V3 List Sessions](https://docs.devin.ai/api-reference/v3/sessions/enterprise-sessions) — Pagination & filtering
- [V3 Send Message](https://docs.devin.ai/api-reference/v3/sessions/post-enterprise-sessions-messages) — Auto-resume behavior
- [V3 Archive Session](https://docs.devin.ai/api-reference/v3/sessions/post-organizations-sessions-archive) — Confirmed endpoint
- [V3 Service Users](https://docs.devin.ai/api-reference/v3/service-users/post-members-service-users) — Service user provisioning
- [Scheduled Sessions Guide](https://docs.devin.ai/product-guides/scheduled-sessions) — UI-only, no API
- [API Release Notes](https://docs.devin.ai/api-reference/release-notes) — V3 changelog
