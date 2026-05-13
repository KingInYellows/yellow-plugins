#!/usr/bin/env bash
# yellow-semgrep MCP wrapper.
# Resolves SEMGREP_APP_TOKEN from userConfig (preferred) or shell env fallback.
# Mirrors the 3-element pattern from yellow-research/bin/start-*.sh.
#
# Before this wrapper existed, plugin.json's env block set
#   "SEMGREP_APP_TOKEN": "${user_config.semgrep_app_token}"
# directly, which OVERWROTE any pre-existing shell-env SEMGREP_APP_TOKEN
# with an empty string when the user dismissed the userConfig prompt.
# This wrapper preserves the shell env value as a fallback.
set -euo pipefail

if [ -n "${SEMGREP_APP_TOKEN_USERCONFIG:-}" ]; then
  export SEMGREP_APP_TOKEN="$SEMGREP_APP_TOKEN_USERCONFIG"
fi
unset SEMGREP_APP_TOKEN_USERCONFIG

# If neither userConfig nor shell env supplied a value, unset the empty
# string so the MCP package sees "absent" not "explicitly empty".
[ -z "${SEMGREP_APP_TOKEN:-}" ] && unset SEMGREP_APP_TOKEN

exec semgrep mcp ${1+-- "$@"}
