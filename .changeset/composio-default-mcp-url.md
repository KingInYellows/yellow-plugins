---
'yellow-composio': minor
'yellow-core': patch
---

Authenticate the bundled Composio server with Claude Code's browser OAuth
against `https://connect.composio.dev/mcp`. The server is native HTTP with
no headers, so enable does not prompt for a URL or an API key. The stdio
proxy and consumer-key userConfig are removed because a proxy that injects
a key never starts the OAuth flow. Headless hosts can still register a
user-level server with a For You consumer key. `/setup:all` classifies
yellow-composio from MCP tool visibility, not a credential-status file.
