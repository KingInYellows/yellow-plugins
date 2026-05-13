#!/usr/bin/env bash
# yellow-research SessionStart hook: emit credential-status.json so /setup:all
# can render an accurate dashboard without probing the keychain.
#
# Note: -e omitted intentionally — SessionStart hooks must output
# {"continue": true} on all paths.
set -uo pipefail

json_exit() {
  printf '{"continue": true}\n'
  exit 0
}

HELPER="${CLAUDE_PLUGIN_ROOT:-}/../yellow-core/lib/credential-status.sh"

if [ ! -f "$HELPER" ]; then
  json_exit
fi

# shellcheck source=/dev/null
. "$HELPER" 2>/dev/null || json_exit

VERSION="unknown"
if command -v jq >/dev/null 2>&1 && [ -f "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" ]; then
  VERSION=$(jq -r '.version // "unknown"' "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json" 2>/dev/null || printf 'unknown')
fi

# Classify each credential field: userConfig wins, shell env is fallback.
classify() {
  local userconfig_var="$1"
  local shell_var="$2"
  local source="absent" present="false"
  local uc_val sh_val
  # shellcheck disable=SC2086
  uc_val=$(printenv "$userconfig_var" 2>/dev/null || printf '')
  # shellcheck disable=SC2086
  sh_val=$(printenv "$shell_var" 2>/dev/null || printf '')
  if [ -n "$uc_val" ]; then
    source="userConfig"; present="true"
  elif [ -n "$sh_val" ]; then
    source="shell_env"; present="true"
  fi
  printf '%s|%s' "$source" "$present"
}

# Only userConfig-declared keys (perplexity, tavily, exa) — the protocol
# requires credentials[].field to match a userConfig key. Ceramic and parallel
# are OAuth-managed by Claude Code with no userConfig field, so they are
# intentionally omitted; including them would inflate the readiness denominator
# and force /setup:all to classify the plugin as PARTIAL even when all three
# real keys are configured.
read -r PERP_SRC PERP_PRES <<< "$(classify CLAUDE_PLUGIN_OPTION_PERPLEXITY_API_KEY PERPLEXITY_API_KEY | tr '|' ' ')"
read -r TAV_SRC TAV_PRES   <<< "$(classify CLAUDE_PLUGIN_OPTION_TAVILY_API_KEY TAVILY_API_KEY | tr '|' ' ')"
read -r EXA_SRC EXA_PRES   <<< "$(classify CLAUDE_PLUGIN_OPTION_EXA_API_KEY EXA_API_KEY | tr '|' ' ')"

PERP=$(credential_status_field "perplexity_api_key" "$PERP_SRC" "$PERP_PRES" "null")
TAV=$(credential_status_field "tavily_api_key" "$TAV_SRC" "$TAV_PRES" "null")
EXA=$(credential_status_field "exa_api_key" "$EXA_SRC" "$EXA_PRES" "null")

write_credential_status "yellow-research" "$VERSION" "[$PERP,$TAV,$EXA]"

json_exit
