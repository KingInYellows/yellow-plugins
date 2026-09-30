#!/usr/bin/env bash
# yellow-semgrep SessionStart hook: emit credential-status.json so /setup:all
# can classify yellow-semgrep without probing the system keychain.
#
# Note: -e omitted intentionally — SessionStart hooks must output
# {"continue": true} on all paths, including jq/write failures.
set -uo pipefail

# Locate yellow-core's credential-status.sh: the repository layout
# (plugins/<name>/ siblings) first, then the installed cache layout
# (cache/<marketplace>/<plugin>/<version>/), newest version first —
# ${CLAUDE_PLUGIN_ROOT}/../yellow-core alone never resolves in the cache.
ROOT="${CLAUDE_PLUGIN_ROOT:-}"
HELPER="$ROOT/../yellow-core/lib/credential-status.sh"
if [ -n "$ROOT" ] && [ ! -f "$HELPER" ] && [ -d "$ROOT/../../yellow-core" ]; then
  CORE_VER=$(for d in "$ROOT/../../yellow-core"/*/; do
    d=$(basename -- "$d")
    [[ "$d" =~ ^[0-9]+(\.[0-9]+)*$ ]] && printf '%s\n' "$d"
  done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
  [ -n "$CORE_VER" ] && HELPER="$ROOT/../../yellow-core/$CORE_VER/lib/credential-status.sh"
fi
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
