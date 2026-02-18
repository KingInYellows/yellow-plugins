# yellow-linear

Linear MCP integration with PM workflows for issues, projects, initiatives,
cycles, and documents.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-linear@yellow-plugins
```

## Prerequisites

- Linear account ([linear.app](https://linear.app))
- Browser access for OAuth login on first use
- Graphite CLI (`gt`) for branch management

## Authentication

On first MCP tool call, Claude Code opens a browser popup to authenticate with
your Linear account. The OAuth token is stored in your system keychain and
refreshed automatically. No API keys or `.env` files needed.

To re-authenticate or revoke access: run `/mcp` in Claude Code, select the
Linear server, and choose "Clear authentication".

## Commands

| Command              | Description                                                                      |
| -------------------- | -------------------------------------------------------------------------------- |
| `/linear:create`     | Create a Linear issue from current context                                       |
| `/linear:sync`       | Sync current branch with its Linear issue (load context, link PR, update status) |
| `/linear:triage`     | Review and assign incoming Linear issues                                         |
| `/linear:plan-cycle` | Plan sprint cycle by selecting backlog issues                                    |
| `/linear:status`     | Generate project and initiative health report                                    |

## Agents

| Agent                 | Description                                     |
| --------------------- | ----------------------------------------------- |
| `linear-issue-loader` | Auto-load Linear issue context from branch name |
| `linear-pr-linker`    | Link PRs to Linear issues and sync status       |
| `linear-explorer`     | Deep search and analysis of Linear backlog      |

## Skills

| Skill              | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `linear-workflows` | Reference patterns and conventions for Linear workflows |

## MCP Servers

| Server | URL                          | Auth                  |
| ------ | ---------------------------- | --------------------- |
| Linear | `https://mcp.linear.app/mcp` | OAuth (browser popup) |

## Limitations

- MCP-only — no offline mode
- Manual retry on transient failures
- Pagination capped at 30-50 items per query

## License

MIT
