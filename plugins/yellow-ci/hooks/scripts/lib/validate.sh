#!/bin/bash
# shellcheck disable=SC2154
# validate.sh — Shared validation functions for yellow-ci hooks and commands
# Source this file: . "${SCRIPT_DIR}/lib/validate.sh"

# Check if string contains newlines or carriage returns
# Returns 0 (true) if newlines found, 1 (false) if clean
has_newline() {
  case "$1" in
    *$'\n'*|*$'\r'*) return 0 ;;
    *) return 1 ;;
  esac
}

# Shared filesystem-path validators (validate_file_path,
# canonicalize_project_dir) live in yellow-core's shared lib so a security
# fix lands in one place. At runtime CLAUDE_PLUGIN_ROOT is set by Claude
# Code; in Bats tests the suite sources validate-fs.sh directly.
_VALIDATE_FS_HELPER="${CLAUDE_PLUGIN_ROOT:-}/../yellow-core/lib/validate-fs.sh"
if [ -f "$_VALIDATE_FS_HELPER" ]; then
  # shellcheck source=/dev/null
  . "$_VALIDATE_FS_HELPER"
fi
unset _VALIDATE_FS_HELPER

# ============================================================================
# Shared validation library functions
# The following functions are not all used by every plugin but are available
# as a shared validation library for hooks, commands, and agents.
# ============================================================================

# Validate runner name: DNS-safe, 2-64 chars, lowercase alphanumeric + hyphens
# Usage: validate_runner_name "$name"
validate_runner_name() {
  local name="$1"

  if [ -z "$name" ]; then
    return 1
  fi

  # Length check: 2-64 chars (matches CLAUDE.md and JSON schema minLength: 2)
  if [ ${#name} -gt 64 ] || [ ${#name} -lt 2 ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$name"; then
    return 1
  fi

  # Pattern: lowercase alphanumeric and hyphens only
  case "$name" in
    *[!a-z0-9-]*) return 1 ;;
    -*) return 1 ;;
    *-) return 1 ;;
  esac

  # Path traversal defense-in-depth
  case "$name" in
    *..*|*/*|*~*) return 1 ;;
  esac

  return 0
}

# Validate GitHub Actions run ID: 1-20 digits, no leading zeros, max JS safe integer
# Usage: validate_run_id "$id"
validate_run_id() {
  local id="$1"

  if [ -z "$id" ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$id"; then
    return 1
  fi

  # Must be digits only, 1-20 chars
  case "$id" in
    *[!0-9]*) return 1 ;;
  esac

  if [ ${#id} -gt 20 ] || [ ${#id} -lt 1 ]; then
    return 1
  fi

  # No leading zeros (except "0" itself, but 0 is not a valid run ID)
  case "$id" in
    0*) return 1 ;;
  esac

  # Max JavaScript safe integer: 9007199254740991 (2^53 - 1)
  # String comparison is intentional: both operands are same-length (16 chars) strings,
  # so lexicographic order equals numeric order, and avoids 32-bit -gt overflow.
  # shellcheck disable=SC2071
  if [ ${#id} -eq 16 ] && [ "$id" \> "9007199254740991" ]; then
    return 1
  fi
  if [ ${#id} -gt 16 ]; then
    return 1
  fi

  return 0
}

# Validate GitHub repository slug: owner/repo format
# Usage: validate_repo_slug "$slug"
validate_repo_slug() {
  local slug="$1"

  if [ -z "$slug" ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$slug"; then
    return 1
  fi

  # Must contain exactly one slash
  local without_slash="${slug//\//}"
  local slash_count=$(( ${#slug} - ${#without_slash} ))
  if [ "$slash_count" -ne 1 ]; then
    return 1
  fi

  # Split owner/repo
  local owner="${slug%%/*}"
  local repo="${slug#*/}"

  # Owner: 1-39 chars, alphanumeric + hyphens, no leading/trailing hyphen
  if [ -z "$owner" ] || [ ${#owner} -gt 39 ]; then
    return 1
  fi
  case "$owner" in
    *[!a-zA-Z0-9_-]*) return 1 ;;
    -*) return 1 ;;
    *-) return 1 ;;  # GitHub rejects trailing hyphen in org names
  esac

  # Repo: 1-100 chars, alphanumeric + hyphens + dots + underscores
  if [ -z "$repo" ] || [ ${#repo} -gt 100 ]; then
    return 1
  fi
  case "$repo" in
    *[!a-zA-Z0-9._-]*) return 1 ;;
    .*) return 1 ;;   # No leading dot
    *.) return 1 ;;   # No trailing dot
  esac

  # Path traversal defense
  case "$slug" in
    *..*) return 1 ;;
  esac

  return 0
}

