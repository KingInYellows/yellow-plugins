#!/usr/bin/env bash
# shellcheck disable=SC2154
# Shared validation functions for yellow-debt plugin

# Shared filesystem-path validators (validate_file_path,
# canonicalize_project_dir) live in yellow-core's shared lib so a security
# fix lands in one place. At runtime CLAUDE_PLUGIN_ROOT is set by Claude
# Code; in Bats tests the suite sources validate-fs.sh directly. In a checkout
# yellow-core is a sibling of the plugin directory. In the installed cache both
# plugins are versioned (.../yellow-debt/<ver>, .../yellow-core/<ver>), so fall
# back to the highest installed yellow-core version.
_VALIDATE_FS_HELPER="${CLAUDE_PLUGIN_ROOT:-}/../yellow-core/lib/validate-fs.sh"
if [ ! -f "$_VALIDATE_FS_HELPER" ] && [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  # No `sort -V`: BSD sort lacks it, and under the callers' `set -eo pipefail`
  # its failure would abort the command.
  _debt_ver_gt() {
    local -a a b
    local i x y
    IFS=. read -r -a a <<<"$1"
    IFS=. read -r -a b <<<"$2"
    for i in 0 1 2 3; do
      x="${a[i]:-0}"; y="${b[i]:-0}"; x="${x//[!0-9]/}"; y="${y//[!0-9]/}"
      x="${x:-0}"; y="${y:-0}"
      [ "$((10#$x))" -le "$((10#$y))" ] || return 0
      [ "$((10#$x))" -ge "$((10#$y))" ] || return 1
    done
    return 1
  }
  _best=""; _best_v=""
  for _cand in "${CLAUDE_PLUGIN_ROOT}"/../../yellow-core/*/lib/validate-fs.sh; do
    [ -f "$_cand" ] || continue
    _cand_v="${_cand%/lib/validate-fs.sh}"; _cand_v="${_cand_v##*/}"
    if [ -z "$_best" ] || _debt_ver_gt "$_cand_v" "$_best_v"; then _best="$_cand"; _best_v="$_cand_v"; fi
  done
  [ -z "$_best" ] || _VALIDATE_FS_HELPER="$_best"
  unset -f _debt_ver_gt
  unset _best _best_v _cand _cand_v
fi
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
# fixed) is hyphenated so it fits the status group; the hand-written spellings
# `wont_fix`, `wontfix` and `wont fix` are accepted only as transition sources.
DEBT_TODO_NAME_RE='^[0-9]{1,6}-(pending|ready|in-progress|deferred|complete|deleted|wont-fix)-(critical|high|medium|low)-[a-z0-9]+(-[a-z0-9]+)*\.md$'

debt_todo_name_ok() {
  [[ "$1" =~ $DEBT_TODO_NAME_RE ]]
}

