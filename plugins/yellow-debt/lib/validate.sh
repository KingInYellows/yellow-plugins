#!/usr/bin/env bash
# shellcheck disable=SC2154
# Shared validation functions for yellow-debt plugin

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

# Surface the missing-dependency case explicitly: yellow-debt commands have
# live callers of validate_file_path (commands/debt/fix.md, sync.md, audit.md).
# Without the function defined, those callers exit 127 — fail-closed but the
# error gives no hint that yellow-core needs to be installed.
command -v validate_file_path >/dev/null 2>&1 || \
  printf '[yellow-debt] Warning: validate_file_path unavailable — install yellow-core (provides lib/validate-fs.sh)\n' >&2

# Todo filename contract: {id}-{status}-{severity}-{slug}[-{hash}].md. A name
# outside it is never handed to a shell block or a model — the repository
# controls these names, and one containing `$(…)` or a backtick would run if
# it were pasted into shell text. `wont-fix` (valid finding, deliberately not
# fixed) is hyphenated so it fits the status group; the `wont_fix` spelling an
# agent once wrote by hand is accepted only as a transition source.
DEBT_TODO_NAME_RE='^[0-9]{1,6}-(pending|ready|in-progress|deferred|complete|deleted|wont-fix)-(critical|high|medium|low)-[a-z0-9]+(-[a-z0-9]+)*\.md$'

debt_todo_name_ok() {
  [[ "$1" =~ $DEBT_TODO_NAME_RE ]]
}

# Refuse when any argument is a symlink. A cloned repository can ship .debt,
# todos/debt, a todo file, or a *.tmp/*.lock name as a symlink; writing
# through one would modify a file outside the tree (e.g. .git/config).
debt_refuse_symlinks() {
  local p
  for p in "$@"; do
    if [ -L "$p" ]; then
      printf '[debt] Refusing to use %s: it is a symlink\n' "$p" >&2
      return 1
    fi
  done
  return 0
}

# Refuse a symlinked FILE, its directory, or that directory's parent (the
# .debt/ or todos/ and todos/debt/ components a repository controls).
debt_refuse_symlinked_path() {
  local file="$1" dir
  dir=$(dirname -- "$file")
  debt_refuse_symlinks "$file" "$dir" "$(dirname -- "$dir")"
}

# Write stdin to FILE through a mktemp file in the same directory, then
# rename it over FILE. mktemp creates a new file (O_EXCL) and rename replaces
# the directory entry, so nothing is written through a planted symlink.
debt_write_file() {
  local file="$1" tmp
  debt_refuse_symlinked_path "$file" || return 1
  if [ -d "$file" ]; then
    printf '[debt] Refusing to write %s: it is a directory\n' "$file" >&2
    return 1
  fi
  tmp=$(mktemp "$(dirname -- "$file")/.debt-write.XXXXXX") || return 1
  if cat >| "$tmp" && chmod 0644 "$tmp" && mv -f -- "$tmp" "$file"; then
    return 0
  fi
  rm -f -- "$tmp"
  return 1
}

# Resolve a numeric todo id to its file under todos/debt/ (relative to the
# current directory — callers cd to the git root first). Prints the path.
# The id is the only value a model substitutes into a block; the filename
# is found here, so a hostile name never appears in shell text.
# Usage: debt_resolve_todo ID [STATE]
debt_resolve_todo() {
  local id="$1" want_state="${2:-}" f base match="" count=0 skipped=0
  if ! [[ "$id" =~ ^[0-9]{1,6}$ ]]; then
    printf '[debt] Invalid todo id (expected 1-6 digits)\n' >&2
    return 1
  fi
  debt_refuse_symlinks todos todos/debt || return 1
  if [ ! -d todos/debt ]; then
    printf '[debt] todos/debt/ not found in %s\n' "$PWD" >&2
    return 1
  fi
  for f in todos/debt/"$id"-*.md; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    base="${f##*/}"
    if ! debt_todo_name_ok "$base"; then
      skipped=$((skipped + 1))
      continue
    fi
    if [ -n "$want_state" ]; then
      case "$base" in
        "$id-$want_state-"*) ;;
        *) continue ;;
      esac
    fi
    match="$f"
    count=$((count + 1))
  done
  if [ "$skipped" -gt 0 ]; then
    printf '[debt] Ignored %d file(s) for id %s whose names do not fit the todo pattern\n' "$skipped" "$id" >&2
  fi
  if [ "$count" -ne 1 ]; then
    printf '[debt] Expected one %stodo with id %s in todos/debt/, found %d\n' \
      "${want_state:+$want_state }" "$id" "$count" >&2
    return 1
  fi
  debt_refuse_symlinks "$match" || return 1
  printf '%s\n' "$match"
}

