#!/usr/bin/env bash
# yellow-research SessionStart hook:
#   (1) Pre-warm context7 library docs cache (background, fire-and-forget)
#   (2) Emit credential-status.json so /setup:all can render an accurate
#       dashboard without probing the keychain.
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

# Pre-warm context7 library docs cache asynchronously. Detached subshell
# follows the yellow-morph prewarm pattern: parent exits in <1s, child
# runs the HTTP work; failures are silent (cache stays empty, runtime
# falls back to existing chain). Skip cleanly if CLAUDE_PLUGIN_ROOT is
# unset OR empty (an empty value would produce the invalid absolute path
# "/hooks/lib/context7-cache.sh") or if the lib is missing (older
# yellow-research install before this hook landed).
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  CACHE_LIB="${CLAUDE_PLUGIN_ROOT}/hooks/lib/context7-cache.sh"
  if [ -f "$CACHE_LIB" ]; then
    ( # shellcheck source=/dev/null
      . "$CACHE_LIB" && _lc_prewarm
    ) >/dev/null 2>&1 &
    disown
  fi
fi

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