# Classify a host string as a private/loopback IPv4 address.
# Returns: 0 = valid private or loopback IPv4; 1 = IPv4-shaped but invalid
# (bad octet, leading zero) or public; 2 = not IPv4-shaped (caller should
# fall through to FQDN validation).
# Usage: _validate_private_ipv4 "$host"
_validate_private_ipv4() {
  local host="$1"

  [[ "$host" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 2

  local octet1=${BASH_REMATCH[1]}
  local octet2=${BASH_REMATCH[2]}
  local octet3=${BASH_REMATCH[3]}
  local octet4=${BASH_REMATCH[4]}

  # Check octet bounds and reject leading zeros
  local octet
  for octet in "$octet1" "$octet2" "$octet3" "$octet4"; do
    # Reject leading zeros (except "0" itself)
    if [ ${#octet} -gt 1 ] && [ "${octet:0:1}" = "0" ]; then
      return 1
    fi
    # Validate 0-255 range
    if [ ${#octet} -gt 3 ] || [ "$octet" -gt 255 ] 2>/dev/null; then
      return 1
    fi
  done

  # Validate private range: 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x
  if [ "$octet1" -eq 10 ] 2>/dev/null; then
    return 0
  elif [ "$octet1" -eq 172 ] 2>/dev/null && [ "$octet2" -ge 16 ] 2>/dev/null && [ "$octet2" -le 31 ] 2>/dev/null; then
    return 0
  elif [ "$octet1" -eq 192 ] 2>/dev/null && [ "$octet2" -eq 168 ] 2>/dev/null; then
    return 0
  elif [ "$octet1" -eq 127 ] 2>/dev/null; then
    return 0  # localhost
  fi
  return 1  # Public IP rejected
}

# Validate SSH host: private IPv4 or FQDN
# Usage: validate_ssh_host "$host"
validate_ssh_host() {
  local host="$1"

  if [ -z "$host" ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$host"; then
    return 1
  fi

  # Reject shell metacharacters
  case "$host" in
    *\;*|*\&*|*\|*|*\$*|*\`*|*\'*|*\"*|*\\*) return 1 ;;
  esac

  # Try IPv4 first: N.N.N.N format. Exit 2 means "not IPv4-shaped" — fall
  # through to FQDN validation below. The exit code is captured via `||`
  # so a non-zero return is errexit-safe when this library is sourced
  # under `set -e` (a bare call followed by `case "$?"` would exit the
  # shell on exit code 1 OR 2 before reaching the case).
  local _ipv4_rc=0
  _validate_private_ipv4 "$host" || _ipv4_rc=$?
  case "$_ipv4_rc" in
    0) return 0 ;;
    1) return 1 ;;
  esac

  # FQDN: lowercase alphanumeric, hyphens, dots
  case "$host" in
    *[!a-z0-9.-]*) return 1 ;;
    .*) return 1 ;;
    *.) return 1 ;;
    *--*) ;;  # Allow double hyphens (punycode)
  esac

  # Must have at least one label
  if [ ${#host} -gt 253 ] || [ ${#host} -lt 1 ]; then
    return 1
  fi

  # TLD restriction: only internal suffixes allowed (private-network-only policy)
  case "$host" in
    *.internal|*.local|*.lan|*.corp|*.home|*.intra|*.private) return 0 ;;
  esac

  return 1  # Public TLD rejected
}

# Validate SSH username: Linux username rules
# Usage: validate_ssh_user "$user"
validate_ssh_user() {
  local user="$1"

  if [ -z "$user" ]; then
    return 1
  fi

  # Length: 1-32 chars
  if [ ${#user} -gt 32 ] || [ ${#user} -lt 1 ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$user"; then
    return 1
  fi

  # Pattern: starts with [a-z_], then [a-z0-9_-]
  case "$user" in
    [a-z_]*) ;;
    *) return 1 ;;
  esac
  case "$user" in
    *[!a-z0-9_-]*) return 1 ;;
  esac

  return 0
}

# Validate cache directory path: whitelist under allowed prefixes
# Usage: validate_cache_dir "$dir"
validate_cache_dir() {
  local dir="$1"

  if [ -z "$dir" ]; then
    return 1
  fi

  # Reject path traversal
  case "$dir" in
    *..* | *~*) return 1 ;;
  esac

  # Reject newlines
  local dir_len=${#dir}
  local oneline
  oneline=$(printf '%s' "$dir" | tr -d '\n\r')
  if [ ${#oneline} -ne "$dir_len" ]; then
    return 1
  fi

  # Whitelist: must start with allowed prefixes
  case "$dir" in
    /home/runner/*) return 0 ;;
    /tmp/*) return 0 ;;
    /var/cache/*) return 0 ;;
  esac

  return 1
}

# Validate integer within bounds
# Usage: validate_numeric_range "$value" "$min" "$max"
validate_numeric_range() {
  local value="$1"
  local min="$2"
  local max="$3"

  if [ -z "$value" ]; then
    return 1
  fi

  # Must be digits only (with optional leading minus for negative)
  case "$value" in
    *[!0-9-]*) return 1 ;;
    -*[!0-9]*) return 1 ;;
  esac

  # Numeric comparison
  if ! [ "$value" -ge "$min" ] 2>/dev/null; then
    return 1
  fi
  if ! [ "$value" -le "$max" ] 2>/dev/null; then
    return 1
  fi

  return 0
}

# Validate SSH command for injection prevention
# Usage: validate_ssh_command "$cmd"
validate_ssh_command() {
  local cmd="$1"

  if [ -z "$cmd" ]; then
    return 1
  fi

  # Strip to single line
  if has_newline "$cmd"; then
    return 1
  fi

  # Reject shell metacharacters that enable injection
  case "$cmd" in
    *\;*|*\&*|*\|*|*\$\(*|*\`*) return 1 ;;
  esac

  return 0
}

# Validate SSH key path: starts with ~ or /, safe characters only
# Usage: validate_ssh_key_path "$path"
validate_ssh_key_path() {
  local key_path="$1"

  # Empty is valid (means use default SSH key)
  if [ -z "$key_path" ]; then
    return 0
  fi

  # Length check
  if [ ${#key_path} -gt 256 ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$key_path"; then
    return 1
  fi

  # Must start with ~ or /
  case "$key_path" in
    ~*|/*) ;;
    *) return 1 ;;
  esac

  # Reject path traversal and shell metacharacters
  case "$key_path" in
    *..*) return 1 ;;
    *\;*|*\|*|*\&*|*\$*|*\`*) return 1 ;;
  esac

  # Only allow safe characters
  case "$key_path" in
    *[!a-zA-Z0-9_./~-]*) return 1 ;;
  esac

  return 0
}

# ============================================================================
# Runner targets validation functions
# Used by /ci:setup-runner-targets and resolve-runner-targets.sh
# ============================================================================

# Validate runner target type: pool | static-family | static-host
# Usage: validate_runner_type "$type"
validate_runner_type() {
  case "$1" in
    pool|static-family|static-host) return 0 ;;
    *) return 1 ;;
  esac
}

# Validate runner target mode: jit_ephemeral | persistent
# Usage: validate_runner_mode "$mode"
validate_runner_mode() {
  case "$1" in
    jit_ephemeral|persistent) return 0 ;;
    *) return 1 ;;
  esac
}

# Validate a selector label for runs-on arrays
# Usage: validate_selector_label "$label"
validate_selector_label() {
  local label="$1"

  if [ -z "$label" ]; then
    return 1
  fi

  # Max 64 chars
  if [ ${#label} -gt 64 ]; then
    return 1
  fi

  # Reject newlines
  if has_newline "$label"; then
    return 1
  fi

  # Pattern: starts with [a-zA-Z0-9], then [a-zA-Z0-9._:-]
  case "$label" in
    [a-zA-Z0-9]*) ;;
    *) return 1 ;;
  esac
  case "$label" in
    *[!a-zA-Z0-9._:-]*) return 1 ;;
  esac

  return 0
}

# Check a runner targets file for the schema version and reject
# parser-unsupported YAML syntax (tabs, flow sequences, block scalars).
# Returns 0 if the syntax is acceptable, 1 otherwise (error on stderr).
_rt_check_yaml_syntax() {
  local filepath="$1"

  if ! grep -qE '^schema:[[:space:]]*1[[:space:]]*$' "$filepath"; then
    printf '[yellow-ci] Error: Missing or unsupported schema version (expected: schema: 1)\n' >&2
    return 1
  fi
  # Literal-tab search: a bare `$'\t'` argument (bash ANSI-C quoting expands
  # it to a real tab byte before grep ever sees it) needs no regex mode at
  # all, so this works identically on GNU and BSD grep — unlike the `-P`
  # (PCRE) flag this used to use, which is a GNU-only extension absent from
  # BSD/macOS grep (exit 2, "invalid option").
  if grep -q $'\t' "$filepath"; then
    printf '[yellow-ci] Error: Tabs found — use spaces only (canonical YAML)\n' >&2
    return 1
  fi
  # `\s`/`\w` are GNU grep extensions honored even under `-E`; POSIX ERE (and
  # BSD/macOS grep) has no such escapes, so `\s` and `\w` are taken literally
  # as "s" and "w" there — silently defeating both checks below on macOS.
  # `[[:space:]]`/`[[:alnum:]_]` are the portable POSIX ERE equivalents.
  if grep -qE '^[[:space:]]+[[:alnum:]_]+:[[:space:]]*\[' "$filepath"; then
    printf '[yellow-ci] Error: Flow syntax [a, b] not supported — use block sequences\n' >&2
    return 1
  fi
  if grep -qE '^[[:space:]]+[[:alnum:]_]+:[[:space:]]*[|>][-+]?[[:space:]]*$' "$filepath"; then
    printf '[yellow-ci] Error: Multi-line scalars (| or >) not supported\n' >&2
    return 1
  fi
  return 0
}

# Validate every runner target name in the file against validate_runner_name.
# A blank/whitespace-only name is a hard failure (schema-required, DNS-safe
# name syntax) — not skipped, since validate_runner_name("") itself rejects
# empty input and a naive `[ -n "$name" ] &&` guard would short-circuit past
# that rejection entirely.
# Returns 0 if all names are valid, 1 on the first invalid/blank name (error
# on stderr).
_rt_check_runner_names() {
  local filepath="$1"
  local name unwrapped
  while IFS= read -r name; do
    # Trim the "- name:" prefix and trailing whitespace.
    name=$(printf '%s' "$name" | sed 's/^[[:space:]]*-[[:space:]]*name:[[:space:]]*//' | sed 's/[[:space:]]*$//')
    if [ -z "$name" ]; then
      printf '[yellow-ci] Error: Runner target has a blank name\n' >&2
      return 1
    fi
    # Accept the canonical double-quoted form (SKILL.md Step 4 now always
    # quotes name) or a legacy/hand-edited unquoted value, same
    # quoted-or-safe-unquoted asymmetry as routing_rules/preferred_selector
    # above. validate_runner_name's DNS-safe charset (lowercase alnum +
    # hyphen only) can never itself contain `\` or `"`, so unquoting a valid
    # name never needs escape-reversal — but a bare "on"/"no"/"off" or an
    # all-digit name (e.g. "42") is DNS-safe-regex-valid AND a YAML
    # boolean/numeric literal when left unquoted, hence the hazard check on
    # the unquoted branch below.
    case "$name" in
      \"*)
        if ! unwrapped=$(_rt_unquote_scalar "$name"); then
          printf '[yellow-ci] Error: Malformed quoted runner target name (unescaped quote or unsupported escape): %s\n' "$name" >&2
          return 1
        fi
        ;;
      *)
        unwrapped="$name"
        if _rt_yaml_hazard_shape "$unwrapped"; then
          printf '[yellow-ci] Error: Unquoted runner target name is YAML-significant (quote it): %s\n' "$name" >&2
          return 1
        fi
        ;;
    esac
    if ! validate_runner_name "$unwrapped"; then
      printf '[yellow-ci] Error: Invalid runner target name: %s\n' "$unwrapped" >&2
      return 1
    fi
  done < <(grep -E '^[[:space:]]*-[[:space:]]+name:' "$filepath")
  return 0
}

# Validate that every runner target has the schema's other required fields
# present: `type`, `mode`, and at least one `preferred_selector` item. (`name`
# blankness is NOT implicit from line presence — a "- name:" line can carry an
# empty or whitespace-only value; that gap is rejected as a hard failure by
# _rt_check_runner_names, which runs before this function.) validate_runner_type/
# validate_runner_mode/validate_selector_label below only check values that ARE
# present, so a target that omits (or blanks) one of these fields would
# otherwise pass this gate and reach emit_runner_json(), which renders it with
# an empty "type":""/"mode":"" — malformed in the merged cache JSON, not skipped.
# Returns 0 if every target has all required fields, 1 on the first gap
# (error on stderr).
_rt_check_required_fields() {
  local filepath="$1"
  local name field
  while IFS=$'\t' read -r name field; do
    printf '[yellow-ci] Error: Runner target %s is missing required field: %s\n' "$name" "$field" >&2
    return 1
  done < <(awk '
  BEGIN { in_targets = 0; in_runner = 0; field = ""; name = ""; have_type = 0; have_mode = 0; have_selector = 0; reported = 0 }
  /^runner_targets:/ { in_targets = 1; next }
  in_targets && /^[a-z]/ { in_targets = 0; if (in_runner) flush_runner(); in_runner = 0; next }
  in_targets && /^[[:space:]]*-[[:space:]]+name:/ {
    if (in_runner) flush_runner()
    in_runner = 1
    name = $0
    sub(/^[[:space:]]*-[[:space:]]+name:[[:space:]]*/, "", name)
    sub(/[[:space:]]*$/, "", name)
    have_type = 0; have_mode = 0; have_selector = 0; field = ""
    next
  }
  in_runner && /^[[:space:]]+type:/ {
    val = $0
    sub(/^[[:space:]]+type:[[:space:]]*/, "", val); sub(/[[:space:]]*$/, "", val)
    if (val != "") have_type = 1
    field = ""; next
  }
  in_runner && /^[[:space:]]+mode:/ {
    val = $0
    sub(/^[[:space:]]+mode:[[:space:]]*/, "", val); sub(/[[:space:]]*$/, "", val)
    if (val != "") have_mode = 1
    field = ""; next
  }
  in_runner && /^[[:space:]]+preferred_selector:/ { field = "selector"; next }
  in_runner && /^[[:space:]]+best_for:/ { field = "best_for"; next }
  in_runner && /^[[:space:]]+avoid_for:/ { field = "avoid_for"; next }
  in_runner && /^[[:space:]]+notes:/ { field = "notes"; next }
  in_runner && /^[[:space:]]+[a-z_]+:/ { field = ""; next }
  in_runner && field == "selector" && /^[[:space:]]+-[[:space:]]/ { have_selector = 1; next }
  END { if (in_runner) flush_runner() }
  function flush_runner() {
    if (reported) return
    if (!have_type) { printf "%s\ttype\n", name; reported = 1; return }
    if (!have_mode) { printf "%s\tmode\n", name; reported = 1; return }
    if (!have_selector) { printf "%s\tpreferred_selector\n", name; reported = 1; return }
  }
  ' "$filepath")
  return 0
}

# Validate every runner target `type:` value against validate_runner_type.
# The `[ -n "$type_val" ] &&` guard below is safe, not a gap: a blank/missing
# `type:` value is already a hard failure from _rt_check_required_fields,
# which runs earlier in validate_runner_targets_file — adding a second blank
# check here would be a duplicate gate.
# Returns 0 if all types are valid, 1 on the first invalid type (error on stderr).
_rt_check_runner_types() {
  local filepath="$1"
  local type_val
  while IFS= read -r type_val; do
    type_val=$(printf '%s' "$type_val" | sed 's/^[[:space:]]*type:[[:space:]]*//' | sed 's/[[:space:]]*$//')
    if [ -n "$type_val" ] && ! validate_runner_type "$type_val"; then
      printf '[yellow-ci] Error: Invalid runner target type: %s (expected pool, static-family, or static-host)\n' "$type_val" >&2
      return 1
    fi
  done < <(grep -E '^[[:space:]]+type:' "$filepath")
  return 0
}

# Validate every runner target `mode:` value against validate_runner_mode.
# The `[ -n "$mode_val" ] &&` guard below is safe, not a gap: a blank/missing
# `mode:` value is already a hard failure from _rt_check_required_fields,
# which runs earlier in validate_runner_targets_file — adding a second blank
# check here would be a duplicate gate.
# Returns 0 if all modes are valid, 1 on the first invalid mode (error on stderr).
_rt_check_runner_modes() {
  local filepath="$1"
  local mode_val
  while IFS= read -r mode_val; do
    mode_val=$(printf '%s' "$mode_val" | sed 's/^[[:space:]]*mode:[[:space:]]*//' | sed 's/[[:space:]]*$//')
    if [ -n "$mode_val" ] && ! validate_runner_mode "$mode_val"; then
      printf '[yellow-ci] Error: Invalid runner target mode: %s (expected jit_ephemeral or persistent)\n' "$mode_val" >&2
      return 1
    fi
  done < <(grep -E '^[[:space:]]+mode:' "$filepath")
  return 0
}

# Extract preferred_selector/best_for/avoid_for/notes array items from a
# runner targets file, tagged by field kind. Mirrors the field-tracking state
# machine in resolve-runner-targets.sh's rt_extract_runners() awk script, but
# only emits raw "<kind>\t<value>" pairs for validation here — no
# pipe-delimited transport format (that lib is a downstream consumer of this
# one, not a dependency of it).
# Usage: _rt_extract_field_items "$filepath"
# Output: one "<kind>\t<value>" line per array item, kind in
#         {selector, best_for, avoid_for, notes}
_rt_extract_field_items() {
  local filepath="$1"
  awk '
  BEGIN { in_targets = 0; in_runner = 0; field = "" }
  /^runner_targets:/ { in_targets = 1; next }
  in_targets && /^[a-z]/ { in_targets = 0; in_runner = 0; next }
  in_targets && /^[[:space:]]*-[[:space:]]+name:/ { in_runner = 1; field = ""; next }
  in_runner && /^[[:space:]]+preferred_selector:/ { field = "selector"; next }
  in_runner && /^[[:space:]]+best_for:/ { field = "best_for"; next }
  in_runner && /^[[:space:]]+avoid_for:/ { field = "avoid_for"; next }
  in_runner && /^[[:space:]]+notes:/ { field = "notes"; next }
  in_runner && /^[[:space:]]+[a-z_]+:/ { field = ""; next }
  in_runner && field != "" && /^[[:space:]]+-[[:space:]]/ {
    val = $0
    sub(/^[[:space:]]+-[[:space:]]+/, "", val)
    sub(/[[:space:]]*$/, "", val)
    printf "%s\t%s\n", field, val
    next
  }
  ' "$filepath"
}

# Return 0 (true) if $raw is either not quoted (does not start with `"`) or
# is a well-formed double-quoted YAML scalar using only the two escapes
# SKILL.md Step 4 writes (`\\` and `\"`); return 1 if it starts with `"` but
# has an unescaped inner quote, an unsupported escape (e.g. `\n`), or a
# trailing lone backslash. Equivalent to the PCRE
# `^"(?:[^"\\]|\\\\|\\")*"$` this used to be checked with — but `grep -P` is
# a GNU-only extension: BSD/macOS grep has no `-P` and exits 2 on it,
# rejecting every quoted value on macOS. Implemented as a left-to-right awk
# scan instead (awk's `substr`/`length` are POSIX and behave identically
# under GNU awk and macOS's bundled "one true awk"). Shared by
# _rt_unquote_scalar below and _rt_check_routing_rules's quoted-scalar
# branch so both use one portable well-formedness check.
# Usage: _rt_quoted_scalar_valid "$raw"
_rt_quoted_scalar_valid() {
  local raw="$1"
  case "$raw" in
    \"*)
      printf '%s' "$raw" | awk '
      {
        s = $0
        n = length(s)
        if (n < 2 || substr(s, n, 1) != "\"") { exit 1 }
        inner = substr(s, 2, n - 2)
        m = length(inner)
        i = 1
        while (i <= m) {
          c = substr(inner, i, 1)
          if (c == "\\") {
            if (i == m) { exit 1 }
            nc = substr(inner, i + 1, 1)
            if (nc == "\\" || nc == "\"") { i += 2 } else { exit 1 }
          } else if (c == "\"") {
            exit 1
          } else {
            i += 1
          }
        }
        exit 0
      }'
      return $?
      ;;
    *)
      return 0
      ;;
  esac
}

# Unwrap a possibly-quoted YAML scalar so downstream checks (charset,
# delimiter-ban, hazard-shape) see the real underlying text rather than the
# YAML surface syntax. Mirrors resolve-runner-targets.sh's
# rt_unquote_rule_stream() single-value equivalent; duplicated here (rather
# than sourced) because resolve-runner-targets.sh depends on this file, not
# the other way around — same mirroring rationale as _rt_extract_field_items
# above.
# Usage: unwrapped=$(_rt_unquote_scalar "$raw") || return 1  # malformed quoting
# Prints the unwrapped/unescaped text and returns 0 when $raw is either not
# quoted (passed through unchanged) or a well-formed quoted scalar (only `\\`
# and `\"` escapes, matching what SKILL.md Step 4 writes). Returns 1 without
# printing anything usable when $raw starts with `"` but is not well-formed
# (unescaped inner quote or an unsupported escape) — the caller must report
# and stop in that case.
_rt_unquote_scalar() {
  local raw="$1"
  case "$raw" in
    \"*)
      if ! _rt_quoted_scalar_valid "$raw"; then
        return 1
      fi
      printf '%s' "$raw" | awk '
      {
        s = $0
        n = length(s)
        inner = substr(s, 2, n - 2)
        m = length(inner)
        out = ""
        i = 1
        while (i <= m) {
          c = substr(inner, i, 1)
          if (c == "\\" && i < m) {
            nc = substr(inner, i + 1, 1)
            if (nc == "\\" || nc == "\"") { out = out nc; i += 2 }
            else { out = out c; i += 1 }
          } else { out = out c; i += 1 }
        }
        print out
      }'
      return 0
      ;;
    *)
      printf '%s' "$raw"
      return 0
      ;;
  esac
}

# Return 0 (true) if the given PLAIN (unquoted) scalar text would be misread
# by a YAML parser as something other than the literal string it appears to
# be: a leading indicator character, an implicit mapping (": " anywhere or a
# trailing bare ":"), a comment truncation (" #"), a boolean/null literal (any
# case), or a bare number. Extracted from _rt_check_routing_rules's unquoted-
# value checks so preferred_selector/best_for/avoid_for/notes/name below can
# share the same hazard-shape coverage instead of hand-duplicating it; does
# NOT replace _rt_check_routing_rules's own checks (left as-is, still tested
# directly), only reused by the newer callers.
# A leading `[` or `{` is a flow-collection opener: `python3 -c
# "import yaml; print(yaml.safe_load('notes:\n  - [wrong]'))"` confirms
# PyYAML reads it as a list, not the string "[wrong]" — a silent type
# misread, same hazard class as the other leading indicators below. Leading
# `]`/`}` have no matching opener and so are a hard YAML syntax error rather
# than a misread, but are rejected here too (fail closed) rather than let an
# invalid-YAML config through. A leading `? ` is the explicit-mapping-key
# indicator (confirmed via the same PyYAML check: it parses as a one-entry
# dict, not the string). Trailing `]`/`}` (no leading opener, e.g. "wrong]")
# are NOT rejected — confirmed safe: PyYAML reads them as the literal
# string.
# Usage: _rt_yaml_hazard_shape "$value"
_rt_yaml_hazard_shape() {
  local value="$1" lower

  case "$value" in
    -*|'*'*|'&'*|'!'*|'|'*|'>'*|'%'*|'@'*|'`'*|"'"*|'#'*|'['*|'{'*|']'*|'}'*|'?'*) return 0 ;;
  esac
  case "$value" in
    *': '*|*:) return 0 ;;
  esac
  case "$value" in
    *' #'*) return 0 ;;
  esac
  lower=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')
  case "$lower" in
    yes|no|true|false|on|off|null|'~') return 0 ;;
  esac
  if printf '%s' "$value" | grep -qE '^[+-]?[0-9]+(\.[0-9]+)*([eE][+-]?[0-9]+)?$'; then
    return 0
  fi
  return 1
}

# Validate every preferred_selector label against validate_selector_label.
# Accepts either the canonical double-quoted form the setup skill now always
# writes (SKILL.md Step 4) or a legacy/hand-edited unquoted label, same
# quoted-or-safe-unquoted asymmetry as _rt_check_routing_rules — but a
# selector label's own charset (^[a-zA-Z0-9][a-zA-Z0-9._:-]*$) is checked on
# the UNWRAPPED value in both cases; quoting only prevents YAML from
# misreading the value, it does not relax the label grammar.
# Returns 0 if all labels are valid, 1 on the first invalid/hazardous/
# malformed label (error on stderr).
_rt_check_selector_labels() {
  local filepath="$1"
  local kind value unwrapped
  while IFS=$'\t' read -r kind value; do
    if [ "$kind" != "selector" ]; then
      continue
    fi
    case "$value" in
      \"*)
        if ! unwrapped=$(_rt_unquote_scalar "$value"); then
          printf '[yellow-ci] Error: Malformed quoted preferred_selector label (unescaped quote or unsupported escape): %s\n' "$value" >&2
          return 1
        fi
        ;;
      *)
        unwrapped="$value"
        if _rt_yaml_hazard_shape "$unwrapped"; then
          printf '[yellow-ci] Error: Unquoted preferred_selector label is YAML-significant (quote it): %s\n' "$value" >&2
          return 1
        fi
        ;;
    esac
    if ! validate_selector_label "$unwrapped"; then
      printf '[yellow-ci] Error: Invalid preferred_selector label: %s\n' "$unwrapped" >&2
      return 1
    fi
  done < <(_rt_extract_field_items "$filepath")
  return 0
}