# Take a lock by creating LOCK_DIR. mkdir is atomic and fails on any existing
# path, symlinks included, so it never writes through one. Waits up to ~5s
# for another run that holds it.
debt_acquire_lock() {
  local lock_dir="$1" tries=0
  until mkdir -- "$lock_dir" 2>/dev/null; do
    if [ -L "$lock_dir" ] || [ ! -d "$lock_dir" ]; then
      printf '[debt] Cannot create lock %s (a non-directory is in the way)\n' "$lock_dir" >&2
      return 1
    fi
    tries=$((tries + 1))
    if [ "$tries" -ge 50 ]; then
      printf '[debt] Failed to acquire lock %s; remove it if no other debt command is running\n' "$lock_dir" >&2
      return 1
    fi
    sleep 0.1
  done
}

# Extract YAML frontmatter from markdown file for yq processing
# Usage: extract_frontmatter FILE | yq '.field'
# NOTE: kislyuk/yq (Python wrapper) cannot parse markdown with YAML frontmatter.
#       This function extracts only the YAML section between the --- delimiters.
extract_frontmatter() {
  local file="$1"
  [ -f "$file" ] || return 1
  # Extract content between first and second '---' markers
  # awk logic: ++c increments counter on each '---' match; c==1 prints lines between first and second delimiter
  # The first '---' is included in output (yq handles the YAML document separator)
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

  debt_refuse_symlinked_path "$file" || return 1
  [ -f "$file" ] || return 1

  # Validate field is a simple property accessor (only dots, lowercase letters, underscores)
  case "$field" in
    *[!.a-z_]*) printf '[validate] Invalid field name: %s\n' "$field" >&2; return 1 ;;
    .[a-z_]*) ;;  # OK: starts with . followed by lowercase/underscore
    *) printf '[validate] Invalid field name: %s\n' "$field" >&2; return 1 ;;
  esac

  # Extract frontmatter and update field
  local updated_frontmatter
  updated_frontmatter=$(extract_frontmatter "$file" | yq -y --arg val "$value" "$field = \$val") || { printf '[validate] yq failed updating %s in %s\n' "$field" "$file" >&2; return 1; }

  # Extract body (everything after second ---)
  local body
  body=$(awk '/^---$/{if(++c==2) {p=1; next}} p' "$file")

  # Reconstruct file and replace it atomically
  {
    printf '%s\n' '---'
    printf '%s\n' "$updated_frontmatter"
    printf '%s\n' '---'
    printf '%s' "$body"
  } | debt_write_file "$file"
}

