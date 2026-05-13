#!/usr/bin/env bash
# Note: -e omitted intentionally — hook must output {"continue": true} on all paths
set -uo pipefail

# yellow-composio SessionStart hook: warn user if composio_mcp_url is non-HTTPS.
# Cannot block MCP server start (Claude Code attaches MCP before this runs);
# this is an advisory surface only. The schema-level pattern enforcement that
# previously lived in plugin.json was rejected by the Claude Code remote
# validator (Unrecognized key); see plans/2026-05-08-doctor-fix-rollback-userconfig-pattern.md.

# Hardcoded fallback message for the non-HTTPS warning so the alert is preserved
# when jq is unavailable or fails (the message is fully static, so we cannot lose
# information by using a literal string in those branches).
NON_HTTPS_WARN_JSON='{"continue":true,"systemMessage":"[yellow-composio] Warning: composio_mcp_url is not HTTPS. The Composio API key will be sent as X-API-Key over an unencrypted channel and could leak. Reconfigure via /plugin (set composio_mcp_url to an https://mcp.composio.dev/* URL)."}'

json_exit() {
  local sysmsg="${1:-}"
  if [ -n "$sysmsg" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -nc --arg msg "$sysmsg" '{continue: true, systemMessage: $msg}' \
        || printf '%s\n' "$NON_HTTPS_WARN_JSON"
    else
      printf '%s\n' "$NON_HTTPS_WARN_JSON"
    fi
  else
    printf '{"continue": true}\n'
  fi
  exit 0
}

URL="${CLAUDE_PLUGIN_OPTION_COMPOSIO_MCP_URL:-}"
API_KEY_OPT="${CLAUDE_PLUGIN_OPTION_COMPOSIO_API_KEY:-}"

# Emit credential-status.json (best-effort; never blocks SessionStart).
emit_status() {
  # Guard CLAUDE_PLUGIN_ROOT against `set -u` unbound exit when the hook runs
  # outside a Claude Code session (e.g. manual invocation or stale environment).
  # Fallback mirrors the cached plugin location used by yellow-semgrep.
  local plugin_root="${CLAUDE_PLUGIN_ROOT:-${HOME}/.claude/plugins/cache/yellow-plugins/yellow-composio}"
  local helper="${plugin_root}/../yellow-core/lib/credential-status.sh"
  [ -f "$helper" ] || return 0
  # shellcheck source=/dev/null
  . "$helper" 2>/dev/null || return 0

  local version="unknown"
  if command -v jq >/dev/null 2>&1 && [ -f "${plugin_root}/.claude-plugin/plugin.json" ]; then
    version=$(jq -r '.version // "unknown"' "${plugin_root}/.claude-plugin/plugin.json" 2>/dev/null || printf 'unknown')
  fi

  # URL: userConfig wins, shell env fallback.
  local url_source="absent" url_present="false"
  if [ -n "$URL" ]; then
    url_source="userConfig"; url_present="true"
  elif [ -n "${COMPOSIO_MCP_URL:-}" ]; then
    url_source="shell_env"; url_present="true"
  fi

  # API key: userConfig wins, shell env fallback.
  local key_source="absent" key_present="false"
  if [ -n "$API_KEY_OPT" ]; then
    key_source="userConfig"; key_present="true"
  elif [ -n "${COMPOSIO_API_KEY:-}" ]; then
    key_source="shell_env"; key_present="true"
  fi

  local url_field key_field
  url_field=$(credential_status_field "composio_mcp_url" "$url_source" "$url_present" "null")
  key_field=$(credential_status_field "composio_api_key" "$key_source" "$key_present" "null")
  write_credential_status "yellow-composio" "$version" "[$url_field,$key_field]" 2>/dev/null || true
}

emit_status

# Empty URL = no source provided; wrapper will exit non-zero and the bundled MCP
# will not start. Nothing to warn about — no API key is on the wire.
if [ -z "$URL" ] && [ -z "${COMPOSIO_MCP_URL:-}" ]; then
  json_exit ""
fi

# Use the resolved value (userConfig preferred, then shell env) for HTTPS check.
EFFECTIVE_URL="${URL:-${COMPOSIO_MCP_URL:-}}"

case "$EFFECTIVE_URL" in
  https://*)
    json_exit ""
    ;;
  *)
    json_exit "[yellow-composio] Warning: composio_mcp_url is not HTTPS. The Composio API key will be sent as X-API-Key over an unencrypted channel and could leak. Reconfigure via /plugin (set composio_mcp_url to an https://mcp.composio.dev/* URL)."
    ;;
esac