# The hand-written spellings of wont-fix an agent once wrote into frontmatter.
# validate_transition accepts the same three as sources; a parity test keeps the
# two lists equal.
debt_is_legacy_wont_fix() {
  case "$1" in
    wont_fix|wontfix|"wont fix") return 0 ;;
    *) return 1 ;;
  esac
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
  local id="$1" want_state="${2:-}" f base match="" count=0 skipped=0 other=""
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
        *) other="${BASH_REMATCH[1]}"; continue ;;
      esac
    fi
    match="$f"
    count=$((count + 1))
  done
  if [ "$skipped" -gt 0 ]; then
    printf '[debt] Ignored %d file(s) for id %s whose names do not fit the todo pattern\n' "$skipped" "$id" >&2
  fi
  if [ "$count" -ne 1 ]; then
    printf '[debt] Expected one %stodo with id %s in todos/debt/, found %d%s\n' \
      "${want_state:+$want_state }" "$id" "$count" "${other:+ (todo $id exists as $other)}" >&2
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

  # Already there: a retry after a lost result is a success, not an error. When
  # only the file name lags the frontmatter (a hand edit), fall through to the
  # rename and skip the edge check, since there is no edge to take.
  local name_state="" rename_only=false
  [[ "${todo_file##*/}" =~ $DEBT_TODO_NAME_RE ]] && name_state="${BASH_REMATCH[1]}"
  if [ "$current_state" = "$new_state" ]; then
    if [ "$name_state" = "$new_state" ]; then
      printf '[debt] %s is already %s; nothing to do\n' "${todo_file##*/}" "$new_state"
      return 0
    fi
    rename_only=true
  fi

  # Validate transition
  if [ "$rename_only" = false ]; then
    validate_transition "$current_state" "$new_state" || {
      local t allowed=""
      for t in pending ready in-progress deferred complete deleted wont-fix; do
        validate_transition "$current_state" "$t" && allowed="$allowed $t"
      done
      printf '[debt] Invalid transition %s→%s (allowed from %s:%s)\n' "$current_state" "$new_state" "$current_state" "${allowed:- none}" >&2
      return 1
    }
  fi

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
  local reason_len
  reason_len=$(jq -rn --arg s "$clean_reason" '$s | length') || return 1
  clean_reason=$(jq -rn --arg s "$clean_reason" '$s[0:200]') || return 1
  # Hand yq the reason as a JSON string: kislyuk yq's argument parser reads a
  # plain `--arg val ---` (or any value starting with `-`) as an option.
  local reason_json
  reason_json=$(jq -n --arg s "$clean_reason" '$s') || return 1
  # One filter for every target: drop all three reason fields, then set the one
  # this state keeps. A legacy wont_fix source with no new reason keeps its
  # hand-written wont_fix_reason, cleaned like a new one.
  local keep="" legacy=false
  case "$new_state" in
    wont-fix) keep=wont_fix_reason ;;
    deferred) keep=deferred_reason ;;
  esac
  if debt_is_legacy_wont_fix "$current_state"; then legacy=true; fi
  if [ -n "$keep" ] && [ "$reason_len" -gt 200 ]; then
    printf '[debt] Note: reason truncated from %d to 200 characters\n' "$reason_len" >&2
  fi
  updated_frontmatter=$(printf '%s' "$updated_frontmatter" | yq -y \
    --arg keep "$keep" --argjson val "$reason_json" --argjson legacy "$legacy" '
    .wont_fix_reason as $old
    | del(.deferred_reason, .wont_fix_reason, .defer_reason)
    | if $keep == "" then .
      elif $val != "" then .[$keep] = $val
      elif $legacy and $keep == "wont_fix_reason" and ($old | type) == "string"
        then .[$keep] = ($old | gsub("[\n\r]"; "") | .[0:200])
      else . end' 2>/dev/null) || return 1

  # Close-time identity: a todo closed as wont-fix or deleted gets its
  # fingerprint now, while the flagged code still matches. Best effort — a
  # failure leaves the todo unstamped and never blocks the transition.
  case "$new_state" in
    wont-fix|deleted)
      local st_fp st_cat st_loc st_new st_anchor st_read=0
      if st_fp=$(printf '%s' "$updated_frontmatter" | yq -r '.fingerprint // ""' 2>/dev/null); then st_read=1; fi
      if [ "$st_read" -eq 1 ] && [ -z "$st_fp" ]; then
        st_cat=$(printf '%s' "$updated_frontmatter" | yq -r '.category // ""' 2>/dev/null) || st_cat=""
        st_loc=$(printf '%s' "$updated_frontmatter" | yq -r '.affected_files[0] // ""' 2>/dev/null) || st_loc=""
        _debt_split_loc "$st_loc"
        if st_fp=$(debt_fingerprint "$st_cat" "$_DEBT_P" "$_DEBT_S" "$_DEBT_E" 2>/dev/null); then
          st_anchor=$(debt_anchor_hashes "$_DEBT_P" "$_DEBT_S" "$_DEBT_E" 1 2>/dev/null) || st_anchor=""
          if st_new=$(printf '%s' "$updated_frontmatter" | yq -y --arg fp "$st_fp" --arg an "$st_anchor" \
              '.fingerprint = $fp | (if $an != "" then .anchor_hash = $an else . end)' 2>/dev/null); then
            updated_frontmatter="$st_new"
          else
            st_fp=""
          fi
        fi
        if [ -z "$st_fp" ]; then
          printf '[debt] Warning: %s closed without a code fingerprint (no usable line range in affected_files); a re-audit may recreate it\n' "${todo_file##*/}" >&2
        fi
      fi
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

  # A hand-edited frontmatter status can leave the name already correct: replace
  # the file in place (removing "$todo_file" afterwards would remove the new one).
  if [ "$new_filename" = "$todo_file" ]; then
    mv -- "$temp_file" "$new_filename" || return 1
    temp_file=""
    printf '[debt] %s -> %s: %s\n' "$current_state" "$new_state" "$new_filename"
    return 0
  fi

  # Check for collision (a dangling symlink fails -e, so test -L as well)
  if [ -e "$new_filename" ] || [ -L "$new_filename" ]; then
    printf '[debt] Target file already exists: %s\n' "$new_filename" >&2
    return 1
  fi

  # Atomic rename
  mv -- "$temp_file" "$new_filename" || return 1
  temp_file=""

  rm -f -- "$todo_file"
  printf '[debt] %s -> %s: %s\n' "$current_state" "$new_state" "$new_filename"
  return 0
}

