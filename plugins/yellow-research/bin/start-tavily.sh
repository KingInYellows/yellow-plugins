#!/usr/bin/env bash
# yellow-research tavily MCP wrapper.
# Resolves TAVILY_API_KEY from userConfig (preferred) or shell env fallback
# via the shared resolver in bin/lib/resolve-mcp-key.sh.
set -euo pipefail

# shellcheck source=lib/resolve-mcp-key.sh
. "$(dirname "$0")/lib/resolve-mcp-key.sh"
resolve_mcp_key TAVILY_API_KEY

exec npx -y "tavily-mcp@0.2.17" ${1+-- "$@"}
