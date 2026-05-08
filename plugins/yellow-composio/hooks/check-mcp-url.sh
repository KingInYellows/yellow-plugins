#!/usr/bin/env bash
# Note: -e omitted intentionally — hook must output {"continue": true} on all paths
set -uo pipefail

# yellow-composio SessionStart hook: warn user if composio_mcp_url is non-HTTPS.
# Cannot block MCP server start (Claude Code attaches MCP before this runs);
# this is an advisory surface only. The schema-level pattern enforcement that
# previously lived in plugin.json was rejected by the Claude Code remote
# validator (Unrecognized key); see plans/2026-05-08-doctor-fix-rollback-userconfig-pattern.md.

json_exit() {
  local sysmsg="${1:-}"
  if [ -n "$sysmsg" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -nc --arg msg "$sysmsg" '{continue: true, systemMessage: $msg}' \
        || printf '{"continue": true}\n'
    else
      printf '{"continue": true}\n'
    fi
  else
    printf '{"continue": true}\n'
  fi
  exit 0
}

URL="${CLAUDE_PLUGIN_OPTION_COMPOSIO_MCP_URL:-}"

# Empty URL = user dismissed the prompt; bundled MCP will fail to start, no leak risk.
if [ -z "$URL" ]; then
  json_exit ""
fi

case "$URL" in
  https://*)
    json_exit ""
    ;;
  *)
    json_exit "[yellow-composio] Warning: composio_mcp_url is not HTTPS ($URL). The Composio API key will be sent as X-API-Key over an unencrypted channel and could leak. Reconfigure via /plugin (set composio_mcp_url to an https://mcp.composio.dev/* URL)."
    ;;
esac
