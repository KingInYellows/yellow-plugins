#!/usr/bin/env bash
# yellow-research tavily MCP wrapper.
# Resolves TAVILY_API_KEY from userConfig (preferred) or shell env fallback.
set -euo pipefail

if [ -n "${TAVILY_API_KEY_USERCONFIG:-}" ]; then
  export TAVILY_API_KEY="$TAVILY_API_KEY_USERCONFIG"
fi
unset TAVILY_API_KEY_USERCONFIG

# If neither userConfig nor shell env supplied a value, unset the empty
# string so the MCP package sees "absent" not "explicitly empty".
[ -z "${TAVILY_API_KEY:-}" ] && unset TAVILY_API_KEY

exec npx -y tavily-mcp@0.2.17 -- "$@"
