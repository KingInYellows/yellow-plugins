---
'yellow-composio': major
---

feat(yellow-composio): stdio MCP transport with shell env fallback

Converts the bundled Composio MCP server from `type: http` to a `command`-type
stdio MCP that proxies to Composio's HTTPS endpoint. This unblocks two pain
points:

1. **Multi-host fleet support.** Power users can now set `COMPOSIO_MCP_URL`
   and `COMPOSIO_API_KEY` in shell rc / direnv / a secrets manager. The
   wrapper (`bin/start-composio.sh`) resolves userConfig OR shell env with
   userConfig-preferred precedence — mirroring the canonical pattern from
   yellow-research and yellow-morph.
2. **Cascade failure protection.** Previously, an empty `composio_mcp_url`
   registered the bundled MCP with `url: ""` and broke `claude doctor` for
   every other MCP in the session. The wrapper now exits non-zero on empty
   or non-HTTPS URLs, so the bundled MCP simply doesn't register — all
   other MCPs are unaffected.

Architecture:
- `bin/start-composio.sh` — credential resolver, HTTPS-only enforcement
- `bin/composio-proxy.mjs` — minimal Node.js stdio↔HTTPS proxy
  (newline-delimited JSON-RPC per MCP spec; request/response only —
  Composio does not need persistent SSE)
- `plugin.json` — `mcpServers.composio-server` is now command-based with
  env block declaring both `_USERCONFIG` and shell-env-passthrough variants
- `hooks/check-mcp-url.sh` — extended to also emit `credential-status.json`
  per the protocol from the yellow-core foundation PR
- `userConfig.composio_mcp_url`/`composio_api_key` — `required: true`
  removed (per research: it does not block install, only surfaces as
  confusing MCP-startup errors)

Breaking change: legacy installs from v1.2.x must `/plugin disable
yellow-composio && /plugin enable yellow-composio` after Claude Code restart
to re-trigger the userConfig prompt. Existing keychain-stored values are
preserved.

Trade-off: this diverges from Composio's officially recommended
`claude mcp add --transport http` integration. Documented in CLAUDE.md.
The trade-off is necessary because Claude Code bug #51581 makes `${VAR}`
substitution in HTTP MCP `headers` non-functional, preventing shell env
fallback for the API key on the http transport.
