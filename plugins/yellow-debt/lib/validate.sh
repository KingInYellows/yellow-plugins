#!/usr/bin/env bash
# shellcheck disable=SC2154
# Shared validation functions for yellow-debt plugin

validate_file_path() {
  local raw_path="$1"
  local project_root="${2:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

  # Newline detection (command substitution strips trailing newlines)
  local path_len=${#raw_path}
  local oneline
  oneline=$(printf '%s' "$raw_path" | tr -d '\n\r')
  [ ${#oneline} -ne "$path_len" ] && return 1

  # Reject path traversal patterns
  case "$raw_path" in
    *../*|*/..|../*|..) return 1 ;;
    /*) return 1 ;;  # Absolute paths
    ~*) return 1 ;;  # Tilde expansion
  esac

  # Canonicalize and verify containment
  local resolved
  resolved=$(realpath -m -- "${project_root}/${raw_path}" 2>/dev/null) || return 1

  case "$resolved" in
    "${project_root}/"*|"${project_root}") return 0 ;;
    *) return 1 ;;
  esac
}

validate_category() {
  local category="$1"
  case "$category" in
    ai-patterns|complexity|duplication|architecture|security) return 0 ;;
    *) return 1 ;;
  esac
}

validate_severity() {
  local severity="$1"
  case "$severity" in
    critical|high|medium|low) return 0 ;;
    *) return 1 ;;
  esac
}

transition_todo_state() {
  local todo_file="$1"
  local new_state="$2"
  local temp_file="${todo_file}.tmp"

  # Acquire exclusive lock
  exec 200>"${todo_file}.lock"
  flock -x 200 || { printf '[debt] Failed to acquire lock\n' >&2; return 1; }

  # Re-read current state inside lock (TOCTOU prevention)
  local current_state
  current_state=$(yq '.status' "$todo_file" 2>/dev/null) || {
    flock -u 200
    return 1
  }

  # Validate transition
  validate_transition "$current_state" "$new_state" || {
    flock -u 200
    printf '[debt] Invalid transition %s→%s\n' "$current_state" "$new_state" >&2
    return 1
  }

  # Update frontmatter + compute new filename
  yq ".status = \"$new_state\"" "$todo_file" > "$temp_file" || {
    flock -u 200
    return 1
  }

  local new_filename
  new_filename=$(printf '%s' "$todo_file" | sed "s/-${current_state}-/-${new_state}-/")

  # Atomic rename
  mv "$temp_file" "$new_filename" || {
    rm -f "$temp_file"
    flock -u 200
    return 1
  }

  rm -f "$todo_file"
  flock -u 200
  return 0
}

validate_transition() {
  local from="$1"
  local to="$2"

  case "${from}→${to}" in
    pending→ready|pending→deleted|pending→deferred) return 0 ;;
    ready→in-progress|ready→deleted) return 0 ;;
    in-progress→complete|in-progress→ready) return 0 ;;
    deferred→pending) return 0 ;;
    *) return 1 ;;
  esac
}
