---
"yellow-composio": patch
"yellow-core": patch
---

When the bundled Composio MCP is OFFLINE, `/composio:setup` now detects WSL
(and its networking mode) and leads with
`claude mcp login plugin:yellow-composio:composio-server --no-browser`: run it
in a separate terminal, open the printed URL anywhere, and paste the redirect
URL back — no inbound callback to WSL needed. On WSL2 NAT it also suggests
`networkingMode=mirrored`; the consumer-key `claude mcp add` path stays as the
last resort. When only the claude.ai Composio connector is visible, setup still
reports HEALTHY but notes the bundled server is not authenticated.
`/composio:status` and `/setup:all` point at the same login command.
