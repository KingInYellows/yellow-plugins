# yellow-devin

Devin.AI V3 API integration — delegate tasks, manage sessions, research
codebases via DeepWiki, orchestrate plan-implement-review chains.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-devin@yellow-plugins
```

## Prerequisites

- `DEVIN_SERVICE_USER_TOKEN` environment variable (service user credential)
- `DEVIN_ORG_ID` environment variable (organization ID)
- `curl` and `jq` installed
- Graphite CLI (`gt`) for branch management

## Setup

### 1. Create a Service User

Go to **Enterprise Settings > Service Users** in the Devin web app. Create a new
service user with the following permissions:

- `ManageOrgSessions` — create, get, terminate, archive sessions
- `ManageAccountSessions` — list sessions, send messages

### 2. Set Environment Variables

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export DEVIN_SERVICE_USER_TOKEN="cog_your_token_here"
export DEVIN_ORG_ID="your-org-id"
```

Find your org ID at **Enterprise Settings > Organizations**.

Never commit tokens to version control.

### Migrating from V1

If you previously used `DEVIN_API_TOKEN` with an `apk_` key:

1. Create a new service user (see above)
2. Replace `DEVIN_API_TOKEN` with `DEVIN_SERVICE_USER_TOKEN` in your shell
   profile
3. Add `DEVIN_ORG_ID` (required for V3)
4. Remove the old `DEVIN_API_TOKEN` export

## Commands

| Command | Description |
|---|---|
| `/devin:delegate` | Create a session with task prompt, tags, ACU limit |
| `/devin:status` | Check session status or list recent sessions |
| `/devin:message` | Send follow-up message (auto-resumes suspended sessions) |
| `/devin:cancel` | Terminate a session (requires confirmation) |
| `/devin:wiki` | Query DeepWiki/Devin Wiki about a repository |
| `/devin:archive` | Archive a session (hides from default listing) |
| `/devin:tag` | Add, remove, or list session tags |

## Agents

| Agent | Description |
|---|---|
| `devin-orchestrator` | Multi-step plan-implement-review-fix cycles with Devin |

## Skills

| Skill | Description |
|---|---|
| `devin-workflows` | V3 API patterns, error codes, security conventions |

## MCP Servers

| Server | URL | Auth |
|---|---|---|
| DeepWiki | `https://mcp.deepwiki.com/mcp` | None (public) |
| Devin | `https://mcp.devin.ai/mcp` | TBD (cog_ token compatibility unverified) |

## Troubleshooting

**"V1 API key detected (apk_ prefix)"** — You're using a legacy API key. Create
a service user token (cog_ prefix) at Enterprise Settings > Service Users.

**"DEVIN_ORG_ID not set"** — V3 requires an org ID. Find yours at Enterprise
Settings > Organizations.

**"Permission denied (403)"** — Your service user needs `ManageOrgSessions` and
`ManageAccountSessions` permissions.

**"Authentication failed (401)"** — Your token was rejected. Create a new
service user at Enterprise Settings > Service Users.

## Limitations

- V3 API is in beta — endpoint URLs may change
- Devin MCP auth with `cog_` tokens unverified
- Scheduled sessions are UI-only (no API)
- No idempotent session creation (title-based dedup used instead)
- Tag update endpoint may fall back to V1
- No unarchive endpoint
- Session state not persisted locally — use `/devin:status` after restart
- Polling-based monitoring (no webhook support)

## License

MIT
