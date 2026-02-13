#!/bin/bash
# validate.sh — Shared validation functions for ruvector hooks
# Source this file from hook scripts: . "${SCRIPT_DIR}/lib/validate.sh"

# Canonicalize PROJECT_DIR to absolute path (prevents symlink/relative path bypass)
canonicalize_project_dir() {
  local raw_dir="$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath -- "$raw_dir" 2>/dev/null || printf '%s' "$raw_dir"
  else
    printf '%s' "$raw_dir"
  fi
}

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

  # Reject newlines and carriage returns (defense-in-depth)
  # Note: cannot use $(printf '\n') in case pattern — command substitution strips trailing newlines
  local path_len=${#raw_path}
  local oneline
  oneline=$(printf '%s' "$raw_path" | tr -d '\n\r')
  if [ ${#oneline} -ne "$path_len" ]; then
    return 1
  fi

  # Normalize and resolve to absolute path
  local resolved
  if ! command -v realpath >/dev/null 2>&1; then
    # Fallback: basic prefix check without normalization
    resolved="${project_root}/${raw_path}"
    case "$resolved" in
      "${project_root}/"*) return 0 ;;
      *) return 1 ;;
    esac
  fi

  resolved="$(realpath -m -- "${project_root}/${raw_path}" 2>/dev/null)" || return 1

  # Reject symlinks outside project root
  if [ -L "${project_root}/${raw_path}" ]; then
    local target
    target="$(realpath -- "${project_root}/${raw_path}" 2>/dev/null)" || return 1
    case "$target" in
      "${project_root}/"*) ;; # OK: symlink points inside project
      *) return 1 ;; # Reject: symlink escapes project root
    esac
  fi

  # Verify resolved path is under project root
  case "$resolved" in
    "${project_root}/"*) return 0 ;;
    *) return 1 ;;
  esac
}

# Validate namespace name matches [a-z0-9-] only
# Usage: validate_namespace "$namespace"
validate_namespace() {
  local ns="$1"

  # Check length (1-64 chars)
  if [ ${#ns} -gt 64 ] || [ ${#ns} -lt 1 ]; then
    return 1
  fi

  # Check pattern: only lowercase alphanumeric and hyphens
  case "$ns" in
    *[!a-z0-9-]*) return 1 ;; # Contains invalid chars
    -*) return 1 ;;            # Starts with hyphen
    *-) return 1 ;;            # Ends with hyphen
  esac

  # Explicit path traversal rejection (defense-in-depth)
  case "$ns" in
    *..*|*/*|*~*) return 1 ;;
  esac

  return 0
}
