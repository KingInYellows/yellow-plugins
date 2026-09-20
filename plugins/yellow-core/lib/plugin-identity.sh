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

# Shared read-only git invocation: hooks and fsmonitor disabled, no optional
# locks. handoff.sh's allowlisted ho_git delegates here so the safety flags
# have one owner. Callers pass the subcommand and its arguments.
pi_git_readonly() {
  command git -c core.hooksPath=/dev/null -c core.fsmonitor=false --no-optional-locks "$@"
}

# Print the .version of a plugin.json / package.json, or "unknown".
pi_json_version() {
  local file="$1"
  if command -v jq >/dev/null 2>&1 && [ -f "$file" ]; then
    jq -r 'if (.version // "") == "" then "unknown" else .version end' "$file" 2>/dev/null || printf 'unknown'
  else
    printf 'unknown'
  fi
}

# Portable dotted-decimal comparison (no GNU sort -V): prints lt | eq | gt,
# or "unknown" when either side is not numeric dotted-decimal.
pi_compare_versions() {
  local a="$1" b="$2" i x y
  case "$a$b" in *[!0-9.]*) printf 'unknown'; return 0 ;; esac
  local -a pa pb
  IFS=. read -r -a pa <<< "$a"
  IFS=. read -r -a pb <<< "$b"
  for i in 0 1 2 3; do
    x="${pa[$i]:-0}"; y="${pb[$i]:-0}"
    if [ "$x" -lt "$y" ]; then printf 'lt'; return 0; fi
    if [ "$x" -gt "$y" ]; then printf 'gt'; return 0; fi
  done
  printf 'eq'
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
    # Only reached when the caller did not pass PI_CHECKOUT_ROOT.
    checkout=$(pi_git_readonly rev-parse --show-toplevel 2>/dev/null || printf '')
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
    case "$(pi_compare_versions "$version" "$checkout_version")" in
      lt) identity="cache-lags-checkout" ;;
      gt) identity="cache-ahead-of-checkout" ;;
      *) identity="unknown" ;;
    esac
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