# --- Finding fingerprints -------------------------------------------------
# A re-audit must recognise a finding that already has a kept todo. Line
# numbers drift between LLM runs, so identity is the flagged code itself, with
# blanks folded (re-indenting does not change it), the same idea as GitHub's
# primaryLocationLineHash. The value is versioned (`fp/v1:`) so the
# normalisation can change later.

# The shortest line (blanks folded) that can serve as an anchor.
DEBT_ANCHOR_MIN_CHARS=20

# Split "path:START-END" (or "path:LINE", or a bare path) into _DEBT_P, _DEBT_S
# and _DEBT_E.
_debt_split_loc() {
  _DEBT_P="$1"; _DEBT_S=""; _DEBT_E=""
  case "$1" in
    *:*)
      _DEBT_P="${1%:*}"; _DEBT_S="${1##*:}"; _DEBT_E="$_DEBT_S"
      case "$_DEBT_S" in *-*) _DEBT_E="${_DEBT_S##*-}"; _DEBT_S="${_DEBT_S%%-*}" ;; esac
      ;;
  esac
}

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

# Print lines START..END of PATH with each line's CR and surrounding blanks
# removed and inner runs of blanks folded to one space, so a reformat does not
# change the text but `"allow admin"` and `"allowadmin"` stay different. The
# whole range is read: an edit anywhere in it changes the text. The path is
# scanner output and untrusted: it must be project-relative, inside the repo
# and not a symlink.
_debt_flagged_text() {
  local path="$1" start="$2" end="$3"
  command -v validate_file_path >/dev/null 2>&1 || return 1
  validate_file_path "$path" "$PWD" || return 1
  [ ! -L "$path" ] && [ -f "$path" ] || return 1
  [[ "$start" =~ ^[0-9]{1,9}$ && "$end" =~ ^[0-9]{1,9}$ ]] || return 1
  [ "$((10#$start))" -ge 1 ] && [ "$((10#$start))" -le "$((10#$end))" ] || return 1
  # File on stdin: BSD sed reads a `--` after the script as a file name.
  sed -n "$((10#$start)),$((10#$end))p;$((10#$end))q" < "$path" |
    tr -d '\r' | sed -e 's/[[:blank:]][[:blank:]]*/ /g' -e 's/^ //' -e 's/ $//'
}

# Usage: debt_fingerprint CATEGORY PATH START END
# Prints `fp/v1:<16 hex>` of sha256("fp/v1\0category\0path\0text"). A finding
# needs a line range: without one the key would cover the whole file, and one
# closed finding would hide every later finding of that category in it. A range
# with no code in it (past end of file, or only blanks) fails too, so the
# finding cannot match anything and resurfaces.
debt_fingerprint() {
  local category="$1" path="$2" start="${3:-}" end="${4:-}" text digest
  validate_category "$category" || return 1
  text=$(_debt_flagged_text "$path" "$start" "$end") || return 1
  [ -n "$(printf '%s' "$text" | tr -d '\n')" ] || return 1
  digest=$({ printf 'fp/v1\0%s\0%s\0' "$category" "$path"; printf '%s' "$text"; } | _debt_sha16) || return 1
  printf 'fp/v1:%s\n' "$digest"
}

