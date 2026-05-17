#!/usr/bin/env bash
# yellow-semgrep SessionStart hook: emit credential-status.json so /setup:all
# can classify yellow-semgrep without probing the system keychain.
#
# Note: -e omitted intentionally — SessionStart hooks must output
# {"continue": true} on all paths, including jq/write failures.
set -uo pipefail

HELPER="${CLAUDE_PLUGIN_ROOT:-}/../yellow-core/lib/credential-status.sh"
# yellow-core not installed alongside yellow-semgrep — skip silently.
[ -f "$HELPER" ] || { printf '{"continue": true}\n'; exit 0; }
# shellcheck source=/dev/null
. "$HELPER" 2>/dev/null || { printf '{"continue": true}\n'; exit 0; }
# Defend against version skew: if yellow-core was updated to a release that
# has credential-status.sh but predates credential_hook_scaffold, the
# source succeeds but the function is undefined. Skip cleanly.
command -v credential_hook_scaffold >/dev/null 2>&1 || { printf '{"continue": true}\n'; exit 0; }

# credential_hook_scaffold reads the version, classifies the token field
# (userConfig wins, shell env fallback), writes credential-status.json,
# then emits {"continue": true} and exits 0.
credential_hook_scaffold "yellow-semgrep" "${CLAUDE_PLUGIN_ROOT:-}" \
  "semgrep_app_token:CLAUDE_PLUGIN_OPTION_SEMGREP_APP_TOKEN:SEMGREP_APP_TOKEN"
