#!/usr/bin/env bash
# yellow-research exa MCP wrapper.
# Resolves EXA_API_KEY from userConfig (preferred) or shell env fallback
# via the shared resolver in bin/lib/resolve-mcp-key.sh.
set -euo pipefail

# shellcheck source=lib/resolve-mcp-key.sh
. "$(dirname "$0")/lib/resolve-mcp-key.sh"
resolve_mcp_key EXA_API_KEY

exec npx -y "exa-mcp-server@3.1.8" \
  "tools=web_search_exa,get_code_context_exa,company_research_exa,web_search_advanced_exa,crawling_exa,deep_researcher_start,deep_researcher_check" \
  ${1+-- "$@"}