# Usage: debt_anchor_hashes PATH START END [LIMIT]
# Prints one 16-hex hash per substantive line of the range, in order: a line
# with at least DEBT_ANCHOR_MIN_CHARS characters once blanks are folded.
# Shorter lines (`}`, `else {`, `return nil`, `if err != nil {`, `@Override`)
# occur all over a file and would match unrelated findings. Length is counted in
# bytes (LC_ALL=C) so stamping and matching agree whatever the locale. The first
# hash is the todo's `anchor_hash`. LIMIT stops after that many hashes.
debt_anchor_hashes() {
  local LC_ALL=C
  local line text limit="${4:-0}" n=0
  [[ "$limit" =~ ^[0-9]{1,4}$ ]] || return 1
  text=$(_debt_flagged_text "$1" "$2" "$3") || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    [ "${#line}" -ge "$DEBT_ANCHOR_MIN_CHARS" ] || continue
    printf '%s' "$line" | _debt_sha16 || return 1
    n=$((n + 1))
    [ "$limit" -eq 0 ] || [ "$n" -lt "$limit" ] || break
  done <<<"$text"
}

# Well-named todos whose file name AND frontmatter both say pending, one path
# per line. A file named pending whose frontmatter says otherwise (a hand edit,
# such as the legacy wont_fix spelling) is a closed todo: it is reported on
# stderr and left alone. Run from the git root.
debt_pending_todos() {
  local f base st skipped=0
  debt_refuse_symlinks todos todos/debt || return 1
  for f in todos/debt/[0-9]*-pending-*.md; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    base="${f##*/}"
    if ! [[ "$base" =~ $DEBT_TODO_NAME_RE ]]; then
      skipped=$((skipped + 1))
      continue
    fi
    [ "${BASH_REMATCH[1]}" = pending ] || continue
    st=$(extract_frontmatter "$f" | yq -r '.status // ""' 2>/dev/null) || st=""
    if [ "$st" = pending ]; then
      printf '%s\n' "$f"
    else
      printf '[debt] Leaving %s: its frontmatter status is "%s", not pending\n' "$f" "${st//[^A-Za-z_ -]/?}" >&2
    fi
  done
  if [ "$skipped" -gt 0 ]; then
    printf '[debt] Warning: skipped %d file(s) whose names do not fit the todo pattern\n' "$skipped" >&2
  fi
  return 0
}

