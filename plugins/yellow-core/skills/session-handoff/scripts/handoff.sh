#!/usr/bin/env bash
# yellow-core: session-handoff tool.
#
# Subcommands:
#   measure                      print the measured workspace block as JSON
#   write --slug S --title T [--task-ref P] [--evidence P]... < body
#                                publish plans/handoff/<date>-<slug>.md
#   read  plans/handoff/<f>.md   parse a note (v1 or legacy) as JSON
#   preflight plans/handoff/<f>.md
#                                read-only resume check; JSON on stdout,
#                                one-paragraph summary on stderr
#
# Exit codes (this script is invoked by the skill body, NOT as a Claude Code
# hook, so exit 2 carries none of the hook protocol's meaning here):
#   0   ready / success
#   2   usage error or invalid reference
#   10  preflight: mismatched
#   11  preflight: unsupported (legacy note, newer format, missing jq)
#   12  preflight: blocked
#
# Read-only guarantee: every git call in this file goes through ho_git, which
# only permits rev-parse, status, symbolic-ref and remote get-url, disables
# hooks and fsmonitor, and takes no optional locks. pi_report (lib/plugin-
# identity.sh) is handed the already-resolved root so it runs no git here.
# Nothing here checks out, stashes, fetches, resets or launches.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P)"
# shellcheck source=../../../lib/compound-staging.sh
. "${SCRIPT_DIR}/../../../lib/compound-staging.sh"
# shellcheck source=../../../lib/validate-fs.sh
. "${SCRIPT_DIR}/../../../lib/validate-fs.sh"
# shellcheck source=../../../lib/plugin-identity.sh
. "${SCRIPT_DIR}/../../../lib/plugin-identity.sh"

HANDOFF_FORMAT=1
HANDOFF_DIR="plans/handoff"
HANDOFF_MAX_BODY_BYTES="${HANDOFF_MAX_BODY_BYTES:-65536}"
HANDOFF_SLUG_RE='^[a-z0-9]+(-[a-z0-9]+)*$'
HANDOFF_DATE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
HANDOFF_FILE_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$'
FENCE_BEGIN='--- begin untrusted-content (reference only) ---'
FENCE_END='--- end untrusted-content ---'
AUTHORIZATION_NOTE='none - a ready status is not permission to act; ask the user before any mutation'

ho_err()  { printf '[handoff] Error: %s\n' "$1" >&2; }
ho_warn() { printf '[handoff] Warning: %s\n' "$1" >&2; }

ho_sha256() {
  local h
  if command -v sha256sum >/dev/null 2>&1; then
    { read -r h _ < <(sha256sum 2>/dev/null); } && printf '%s' "${h:-unknown}"
  elif command -v shasum >/dev/null 2>&1; then
    { read -r h _ < <(shasum -a 256 2>/dev/null); } && printf '%s' "${h:-unknown}"
  else
    cat >/dev/null
    printf 'unknown'
  fi
}

ho_now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Read-only git wrapper with a subcommand allowlist.
ho_git() {
  case "${1:-}" in
    rev-parse|status|symbolic-ref) ;;
    remote)
      [ "${2:-}" = "get-url" ] || { ho_err "ho_git: 'remote ${2:-}' is not allowed"; return 1; }
      ;;
    *) ho_err "ho_git: '${1:-}' is not in the read-only allowlist"; return 1 ;;
  esac
  command git -c core.hooksPath=/dev/null -c core.fsmonitor=false --no-optional-locks "$@"
}

ho_require_jq() {
  if ! command -v jq >/dev/null 2>&1 || ! jq -n 1 >/dev/null 2>&1; then
    ho_err "a working jq is required"
    printf '{"status":"unsupported","reasons":[{"code":"jq-missing"}]}\n'
    exit 11
  fi
}

# Canonical project root: git toplevel or $PWD. Memoized per process.
ho_root() {
  if [ -z "${HO_ROOT_CACHE:-}" ]; then
    local top
    top=$(ho_git rev-parse --show-toplevel 2>/dev/null) || top="$PWD"
    HO_ROOT_CACHE=$( cd -- "$top" 2>/dev/null && pwd -P ) || HO_ROOT_CACHE="$PWD"
  fi
  printf '%s' "$HO_ROOT_CACHE"
}

