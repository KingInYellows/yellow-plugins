#!/usr/bin/env bash
# yellow-research SessionStart hook: emit credential-status.json so /setup:all
# can render an accurate dashboard without probing the keychain.
#
# Note: -e omitted intentionally — SessionStart hooks must output
# {"continue": true} on all paths.
set -uo pipefail

HELPER="${CLAUDE_PLUGIN_ROOT:-}/../yellow-core/lib/credential-status.sh"
[ -f "$HELPER" ] || { printf '{"continue": true}\n'; exit 0; }
# shellcheck source=/dev/null
. "$HELPER" 2>/dev/null || { printf '{"continue": true}\n'; exit 0; }
# Defend against version skew: if yellow-core was updated to a release that
# has credential-status.sh but predates credential_hook_scaffold, the
# source succeeds but the function is undefined. Skip cleanly.
command -v credential_hook_scaffold >/dev/null 2>&1 || { printf '{"continue": true}\n'; exit 0; }

# Only userConfig-declared keys (perplexity, tavily, exa). Ceramic and
# parallel are OAuth-managed by Claude Code with no userConfig field, so
# they are intentionally omitted — including them would inflate the
# readiness denominator and force /setup:all to classify the plugin as
# PARTIAL even when all three real keys are configured.
# credential_hook_scaffold reads the version, classifies each field, writes
# credential-status.json, then emits {"continue": true} and exits 0.
credential_hook_scaffold "yellow-research" "${CLAUDE_PLUGIN_ROOT:-}" \
  "perplexity_api_key:CLAUDE_PLUGIN_OPTION_PERPLEXITY_API_KEY:PERPLEXITY_API_KEY" \
  "tavily_api_key:CLAUDE_PLUGIN_OPTION_TAVILY_API_KEY:TAVILY_API_KEY" \
  "exa_api_key:CLAUDE_PLUGIN_OPTION_EXA_API_KEY:EXA_API_KEY"
