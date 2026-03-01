# yellow-devin Plugin

Devin.AI integration for multi-agent workflows — delegate tasks, research
codebases via DeepWiki, orchestrate plan-implement-review chains. Targets
**Devin V3 API (beta)** with service user authentication.

## Required Environment Variables

- **`DEVIN_SERVICE_USER_TOKEN`** — Service user credential (`cog_` prefix).
  Create at: Enterprise Settings > Service Users.
- **`DEVIN_ORG_ID`** — Organization ID for all API paths. Find at: Enterprise
  Settings > Organizations.

## Required Permissions

The service user needs both:

- **`ManageOrgSessions`** — Create, get, terminate, archive sessions (org scope)
- **`ManageAccountSessions`** — List sessions, send messages (enterprise scope)

## MCP Servers

- **DeepWiki** — Public HTTP endpoint at `https://mcp.deepwiki.com/mcp`
  - No authentication required
- **Devin** — Private HTTP endpoint at `https://mcp.devin.ai/mcp`
  - Auth mechanism with `cog_` tokens unverified — may need separate
    configuration

## Conventions

- **API calls:** All session management via `curl` to
  `api.devin.ai/v3beta1/`. Two scopes:
  - **Org:** `https://api.devin.ai/v3beta1/organizations/${DEVIN_ORG_ID}/...`
  - **Enterprise:** `https://api.devin.ai/v3beta1/enterprise/...`
- **JSON construction:** Always use `jq` — never interpolate user input into
  JSON strings.
- **Shell quoting:** Always quote variables: `"$VAR"` not `$VAR`.
- **Git workflow:** Use Graphite (`gt`) for all branch management and PR
  creation — never raw `git push` or `gh pr create`.
- **Input validation:**
  - Token format: `^cog_[a-zA-Z0-9_-]{20,128}$`
  - Session ID: `^[a-zA-Z0-9_-]{8,64}$`
  - Org ID: `^[a-zA-Z0-9_-]{4,64}$`
  - Task prompts: max 8000 characters
  - Messages: max 2000 characters
  - Tags: max 32 chars each, alphanumeric + dashes, max 10 per session
  - Titles: max 80 chars
- **Error handling:** Check curl exit code, HTTP status code, jq exit code on
  every API call. See `devin-workflows` skill for patterns.
- **Write safety:** C1 (validate before write), M3 (confirm destructive ops like
  cancel via AskUserQuestion).
- **Never echo tokens** in error messages or debug output. Sanitize with:
  `sed 's/cog_[a-zA-Z0-9_-]*/***REDACTED***/g'`
- **Never use curl `-v`, `--trace`, or `--trace-ascii`** — they leak auth
  headers.
- **Forbidden V3 fields:** Never use `create_as_user_id` (impersonation),
  `session_secrets` (leakage), or `message_as_user_id` (impersonation).
- **Enterprise scope safety:** Always filter by `org_ids` matching
  `DEVIN_ORG_ID` to prevent cross-org access.

## Plugin Components

### Commands (8)

- `/devin:setup` — Validate credentials and permissions for the V3 API
- `/devin:delegate` — Create a Devin session with task prompt, tags, ACU limit
- `/devin:status` — Check session status or list recent sessions with filters
- `/devin:message` — Send follow-up message (auto-resumes suspended sessions)
- `/devin:cancel` — Terminate a session (requires confirmation)
- `/devin:wiki` — Query DeepWiki/Devin Wiki about a repository
- `/devin:archive` — Archive a session (hides from default listing)
- `/devin:tag` — Add, remove, or list session tags

### Agents (1)

**Workflow:**

- `devin-orchestrator` — Multi-step plan-implement-review-fix cycles with Devin

### Skills (1)

- `devin-workflows` — Shared V3 API patterns, error codes, security conventions

## V3 Session Status Values

| Status | Meaning | Terminal? | Messageable? | Cancellable? |
|---|---|---|---|---|
| `new` | Created, waiting to start | No | No | Yes |
| `claimed` | Initializing | No | No | Yes |
| `running` | Actively working | No | Yes | Yes |
| `suspended` | Paused (cost saving) | No | Yes (auto-resumes) | Yes |
| `resuming` | Waking from suspended | No | No (wait) | Yes |
| `exit` | Completed successfully | Yes | No | No |
| `error` | Failed | Yes | No | No |

## When to Use What

| Capability | Command | Agent | When to Use |
|---|---|---|---|
| Validate credentials | `/devin:setup` | — | First install, after token rotation, on 401/403 errors |
| Create session | `/devin:delegate` | devin-orchestrator | Command for one-off delegation; agent for multi-step cycles |
| Check progress | `/devin:status` | devin-orchestrator | Command for manual checks; agent polls automatically |
| Send message | `/devin:message` | devin-orchestrator | Command for ad-hoc messages; agent for review feedback |
| Cancel session | `/devin:cancel` | — | Always manual (M3 destructive op) |
| Research repo | `/devin:wiki` | — | Command for quick queries |
| Archive session | `/devin:archive` | — | Clean up completed sessions |
| Manage tags | `/devin:tag` | — | Organize sessions by project/sprint |

## Known Limitations

- **V3 API is in beta** — endpoint URLs use `/v3beta1/` and may change
- **MCP auth with `cog_` tokens unverified** — Devin MCP at `mcp.devin.ai` may
  need separate auth configuration
- **Scheduled sessions are UI-only** — manage at Settings > Schedules in the
  Devin web app (no API)
- **No idempotent session creation** — V3 dropped the `idempotent` field;
  delegate command uses title-based dedup check
- **Tag update endpoint TBD** — post-creation tag management falls back to V1
  endpoint (compatibility unverified)
- **No unarchive endpoint** — archived sessions cannot be unarchived via API
- Session state not persisted locally — after Claude Code restart, use
  `/devin:status` to re-discover active sessions
- Polling-based session monitoring — no push/webhook support
