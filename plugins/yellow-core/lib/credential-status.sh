#!/usr/bin/env bash
# yellow-core: credential-status helper.
#
# Source from a SessionStart hook to emit a credential-status.json file
# describing which credential fields are populated for this plugin.
#
# Usage:
#   source "${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/credential-status.sh"
#   fields_json='[{"field":"foo_api_key","source":"userConfig","present":true,"valid":null}]'
#   write_credential_status "yellow-foo" "1.2.3" "$fields_json"
#
# Contract:
#   - Writes atomically (tmp + rename).
#   - Never aborts on failure — readers handle "file absent" gracefully.
#   - Never echoes credential values; only resolution sources.
#
# Note: -e omitted intentionally — hook must output {"continue": true} on
# all paths. The caller is responsible for the final JSON emission.
set -uo pipefail

# Resolve the data directory for the given plugin.
# Honors $CLAUDE_PLUGIN_DATA (canonical, per Claude Code docs) and falls
# back to the documented disk path when unset (e.g., when sourced from a
# bats test).
_credstatus_resolve_dir() {
  local plugin="${1:-}"
  if [ -z "$plugin" ]; then
    return 1
  fi
  if [ -n "${CLAUDE_PLUGIN_DATA:-}" ]; then
    printf '%s' "$CLAUDE_PLUGIN_DATA"
  else
    printf '%s/.claude/plugins/data/%s' "${HOME:-/tmp}" "$plugin"
  fi
}

# Compose the JSON document. Prefers jq when available so we get correct
# escaping for free; falls back to printf for environments without jq.
# The shell env passthrough cannot produce arbitrary user input here — the
# only string inputs are the plugin name (from manifest) and version
# (semver) — so printf-only fallback is safe.
_credstatus_compose() {
  local plugin="$1"
  local version="$2"
  local fields_json="$3"
  local session_ts
  session_ts=$(date -u +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '1970-01-01T00:00:00Z')

  if command -v jq >/dev/null 2>&1; then
    jq -nc \
      --arg plugin "$plugin" \
      --arg version "$version" \
      --arg session_ts "$session_ts" \
      --argjson credentials "$fields_json" \
      '{plugin: $plugin, version: $version, session_ts: $session_ts, credentials: $credentials}' \
      2>/dev/null && return 0
  fi

  # Fallback: assume fields_json is already valid JSON (caller responsibility).
  # Plugin and version are constrained by validate-plugin.js to safe chars.
  printf '{"plugin":"%s","version":"%s","session_ts":"%s","credentials":%s}' \
    "$plugin" "$version" "$session_ts" "$fields_json"
}

# Public API: write credential status for a plugin.
# Args:
#   $1: plugin name (e.g., "yellow-composio")
#   $2: plugin version (e.g., "1.3.0")
#   $3: credentials JSON array as a string
# Returns 0 on success, 0 on any failure (intentional — never block SessionStart).
write_credential_status() {
  local plugin="${1:-}"
  local version="${2:-}"
  local fields_json="${3:-[]}"

  if [ -z "$plugin" ] || [ -z "$version" ]; then
    printf '[credential-status] Warning: plugin name and version are required\n' >&2
    return 0
  fi

  local data_dir
  data_dir=$(_credstatus_resolve_dir "$plugin") || {
    printf '[credential-status] Warning: could not resolve data directory for %s\n' "$plugin" >&2
    return 0
  }

  mkdir -p "$data_dir" 2>/dev/null || {
    # GH issue #41156: writes may trigger a protected-directory prompt.
    # Silently skip rather than blocking SessionStart.
    printf '[credential-status] Warning: could not create %s (skipping status write)\n' "$data_dir" >&2
    return 0
  }

  local doc
  doc=$(_credstatus_compose "$plugin" "$version" "$fields_json") || {
    printf '[credential-status] Warning: could not compose status document\n' >&2
    return 0
  }

  local target="$data_dir/credential-status.json"
  local tmp="${target}.tmp"

  printf '%s\n' "$doc" >"$tmp" 2>/dev/null || {
    printf '[credential-status] Warning: could not write %s\n' "$tmp" >&2
    rm -f "$tmp" 2>/dev/null
    return 0
  }

  mv -f "$tmp" "$target" 2>/dev/null || {
    printf '[credential-status] Warning: could not rename %s -> %s\n' "$tmp" "$target" >&2
    rm -f "$tmp" 2>/dev/null
    return 0
  }

  return 0
}

# Compose a single credential field entry. Helper for hook authors who
# want to build fields_json incrementally rather than emitting a single
# heredoc.
# Args:
#   $1: field name
#   $2: source ("userConfig" | "shell_env" | "absent")
#   $3: present (true | false)
#   $4: valid ("true" | "false" | "null"; default "null")
credential_status_field() {
  local field="${1:-}"
  local source="${2:-absent}"
  local present="${3:-false}"
  local valid="${4:-null}"

  if command -v jq >/dev/null 2>&1; then
    jq -nc \
      --arg field "$field" \
      --arg source "$source" \
      --argjson present "$present" \
      --argjson valid "$valid" \
      '{field: $field, source: $source, present: $present, valid: $valid}' \
      2>/dev/null && return 0
  fi

  printf '{"field":"%s","source":"%s","present":%s,"valid":%s}' \
    "$field" "$source" "$present" "$valid"
}