# Reject a literal | or , in best_for/avoid_for/notes values — these are the
# runner-targets cache's internal field/item delimiters (see the "Delimiter
# limitation" note in resolve-runner-targets.sh); a value containing either
# would be silently misparsed (split into extra items, or shifted into a
# neighboring field) when the cache is generated.
# Returns 0 if no reserved delimiter is found, 1 on the first hit (error on stderr).
_rt_check_metadata_delimiters() {
  local filepath="$1"
  local kind value
  while IFS=$'\t' read -r kind value; do
    case "$kind" in
      best_for|avoid_for|notes)
        case "$value" in
          *'|'*|*,*)
            printf '[yellow-ci] Error: %s value contains a reserved | or , delimiter: %s\n' "$kind" "$value" >&2
            return 1
            ;;
        esac
        ;;
    esac
  done < <(_rt_extract_field_items "$filepath")
  return 0
}

# Validate every best_for/avoid_for/notes item is either the canonical
# double-quoted form the setup skill now always writes (SKILL.md Step 4) or a
# legacy/hand-edited unquoted value free of YAML-significant shapes — same
# quoted-or-safe-unquoted asymmetry as _rt_check_routing_rules and
# _rt_check_selector_labels above. These fields are free text (no charset
# restriction beyond the |/, delimiter ban already enforced by
# _rt_check_metadata_delimiters), so unlike selector labels there is no
# further grammar check on the unwrapped value here.
# Returns 0 if every item is safe, 1 on the first hazardous/malformed item
# (error on stderr).
_rt_check_metadata_hazard_shapes() {
  local filepath="$1"
  local kind value unwrapped
  while IFS=$'\t' read -r kind value; do
    case "$kind" in
      best_for|avoid_for|notes)
        case "$value" in
          \"*)
            if ! unwrapped=$(_rt_unquote_scalar "$value"); then
              printf '[yellow-ci] Error: Malformed quoted %s value (unescaped quote or unsupported escape): %s\n' "$kind" "$value" >&2
              return 1
            fi
            ;;
          *)
            if _rt_yaml_hazard_shape "$value"; then
              printf '[yellow-ci] Error: Unquoted %s value is YAML-significant (quote it): %s\n' "$kind" "$value" >&2
              return 1
            fi
            ;;
        esac
        ;;
    esac
  done < <(_rt_extract_field_items "$filepath")
  return 0
}

