# yellow-devin

Devin.AI V3 API integration — delegate tasks, manage sessions, orchestrate
plan-implement-review chains.

## Status: Legacy

`yellow-devin` is legacy — manual install, security fixes only, replaced by
`yellow-cursor`. It is not removed and keeps working:

- Existing sessions and commands (`/devin:status`, `/devin:message`, etc.) are
  unaffected.
- `/devin:wiki`'s DeepWiki fallback now redirects to `yellow-research`,
  DeepWiki's new canonical home — the command still works, it just discovers the
  tools from their new location.
- For new delegation work, prefer `/cursor:delegate` (yellow-cursor) or the
  provider-neutral `/linear:delegate`.
- To keep using Devin explicitly: enable `yellow-devin` and disable
  `yellow-cursor` (only one remote-agent provider is active at a time), or pass
  `--provider devin` to `/linear:delegate`.

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

- `UseDevinSessions` — create sessions (required)
- `ViewOrgSessions` — list and get sessions (required)
- `ManageOrgSessions` — send messages, terminate, archive (required)
- `ViewAccountSessions` — list sessions cross-org (optional)
- `ManageAccountSessions` — enterprise-scope messaging (optional)

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

| Command           | Description                                                                          |
| ----------------- | ------------------------------------------------------------------------------------ |
| `/devin:setup`    | Validate credentials and permissions (first install, token rotation, 401/403 errors) |
| `/devin:delegate` | Create a session with task prompt, tags, ACU limit                                   |
| `/devin:status`   | Check session status or list recent sessions                                         |
| `/devin:message`  | Send follow-up message (auto-resumes suspended sessions)                             |
| `/devin:cancel`   | Terminate a session (requires confirmation)                                          |
| `/devin:wiki`     | Query DeepWiki/Devin Wiki about a repository                                         |
| `/devin:archive`  | Archive a session (hides from default listing)                                       |
| `/devin:tag`      | Add, remove, or list session tags                                                    |

## Agents

| Agent                | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `devin-orchestrator` | Multi-step plan-implement-review-fix cycles with Devin |

## Skills

| Skill             | Description                                        |
| ----------------- | -------------------------------------------------- |
| `devin-workflows` | V3 API patterns, error codes, security conventions |

## MCP Servers

| Server | URL                        | Auth                                       |
| ------ | -------------------------- | ------------------------------------------ |
| Devin  | `https://mcp.devin.ai/mcp` | TBD (cog\_ token compatibility unverified) |

DeepWiki moved to the `yellow-research` plugin (bundled, no auth, public repos
only). `/devin:wiki` still works — it discovers the DeepWiki tools at runtime,
preferring yellow-research's copy and falling back to an older yellow-devin
install's bundled copy if present.

## Troubleshooting

**"V1 API key detected (apk\_ prefix)"** — You're using a legacy API key. Create
a service user token (cog\_ prefix) at Enterprise Settings > Service Users.

**"DEVIN_ORG_ID not set"** — V3 requires an org ID. Find yours at Enterprise
Settings > Organizations.

**"Permission denied (403)"** — Your service user may be missing a required
permission. Run `/devin:setup` to check, and verify all three org-scoped
permissions are granted: `UseDevinSessions`, `ViewOrgSessions`,
`ManageOrgSessions`.

**"Authentication failed (401)"** — Your token was rejected. Create a new
service user at Enterprise Settings > Service Users.

## Limitations

- V3 session endpoints promoted from `/v3beta1/` to `/v3/` (Feb 2026)
- Devin MCP auth with `cog_` tokens unverified
- Scheduled sessions are UI-only (no API)
- No idempotent session creation (title-based dedup used instead)
- Tag update endpoint may fall back to V1
- No unarchive endpoint
- Session state not persisted locally — use `/devin:status` after restart
- Polling-based monitoring (no webhook support)

## License

MIT