# Whole-string ERE match (grep is line-oriented and would accept "ok\nbad").
ho_matches() { [[ "$1" =~ $2 ]]; }

# One line, no control characters, no shell metacharacters that would let a
# value copied into a command line re-enter the shell.
ho_safe_arg() {
  case "$1" in
    *[[:cntrl:]]*|*'$'*|*'`'*|*'"'*|*"'"*|*'\'*) return 1 ;;
  esac
  return 0
}

# --- measure -----------------------------------------------------------------

ho_measure() {
  local captured_at source_session plugin_version
  local toplevel="" common="" repository_id=unknown worktree_id=unknown worktree_kind=unknown
  local remote_origin=none branch=unknown head=unknown dirty_digest=unknown
  local staged=unknown unstaged=unknown untracked=unknown

  captured_at=$(ho_now_utc)
  source_session="${CLAUDE_CODE_SESSION_ID:-unknown}"
  plugin_version=$(pi_json_version "${CLAUDE_PLUGIN_ROOT:-/nonexistent}/.claude-plugin/plugin.json")

  if toplevel=$(ho_git rev-parse --show-toplevel 2>/dev/null) && [ -n "$toplevel" ]; then
    toplevel=$( cd -- "$toplevel" 2>/dev/null && pwd -P )
    worktree_id="sha256:$(printf '%s' "$toplevel" | ho_sha256)"
    if common=$(ho_git rev-parse --git-common-dir 2>/dev/null) && [ -n "$common" ]; then
      common=$( cd -- "$common" 2>/dev/null && pwd -P ) || common=""
    fi
    if [ -n "$common" ]; then
      repository_id="sha256:$(printf '%s' "$common" | ho_sha256)"
      if [ "$common" = "$toplevel/.git" ]; then worktree_kind=main; else worktree_kind=linked; fi
    else
      ho_warn "git common dir unavailable; repository_id is unknown"
    fi
    if remote_origin=$(ho_git remote get-url origin 2>/dev/null) && [ -n "$remote_origin" ]; then
      remote_origin=$(printf '%s' "$remote_origin" | cs_redact_secrets)
    else
      remote_origin=none
    fi
    branch=$(ho_git symbolic-ref --short -q HEAD 2>/dev/null) || branch=detached
    head=$(ho_git rev-parse HEAD 2>/dev/null) || head=unknown

    # One awk pass over the NUL-separated porcelain stream: emit "XY\tpath"
    # (renames/copies: "XY\tpath\torig"), count staged / unstaged / untracked,
    # and skip handoff notes (and the writer's own temp file) so publishing a
    # note never changes the fingerprint. Counts land on the final line.
    local parsed
    if parsed=$(ho_git status --porcelain=v1 -z --untracked-files=all 2>/dev/null \
        | LC_ALL=C awk -v RS='\0' -v dir="$HANDOFF_DIR/" '
          BEGIN { s = 0; u = 0; t = 0; want_orig = 0; skip = 0 }
          want_orig {
            want_orig = 0
            if (!skip) printf "%s\t%s\n", rec, $0
            skip = 0; next
          }
          {
            xy = substr($0, 1, 2); path = substr($0, 4)
            two = (xy ~ /^[RC]/ || xy ~ /^.[RC]/)
            if (index(path, dir) == 1) { if (two) { want_orig = 1; skip = 1 }; next }
            if (xy == "??") { t++ }
            else {
              if (substr(xy, 1, 1) != " " && substr(xy, 1, 1) != "?") s++
              if (substr(xy, 2, 1) != " " && substr(xy, 2, 1) != "?") u++
            }
            if (two) { want_orig = 1; rec = xy "\t" path; next }
            printf "%s\t%s\n", xy, path
          }
          END { printf "__COUNTS__\t%d\t%d\t%d\n", s, u, t }'); then
      local counts
      counts=$(printf '%s\n' "$parsed" | tail -n 1)
      IFS=$'\t' read -r _ staged unstaged untracked <<< "$counts"
      dirty_digest="sha256:$(printf '%s\n' "$parsed" | sed '$d' | LC_ALL=C sort | ho_sha256)"
    else
      ho_warn "git status failed; dirty_digest is unknown"
    fi
  else
    ho_warn "not inside a git repository; git-derived fields are unknown"
  fi

  case "$worktree_id" in sha256:unknown) worktree_id=unknown ;; esac
  case "$repository_id" in sha256:unknown) repository_id=unknown ;; esac
  case "$dirty_digest" in sha256:unknown) dirty_digest=unknown ;; esac

  jq -nc \
    --arg captured_at "$captured_at" --arg source_session "$source_session" \
    --arg plugin_version "$plugin_version" --arg repository_id "$repository_id" \
    --arg worktree_id "$worktree_id" --arg worktree_kind "$worktree_kind" \
    --arg remote_origin "$remote_origin" --arg branch "$branch" --arg head "$head" \
    --arg dirty_digest "$dirty_digest" \
    --arg staged "$staged" --arg unstaged "$unstaged" --arg untracked "$untracked" \
    '{captured_at: $captured_at, source_session: $source_session, plugin_version: $plugin_version,
      repository_id: $repository_id, worktree_id: $worktree_id, worktree_kind: $worktree_kind,
      remote_origin: $remote_origin, branch: $branch, head: $head, dirty_digest: $dirty_digest,
      dirty_staged: ($staged | tonumber? // "unknown"),
      dirty_unstaged: ($unstaged | tonumber? // "unknown"),
      dirty_untracked: ($untracked | tonumber? // "unknown"),
      context_at_capture: "unknown"}'
}

cmd_measure() { ho_require_jq; ho_measure; }

# --- write -------------------------------------------------------------------

ho_path_exists() { validate_file_path "$1" "$2" && [ -e "$2/$1" ]; }

cmd_write() {
  ho_require_jq
  local slug="" title="" task_ref="none" evidence=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --slug|--title|--task-ref|--evidence)
        [ $# -ge 2 ] || { ho_err "$1 requires a value"; exit 2; } ;;
    esac
    case "$1" in
      --slug) slug="$2"; shift 2 ;;
      --title) title="$2"; shift 2 ;;
      --task-ref)
        [ "$task_ref" = "none" ] || { ho_err "--task-ref may be given once"; exit 2; }
        task_ref="$2"; shift 2 ;;
      --evidence) evidence+=("$2"); shift 2 ;;
      *) ho_err "unknown argument: $1"; exit 2 ;;
    esac
  done
  if ! ho_matches "$slug" "$HANDOFF_SLUG_RE" || [ "${#slug}" -gt 40 ]; then
    ho_err "invalid slug (expected ${HANDOFF_SLUG_RE}, max 40 chars)"; exit 2
  fi
  if [ -z "$title" ] || ! ho_safe_arg "$title" || [ "${#title}" -gt 200 ]; then
    ho_err "--title is required: one line, at most 200 chars, no quotes, backslashes, \$ or backticks"; exit 2
  fi
  title=$(printf '%s' "$title" | cs_redact_secrets) || { ho_err "title redaction failed"; exit 2; }
  local date="${HANDOFF_DATE:-$(date -u +%Y-%m-%d)}"
  ho_matches "$date" "$HANDOFF_DATE_RE" || { ho_err "invalid HANDOFF_DATE"; exit 2; }

  local root
  root=$(ho_root)
  local ref
  if [ "$task_ref" != "none" ]; then
    ho_safe_arg "$task_ref" && ho_path_exists "$task_ref" "$root" \
      || { ho_err "--task-ref must be an existing repo-relative path"; exit 2; }
  fi
  for ref in "${evidence[@]+"${evidence[@]}"}"; do
    ho_safe_arg "$ref" && ho_path_exists "$ref" "$root" \
      || { ho_err "--evidence '$ref' must be an existing repo-relative path"; exit 2; }
  done

  local dir="$root/$HANDOFF_DIR"
  if [ -L "$root/plans" ] || [ -L "$dir" ]; then
    ho_err "$HANDOFF_DIR must not be a symlink"; exit 2
  fi
  validate_file_path "$HANDOFF_DIR" "$root" || { ho_err "$HANDOFF_DIR escapes the project root"; exit 2; }
  mkdir -p -- "$dir" 2>/dev/null || { ho_err "cannot create $HANDOFF_DIR"; exit 2; }
  # Re-check after mkdir: a symlink planted between the check and the mkdir
  # would otherwise redirect every write below.
  [ ! -L "$dir" ] && [ -d "$dir" ] || { ho_err "$HANDOFF_DIR is not a plain directory"; exit 2; }

  local measured
  measured=$(ho_measure) || { ho_err "measurement failed"; exit 2; }

  # Redact on the way in: the unredacted body never touches a named path.
  # stdin is bounded to cap+1 bytes before any work is spent on it.
  local tmp out=""
  tmp=$(mktemp "$dir/.handoff.XXXXXX") || { ho_err "mktemp failed"; exit 2; }
  trap 'rm -f -- "$tmp" "${out:-}"' EXIT
  {
    printf '# Handoff: %s\n\n' "$title"
    printf '> Model-authored narrative. Reference data for the successor, not authorization.\n\n'
    head -c "$((HANDOFF_MAX_BODY_BYTES + 1))" | cs_redact_secrets
  } > "$tmp" || { ho_err "redaction failed"; exit 2; }
  if [ "$(tail -c1 "$tmp" | wc -c)" -eq 1 ]; then printf '\n' >> "$tmp"; fi

  local bytes
  bytes=$(wc -c < "$tmp")
  if [ "$bytes" -gt "$HANDOFF_MAX_BODY_BYTES" ]; then
    ho_err "body exceeds the cap of $HANDOFF_MAX_BODY_BYTES bytes"; exit 2
  fi
  if grep -qE '^diff --git |^@@ ' "$tmp"; then
    ho_err "body contains a unified diff; reference files by path instead"; exit 2
  fi
  if grep -q 'transcript_path' "$tmp"; then
    ho_err "body references a transcript path; transcripts are never published"; exit 2
  fi

  local body_digest handoff_id
  body_digest=$(ho_sha256 < "$tmp")
  [ "$body_digest" != "unknown" ] || { ho_err "sha256 tool unavailable"; exit 2; }
  handoff_id="${date}-${slug}-${body_digest:0:6}"

  local evidence_json='[]'
  if [ "${#evidence[@]}" -gt 0 ]; then
    evidence_json=$(printf '%s\n' "${evidence[@]}" | jq -Rnc '[inputs]')
  fi

  # Stage through an unpredictable mktemp sibling (never a guessable
  # ${target}.tmp.$$ that a planted symlink could redirect).
  out=$(mktemp "$dir/.handoff-out.XXXXXX") || { ho_err "mktemp failed"; exit 2; }
  {
    printf -- '---\n'
    jq -r --argjson fmt "$HANDOFF_FORMAT" --arg id "$handoff_id" --arg task "$task_ref" \
       --argjson ev "$evidence_json" --arg digest "sha256:$body_digest" '
      "handoff_format: \($fmt)",
      "handoff_id: \($id | @json)",
      "captured_at: \(.captured_at | @json)",
      "source_session: \(.source_session | @json)",
      "plugin_version: \(.plugin_version | @json)",
      "repository_id: \(.repository_id | @json)",
      "worktree_id: \(.worktree_id | @json)",
      "worktree_kind: \(.worktree_kind | @json)",
      "remote_origin: \(.remote_origin | @json)",
      "branch: \(.branch | @json)",
      "head: \(.head | @json)",
      "dirty_digest: \(.dirty_digest | @json)",
      "dirty_staged: \(.dirty_staged | tojson)",
      "dirty_unstaged: \(.dirty_unstaged | tojson)",
      "dirty_untracked: \(.dirty_untracked | tojson)",
      "task_ref: \($task | @json)",
      "evidence_refs: \($ev | tojson)",
      "context_at_capture: \(.context_at_capture | tojson)",
      "body_digest: \($digest | @json)"' <<< "$measured"
    printf -- '---\n'
    cat -- "$tmp"
  } > "$out" 2>/dev/null || { ho_err "write failed"; exit 2; }
  if [ -n "${HANDOFF_TEST_SLEEP_BEFORE_MV:-}" ]; then sleep "$HANDOFF_TEST_SLEEP_BEFORE_MV"; fi

  # Publish with a fail-if-exists hard link so a concurrent writer that chose
  # the same name re-enters the suffix loop instead of clobbering the note.
  local name="${date}-${slug}.md" n=1 target
  while :; do
    target="$dir/$name"
    if [ ! -e "$target" ] && [ ! -L "$target" ]; then
      validate_file_path "$HANDOFF_DIR/$name" "$root" || { ho_err "target path rejected"; exit 2; }
      ln -- "$out" "$target" 2>/dev/null && break
    fi
    n=$((n + 1)); name="${date}-${slug}-${n}.md"
    [ "$n" -le 1000 ] || { ho_err "too many collisions for $slug"; exit 2; }
  done
  rm -f -- "$out" "$tmp"; trap - EXIT

  jq -nc --arg path "$HANDOFF_DIR/$name" --arg id "$handoff_id" --arg digest "sha256:$body_digest" \
    '{path: $path, handoff_id: $id, body_digest: $digest}'
  printf '[handoff] wrote %s (%s)\n' "$HANDOFF_DIR/$name" "$handoff_id" >&2
}

