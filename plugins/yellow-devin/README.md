# yellow-devin

Devin.AI integration for multi-agent workflows — delegate tasks, research
codebases via DeepWiki, orchestrate plan-implement-review chains.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-devin@yellow-plugins
```

## Prerequisites

- `DEVIN_API_TOKEN` environment variable set (Bearer token from
  [devin.ai](https://devin.ai))
- `curl` and `jq` installed
- Graphite CLI (`gt`) for branch management

## Authentication

Commands require a `DEVIN_API_TOKEN` environment variable (Bearer token for the
Devin REST API):

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export DEVIN_API_TOKEN="apk_your_token_here"

# Get your token: https://devin.ai/settings/api
```

Never commit tokens to version control. The DeepWiki MCP server requires no
authentication.

## Commands

| Command           | Description                                         |
| ----------------- | --------------------------------------------------- |
| `/devin:delegate` | Create a Devin session with a task prompt           |
| `/devin:status`   | Check session status and recent output              |
| `/devin:message`  | Send follow-up message to active session            |
| `/devin:cancel`   | Terminate a running session (requires confirmation) |
| `/devin:wiki`     | Query DeepWiki about a repository                   |

## Agents

| Agent                | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `devin-orchestrator` | Multi-step plan-implement-review-fix cycles with Devin |

## Skills

| Skill             | Description                                    |
| ----------------- | ---------------------------------------------- |
| `devin-workflows` | Shared conventions, API reference, error codes |

## MCP Servers

| Server   | URL                            | Auth          |
| -------- | ------------------------------ | ------------- |
| DeepWiki | `https://mcp.deepwiki.com/mcp` | None (public) |
| Devin    | `https://mcp.devin.ai/mcp`     | OAuth/Token   |

## Limitations

- Session state not persisted locally — use `/devin:status` after restart
- Polling-based monitoring (no webhook support)
- Pagination capped at 10 sessions per query

## License

MIT