# Enforce the max-20 limits on runner targets and routing rules.
# Returns 0 if within limits, 1 otherwise (error on stderr).
_rt_check_target_counts() {
  local filepath="$1"

  local target_count
  target_count=$(grep -cE '^[[:space:]]*-[[:space:]]+name:' "$filepath") || target_count=0
  if [ "$target_count" -gt 20 ]; then
    printf '[yellow-ci] Error: Too many runner targets (%s, max 20)\n' "$target_count" >&2
    return 1
  fi

  if grep -qE '^routing_rules:' "$filepath"; then
    local rule_count
    rule_count=$(sed -n '/^routing_rules:/,/^[a-z]/{ /^[[:space:]]*-/p; }' "$filepath" | wc -l) || rule_count=0
    if [ "$rule_count" -gt 20 ]; then
      printf '[yellow-ci] Error: Too many routing rules (%s, max 20)\n' "$rule_count" >&2
      return 1
    fi
  fi
  return 0
}

# Extract routing_rules item values from a runner targets file, one per
# line, with only the leading "- " sequence marker stripped (mirrors
# resolve-runner-targets.sh's rt_extract_rules() extraction exactly, so this
# validator sees precisely what that reader will see — including a quoted
# scalar's surrounding quote characters, still present at this point).
# Usage: _rt_extract_routing_rule_values "$filepath"
# Output: one raw routing_rules value per line
_rt_extract_routing_rule_values() {
  local filepath="$1"
  sed -n '/^routing_rules:/,/^[a-z]/{
    /^[[:space:]]*-[[:space:]]/{ s/^[[:space:]]*-[[:space:]]*//; s/[[:space:]]*$//; p; }
  }' "$filepath"
}