# --- read --------------------------------------------------------------------

# Validate a reference; prints the absolute file path on success.
ho_resolve_ref() {
  local ref="${1:-}" root="${2:-}"
  case "$ref" in
    "$HANDOFF_DIR"/*) ;;
    *) return 1 ;;
  esac
  local base="${ref#"$HANDOFF_DIR"/}"
  case "$base" in */*) return 1 ;; esac
  ho_matches "$base" "$HANDOFF_FILE_RE" || ho_matches "$base" '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*-[0-9]+\.md$' || return 1
  validate_file_path "$ref" "$root" || return 1
  local full="$root/$ref"
  [ ! -L "$full" ] && [ -f "$full" ] || return 1
  printf '%s' "$full"
}

ho_front_matter() { awk 'BEGIN{c=0} /^---\r?$/ && c<2 {c++; next} c==1{print} c>=2{exit}' "$1"; }
ho_after_front_matter() { awk 'BEGIN{c=0} /^---\r?$/ && c<2 {c++; next} c>=2{print}' "$1"; }

# Section body under a "## <name>" heading (case-insensitive substring), up to the next heading.
ho_section() {
  local file="$1" needle="$2"
  awk -v n="$needle" '
    BEGIN{p=0}
    /^#{1,6} / { if (p) exit; if (index(tolower($0), tolower(n))) { p=1; next } }
    p {print}' "$file"
}

