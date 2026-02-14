#!/usr/bin/env bash
# shellcheck disable=SC2154
# Shared validation functions for yellow-debt plugin

# Extract YAML frontmatter from markdown file for yq processing
# Usage: extract_frontmatter FILE | yq '.field'
# NOTE: kislyuk/yq (Python wrapper) cannot parse markdown with YAML frontmatter.
#       This function extracts only the YAML section between the --- delimiters.
extract_frontmatter() {
  local file="$1"
  [ -f "$file" ] || return 1
  # Extract content between first and second '---' markers
  awk '/^---$/{if(++c==2) exit} c==1' "$file"
}

# Update YAML frontmatter field in markdown file
# Usage: update_frontmatter FILE FIELD VALUE
# Example: update_frontmatter todo.md '.status' 'ready'
# NOTE: kislyuk/yq -i cannot handle markdown with YAML frontmatter.
#       This function extracts frontmatter, updates it, and reconstructs the file.
update_frontmatter() {
  local file="$1"
  local field="$2"
  local value="$3"
  local temp_file="${file}.tmp"

  [ -f "$file" ] || return 1

  # Extract frontmatter and update field
  local updated_frontmatter
  updated_frontmatter=$(extract_frontmatter "$file" | yq -y "$field = \"$value\"" 2>/dev/null) || return 1

  # Extract body (everything after second ---)
  local body
  body=$(awk '/^---$/{if(++c==2) {p=1; next}} p' "$file")

  # Reconstruct file
  {
    printf '%s\n' '---'
    printf '%s\n' "$updated_frontmatter"
    printf '%s\n' '---'
    printf '%s' "$body"
  } > "$temp_file" || return 1

  # Atomic replace
  mv "$temp_file" "$file" || return 1
  return 0
}

validate_file_path() {
  local raw_path="$1"
  local project_root="${2:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

  # Reject empty paths
  [ -z "$raw_path" ] && return 1

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
  local lock_file="${todo_file}.lock"

  # Ensure cleanup on all exit paths
  trap 'rm -f "$lock_file" "$temp_file"; flock -u 200 2>/dev/null || true' RETURN

  # Acquire exclusive lock
  exec 200>"$lock_file"
  flock -x 200 || { printf '[debt] Failed to acquire lock\n' >&2; return 1; }

  # INSIDE LOCK: Verify file exists (TOCTOU prevention)
  if [ ! -f "$todo_file" ]; then
    printf '[debt] File not found inside lock\n' >&2
    return 1
  fi

  # Re-read current state inside lock (TOCTOU prevention)
  local current_state
  current_state=$(extract_frontmatter "$todo_file" | yq '.status' 2>/dev/null) || return 1

  # Validate transition
  validate_transition "$current_state" "$new_state" || {
    printf '[debt] Invalid transition %s→%s\n' "$current_state" "$new_state" >&2
    return 1
  }

  # Update frontmatter (extract YAML, update, reconstruct markdown)
  local updated_frontmatter body
  updated_frontmatter=$(extract_frontmatter "$todo_file" | yq -y ".status = \"$new_state\"" 2>/dev/null) || return 1
  body=$(awk '/^---$/{if(++c==2) {p=1; next}} p' "$todo_file")

  # Write updated content to temp file
  {
    printf '%s\n' '---'
    printf '%s\n' "$updated_frontmatter"
    printf '%s\n' '---'
    printf '%s' "$body"
  } > "$temp_file" || return 1

  # INSIDE LOCK: Parse current filename and derive new name from actual file state
  local base_name new_filename id severity slug hash
  base_name=$(basename "$todo_file")

  if [[ "$base_name" =~ ^([0-9]+)-(pending|ready|in-progress|deferred|complete|deleted)-([^-]+)-(.+)-([^-]+)\.md$ ]]; then
    id="${BASH_REMATCH[1]}"
    severity="${BASH_REMATCH[3]}"
    slug="${BASH_REMATCH[4]}"
    hash="${BASH_REMATCH[5]}"
    new_filename="$(dirname "$todo_file")/${id}-${new_state}-${severity}-${slug}-${hash}.md"
  else
    # Fallback: use sed-based rename if regex doesn't match
    new_filename=$(printf '%s' "$todo_file" | sed "s/-${current_state}-/-${new_state}-/")
  fi

  # Check for collision
  if [ -e "$new_filename" ]; then
    printf '[debt] Target file already exists: %s\n' "$new_filename" >&2
    return 1
  fi

  # Atomic rename
  mv "$temp_file" "$new_filename" || return 1

  rm -f "$todo_file"
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