# Print the next free todo ids, one per line, zero-padded to three digits: COUNT
# ids (default 1) above the highest leading number of any regular *.md under
# todos/debt/, skipping a number a symlink holds (dangling or not: the resolver
# sees it, so reusing the number would make the new todo ambiguous). A symlink
# never raises the counter, so a planted `999999-…` link cannot exhaust the id
# space. Ids are 1-6 digits everywhere else, so a larger one is ignored. Run
# from the git root.
# Usage: debt_next_todo_id [COUNT]
debt_next_todo_id() {
  local count="${1:-1}" f base id max=0 k n held=" "
  [[ "$count" =~ ^[0-9]{1,4}$ ]] && [ "$((10#$count))" -ge 1 ] || {
    printf '[debt] Error: count must be 1-9999\n' >&2; return 1; }
  debt_refuse_symlinks todos todos/debt || return 1
  for f in todos/debt/*.md; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    base="${f##*/}"; id="${base%%-*}"
    [[ "$id" =~ ^[0-9]{1,6}$ ]] || continue
    if [ -L "$f" ]; then held="$held$((10#$id)) "; continue; fi
    [ "$((10#$id))" -le "$max" ] || max=$((10#$id))
  done
  n=$max
  for ((k = 1; k <= 10#$count; k++)); do
    n=$((n + 1))
    while [[ "$held" == *" $n "* ]]; do n=$((n + 1)); done
    if [ "$n" -gt 999999 ]; then
      printf '[debt] Error: todo ids exhausted\n' >&2
      return 1
    fi
    printf '%03d\n' "$n"
  done
}

# Decide which surviving findings already have a kept todo (any status but
# pending or deferred; a matching deferred todo is reported as resurfaced_from). Reads .debt/surviving-findings.json (an array of v2.0 records),
# writes .debt/fingerprints.json (one entry per finding, by index) and prints a
# line per skipped finding. Exact fingerprint first; then same category and
# path whose anchor_hash equals the first substantive line of the new range
# (never for security-debt). Only a unique match suppresses; a tie, an
# unreadable range or no match leaves the finding to resurface. Run from the
# git root.
debt_match_kept_todos() {
  local US=$'\x1f' paths out f base st meta cat loc fp anchor
  local -a k_id=() k_status=() k_cat=() k_path=() k_fp=() k_anchor=() candidates=() d_id=() d_fp=()
  local unreadable=0 unfingerprinted=0 n i j rec fpath lines first first_done matches how match_idx merged fm_status resurfaced
  command -v validate_file_path >/dev/null 2>&1 || {
    printf '[debt] Error: validate_file_path is unavailable (yellow-core lib/validate-fs.sh not found); cannot fingerprint findings\n' >&2
    return 1; }
  debt_refuse_symlinks todos todos/debt .debt .debt/surviving-findings.json .debt/fingerprints.json || return 1
  rm -f -- .debt/fingerprints.json
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || {
    printf '[debt] Error: sha256sum or shasum is required\n' >&2; return 1; }
  paths=$(mktemp .debt/.paths.XXXXXX) || return 1
  out=$(mktemp .debt/.fingerprints.XXXXXX) || { rm -f -- "$paths"; return 1; }
  trap 'rm -f -- "$paths" "$out"; trap - RETURN' RETURN
  if ! jq -e 'type == "array"' .debt/surviving-findings.json >/dev/null 2>&1; then
    printf '[debt] Error: .debt/surviving-findings.json is missing or not a JSON array; write it with the Write tool first\n' >&2
    return 1
  fi
  n=$(jq 'length' .debt/surviving-findings.json) || return 1

  # Only a kept todo that names a surviving finding's path can match, so read
  # frontmatter (one yq process each) for those files alone.
  jq -r '.[].file.path // empty' .debt/surviving-findings.json | grep -v '^$' | LC_ALL=C sort -u >| "$paths"
  while IFS= read -r f; do candidates+=("$f"); done < <(grep -lF -f "$paths" -- todos/debt/[0-9]*.md 2>/dev/null)

  for f in "${candidates[@]}"; do
    [ -f "$f" ] && [ ! -L "$f" ] || continue
    base="${f##*/}"
    [[ "$base" =~ $DEBT_TODO_NAME_RE ]] || continue
    meta=$(extract_frontmatter "$f" | yq -r '[(.status // ""), (.category // ""), (.affected_files[0] // ""), (.fingerprint // ""), (.anchor_hash // "")] | join("\u001f")' 2>/dev/null) || {
      unreadable=$((unreadable + 1)); printf '[debt] Warning: kept todo %s is unreadable\n' "$base" >&2; continue; }
    IFS="$US" read -r fm_status cat loc fp anchor <<<"$meta"
    # The frontmatter status is the source of truth: a file name is a cache of
    # it, and a hand edit (the legacy wont_fix spelling) can leave them apart.
    if debt_is_legacy_wont_fix "$fm_status"; then
      st=wont-fix
    else
      case "$fm_status" in
        pending|ready|in-progress|deferred|complete|deleted|wont-fix) st="$fm_status" ;;
        *) unreadable=$((unreadable + 1)); printf '[debt] Warning: kept todo %s has an unknown status\n' "$base" >&2; continue ;;
      esac
    fi
    # A pending todo is about to be deleted: it suppresses nothing.
    [ "$st" != pending ] || continue
    _debt_split_loc "$loc"
    # An older todo has no stored identity. Rehash it from the tree, except a
    # complete one: its code was changed by the fix, so the tree says nothing.
    if [ "$st" != complete ] && [ -n "$cat" ] && [ -n "$_DEBT_S" ]; then
      [ -n "$fp" ] || fp=$(debt_fingerprint "$cat" "$_DEBT_P" "$_DEBT_S" "$_DEBT_E" 2>/dev/null) || fp=""
      [ -n "$anchor" ] || anchor=$(debt_anchor_hashes "$_DEBT_P" "$_DEBT_S" "$_DEBT_E" 1 2>/dev/null) || anchor=""
    fi
    if [ "$st" = deferred ]; then
      # A deferred todo is meant to come back, so it never suppresses; remember
      # its identity so the new pending todo can point at it.
      d_id+=("${base%%-*}"); d_fp+=("$fp")
      continue
    fi
    k_id+=("${base%%-*}"); k_status+=("$st"); k_cat+=("$cat"); k_path+=("$_DEBT_P"); k_fp+=("$fp"); k_anchor+=("$anchor")
  done

  for ((i = 0; i < n; i++)); do
    rec=$(jq -r --argjson i "$i" '.[$i] | [(.category // ""), (.file.path // ""), ((.file.lines // "") | tostring)] | join("\u001f")' .debt/surviving-findings.json) || return 1
    IFS="$US" read -r cat fpath lines <<<"$rec"
    loc="$fpath"; [ -z "$lines" ] || loc="$fpath:$lines"
    _debt_split_loc "$loc"
    fp=$(debt_fingerprint "$cat" "$fpath" "$_DEBT_S" "$_DEBT_E" 2>/dev/null) || {
      fp=""; unfingerprinted=$((unfingerprinted + 1)); printf '[debt] Warning: finding %d has no usable line range\n' "$i" >&2; }
    first=""; first_done=0; match_idx=-1; matches=0; how=""; resurfaced=""
    if [ -n "$fp" ]; then
      # An exact fingerprint is unambiguous, so any number of kept todos with it
      # suppress (a finding closed twice must stay closed). Report the lowest id.
      for j in "${!k_id[@]}"; do
        [ "${k_fp[j]}" = "$fp" ] || continue
        [ "$matches" -gt 0 ] || match_idx=$j
        matches=$((matches + 1))
      done
      [ "$matches" -ge 1 ] && how=fingerprint
    fi
    if [ -z "$how" ] && [ "$matches" -eq 0 ] && [ -n "$fp" ] && [ "$cat" != security-debt ]; then
      for j in "${!k_id[@]}"; do
        # complete and deleted todos suppress only on an exact fingerprint: a
        # fixed function often keeps its first line, and a false positive says
        # nothing about a later real finding that starts on the same line.
        [ "${k_status[j]}" != complete ] && [ "${k_status[j]}" != deleted ] || continue
        [ "${k_cat[j]}" = "$cat" ] && [ "${k_path[j]}" = "$fpath" ] && [ -n "${k_anchor[j]}" ] || continue
        if [ "$first_done" -eq 0 ]; then
          first=$(debt_anchor_hashes "$fpath" "$_DEBT_S" "$_DEBT_E" 1 2>/dev/null) || first=""
          first_done=1
        fi
        [ "${k_anchor[j]}" = "$first" ] || continue
        matches=$((matches + 1)); match_idx=$j
      done
      [ "$matches" -eq 1 ] && how=anchor
    fi
    if [ -n "$how" ]; then
      jq -cn --argjson i "$i" --arg id "${k_id[match_idx]}" --arg st "${k_status[match_idx]}" --arg how "$how" \
        '{index: $i, skip: true, kept_id: $id, status: $st, match: $how}' >> "$out" || return 1
    else
      if [ "$first_done" -eq 0 ] && [ -n "$fp" ]; then
        first=$(debt_anchor_hashes "$fpath" "$_DEBT_S" "$_DEBT_E" 1 2>/dev/null) || first=""
      fi
      if [ -n "$fp" ]; then
        for j in "${!d_id[@]}"; do
          [ "${d_fp[j]}" = "$fp" ] || continue
          resurfaced="${d_id[j]}"; break
        done
      fi
      jq -cn --argjson i "$i" --arg fp "$fp" --arg anchor "$first" --arg res "$resurfaced" \
        '{index: $i, skip: false, fingerprint: (if $fp == "" then null else $fp end), anchor_hash: (if $anchor == "" then null else $anchor end), resurfaced_from: (if $res == "" then null else $res end)}' >> "$out" || return 1
    fi
  done
  merged=$(jq -s '.' "$out") || return 1
  printf '%s\n' "$merged" | debt_write_file .debt/fingerprints.json || return 1
  jq -r '.[] | select(.skip) | "skipped: finding \(.index) matches kept todo \(.kept_id) (\(.status), \(.match))"' .debt/fingerprints.json
  if [ "$unreadable" -gt 0 ] || [ "$unfingerprinted" -gt 0 ]; then
    printf '[debt] Warning: %d kept todo(s) unreadable or with an unknown status, %d finding(s) without a usable line range; those cannot match and may resurface\n' \
      "$unreadable" "$unfingerprinted" >&2
  fi
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
    # hand (also `wontfix` and `wont fix`); they are accepted as sources only so
    # the helper can repair them.
    pending→wont-fix|ready→wont-fix|in-progress→wont-fix|deferred→wont-fix) return 0 ;;
    wont-fix→pending) return 0 ;;
    wont_fix→wont-fix|wontfix→wont-fix|"wont fix→wont-fix") return 0 ;;
    *) return 1 ;;
  esac
}
