---
"yellow-composio": patch
---

Mark `composio_mcp_url` and `composio_api_key` as `required: true` so the plugin
can no longer be enabled with empty userConfig values. Previously, dismissing
either prompt left the bundled HTTP MCP server registered with an empty URL,
which Claude Code's transport normalizes to `/` and which `claude doctor`
reports as `SDK auth failed: "/" cannot be parsed as a URL` — the failure was
loud, misleading (auth message for a URL parse error), and prevented other
MCP servers from passing their auth checks. With both fields required, the
"dismissed prompt" state is unreachable: users either provide the values at
enable time or do not enable the plugin. CLAUDE.md and `/composio:setup`
prose updated to drop the dismissed-prompt fallback path.
