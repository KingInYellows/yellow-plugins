#!/usr/bin/env bash
# yellow-composio MCP wrapper.
# Resolves COMPOSIO_MCP_URL and COMPOSIO_API_KEY from userConfig (preferred)
# or shell env fallback, then execs the stdio<->HTTPS proxy.
#
# Why a wrapper instead of type:http?
# - Claude Code bug #51581: ${VAR} substitution in HTTP MCP `headers` field
#   does not work (sends literal string). Wrapper avoids the substitution
#   engine entirely.
# - Without a wrapper, multi-host fleets cannot use shell env for the URL
#   or key — every host would need a userConfig prompt cycle.
set -euo pipefail

# Resolve COMPOSIO_MCP_URL: userConfig wins, shell env is fallback.
if [ -n "${COMPOSIO_MCP_URL_USERCONFIG:-}" ]; then
  export COMPOSIO_MCP_URL="$COMPOSIO_MCP_URL_USERCONFIG"
fi
unset COMPOSIO_MCP_URL_USERCONFIG
[ -z "${COMPOSIO_MCP_URL:-}" ] && unset COMPOSIO_MCP_URL

# Resolve COMPOSIO_API_KEY: userConfig wins, shell env is fallback.
if [ -n "${COMPOSIO_API_KEY_USERCONFIG:-}" ]; then
  export COMPOSIO_API_KEY="$COMPOSIO_API_KEY_USERCONFIG"
fi
unset COMPOSIO_API_KEY_USERCONFIG
[ -z "${COMPOSIO_API_KEY:-}" ] && unset COMPOSIO_API_KEY

# Fail fast if either value is missing. Exiting non-zero here prevents the
# bundled MCP server from registering with an empty URL, which would
# cascade-fail `claude doctor` for ALL other MCPs in the session.
if [ -z "${COMPOSIO_MCP_URL:-}" ]; then
  printf '[start-composio] Error: COMPOSIO_MCP_URL is not set.\n' >&2
  printf '[start-composio]   Set via userConfig (composio_mcp_url) or shell env.\n' >&2
  printf '[start-composio]   The Composio MCP server will not start; other MCPs are unaffected.\n' >&2
  exit 1
fi
if [ -z "${COMPOSIO_API_KEY:-}" ]; then
  printf '[start-composio] Error: COMPOSIO_API_KEY is not set.\n' >&2
  printf '[start-composio]   Set via userConfig (composio_api_key) or shell env.\n' >&2
  exit 1
fi
case "$COMPOSIO_MCP_URL" in
  https://*) ;;
  *)
    printf '[start-composio] Error: COMPOSIO_MCP_URL must be https:// (got %s)\n' "${COMPOSIO_MCP_URL:0:8}..." >&2
    printf '[start-composio]   API keys sent over non-HTTPS would leak in cleartext.\n' >&2
    exit 1
    ;;
esac

exec node "${CLAUDE_PLUGIN_ROOT}/bin/composio-proxy.mjs"
