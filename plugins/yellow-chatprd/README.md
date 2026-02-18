# yellow-chatprd

ChatPRD MCP integration with document management workflows and Linear bridging
for Claude Code.

## Install

```
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-chatprd@yellow-plugins
```

## Prerequisites

- ChatPRD account ([chatprd.ai](https://chatprd.ai))
- Browser access for OAuth login (will not work in headless SSH sessions)
- Optional: `yellow-linear` plugin for Linear bridging

## Authentication

On first MCP tool call, Claude Code opens a browser popup to authenticate with
your ChatPRD account via Clerk OAuth. The token is stored in your system keychain
and refreshed automatically. No API keys or `.env` files needed.

Requires browser access — will not work in headless SSH sessions. To
re-authenticate: run `/mcp` in Claude Code, select the ChatPRD server, and
choose "Clear authentication".

## Commands

| Command                | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `/chatprd:create`      | Create a new document (PRD, spec, one-pager, API doc) |
| `/chatprd:search`      | Search ChatPRD workspace for documents                |
| `/chatprd:update`      | Update an existing ChatPRD document                   |
| `/chatprd:list`        | List documents in ChatPRD workspace                   |
| `/chatprd:link-linear` | Create Linear issues from a ChatPRD document          |

## Agents

| Agent                | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `document-assistant` | ChatPRD document management (create, read, update, search) |
| `linear-prd-bridge`  | Bridge ChatPRD documents to Linear issues                  |

## Skills

| Skill                 | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `chatprd-conventions` | Error mapping, template guide, and input validation reference |

## MCP Servers

| Server  | URL                          | Auth                  |
| ------- | ---------------------------- | --------------------- |
| ChatPRD | `https://app.chatprd.ai/mcp` | OAuth (browser popup) |

## License

MIT
