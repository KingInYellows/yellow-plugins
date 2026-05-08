#!/usr/bin/env bash
# yellow-research exa MCP wrapper.
# Resolves EXA_API_KEY from userConfig (preferred) or shell env fallback.
set -euo pipefail

if [ -n "${EXA_API_KEY_USERCONFIG:-}" ]; then
  export EXA_API_KEY="$EXA_API_KEY_USERCONFIG"
fi
unset EXA_API_KEY_USERCONFIG

# If neither userConfig nor shell env supplied a value, unset the empty
# string so the MCP package sees "absent" not "explicitly empty".
[ -z "${EXA_API_KEY:-}" ] && unset EXA_API_KEY

exec npx -y exa-mcp-server@3.1.8 \
  "tools=web_search_exa,get_code_context_exa,company_research_exa,web_search_advanced_exa,crawling_exa,deep_researcher_start,deep_researcher_check" \
  -- "$@"
