---
'yellow-composio': major
'yellow-core': patch
---

BREAKING: the bundled Composio server no longer reads `composio_mcp_url`,
`composio_api_key`, `COMPOSIO_MCP_URL`, or `COMPOSIO_API_KEY`. Existing 2.x
installs that authenticated that way must open `/mcp` and complete browser
OAuth, or register a user-level server with a For You consumer key.

The server is native HTTP at `https://connect.composio.dev/mcp` with no
headers. The stdio proxy is removed because a proxy that injects a key
never starts the OAuth flow. `/setup:all` classifies yellow-composio from
MCP tool visibility, not a credential-status file.
