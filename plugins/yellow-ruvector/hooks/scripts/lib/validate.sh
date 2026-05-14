#!/bin/bash
# validate.sh — Shared validation functions for ruvector hooks
# Source this file from hook scripts: . "${SCRIPT_DIR}/lib/validate.sh"

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
