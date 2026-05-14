#!/usr/bin/env bash
# yellow-core: shared filesystem-path validation helpers.
#
# Canonical home for validate_file_path() and canonicalize_project_dir(),
# previously copy-pasted (with divergent implementations) into yellow-ci,
# yellow-ruvector, and yellow-debt. Source from a plugin's local
# lib/validate.sh so a security fix lands in one place.
#
# Usage:
#   HELPER="${CLAUDE_PLUGIN_ROOT:-}/../yellow-core/lib/validate-fs.sh"
#   [ -f "$HELPER" ] && . "$HELPER"
#   validate_file_path "src/main.sh" "$PROJECT_ROOT" || reject
#
# Contract:
#   - validate_file_path returns 0 if the path is a project-relative path
#     that resolves inside the project root, 1 otherwise. Rejects empty
#     paths, "..", leading "/", "~" anywhere in the path, embedded newlines/CRs, and symlinks
#     whose target escapes the root.
#   - The project root ($2) is optional; it defaults to the git toplevel
#     (or $PWD). yellow-debt callers rely on the optional form.
#
# Note: this file is intended to be sourced. It MUST NOT alter the
# caller's shell options (no top-level `set -e`, `set -u`,
# `set -o pipefail`) — doing so can break a SessionStart hook's required
# `{"continue": true}` emission. Functions below use ${var:-} defaulting
# and explicit failure branches instead.

# Idempotency guard: a consumer plugin's validate.sh may guard-source this
# file at hook-load time, then a Bats test may source it again directly.
# Without the guard, function redefinition is silent and any divergence
# between source paths could mask a regression.
[ -n "${_VALIDATE_FS_LOADED:-}" ] && return 0
_VALIDATE_FS_LOADED=1

# Canonicalize a project directory to an absolute, symlink-free path.
# Portable: prefers cd+pwd (POSIX), falls back to realpath, then to the
# raw input. Never fails — always prints something on stdout.
# Usage: root=$(canonicalize_project_dir "$raw_dir")
canonicalize_project_dir() {
  local raw_dir="$1"
  if [ -d "$raw_dir" ]; then
    (cd -- "$raw_dir" 2>/dev/null && pwd -P) || { printf '[validate-fs] Warning: cd+pwd canonicalization failed, using raw path\n' >&2; printf '%s' "$raw_dir"; }
  elif command -v realpath >/dev/null 2>&1; then
    realpath -- "$raw_dir" 2>/dev/null || { printf '[validate-fs] Warning: realpath canonicalization failed, using raw path\n' >&2; printf '%s' "$raw_dir"; }
  else
    printf '[validate-fs] Warning: No realpath available, using raw path\n' >&2
    printf '%s' "$raw_dir"
  fi
}

# Validate that file_path is a project-relative path resolving inside the
# project root (path-traversal mitigation).
# Usage: validate_file_path "$path" ["$project_root"]
# Returns 0 if valid, 1 otherwise.
validate_file_path() {
  local raw_path="$1"
  local project_root="${2:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

  # Quick reject: obvious traversal patterns.
  case "$raw_path" in
    *..* | /* | *~*) return 1 ;;
  esac

  # Empty path is invalid.
  if [ -z "$raw_path" ]; then
    return 1
  fi

  # Reject newlines and carriage returns (defense-in-depth).
  # Note: cannot use $(printf '\n') in a case pattern — command
  # substitution strips trailing newlines. Use tr + length comparison.
  local path_len=${#raw_path}
  local oneline
  oneline=$(printf '%s' "$raw_path" | tr -d '\n\r')
  if [ ${#oneline} -ne "$path_len" ]; then
    return 1
  fi

  # Canonicalize the project root so the containment check below is
  # reliable even when the caller passes a symlinked root (e.g. macOS
  # /var -> /private/var).
  local canonical_root
  canonical_root=$(cd -- "$project_root" 2>/dev/null && pwd -P) || return 1

  local full_path="${canonical_root}/${raw_path}"

  # Reject symlinks whose target escapes the project root (check before
  # resolving the full path).
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
      # Cannot safely resolve symlink target — reject.
      return 1
    fi
    case "$target" in
      "${canonical_root}/"*) ;; # OK: symlink points inside project
      *) return 1 ;;            # Reject: symlink escapes project root
    esac
  fi

  # Resolve path by walking up to the nearest existing ancestor using
  # cd+pwd -P (POSIX, no realpath required). Fixes two issues with the
  # prior realpath fallback:
  #   1. realpath -m is not portable (GNU only); bare realpath fails on
  #      non-existent paths, producing noisy warnings on every pre-creation
  #      validate call (yellow-debt pattern).
  #   2. The literal-$full_path fallback was fail-open against a symlinked
  #      intermediate directory: if safe/link/ -> /tmp, validate_file_path
  #      for safe/link/new.md returned success even though creation would
  #      escape the project root. Walking up and resolving the nearest
  #      existing ancestor via pwd -P catches this.
  local resolved candidate="$full_path" remainder=""
  while [ -n "$candidate" ] && [ "$candidate" != "/" ] && [ ! -e "$candidate" ]; do
    remainder="$(basename -- "$candidate")${remainder:+/$remainder}"
    candidate="$(dirname -- "$candidate")"
  done
  # If candidate is a regular file (not a directory), cd to its parent and
  # append its basename — cd fails on non-directories.
  local resolved_parent
  if [ -d "$candidate" ]; then
    resolved_parent=$(cd -- "$candidate" 2>/dev/null && pwd -P) || return 1
  else
    resolved_parent=$(cd -- "$(dirname -- "$candidate")" 2>/dev/null && pwd -P) || return 1
    remainder="$(basename -- "$candidate")${remainder:+/$remainder}"
  fi
  resolved="${resolved_parent}${remainder:+/$remainder}"

  # Verify resolved path is under the project root.
  case "$resolved" in
    "${canonical_root}/"*) return 0 ;;
    *) return 1 ;;
  esac
}
