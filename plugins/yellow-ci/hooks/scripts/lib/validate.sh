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
  if grep -qP '\t' "$filepath"; then
    printf '[yellow-ci] Error: Tabs found — use spaces only (canonical YAML)\n' >&2
    return 1
  fi
  if grep -qE '^\s+\w+:\s*\[' "$filepath"; then
    printf '[yellow-ci] Error: Flow syntax [a, b] not supported — use block sequences\n' >&2
    return 1
  fi
  if grep -qE '^\s+\w+:\s*[|>][-+]?\s*$' "$filepath"; then
    printf '[yellow-ci] Error: Multi-line scalars (| or >) not supported\n' >&2
    return 1
  fi
  return 0
}

# Validate every runner target name in the file against validate_runner_name.
# Returns 0 if all names are valid, 1 on the first invalid name (error on stderr).
_rt_check_runner_names() {
  local filepath="$1"
  local name
  while IFS= read -r name; do
    # Trim the "- name:" prefix and trailing whitespace.
    name=$(printf '%s' "$name" | sed 's/^[[:space:]]*-[[:space:]]*name:[[:space:]]*//' | sed 's/[[:space:]]*$//')
    if [ -n "$name" ] && ! validate_runner_name "$name"; then
      printf '[yellow-ci] Error: Invalid runner target name: %s\n' "$name" >&2
      return 1
    fi
  done < <(grep -E '^[[:space:]]*-[[:space:]]+name:' "$filepath")
  return 0
}

# Validate that every runner target has the schema's other required fields
# present: `type`, `mode`, and at least one `preferred_selector` item (`name`
# presence is implicit — _rt_check_runner_names only sees "- name:" lines that
# already exist). validate_runner_type/validate_runner_mode/
# validate_selector_label below only check values that ARE present, so a
# target that omits (or blanks) one of these fields would otherwise pass this
# gate and reach emit_runner_json(), which renders it with an empty
# "type":""/"mode":"" — malformed in the merged cache JSON, not skipped.
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

# Validate every preferred_selector label against validate_selector_label.
# Returns 0 if all labels are valid, 1 on the first invalid label (error on stderr).
_rt_check_selector_labels() {
  local filepath="$1"
  local kind value
  while IFS=$'\t' read -r kind value; do
    if [ "$kind" = "selector" ] && ! validate_selector_label "$value"; then
      printf '[yellow-ci] Error: Invalid preferred_selector label: %s\n' "$value" >&2
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

# Validate a runner targets YAML file for structural correctness
# Checks: file exists, size < 32KB, has schema: 1, has runner_targets section,
# every target has type/mode/preferred_selector present, name/type/mode/
# preferred_selector-labels are valid, best_for/avoid_for/notes contain no
# reserved |/, delimiter, and the 20/20 count caps.
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
    # routing_rules-only file — skip runner validation, return success.
    return 0
  fi

  _rt_check_runner_names "$filepath" || return 1
  _rt_check_required_fields "$filepath" || return 1
  _rt_check_target_counts "$filepath" || return 1
  _rt_check_runner_types "$filepath" || return 1
  _rt_check_runner_modes "$filepath" || return 1
  _rt_check_selector_labels "$filepath" || return 1
  _rt_check_metadata_delimiters "$filepath" || return 1

  return 0
}