# Reject a bare `-` sequence item (with nothing after it but optional
# trailing whitespace) anywhere in routing_rules. A bare `-` is YAML null,
# not an empty string, but _rt_extract_routing_rule_values's own extraction
# pattern requires a `-` FOLLOWED BY at least one whitespace character to
# match a sequence item at all (`-[[:space:]]`) — a line that is only `-`
# with no trailing space never matches that pattern and so never reaches
# _rt_check_routing_rules's per-value checks, or the resolver's identical
# rt_extract_rules() extraction (resolve-runner-targets.sh): the item just
# silently vanishes from both validation and the merged cache instead of
# being rejected or counted. Run this BEFORE _rt_check_routing_rules so the
# whole file fails closed instead of quietly dropping a rule.
# Returns 0 if no null item is found, 1 on the first one (error on stderr).
_rt_check_routing_rules_no_null() {
  local filepath="$1"
  if sed -n '/^routing_rules:/,/^[a-z]/{ /^[[:space:]]*-[[:space:]]*$/p; }' "$filepath" | grep -q .; then
    printf '[yellow-ci] Error: routing_rules contains a bare "-" (null) sequence item — remove it or quote an explicit empty string as ""\n' >&2
    return 1
  fi
  return 0
}

# Reject a routing_rules item that would be misread by a real YAML parser
# instead of the plugin's own bash reader. The setup skill (SKILL.md Step 4)
# always writes every routing rule as a double-quoted scalar (escaping `\`
# and `"`), so this accepts that canonical quoted form outright. For
# backward compatibility with already-written or hand-edited files, it also
# accepts an UNQUOTED value as long as it isn't one of the shapes a YAML
# parser would read as something other than the literal string: a leading
# indicator character, an implicit mapping (": "  or a trailing bare ":"),
# a comment truncation (" #"), a boolean/null literal, or a bare number.
# Tightening this to require quoting unconditionally would reject
# already-valid unquoted rules like "prefer pool:ares for heavy CI" (see
# tests/fake-exec.bats / tests/resolve-runner-targets.bats fixtures) — the
# asymmetry (writer always quotes, reader/validator also allows hazard-free
# unquoted) is intentional, not a gap.
# Returns 0 if every routing_rules item is safe, 1 on the first unsafe item
# (error on stderr).
_rt_check_routing_rules() {
  local filepath="$1"
  local value lower

  while IFS= read -r value; do
    case "$value" in
      \"*)
        # Quoted scalar: must be well-formed — starts and ends with an
        # unescaped double quote, body using only \\ / \" escapes (nothing
        # else, e.g. \n, is supported — matches what SKILL.md Step 4 emits).
        # Delegates to _rt_quoted_scalar_valid (portable awk scan) rather
        # than `grep -P`, a GNU-only extension absent from BSD/macOS grep.
        if ! _rt_quoted_scalar_valid "$value"; then
          printf '[yellow-ci] Error: Malformed quoted routing rule (unescaped quote or unsupported escape): %s\n' "$value" >&2
          return 1
        fi
        continue
        ;;
    esac

    # Unquoted: reject a leading YAML indicator character. Mirrors
    # _rt_yaml_hazard_shape's leading-character set (see its comment for the
    # PyYAML-verified rationale on [/{/]/}/? ) — duplicated rather than
    # shared per this function's own file-header note (left as-is, still
    # tested directly).
    case "$value" in
      -*|'*'*|'&'*|'!'*|'|'*|'>'*|'%'*|'@'*|'`'*|"'"*|'#'*|'['*|'{'*|']'*|'}'*|'?'*)
        printf '[yellow-ci] Error: Unquoted routing rule starts with a YAML-significant character (quote it): %s\n' "$value" >&2
        return 1
        ;;
    esac

    # Unquoted: reject an implicit mapping (": " anywhere, or a trailing ":").
    case "$value" in
      *': '*|*:)
        printf '[yellow-ci] Error: Unquoted routing rule contains ": " or ends with ":" (parses as a YAML mapping, not a string): %s\n' "$value" >&2
        return 1
        ;;
    esac

    # Unquoted: reject a mid-rule comment start (" #").
    case "$value" in
      *' #'*)
        printf '[yellow-ci] Error: Unquoted routing rule contains " #" (parses as a YAML comment): %s\n' "$value" >&2
        return 1
        ;;
    esac

    # Unquoted: reject a bare YAML 1.1 boolean/null literal (any case).
    lower=$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
      yes|no|true|false|on|off|null|'~')
        printf '[yellow-ci] Error: Unquoted routing rule is a YAML boolean/null literal (quote it): %s\n' "$value" >&2
        return 1
        ;;
    esac

    # Unquoted: reject a bare number (e.g. "1.2.3" resolves to a non-string).
    if printf '%s' "$value" | grep -qE '^[+-]?[0-9]+(\.[0-9]+)*([eE][+-]?[0-9]+)?$'; then
      printf '[yellow-ci] Error: Unquoted routing rule looks numeric (quote it): %s\n' "$value" >&2
      return 1
    fi
  done < <(_rt_extract_routing_rule_values "$filepath")

  return 0
}

