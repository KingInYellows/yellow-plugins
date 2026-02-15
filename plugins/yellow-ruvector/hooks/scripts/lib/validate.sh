#!/bin/bash
# validate.sh — Shared validation functions for ruvector hooks
# Source this file from hook scripts: . "${SCRIPT_DIR}/lib/validate.sh"

# Canonicalize PROJECT_DIR to absolute path (prevents symlink/relative path bypass)
# Portable: uses cd+pwd (POSIX), no GNU realpath dependency
canonicalize_project_dir() {
  local raw_dir="$1"
  if [ -d "$raw_dir" ]; then
    (cd -- "$raw_dir" 2>/dev/null && pwd -P) || { printf '[validate] Warning: cd+pwd canonicalization failed, using raw path\n' >&2; printf '%s' "$raw_dir"; }
  elif command -v realpath >/dev/null 2>&1; then
    realpath -- "$raw_dir" 2>/dev/null || { printf '[validate] Warning: realpath canonicalization failed, using raw path\n' >&2; printf '%s' "$raw_dir"; }
  else
    printf '[validate] Warning: No realpath available, using raw path\n' >&2
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

  # Normalize and resolve to absolute path (portable — no GNU realpath -m)
  local resolved
  local full_path="${project_root}/${raw_path}"

  # Reject symlinks outside project root (check before resolving)
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
      # Cannot safely resolve symlink target — reject
      return 1
    fi
    case "$target" in
      "${project_root}/"*) ;; # OK: symlink points inside project
      *) return 1 ;; # Reject: symlink escapes project root
    esac
  fi

  # Resolve path: prefer realpath (any version), fall back to cd+pwd
  if [ -e "$full_path" ] && [ -d "$(dirname "$full_path")" ]; then
    resolved="$(cd -- "$(dirname "$full_path")" 2>/dev/null && pwd -P)/$(basename "$full_path")"
  elif command -v realpath >/dev/null 2>&1; then
    # realpath without -m: works on most systems including macOS (coreutils)
    resolved="$(realpath -- "$full_path" 2>/dev/null)" || { printf '[validate] Warning: realpath failed for path, using literal path\n' >&2; resolved="$full_path"; }
  else
    printf '[validate] Warning: No realpath available, using literal path\n' >&2
    resolved="$full_path"
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