validate_category() {
  local category="$1"
  case "$category" in
    ai-pattern|complexity|duplication|architecture|security-debt) return 0 ;;
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
  local reason="${3:-}"
  local todo_dir temp_file="" lock_dir="${todo_file}.lock"
  todo_dir=$(dirname -- "$todo_file")

  debt_refuse_symlinked_path "$todo_file" || return 1
  if ! debt_todo_name_ok "$(basename -- "$todo_file")"; then
    printf '[debt] Refusing todo whose name does not fit the todo pattern\n' >&2
    return 1
  fi

  debt_acquire_lock "$lock_dir" || return 1
  # Release on every return path; the trap clears itself so later function
  # returns in the caller do not re-run it.
  trap '[ -z "$temp_file" ] || rm -f -- "$temp_file"; rmdir -- "$lock_dir" 2>/dev/null || true; trap - RETURN' RETURN

  # INSIDE LOCK: Verify file exists (TOCTOU prevention)
  if [ -L "$todo_file" ] || [ ! -f "$todo_file" ]; then
    printf '[debt] File not found inside lock\n' >&2
    return 1
  fi

  # Re-read current state inside lock (TOCTOU prevention)
  local current_state
  current_state=$(extract_frontmatter "$todo_file" | yq -r '.status' 2>/dev/null) || return 1

  # Validate transition
  validate_transition "$current_state" "$new_state" || {
    printf '[debt] Invalid transition %s→%s\n' "$current_state" "$new_state" >&2
    return 1
  }

  # Update frontmatter (extract YAML, update, reconstruct markdown)
  local updated_frontmatter body
  updated_frontmatter=$(extract_frontmatter "$todo_file" | yq -y --arg val "$new_state" '.status = $val' 2>/dev/null) || return 1

  # Reason fields: `deferred` keeps deferred_reason, `wont-fix` keeps
  # wont_fix_reason, every other target keeps neither. The legacy defer_reason
  # is always dropped. Clean the reason first (strip newlines, cut to 200
  # codepoints with jq — `cut -c` counts bytes and can split a character) and
  # test the cleaned value, so a reason made only of newlines writes no field.
  local clean_reason
  clean_reason=$(printf '%s' "$reason" | tr -d '\n\r')
  clean_reason=$(jq -rn --arg s "$clean_reason" '$s[0:200]') || return 1
  # Hand yq the reason as a JSON string: kislyuk yq's argument parser reads a
  # plain `--arg val ---` (or any value starting with `-`) as an option.
  local reason_json
  reason_json=$(jq -n --arg s "$clean_reason" '$s') || return 1
  case "$new_state" in
    wont-fix)
      if [ -z "$clean_reason" ] && [ "$current_state" = "wont_fix" ]; then
        # Legacy repair: keep the hand-written reason, truncated like a new one.
        updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y '
          (if (.wont_fix_reason | type) == "string" then .wont_fix_reason |= .[0:200] else . end)
          | del(.deferred_reason) | del(.defer_reason)' 2>/dev/null) || return 1
      elif [ -n "$clean_reason" ]; then
        updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y --argjson val "$reason_json" '.wont_fix_reason = $val | del(.deferred_reason) | del(.defer_reason)' 2>/dev/null) || return 1
      else
        updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y 'del(.wont_fix_reason) | del(.deferred_reason) | del(.defer_reason)' 2>/dev/null) || return 1
      fi
      ;;
    deferred)
      if [ -n "$clean_reason" ]; then
        updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y --argjson val "$reason_json" '.deferred_reason = $val | del(.wont_fix_reason) | del(.defer_reason)' 2>/dev/null) || return 1
      else
        updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y 'del(.deferred_reason) | del(.wont_fix_reason) | del(.defer_reason)' 2>/dev/null) || return 1
      fi
      ;;
    *)
      updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y 'del(.deferred_reason) | del(.wont_fix_reason) | del(.defer_reason)' 2>/dev/null) || return 1
      ;;
  esac
  body=$(awk '/^---$/{if(++c==2) {p=1; next}} p' "$todo_file")

  # Write updated content to a fresh temp file (mktemp never reuses a planted
  # name or symlink)
  temp_file=$(mktemp "$todo_dir/.debt-transition.XXXXXX") || return 1
  {
    printf '%s\n' '---'
    printf '%s\n' "$updated_frontmatter"
    printf '%s\n' '---'
    printf '%s' "$body"
  } >| "$temp_file" || return 1
  chmod 0644 "$temp_file" || return 1

  # INSIDE LOCK: derive the new name by swapping the status field. The name
  # was checked against DEBT_TODO_NAME_RE above, so the status is the field
  # right after the numeric id.
  local base_name new_filename id rest
  base_name=$(basename -- "$todo_file")
  id="${base_name%%-*}"
  rest="${base_name#"$id"-}"
  case "$rest" in
    in-progress-*) rest="${rest#in-progress-}" ;;
    wont-fix-*) rest="${rest#wont-fix-}" ;;
    *) rest="${rest#*-}" ;;
  esac
  new_filename="${todo_dir}/${id}-${new_state}-${rest}"

  # Check for collision (a dangling symlink fails -e, so test -L as well)
  if [ -e "$new_filename" ] || [ -L "$new_filename" ]; then
    printf '[debt] Target file already exists: %s\n' "$new_filename" >&2
    return 1
  fi

  # Atomic rename
  mv -- "$temp_file" "$new_filename" || return 1
  temp_file=""

  rm -f -- "$todo_file"
  return 0
}

# --- Finding fingerprints -------------------------------------------------
# A re-audit must recognise a finding that already has a kept todo. Line
# numbers drift between LLM runs, so identity is the flagged code itself, with
# spaces, tabs and CR removed (re-indenting does not change it), the same idea
# as GitHub's primaryLocationLineHash. The value is versioned (`fp/v1:`) so the
# normalisation can change later.

