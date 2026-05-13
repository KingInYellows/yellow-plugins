#!/usr/bin/env bash
# yellow-semgrep SessionStart hook: emit credential-status.json so /setup:all
# can classify yellow-semgrep without probing the system keychain.
#
# Note: -e omitted intentionally — SessionStart hooks must output
# {"continue": true} on all paths, including jq/write failures.
set -uo pipefail

json_exit() {
  printf '{"continue": true}\n'
  exit 0
}

# Source the shared helper from yellow-core. yellow-core/lib/ is the
# canonical location for this helper; we resolve it relative to
# CLAUDE_PLUGIN_ROOT (which points at the yellow-semgrep dir) by going
# up one level and into yellow-core/lib.
HELPER="${CLAUDE_PLUGIN_ROOT:-${HOME}/.claude/plugins/cache/yellow-plugins/yellow-semgrep}/../yellow-core/lib/credential-status.sh"

if [ ! -f "$HELPER" ]; then
  # yellow-core not installed alongside yellow-semgrep — skip silently.
  json_exit
fi

# shellcheck source=/dev/null
. "$HELPER" 2>/dev/null || json_exit

# Read plugin version from plugin.json (manifest is the source of truth).
VERSION="unknown"
if command -v jq >/dev/null 2>&1 && [ -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" ]; then
  VERSION=$(jq -r '.version // "unknown"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || printf 'unknown')
fi

# Classify SEMGREP_APP_TOKEN: userConfig wins, shell env is fallback.
SOURCE="absent"
PRESENT="false"
if [ -n "${CLAUDE_PLUGIN_OPTION_SEMGREP_APP_TOKEN:-}" ]; then
  SOURCE="userConfig"
  PRESENT="true"
elif [ -n "${SEMGREP_APP_TOKEN:-}" ]; then
  SOURCE="shell_env"
  PRESENT="true"
fi

FIELDS=$(credential_status_field "semgrep_app_token" "$SOURCE" "$PRESENT" "null")
write_credential_status "yellow-semgrep" "$VERSION" "[$FIELDS]"

json_exit