# Validate a runner targets YAML file for structural correctness
# Checks: file exists, size < 32KB, has schema: 1, has runner_targets section,
# every target has type/mode/preferred_selector present, name/type/mode/
# preferred_selector-labels are valid (quoted-or-safe-unquoted), best_for/
# avoid_for/notes contain no reserved |/, delimiter and are themselves
# quoted-or-safe-unquoted, routing_rules has no bare-`-` null items, and the
# 20/20 count caps.
# Usage: validate_runner_targets_file "$filepath"
# Returns 0 on success, 1 on failure (with error on stderr)
validate_runner_targets_file() {
  local filepath="$1"

  if [ ! -f "$filepath" ]; then
    printf '[yellow-ci] Error: Runner targets file not found: %s\n' "$filepath" >&2
    return 1
  fi

  # Size check: max 32KB
  local filesize
  filesize=$(wc -c < "$filepath" 2>/dev/null) || filesize=0
  if [ "$filesize" -gt 32768 ]; then
    printf '[yellow-ci] Error: Runner targets file exceeds 32KB limit (%s bytes)\n' "$filesize" >&2
    return 1
  fi

  _rt_check_yaml_syntax "$filepath" || return 1

  # runner_targets section is optional (local override may only have
  # routing_rules). If present, it must have at least one valid entry.
  if grep -qE '^runner_targets:' "$filepath"; then
    if ! grep -qE '^[[:space:]]*-[[:space:]]+name:' "$filepath"; then
      printf '[yellow-ci] Error: runner_targets section exists but has no entries\n' >&2
      return 1
    fi
  else
    # No runner_targets — valid only if routing_rules exists (local override).
    if ! grep -qE '^routing_rules:' "$filepath"; then
      printf '[yellow-ci] Error: File must have runner_targets and/or routing_rules\n' >&2
      return 1
    fi
    # routing_rules-only file — skip runner validation, but still enforce
    # the 20-rule cap and per-rule scalar safety below (a per-repo override
    # is typically rules-only, so this is the common path for a hand-edited
    # unsafe rule, not an edge case).
    _rt_check_target_counts "$filepath" || return 1
    _rt_check_routing_rules_no_null "$filepath" || return 1
    _rt_check_routing_rules "$filepath" || return 1
    return 0
  fi

  _rt_check_runner_names "$filepath" || return 1
  _rt_check_required_fields "$filepath" || return 1
  _rt_check_target_counts "$filepath" || return 1
  _rt_check_runner_types "$filepath" || return 1
  _rt_check_runner_modes "$filepath" || return 1
  _rt_check_selector_labels "$filepath" || return 1
  _rt_check_metadata_delimiters "$filepath" || return 1
  _rt_check_metadata_hazard_shapes "$filepath" || return 1
  _rt_check_routing_rules_no_null "$filepath" || return 1
  _rt_check_routing_rules "$filepath" || return 1

  return 0
}
