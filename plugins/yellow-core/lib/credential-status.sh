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
# Note: this file is intended to be sourced. It MUST NOT alter the caller's
# shell options (no top-level `set -e`, `set -u`, `set -o pipefail`) — doing
# so can break a SessionStart hook's required `{"continue": true}` emission
# if the caller relied on default behavior. Functions below use ${var:-}
# defaulting and explicit failure branches instead of relying on `set`.

# Escape a value for safe embedding inside a JSON string literal. Handles
# backslash, double-quote, and the two control characters most likely to
# appear in plugin/version strings (newline, tab). Sufficient for the
# printf fallback path; jq does its own escaping when available.
_credstatus_json_escape() {
  local s="${1:-}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

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

# Compose the JSON document. Prefers jq when available — both for correct
# escaping AND for fields_json validation. When jq is installed, a parse
# failure (e.g., malformed fields_json) returns non-zero and the caller
# skips the write rather than emitting invalid JSON via the printf path.
# The printf fallback is reserved for environments where jq is not
# installed; it escapes plugin/version but trusts that fields_json is
# already valid JSON (caller responsibility, documented in the protocol).
_credstatus_compose() {
  local plugin="$1"
  local version="$2"
  local fields_json="$3"
  local session_ts
  session_ts=$(date -u +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf '1970-01-01T00:00:00Z')

  if command -v jq >/dev/null 2>&1; then
    # When jq is available, treat parse/build failure as a hard error so
    # we never overwrite a previously valid status file with garbage.
    jq -nc \
      --arg plugin "$plugin" \
      --arg version "$version" \
      --arg session_ts "$session_ts" \
      --argjson credentials "$fields_json" \
      '{plugin: $plugin, version: $version, session_ts: $session_ts, credentials: $credentials}' \
      2>/dev/null
    return $?
  fi

  # jq not installed → printf fallback. Escape plugin/version so unusual
  # input (quotes, backslashes) cannot break the JSON shape. fields_json
  # is assumed valid (caller responsibility per the protocol contract).
  local plugin_esc version_esc
  plugin_esc=$(_credstatus_json_escape "$plugin")
  version_esc=$(_credstatus_json_escape "$version")
  printf '{"plugin":"%s","version":"%s","session_ts":"%s","credentials":%s}' \
    "$plugin_esc" "$version_esc" "$session_ts" "$fields_json"
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
  # Per-invocation unique temp filename so concurrent SessionStart writers
  # for the same plugin (e.g., two Claude Code sessions racing) cannot
  # clobber each other's tmp file mid-write. Falls back to a PID-suffixed
  # path if mktemp is unavailable (extremely rare).
  local tmp
  tmp=$(mktemp "${target}.tmp.XXXXXX" 2>/dev/null) || tmp="${target}.tmp.$$"

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
    # Mirrors _credstatus_compose: jq parse failure (e.g., non-boolean
    # present/valid) returns non-zero so callers don't accidentally embed
    # invalid JSON into the composed document.
    jq -nc \
      --arg field "$field" \
      --arg source "$source" \
      --argjson present "$present" \
      --argjson valid "$valid" \
      '{field: $field, source: $source, present: $present, valid: $valid}' \
      2>/dev/null
    return $?
  fi

  local field_esc source_esc
  field_esc=$(_credstatus_json_escape "$field")
  source_esc=$(_credstatus_json_escape "$source")
  printf '{"field":"%s","source":"%s","present":%s,"valid":%s}' \
    "$field_esc" "$source_esc" "$present" "$valid"
}

# Public API: complete SessionStart-hook scaffold for credential-bearing
# plugins. Reads the plugin version from the manifest, classifies each
# credential field (userConfig env wins, shell env is the fallback),
# writes credential-status.json, then emits {"continue": true} and exits 0.
#
# This collapses the previously copy-pasted write-credential-status.sh
# bodies (debt findings 024/025) — a calling hook only needs to source this
# file and invoke the scaffold with its field list.
#
# Args:
#   $1:    plugin name (e.g. "yellow-research")
#   $2:    plugin root directory (typically CLAUDE_PLUGIN_ROOT)
#   $3..:  one or more field specs, each "field_name:userconfig_env:shell_env"
#
# Never blocks SessionStart: every path still emits {"continue": true} and
# exits 0, including jq-absent, manifest-absent, and write-failure cases.
credential_hook_scaffold() {
  # Precondition: plugin name + plugin root are required. Without them the
  # for-loop below would treat `$1` (or `$1 $2`) as a field spec, producing
  # garbage credential-status.json. Fail-closed by emitting the required
  # SessionStart JSON and exiting cleanly — never let the caller's hook
  # exit without `{"continue": true}` (which would block SessionStart).
  if [ "$#" -lt 2 ]; then
    printf '[credential-status] Warning: credential_hook_scaffold requires plugin name + plugin root (got %d args); skipping\n' "$#" >&2
    printf '{"continue": true}\n'
    exit 0
  fi
  local plugin="${1:-}"
  local plugin_root="${2:-}"
  shift 2

  local version="unknown"
  if command -v jq >/dev/null 2>&1 && [ -n "$plugin_root" ] \
    && [ -f "${plugin_root}/.claude-plugin/plugin.json" ]; then
    version=$(jq -r '.version // "unknown"' \
      "${plugin_root}/.claude-plugin/plugin.json" 2>/dev/null || printf 'unknown')
  fi

  local fields_json="[" first=1
  local spec field uc_env sh_env source present entry
  for spec in "$@"; do
    field="${spec%%:*}"
    uc_env="${spec#*:}"
    uc_env="${uc_env%%:*}"
    sh_env="${spec##*:}"
    source="absent"
    present="false"
    if [ -n "$(printenv "$uc_env" 2>/dev/null || printf '')" ]; then
      source="userConfig"
      present="true"
    elif [ -n "$(printenv "$sh_env" 2>/dev/null || printf '')" ]; then
      source="shell_env"
      present="true"
    fi
    entry=$(credential_status_field "$field" "$source" "$present" "null")
    if [ "$first" -eq 1 ]; then
      first=0
    else
      fields_json="${fields_json},"
    fi
    fields_json="${fields_json}${entry}"
  done
  fields_json="${fields_json}]"

  write_credential_status "$plugin" "$version" "$fields_json" 2>/dev/null || true

  printf '{"continue": true}\n'
  exit 0
}
