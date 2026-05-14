#!/usr/bin/env bash
# yellow-research perplexity MCP wrapper.
# Resolves PERPLEXITY_API_KEY from userConfig (preferred) or shell env
# fallback via the shared resolver in bin/lib/resolve-mcp-key.sh.
# PERPLEXITY_TIMEOUT_MS is passed through from plugin.json env unchanged.
set -euo pipefail

# shellcheck source=lib/resolve-mcp-key.sh
. "$(dirname "$0")/lib/resolve-mcp-key.sh"
resolve_mcp_key PERPLEXITY_API_KEY

exec npx -y "@perplexity-ai/mcp-server@0.8.2" ${1+-- "$@"}
