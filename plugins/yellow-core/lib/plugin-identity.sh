#!/usr/bin/env bash
# yellow-core: plugin-identity helper.
#
# Reports which copy of a plugin is executing (the installed cache under
# ${CLAUDE_PLUGIN_ROOT}) versus the version in the current checkout, so a
# handoff preflight can say whether the cached plugin lags the source tree.
# It never copies, enables, or installs anything.
#
# Usage:
#   . "${SCRIPT_DIR}/../lib/plugin-identity.sh"
#   pi_report yellow-core          # JSON on stdout, always exits 0
#
# Overrides (tests):
#   PI_PLUGIN_ROOT            defaults to $CLAUDE_PLUGIN_ROOT
#   PI_INSTALLED_PLUGINS_FILE defaults to ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json
#   PI_CHECKOUT_ROOT          defaults to the git toplevel of $PWD
#
# Identity values: matches-checkout | cache-lags-checkout |
# cache-ahead-of-checkout | no-checkout | unknown
#
# Sourced library only. MUST NOT set top-level shell options.

[ -n "${_PLUGIN_IDENTITY_LOADED:-}" ] && return 0
_PLUGIN_IDENTITY_LOADED=1

pi_warn() {
  printf '[plugin-identity] Warning: %s\n' "$1" >&2
}

# Print the .version of a plugin.json / package.json, or "unknown".
pi_json_version() {
  local file="$1"
  if command -v jq >/dev/null 2>&1 && [ -f "$file" ]; then
    jq -r '.version // "unknown"' "$file" 2>/dev/null || printf 'unknown'
  else
    printf 'unknown'
  fi
}

pi_report() {
  local plugin="${1:-yellow-core}"
  local root="${PI_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
  local installed="${PI_INSTALLED_PLUGINS_FILE:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json}"
  local checkout="${PI_CHECKOUT_ROOT:-}"
  local version="unknown" cache_commit="unknown" checkout_version="unknown" identity="unknown"

  if [ -z "$root" ]; then
    root="unknown"
  else
    version=$(pi_json_version "$root/.claude-plugin/plugin.json")
  fi

  if command -v jq >/dev/null 2>&1 && [ -f "$installed" ]; then
    # installed_plugins.json v2: {"plugins": {"<name>@<marketplace>": [{gitCommitSha, version, installPath, ...}]}}
    cache_commit=$(jq -r --arg p "$plugin" '
      (.plugins // {}) | to_entries
      | map(select(.key | startswith($p + "@")))
      | .[0].value
      | if type == "array" then .[0] else . end
      | .gitCommitSha // "unknown"' "$installed" 2>/dev/null || printf 'unknown')
    [ -n "$cache_commit" ] || cache_commit="unknown"
  fi

  if [ -z "$checkout" ]; then
    checkout=$(git rev-parse --show-toplevel 2>/dev/null || printf '')
  fi
  if [ -n "$checkout" ] && [ -f "$checkout/plugins/$plugin/package.json" ]; then
    checkout_version=$(pi_json_version "$checkout/plugins/$plugin/package.json")
  fi

  if [ "$root" = "unknown" ] || [ "$version" = "unknown" ]; then
    identity="unknown"
  elif [ "$checkout_version" = "unknown" ]; then
    identity="no-checkout"
  elif [ "$version" = "$checkout_version" ]; then
    identity="matches-checkout"
  else
    local lowest
    lowest=$(printf '%s\n%s\n' "$version" "$checkout_version" | sort -V | head -n 1)
    if [ "$lowest" = "$version" ]; then
      identity="cache-lags-checkout"
    else
      identity="cache-ahead-of-checkout"
    fi
  fi

  if command -v jq >/dev/null 2>&1; then
    jq -nc --arg root "$root" --arg version "$version" --arg cache_commit "$cache_commit" \
      --arg checkout_version "$checkout_version" --arg identity "$identity" \
      '{root: $root, version: $version, cache_commit: $cache_commit, checkout_version: $checkout_version, identity: $identity}'
  else
    pi_warn "jq not installed; emitting minimal report"
    printf '{"root":"unknown","version":"unknown","cache_commit":"unknown","checkout_version":"unknown","identity":"unknown"}\n'
  fi
  return 0
}