# Print the first 16 hex digits of the SHA-256 of stdin.
_debt_sha16() {
  local out
  if command -v sha256sum >/dev/null 2>&1; then
    out=$(sha256sum) || return 1
  else
    out=$(shasum -a 256) || return 1
  fi
  printf '%s\n' "${out:0:16}"
}

# Print lines START..END of PATH with spaces, tabs and CR removed. The path is
# scanner output and untrusted: it must be project-relative, inside the repo
# and not a symlink.
_debt_flagged_text() {
  local path="$1" start="$2" end="$3"
  command -v validate_file_path >/dev/null 2>&1 || return 1
  validate_file_path "$path" "$PWD" || return 1
  [ ! -L "$path" ] && [ -f "$path" ] || return 1
  [[ "$start" =~ ^[0-9]{1,9}$ && "$end" =~ ^[0-9]{1,9}$ ]] || return 1
  [ "$((10#$start))" -ge 1 ] && [ "$((10#$start))" -le "$((10#$end))" ] || return 1
  # A scanner range is a few dozen lines; a huge one is malformed and makes
  # the finding resurface instead of hashing thousands of lines.
  [ "$((10#$end - 10#$start))" -lt 200 ] || return 1
  # File on stdin: BSD sed reads a `--` after the script as a file name.
  sed -n "$((10#$start)),$((10#$end))p;$((10#$end))q" < "$path" | tr -d ' \t\r'
}

# Usage: debt_fingerprint CATEGORY PATH [START END]
# Prints `fp/v1:<16 hex>` of sha256("fp/v1\0category\0path\0text"). Without a
# line range the text is empty, so the fingerprint covers category and path
# only. A range with no code in it (past end of file, or only blanks) fails, so
# the finding cannot match anything and resurfaces.
debt_fingerprint() {
  local category="$1" path="$2" start="${3:-}" end="${4:-}" text=""
  validate_category "$category" || return 1
  if [ -n "$start" ] || [ -n "$end" ]; then
    text=$(_debt_flagged_text "$path" "$start" "$end") || return 1
    [ -n "$(printf '%s' "$text" | tr -d '\n')" ] || return 1
  else
    command -v validate_file_path >/dev/null 2>&1 || return 1
    validate_file_path "$path" "$PWD" || return 1
  fi
  local digest
  digest=$({ printf 'fp/v1\0%s\0%s\0' "$category" "$path"; printf '%s' "$text"; } | _debt_sha16) || return 1
  printf 'fp/v1:%s\n' "$digest"
}

# Usage: debt_anchor_hashes PATH START END [LIMIT]
# Prints one 16-hex hash per substantive line of the range, in order: a line
# with at least 8 characters once whitespace is removed. Shorter lines (`}`,
# `else {`, `return nil`) occur all over a file and would match unrelated
# findings. The first hash is the todo's `anchor_hash`; the rest let a later
# run match a finding whose range shifted. LIMIT stops after that many hashes.
debt_anchor_hashes() {
  local line text limit="${4:-0}" n=0
  [[ "$limit" =~ ^[0-9]{1,4}$ ]] || return 1
  text=$(_debt_flagged_text "$1" "$2" "$3") || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    [ "${#line}" -ge 8 ] || continue
    printf '%s' "$line" | _debt_sha16 || return 1
    n=$((n + 1))
    [ "$limit" -eq 0 ] || [ "$n" -lt "$limit" ] || break
  done <<<"$text"
}

validate_transition() {
  local from="$1"
  local to="$2"

  case "${from}→${to}" in
    pending→ready|pending→deleted|pending→deferred) return 0 ;;
    ready→in-progress|ready→deleted) return 0 ;;
    in-progress→complete|in-progress→ready) return 0 ;;
    deferred→pending) return 0 ;;
    # wont-fix: valid finding deliberately not fixed. Reopen goes back to
    # pending for re-triage. `wont_fix` is the spelling an agent once wrote by
    # hand; it is accepted as a source only so the helper can repair it.
    pending→wont-fix|ready→wont-fix|in-progress→wont-fix|deferred→wont-fix) return 0 ;;
    wont-fix→pending) return 0 ;;
    wont_fix→wont-fix) return 0 ;;
    *) return 1 ;;
  esac
}