# Flatten untrusted text to one line, neutralize fence markers, truncate.
ho_scrub() {
  printf '%s' "$1" | tr '\n\r' '  ' | tr -d '\000-\010\013-\037\177' \
    | sed -E 's/--- (begin|end) untrusted-content/[fence-marker]/g; s/[[:space:]]+/ /g; s/^ //; s/ $//' \
    | head -c "${2:-200}"
}

ho_excerpt() {
  printf '%s\n%s\n%s' "$FENCE_BEGIN" "$(ho_scrub "$1" 200)" "$FENCE_END"
}

ho_read_json() {
  local ref="$1"
  local root full
  root=$(ho_root)
  if ! full=$(ho_resolve_ref "$ref" "$root"); then
    jq -nc --arg ref "$ref" '{format: "invalid", reference: $ref, reasons: [{code: "invalid-reference"}]}'
    return 2
  fi

  local first fm
  first=$(head -n 1 -- "$full" | tr -d '\r')
  fm=""
  [ "$first" = "---" ] && fm=$(ho_front_matter "$full")
  local fm_json='{}'
  if [ -n "$fm" ]; then
    fm_json=$(printf '%s\n' "$fm" | tr -d '\r' | jq -Rn '
      [inputs | capture("^(?<k>[a-z_]+): (?<v>.*)$")?]
      | map({key: .k, value: (.v | try fromjson catch .)}) | from_entries' 2>/dev/null) || fm_json='{}'
  fi

  local heading next_action
  heading=$(ho_scrub "$(grep -m1 -E '^# ' -- "$full" | sed 's/^# //')" 200)
  next_action=$(ho_section "$full" "next")
  [ -n "$next_action" ] || next_action=$(grep -v '^[[:space:]]*$' -- "$full" | tail -n 1)
  local status_section complete=false
  status_section=$(ho_section "$full" "workflow status")
  if printf '%s' "$status_section" | grep -qE 'Status:[[:space:]]*COMPLETE|\bCOMPLETE\b'; then complete=true; fi

  local fmt
  fmt=$(printf '%s' "$fm_json" | jq -r '.handoff_format // "legacy"')
  if [ "$fmt" = "legacy" ]; then
    jq -nc --arg ref "$ref" --arg heading "$heading" --arg excerpt "$(ho_excerpt "$next_action")" \
      --argjson complete "$complete" \
      '{format: "legacy", reference: $ref, title: $heading, next_action_excerpt: $excerpt,
        workflow_status_complete: $complete, reasons: [{code: "legacy-note"}]}'
    return 0
  fi
  if ! ho_matches "$fmt" '^[0-9]+$' || [ "$fmt" -gt "$HANDOFF_FORMAT" ]; then
    jq -nc --arg ref "$ref" --arg fmt "$fmt" --argjson reader "$HANDOFF_FORMAT" \
      '{format: "unsupported", reference: $ref, handoff_format: $fmt, reader_format: $reader,
        reasons: [{code: "format-newer-than-reader", expected: ($reader|tostring), actual: $fmt}]}'
    return 0
  fi

  local recomputed digest_ok=false expected
  recomputed="sha256:$(ho_after_front_matter "$full" | ho_sha256)"
  expected=$(printf '%s' "$fm_json" | jq -r '.body_digest // "unknown"')
  [ "$recomputed" = "$expected" ] && digest_ok=true

  jq -nc --arg ref "$ref" --argjson fm "$fm_json" --arg heading "$heading" \
    --arg excerpt "$(ho_excerpt "$next_action")" --argjson digest_ok "$digest_ok" \
    --argjson complete "$complete" '
    {format: "v1", reference: $ref, handoff_id: ($fm.handoff_id // "unknown"), title: $heading,
     measured: ($fm | del(.handoff_format, .handoff_id, .task_ref, .evidence_refs, .body_digest)),
     body_digest_ok: $digest_ok,
     task_ref: (($fm.task_ref // "none") | tostring),
     evidence_refs: (($fm.evidence_refs // []) | if type == "array" then map(tostring) else [] end),
     workflow_status_complete: $complete,
     next_action_excerpt: $excerpt}'
}

cmd_read() {
  ho_require_jq
  local out rc
  out=$(ho_read_json "${1:-}"); rc=$?
  printf '%s\n' "$out"
  [ "$rc" -eq 0 ] || { ho_err "invalid reference: ${1:-}"; exit 2; }
}

# --- preflight ---------------------------------------------------------------

cmd_preflight() {
  ho_require_jq
  local ref="${1:-}"
  local note rc root
  root=$(ho_root)
  note=$(ho_read_json "$ref"); rc=$?
  local plugin
  plugin=$(PI_CHECKOUT_ROOT="$root" pi_report yellow-core)

  if [ "$rc" -ne 0 ]; then
    jq -nc --arg ref "$ref" --argjson plugin "$plugin" --arg auth "$AUTHORIZATION_NOTE" \
      '{preflight_format: 1, reference: $ref, status: "invalid", reasons: [{code: "invalid-reference"}],
        plugin: $plugin, context: "unknown", authorization: $auth}'
    ho_err "invalid reference: $ref (must be an existing regular file under $HANDOFF_DIR/ named <date>-<slug>.md)"
    exit 2
  fi

  local fmt
  fmt=$(printf '%s' "$note" | jq -r '.format')
  if [ "$fmt" != "v1" ]; then
    jq -nc --arg ref "$ref" --argjson note "$note" --argjson plugin "$plugin" --arg auth "$AUTHORIZATION_NOTE" '
      {preflight_format: 1, reference: $ref, status: "unsupported", reasons: $note.reasons,
       note: ($note | del(.reasons)), plugin: $plugin, context: "unknown",
       next_action_excerpt: ($note.next_action_excerpt // ""), authorization: $auth}'
    printf '[handoff] unsupported: %s (%s). Legacy or newer-format notes are readable but cannot be validated; re-capture with this tool to enable preflight.\n' \
      "$ref" "$(printf '%s' "$note" | jq -r '.reasons[0].code')" >&2
    exit 11
  fi

  local live
  live=$(ho_measure) || { ho_err "measurement failed"; exit 2; }

  # Task / evidence existence and completion detection (read-only).
  local task_ref task_missing=false complete=false
  local note_complete
  { IFS= read -r task_ref; IFS= read -r note_complete; } < <(printf '%s' "$note" | jq -r '.task_ref, (.workflow_status_complete | tostring)')
  if [ "$task_ref" != "none" ]; then
    if ! ho_path_exists "$task_ref" "$root"; then
      task_missing=true
    else
      case "$task_ref" in plans/complete/*) complete=true ;; esac
      if [ "$complete" = false ] && [ -f "$root/$task_ref" ]; then
        local unchecked checked
        unchecked=$(grep -cE '^[[:space:]]*- \[ \]' -- "$root/$task_ref" 2>/dev/null || true)
        checked=$(grep -cE '^[[:space:]]*- \[[xX]\]' -- "$root/$task_ref" 2>/dev/null || true)
        if [ "${unchecked:-0}" -eq 0 ] && [ "${checked:-0}" -gt 0 ]; then complete=true; fi
      fi
    fi
  fi
  [ "$note_complete" = "true" ] && complete=true
  local ev missing=()
  while IFS= read -r ev; do
    [ -n "$ev" ] || continue
    ho_path_exists "$ev" "$root" || missing+=("$ev")
  done < <(printf '%s' "$note" | jq -r '.evidence_refs[]?')
  local evidence_missing='[]'
  if [ "${#missing[@]}" -gt 0 ]; then
    evidence_missing=$(printf '%s\n' "${missing[@]}" | jq -Rnc '[inputs]')
  fi

  local result
  result=$(jq -nr --arg ref "$ref" --argjson note "$note" --argjson live "$live" --argjson plugin "$plugin" \
    --arg auth "$AUTHORIZATION_NOTE" --argjson task_missing "$task_missing" --argjson complete "$complete" \
    --argjson evidence_missing "$evidence_missing" --arg session "${CLAUDE_CODE_SESSION_ID:-unknown}" '
    ($note.measured) as $m
    | [
        (if $note.body_digest_ok == false then {code: "modified-after-capture"} else empty end),
        (if ([$m.repository_id, $m.worktree_id, $m.head, $m.dirty_digest, $m.branch,
              $live.repository_id, $live.worktree_id, $live.head, $live.dirty_digest, $live.branch]
             | any(. == "unknown" or . == null))
         then {code: "unverifiable", detail: "a measured identity field is unknown on the note or the live workspace"} else empty end),
        (if $m.repository_id != "unknown" and $live.repository_id != "unknown" and $m.repository_id != $live.repository_id
         then {code: "repository-mismatch"} else empty end),
        (if $m.worktree_id != "unknown" and $live.worktree_id != "unknown" and $m.worktree_id != $live.worktree_id
         then {code: "worktree-mismatch"} else empty end),
        (if $m.branch != "unknown" and $live.branch != "unknown" and $m.branch != $live.branch
         then {code: "branch-mismatch", expected: $m.branch, actual: $live.branch} else empty end),
        (if $m.head != "unknown" and $live.head != "unknown" and $m.head != $live.head
         then {code: "head-moved", expected: $m.head, actual: $live.head} else empty end),
        (if $m.dirty_digest != "unknown" and $live.dirty_digest != "unknown" and $m.dirty_digest != $live.dirty_digest
         then {code: "dirty-changed",
               expected_counts: {staged: $m.dirty_staged, unstaged: $m.dirty_unstaged, untracked: $m.dirty_untracked},
               actual_counts: {staged: $live.dirty_staged, unstaged: $live.dirty_unstaged, untracked: $live.dirty_untracked}}
         else empty end),
        (if $task_missing then {code: "task-ref-missing", path: $note.task_ref} else empty end),
        (if ($evidence_missing | length) > 0 then {code: "evidence-missing", paths: $evidence_missing} else empty end),
        (if $complete then {code: "already-complete", path: $note.task_ref} else empty end),
        (if $m.source_session != "unknown" and $session != "unknown" and $m.source_session != $session
         then {code: "session-differs", informational: true, expected: $m.source_session, actual: $session} else empty end)
      ] as $reasons
    | ($reasons | map(.code)) as $codes
    | (if ($codes | any(. == "unverifiable" or . == "task-ref-missing" or . == "evidence-missing" or . == "already-complete")) then "blocked"
       elif ($codes | any(. == "repository-mismatch" or . == "worktree-mismatch" or . == "branch-mismatch" or . == "head-moved" or . == "dirty-changed" or . == "modified-after-capture")) then "mismatched"
       else "ready" end) as $status
    | {preflight_format: 1, reference: $ref, status: $status, reasons: $reasons,
       measured: $live,
       note: {handoff_format: 1, handoff_id: $note.handoff_id, captured_at: $m.captured_at,
              source_session: $m.source_session, body_digest_ok: $note.body_digest_ok,
              task_ref: $note.task_ref, evidence_refs: $note.evidence_refs},
       plugin: $plugin, context: "unknown",
       next_action_excerpt: $note.next_action_excerpt, authorization: $auth}
    | (tojson), "\(.status)\t\($codes | join(", "))"')
  local json status codes
  json=$(printf '%s\n' "$result" | sed '$d')
  IFS=$'\t' read -r status codes <<< "$(printf '%s\n' "$result" | tail -n 1)"
  printf '%s\n' "$json"
  printf '[handoff] preflight %s for %s%s. %s\n' "$status" "$ref" \
    "${codes:+ (reasons: $codes)}" "Ready means safe to discuss, not permission to act; ask the user before continuing." >&2
  case "$status" in
    ready) exit 0 ;;
    mismatched) exit 10 ;;
    blocked) exit 12 ;;
    *) exit 11 ;;
  esac
}

usage() {
  cat >&2 <<'__EOF_USAGE__'
usage: handoff.sh <subcommand> [args]
  measure                                  measured workspace block as JSON
  write --slug S --title T [--task-ref P] [--evidence P]... < body
                                           publish plans/handoff/<date>-<slug>.md
  read  plans/handoff/<file>.md            parse a note (v1 or legacy) as JSON
  preflight plans/handoff/<file>.md        read-only resume check
exit: 0 ready/ok, 2 usage or invalid reference, 10 mismatched, 11 unsupported, 12 blocked
__EOF_USAGE__
}

main() {
  local cmd="${1:-}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    measure) cmd_measure "$@" ;;
    write) cmd_write "$@" ;;
    read) cmd_read "$@" ;;
    preflight) cmd_preflight "$@" ;;
    -h|--help|help) usage; exit 0 ;;
    *) usage; ho_err "unknown subcommand: '$cmd'"; exit 2 ;;
  esac
}

main "$@"
