# yellow-devin Plugin

Devin.AI integration for multi-agent workflows — delegate tasks, research
codebases via DeepWiki, orchestrate plan-implement-review chains. Targets
**Devin V3 API** with service user authentication.

## Required Credentials

The plugin reads two credentials. Each can come from **either** the plugin
`userConfig` (recommended — prompted at plugin-enable time, stored in the
system keychain for the sensitive token) **or** a shell environment variable
(fallback for power users and CI):

- **`devin_service_user_token`** / **`DEVIN_SERVICE_USER_TOKEN`** — service
  user credential (`cog_` prefix). Create at: Devin Enterprise Settings >
  Service Users.
- **`devin_org_id`** / **`DEVIN_ORG_ID`** — organization ID for all API
  paths. Find at: Devin Enterprise Settings > Organizations.

Commands read the shell env vars directly. `/devin:setup` detects whichever
source is configured and reports which is active. Setting userConfig avoids
the "restart Claude Code after exporting a variable" dance that shell-only
setups require.

## Required Permissions

The service user needs these permissions for full functionality:

| Permission | Scope | Grants | Required? |
|---|---|---|---|
| `UseDevinSessions` | Org | Create sessions | **Required** |
| `ViewOrgSessions` | Org | List and get sessions | **Required** |
| `ManageOrgSessions` | Org | Send messages, terminate, archive | **Required** |
| `ViewAccountSessions` | Enterprise | List sessions cross-org | Optional |
| `ManageAccountSessions` | Enterprise | Enterprise-scope messaging | Optional |

**Note:** All commands use the list endpoint with `session_ids` filter for
session lookups (see Session Lookup Pattern in `devin-workflows` skill). The
`/devin:message` command tries the org-scoped endpoint first
(`ManageOrgSessions`), falling back to enterprise (`ManageAccountSessions`).

## MCP Servers

- **DeepWiki** — Public HTTP endpoint at `https://mcp.deepwiki.com/mcp`
  - No authentication required
- **Devin** — Private HTTP endpoint at `https://mcp.devin.ai/mcp`
  - Auth mechanism with `cog_` tokens unverified — may need separate
    configuration

## Conventions

- **API calls:** All session management via `curl` to
  `api.devin.ai/v3/`. Two scopes:
  - **Org:** `https://api.devin.ai/v3/organizations/${DEVIN_ORG_ID}/...`
  - **Enterprise:** `https://api.devin.ai/v3/enterprise/...`
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

### Commands (9)

- `/devin:setup` — Validate credentials and permissions for the V3 API
- `/devin:delegate` — Create a Devin session with task prompt, tags, ACU limit
- `/devin:status` — Check session status or list recent sessions with filters
- `/devin:message` — Send follow-up message (auto-resumes suspended sessions)
- `/devin:cancel` — Terminate a session (requires confirmation)
- `/devin:wiki` — Query DeepWiki/Devin Wiki about a repository
- `/devin:archive` — Archive a session (hides from default listing)
- `/devin:tag` — Add, remove, or list session tags
- `/devin:review-prs` — Discover Devin PRs for current repo, review, and remediate

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
| Review Devin PRs | `/devin:review-prs` | — | Discover, review, and remediate all Devin PRs for current repo |

## Known Limitations

- **V3 API** — session endpoints promoted to `/v3/` (Feb 2026); some endpoints
  like repo indexing remain on `/v3beta1/`
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
- **API messaging requires ManageOrgSessions or ManageAccountSessions** —
  Without either permission, `/devin:message` and `/devin:review-prs` API
  calls fail with 403 on both endpoints. A PR comment fallback is available:
  feedback can be posted as PR comments with `@devin` prefix. Requires `gh`
  CLI auth and Devin's GitHub integration enabled on the repo.

### MCP Tool Integration

- **ruvector** — Recall past delegation outcomes at workflow start; tiered
  remember for delegation failures (Prompted tier). Graceful skip if
  yellow-ruvector not installed.
- **morph** — Not applicable. yellow-devin delegates to Devin's own editing
  capabilities, not local file edits.

