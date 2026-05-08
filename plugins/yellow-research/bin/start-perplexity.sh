#!/usr/bin/env bash
# yellow-research perplexity MCP wrapper.
# Resolves PERPLEXITY_API_KEY from userConfig (preferred) or shell env fallback.
# PERPLEXITY_TIMEOUT_MS is passed through from plugin.json env unchanged.
set -euo pipefail

if [ -n "${PERPLEXITY_API_KEY_USERCONFIG:-}" ]; then
  export PERPLEXITY_API_KEY="$PERPLEXITY_API_KEY_USERCONFIG"
fi
unset PERPLEXITY_API_KEY_USERCONFIG

# If neither userConfig nor shell env supplied a value, unset the empty
# string so the MCP package sees "absent" not "explicitly empty".
[ -z "${PERPLEXITY_API_KEY:-}" ] && unset PERPLEXITY_API_KEY

exec npx -y "@perplexity-ai/mcp-server@0.8.2" ${1+-- "$@"}
