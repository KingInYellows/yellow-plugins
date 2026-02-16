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

# ============================================================================
# Shared validation library functions
# The following functions are not all used by every plugin but are available
# as a shared validation library for hooks, commands, and agents.
# ============================================================================

# Validate file_path is within project root (path traversal mitigation)
# Usage: validate_file_path "$path" "$project_root"
validate_file_path() {
  local raw_path="$1"
  local project_root="$2"

  # Quick reject: obvious traversal patterns
  case "$raw_path" in
    *..* | /* | *~*) return 1 ;;
  esac

  # Empty path is invalid
  if [ -z "$raw_path" ]; then
    return 1
  fi

  # Reject newlines and carriage returns
  if has_newline "$raw_path"; then
    return 1
  fi

  # Resolve to absolute and check containment
  local full_path="${project_root}/${raw_path}"

  # Reject symlinks outside project root
  if [ -L "$full_path" ]; then
    local target
    if command -v realpath >/dev/null 2>&1; then
      target="$(realpath -- "$full_path" 2>/dev/null)" || return 1
    elif command -v readlink >/dev/null 2>&1; then
      local link_content
      link_content=$(readlink -- "$full_path" 2>/dev/null) || return 1
      case "$link_content" in
        /*) target="$link_content" ;;
        *)  target="$(cd -- "$(dirname "$full_path")" 2>/dev/null && cd -- "$(dirname "$link_content")" 2>/dev/null && pwd -P)/$(basename "$link_content")" || return 1 ;;
      esac
    else
      return 1
    fi
    case "$target" in
      "${project_root}/"*) ;;
      *) return 1 ;;
    esac
  fi

  # Resolve path
  local resolved
  if [ -e "$full_path" ] && [ -d "$(dirname "$full_path")" ]; then
    resolved="$(cd -- "$(dirname "$full_path")" 2>/dev/null && pwd -P)/$(basename "$full_path")"
  elif command -v realpath >/dev/null 2>&1; then
    resolved="$(realpath -- "$full_path" 2>/dev/null)" || resolved="$full_path"
  else
    resolved="$full_path"
  fi

  case "$resolved" in
    "${project_root}/"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Validate runner name: DNS-safe, 1-64 chars, lowercase alphanumeric + hyphens
# Usage: validate_runner_name "$name"
validate_runner_name() {
  local name="$1"

  if [ -z "$name" ]; then
    return 1
  fi

  # Length check: 1-64 chars
  if [ ${#name} -gt 64 ] || [ ${#name} -lt 1 ]; then
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

  # Try IPv4 first: N.N.N.N format
  if [[ "$host" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    # Validate private range: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    local octet1=${BASH_REMATCH[1]}
    local octet2=${BASH_REMATCH[2]}

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
  fi

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

  return 0
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
