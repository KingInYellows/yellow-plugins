#!/bin/bash
# yellow-review: durable review-findings ledger.
#
# Usage: review-ledger.sh <subcommand> [args]   (run `review-ledger.sh help`)
#
# One append-only JSONL file per PR under
#   $(git rev-parse --git-common-dir)/yellow-review/findings/<pr>.jsonl
# shared by every worktree of the clone. Two record types: `observation`
# (one per finding per run) and `transition` (a lifecycle change). Readers
# fold in file order and take the latest transition per finding_id. Design:
# docs/brainstorms/2026-09-23-review-findings-ledger-brainstorm.md and
# plans/review-findings-ledger.md.
#
# Command prose invokes this file as an executable; shell state does not
# survive between a command file's Bash calls. Bats sources it for unit
# coverage (the dispatcher runs only when executed directly).
#
# Exit codes: 0 ok, 2 usage, 3 validation / illegal transition, 4 lock
# timeout, 5 PR closed / tombstoned, 6 unverifiable (object missing,
# shallow repository). Diagnostics go to stderr prefixed `[review-ledger]`.
# A rejected path is never echoed: model-produced paths are untrusted, and
# this output is read by an orchestrator that holds mutation tools.
#
# Untrusted data: every model-authored string (title, suggested_fix,
# scope_claimed, reasons, migration_path) and every anchor-snapshot line is
# redacted before it is written. Paths reach git only after
# rl_validate_path, as their own argv element after `--` or as one
# `<sha>:<path>` argument, and JSON is built only with `jq --arg`.

RL_EXIT_USAGE=2
RL_EXIT_INVALID=3
RL_EXIT_LOCK=4
RL_EXIT_CLOSED=5
RL_EXIT_UNVERIFIABLE=6

RL_SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
RL_VOCAB="${RL_VOCAB:-$RL_SELF_DIR/review-ledger-vocab.json}"
RL_LOCK_WAIT="${RL_LOCK_WAIT:-10}"
RL_CTAGS_TIMEOUT="${RL_CTAGS_TIMEOUT:-2}"
RL_WITHHELD='[withheld: possible credential]'
RL_UNREDACTED='[withheld: redaction unavailable]'
RL_GENERIC_SCOPES=' module file global top-level toplevel unscoped none null '

rl_err() { printf '[review-ledger] %s\n' "$*" >&2; }

rl_die() {
  local code="$1"
  shift
  rl_err "$*"
  exit "$code"
}

# --- small utilities --------------------------------------------------------

rl_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  else
    shasum -a 256 | cut -d' ' -f1
  fi
}

rl_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

rl_new_run_id() {
  local id=''
  if command -v uuidgen >/dev/null 2>&1; then
    id=$(uuidgen 2>/dev/null | tr 'A-F' 'a-f')
  fi
  if [ -z "$id" ] && [ -r /proc/sys/kernel/random/uuid ]; then
    id=$(cat /proc/sys/kernel/random/uuid)
  fi
  if [ -z "$id" ]; then
    id=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
  fi
  printf '%s' "$id"
}

rl_is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

rl_validate_pr() { [[ "$1" =~ ^[1-9][0-9]{0,9}$ ]]; }

# Whitespace-normalize one line: collapse runs, trim both ends.
rl_normalize_line() {
  local s="$1"
  s="${s//$'\t'/ }"
  s="${s//$'\r'/}"
  printf '%s' "$s" | tr -s ' ' | sed -e 's/^ //' -e 's/ $//'
}

rl_hash_line() { printf '%s' "$(rl_normalize_line "$1")" | rl_sha256; }

# Strip C0, DEL and ANSI escape sequences for terminal display (P8).
rl_display_strip() {
  printf '%s' "$1" | sed -E $'s/\x1b\\[[0-9;?]*[ -\\/]*[@-~]//g' | tr -d '\000-\010\013-\037\177' | tr '\n\t' '  '
}

# --- repository and ledger locations ----------------------------------------

rl_repo_root() {
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$top" ] || return 1
  (cd -- "$top" && pwd -P)
}

rl_common_dir() {
  local d
  if d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [ -n "$d" ] && [ "${d#/}" != "$d" ]; then
    (cd -- "$d" && pwd -P)
    return
  fi
  d=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
  (cd -- "$d" && pwd -P)
}

rl_ledger_dir() {
  local c
  c=$(rl_common_dir) || return 1
  printf '%s/yellow-review/findings' "$c"
}

rl_ensure_dir() {
  local d
  d=$(rl_ledger_dir) || return 1
  (umask 077 && mkdir -p -- "$d") || return 1
  chmod 700 -- "$d" "$(dirname -- "$d")" 2>/dev/null || true
  printf '%s' "$d"
}

rl_file_size() { wc -c <"$1" | tr -d ' '; }

rl_is_shallow() { [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; }

rl_have_commit() { git cat-file -e "$1^{commit}" 2>/dev/null; }

# --- locking and atomic writes ----------------------------------------------

# rl_locked <pr> <cmd> [args...]: run <cmd> in a subshell holding an
# exclusive flock on <pr>.lock (never the JSONL itself, whose inode tail
# repair replaces). Exit 4 on timeout.
rl_locked() {
  local pr="$1"
  shift
  local dir
  dir=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  (
    umask 077
    exec 9>>"$dir/$pr.lock" || exit 1
    flock -w "$RL_LOCK_WAIT" 9 || {
      rl_err "lock timeout for PR #$pr"
      exit "$RL_EXIT_LOCK"
    }
    "$@"
  )
}

# Replace <path> with <content> via a sibling temp file and rename.
rl_atomic_write() {
  local path="$1" content="$2" tmp
  tmp="$path.tmp.$$"
  (umask 077 && printf '%s' "$content" >|"$tmp") || {
    rm -f -- "${tmp:?}"
    return 1
  }
  mv -f -- "$tmp" "$path" || {
    rm -f -- "${tmp:?}"
    return 1
  }
}

# Append one JSON record as a single printf (P5). Caller holds the lock.
rl_append() {
  local file="$1" line="$2"
  case "$line" in
    *$'\n'*) rl_err "refusing multi-line record"; return 1 ;;
  esac
  (umask 077 && printf '%s\n' "$line" >>"$file")
}

# Tail repair, under the lock, before any append or fold. A final record
# missing only its newline gets it; an unparseable tail is quarantined to
# <file>.corrupt-<ts> and the file truncated to its last newline.
rl_repair_tail() {
  local file="$1" size last taillen keep tmp ts
  [ -s "$file" ] || return 0
  last=$(tail -c 1 -- "$file" | od -An -tx1 | tr -d ' \n')
  [ "$last" = "0a" ] && return 0
  size=$(rl_file_size "$file")
  taillen=$(tail -n 1 -- "$file" | wc -c | tr -d ' ')
  if tail -n 1 -- "$file" | jq -se 'length == 1 and (.[0] | type) == "object"' >/dev/null 2>&1; then
    printf '\n' >>"$file"
    return 0
  fi
  keep=$((size - taillen))
  ts=$(date -u +%Y%m%dT%H%M%SZ).$$
  tmp="$file.tmp.$$"
  (umask 077 && tail -n 1 -- "$file" >|"$file.corrupt-$ts") || return 1
  (umask 077 && head -c "$keep" -- "$file" >|"$tmp") || {
    rm -f -- "${tmp:?}"
    return 1
  }
  mv -f -- "$tmp" "$file" || return 1
  rl_err "quarantined an unparseable ledger tail ($taillen bytes)"
}

# --- PR state ---------------------------------------------------------------

# Prints OPEN|MERGED|CLOSED, or fails. fd 9 (the lock) is closed for gh.
rl_gh_state() {
  local pr="$1" out st
  command -v gh >/dev/null 2>&1 || return 1
  out=$(gh pr view "$pr" --json state 9>&- 2>/dev/null) || return 1
  st=$(printf '%s' "$out" | jq -r '.state // empty' 2>/dev/null) || return 1
  case "$st" in
    OPEN | MERGED | CLOSED) printf '%s' "$st" ;;
    *) return 1 ;;
  esac
}

rl_write_state() {
  local dir="$1" pr="$2" st="$3"
  rl_atomic_write "$dir/$pr.state" "$st $(date -u +%s)"$'\n'
}

# Writer preamble, under the lock: honour the tombstone and the live state.
# A reopened PR drops its tombstone and starts a fresh ledger; a closed or
# merged PR refuses the write (exit 5). If gh is unavailable and there is
# no tombstone the write proceeds: losing findings is the failure this
# ledger exists to prevent.
rl_writer_gate() {
  local dir="$1" pr="$2" st=''
  st=$(rl_gh_state "$pr") || st=''
  if [ -e "$dir/$pr.closed" ]; then
    if [ "$st" = "OPEN" ]; then
      rm -f -- "${dir:?}/${pr:?}.closed"
      rl_err "PR #$pr was reopened; starting a fresh ledger"
    else
      rl_err "PR #$pr is tombstoned (closed or merged); refusing to write"
      return "$RL_EXIT_CLOSED"
    fi
  fi
  case "$st" in
    MERGED | CLOSED)
      rl_write_state "$dir" "$pr" "$st"
      rl_err "PR #$pr is $st; refusing to write"
      return "$RL_EXIT_CLOSED"
      ;;
    OPEN) rl_write_state "$dir" "$pr" "$st" ;;
    *) rl_err "could not confirm PR #$pr state; writing anyway" ;;
  esac
  return 0
}

# --- redaction (P3) ---------------------------------------------------------

# Locate yellow-core's compound-staging.sh. RL_CORE_LIB, when set, is the
# only candidate (tests use it to simulate a missing dependency). Otherwise:
# the repository layout (plugins/<name>/ siblings), then the installed cache
# layout (cache/<marketplace>/<plugin>/<version>/), newest version first —
# `${CLAUDE_PLUGIN_ROOT}/../yellow-core` alone never resolves in the cache.
rl_core_lib_path() {
  local root cand ver
  if [ -n "${RL_CORE_LIB+x}" ]; then
    [ -f "$RL_CORE_LIB" ] && printf '%s' "$RL_CORE_LIB"
    return
  fi
  root="${CLAUDE_PLUGIN_ROOT:-$RL_SELF_DIR/..}"
  cand="$root/../yellow-core/lib/compound-staging.sh"
  if [ -f "$cand" ]; then
    printf '%s' "$cand"
    return
  fi
  if [ -d "$root/../../yellow-core" ]; then
    ver=$(for cand in "$root/../../yellow-core"/*/; do
      cand=$(basename -- "$cand")
      [[ "$cand" =~ ^[0-9]+(\.[0-9]+)*$ ]] && printf '%s\n' "$cand"
    done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
    cand="$root/../../yellow-core/$ver/lib/compound-staging.sh"
    if [ -n "$ver" ] && [ -f "$cand" ]; then
      printf '%s' "$cand"
    fi
  fi
}

RL_CORE_STATE=''
rl_load_core() {
  local lib
  [ -n "$RL_CORE_STATE" ] && { [ "$RL_CORE_STATE" = ok ]; return; }
  RL_CORE_STATE=missing
  lib=$(rl_core_lib_path)
  if [ -n "$lib" ]; then
    # shellcheck disable=SC1090
    . "$lib" 2>/dev/null
  fi
  if command -v cs_redact_secrets >/dev/null 2>&1; then
    RL_CORE_STATE=ok
  else
    rl_err "yellow-core compound-staging.sh not found; withholding all model-authored text"
  fi
  [ "$RL_CORE_STATE" = ok ]
}

# Fail-closed pass: env-style credential assignments and long mixed-case
# high-entropy tokens that cs_redact_secrets does not know. Already-redacted
# markers are removed first so `API_KEY=[REDACTED]` does not trip it.
rl_suspicious() {
  local probe
  probe=$(printf '%s' "$1" | sed -E 's/\[REDACTED[^]]*\]//g')
  if printf '%s\n' "$probe" | grep -Eq '(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_ID|_PASSWORD)[[:space:]]*[=:][[:space:]]*[^[:space:]]'; then
    return 0
  fi
  printf '%s\n' "$probe" | grep -Eo '[A-Za-z0-9+/_=-]{32,}' | while IFS= read -r tok; do
    if [[ "$tok" =~ [a-z] && "$tok" =~ [A-Z] && "$tok" =~ [0-9] ]]; then
      echo hit
      break
    fi
  done | grep -q hit
}

# Redact one model-authored string. Prints the text to store.
rl_redact() {
  local s="$1" out
  [ -z "$s" ] && return 0
  rl_load_core || {
    printf '%s' "$RL_UNREDACTED"
    return 0
  }
  if ! out=$(printf '%s' "$s" | cs_redact_secrets 2>/dev/null) || [[ "$out" == *'[REDACTED: sanitization failed]'* ]]; then
    printf '%s' "$RL_WITHHELD"
    return 0
  fi
  if rl_suspicious "$out"; then
    printf '%s' "$RL_WITHHELD"
    return 0
  fi
  printf '%s' "$out"
}

# Anchor snapshot lines are stored only when redaction leaves them
# byte-identical and the fail-closed pass finds nothing; otherwise only
# the hash and line hint are kept (anchor_withheld). Returns 0 if safe.
rl_anchor_safe() {
  local s="$1" out
  rl_load_core || return 1
  out=$(printf '%s\n' "$s" | cs_redact_secrets 2>/dev/null) || return 1
  [ "$out" = "$s" ] || return 1
  ! rl_suspicious "$s"
}

# --- category and rule vocabulary -------------------------------------------

rl_normalize_category() {
  local raw
  raw=$(printf '%s' "$1" | tr 'A-Z_ ' 'a-z--' | sed -e 's/^-*//' -e 's/-*$//')
  jq -r --arg c "$raw" '
    if .categories[$c] then $c
    elif .category_aliases[$c] then .category_aliases[$c]
    else "" end' "$RL_VOCAB"
}

rl_validate_rule() {
  local cat="$1" rule="$2"
  jq -r --arg c "$cat" --arg r "$rule" '
    if ((.categories[$c] // []) | index($r)) != null then $r else "unclassified" end' "$RL_VOCAB"
}

# --- path validation (CLAUDE-44, 45, 47) -------------------------------------

# Lexical rules shared by every mode. Prints a reason token and fails.
rl_path_lexical() {
  local p="$1" seg rest
  local LC_ALL=C
  [ -n "$p" ] || { printf 'empty'; return 1; }
  [ "${#p}" -le 4096 ] || { printf 'too-long'; return 1; }
  if [[ "$p" == *[[:cntrl:]]* ]]; then
    printf 'control-char'
    return 1
  fi
  if [ "$(printf '%s' "$p" | jq -Rj . 2>/dev/null)" != "$p" ]; then
    printf 'invalid-utf8'
    return 1
  fi
  case "$p" in
    /*) printf 'absolute'; return 1 ;;
    -*) printf 'leading-dash'; return 1 ;;
    */) printf 'bad-segment'; return 1 ;;
  esac
  rest="$p"
  while :; do
    seg="${rest%%/*}"
    case "$seg" in
      '' | . | ..) printf 'bad-segment'; return 1 ;;
    esac
    [ "$seg" = "$rest" ] && break
    rest="${rest#*/}"
  done
  return 0
}

# Look <path> up in <rev>'s tree, NUL-safe and literal. Prints
# "<mode> <oid>" for an exact match; fails when absent.
rl_tree_entry() {
  local rev="$1" p="$2" rec meta rpath
  while IFS= read -r -d '' rec; do
    meta="${rec%%$'\t'*}"
    rpath="${rec#*$'\t'}"
    if [ "$rpath" = "$p" ]; then
      printf '%s %s' "${meta%% *}" "${meta##* }"
      return 0
    fi
  done < <(git --literal-pathspecs ls-tree -z --full-tree "$rev" -- "$p" 2>/dev/null)
  return 1
}

rl_regular_mode() { [ "$1" = 100644 ] || [ "$1" = 100755 ]; }

# Inside <root> after canonicalization.
rl_inside_root() {
  local root="$1" target="$2" real
  real=$(realpath -e -- "$target" 2>/dev/null) || return 1
  case "$real" in
    "$root" | "$root"/*) return 0 ;;
  esac
  return 1
}

# The checked-out entry: a regular file, not a symlink, inside the root.
rl_worktree_entry_ok() {
  local root="$1" p="$2"
  [ -f "$root/$p" ] && [ ! -L "$root/$p" ] && rl_inside_root "$root" "$root/$p"
}

# rl_validate_path <mode> <rev> <path> [<base-rev>]
#   anchor     — exists at <rev> with a regular mode; when absent and a
#                <base-rev> is given, may exist at the base instead (the
#                primary anchor of a deletion finding).
#   dependency — exists at <rev> only, regular mode.
#   restore    — <rev> is the base: the source exists there with a regular
#                mode, the destination does not exist and is not a symlink,
#                and the nearest existing ancestor directory is inside the
#                repository root.
# Success prints "<mode> <oid> head|base". Failure prints a reason token
# and returns 3, or 6 when <rev> itself is not in the object store.
rl_validate_path() {
  local mode="$1" rev="$2" p="$3" base="${4:-}" reason entry root anc
  case "$mode" in
    anchor | dependency | restore) ;;
    *) printf 'bad-mode-arg'; return "$RL_EXIT_USAGE" ;;
  esac
  reason=$(rl_path_lexical "$p") || { printf '%s' "$reason"; return "$RL_EXIT_INVALID"; }
  rl_have_commit "$rev" || { printf 'unverifiable'; return "$RL_EXIT_UNVERIFIABLE"; }
  if entry=$(rl_tree_entry "$rev" "$p"); then
    rl_regular_mode "${entry%% *}" || { printf 'not-regular-file'; return "$RL_EXIT_INVALID"; }
    if [ "$mode" = restore ]; then
      root=$(rl_repo_root) || { printf 'no-repo'; return "$RL_EXIT_INVALID"; }
      if [ -e "$root/$p" ] || [ -L "$root/$p" ]; then
        printf 'destination-exists'
        return "$RL_EXIT_INVALID"
      fi
      anc=$(dirname -- "$root/$p")
      while [ ! -e "$anc" ] && [ ! -L "$anc" ]; do anc=$(dirname -- "$anc"); done
      if [ -L "$anc" ] || [ ! -d "$anc" ] || ! rl_inside_root "$root" "$anc"; then
        printf 'outside-root'
        return "$RL_EXIT_INVALID"
      fi
    fi
    printf '%s head' "$entry"
    return 0
  fi
  if [ "$mode" = anchor ] && [ -n "$base" ]; then
    rl_have_commit "$base" || { printf 'unverifiable'; return "$RL_EXIT_UNVERIFIABLE"; }
    if entry=$(rl_tree_entry "$base" "$p"); then
      rl_regular_mode "${entry%% *}" || { printf 'not-regular-file'; return "$RL_EXIT_INVALID"; }
      printf '%s base' "$entry"
      return 0
    fi
  fi
  printf 'not-found'
  return "$RL_EXIT_INVALID"
}

# --- per-invocation scratch -------------------------------------------------

RL_TMP=''
# Call once in the parent shell (rl_main does) before any `$(rl_tmp)`.
rl_tmp() {
  if [ -z "$RL_TMP" ]; then
    RL_TMP=$(mktemp -d "${TMPDIR:-/tmp}/review-ledger.XXXXXX") || rl_die 1 "mktemp failed"
  fi
  printf '%s' "$RL_TMP"
}
rl_cleanup() { [ -n "$RL_TMP" ] && rm -rf -- "${RL_TMP:?}"; }

# Materialize a blob into the scratch dir (cached by oid). Prints the path.
rl_blob_file() {
  local oid="$1" f
  f="$(rl_tmp)/blob-$oid"
  if [ ! -f "$f" ]; then
    git cat-file blob "$oid" >|"$f" 2>/dev/null || { rm -f -- "${f:?}"; return 1; }
  fi
  printf '%s' "$f"
}

rl_line_count() { awk 'END { print NR }' "$1"; }
rl_line_at() { awk -v n="$2" 'NR == n { print; exit }' "$1"; }

# awk normalization identical to rl_normalize_line.
RL_AWK_NORM='function norm(s) { gsub(/\t/, " ", s); gsub(/\r/, "", s); gsub(/ +/, " ", s); sub(/^ /, "", s); sub(/ $/, "", s); return s }'

# Bigram Dice similarity of two normalized strings, 0..1.
rl_similarity() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    if (a == b) { print 1; exit }
    na = length(a) - 1; nb = length(b) - 1
    if (na < 1 || nb < 1) { print 0; exit }
    for (i = 1; i <= na; i++) ca[substr(a, i, 2)]++
    m = 0
    for (i = 1; i <= nb; i++) { g = substr(b, i, 2); if (ca[g] > 0) { ca[g]--; m++ } }
    printf "%.4f\n", (2 * m) / (na + nb)
  }'
}

# --- line mapping (CLAUDE-46, 48) -------------------------------------------

RL_DIFF_FLAGS=(--no-color --no-ext-diff --no-textconv --no-relative --src-prefix=a/ --dst-prefix=b/ --diff-algorithm=myers)

# Where did <path> go between two commits? Prints "M|D|R|U<TAB><newpath>"
# (U = untouched). Cached per commit pair.
rl_path_fate() {
  local from="$1" to="$2" p="$3" cache st a b
  cache="$(rl_tmp)/fate-$from-$to"
  if [ ! -f "$cache" ]; then
    git diff "${RL_DIFF_FLAGS[@]}" --find-renames=50% --name-status -z "$from" "$to" >|"$cache" 2>/dev/null || {
      rm -f -- "${cache:?}"
      return 1
    }
  fi
  while IFS= read -r -d '' st; do
    case "$st" in
      R* | C*)
        IFS= read -r -d '' a
        IFS= read -r -d '' b
        if [ "$a" = "$p" ] && [ "${st:0:1}" = R ]; then
          printf 'R\t%s' "$b"
          return 0
        fi
        ;;
      *)
        IFS= read -r -d '' a
        if [ "$a" = "$p" ]; then
          printf '%s\t%s' "${st:0:1}" "$p"
          return 0
        fi
        ;;
    esac
  done <"$cache"
  printf 'U\t%s' "$p"
}

# rl_map_line <from> <to> <path> <line>
# Prints "<result> <line> <path>"; result is exact | shifted | anchored |
# unmapped | deleted | unverifiable. `anchored` means the line itself was
# changed; the line printed is where its hunk now starts.
rl_map_line() {
  local from="$1" to="$2" p="$3" L="$4" fate kind np out
  if ! rl_have_commit "$from" || ! rl_have_commit "$to"; then
    printf 'unverifiable 0 %s' "$p"
    return 0
  fi
  if [ "$(git rev-parse "$from^{commit}")" = "$(git rev-parse "$to^{commit}")" ]; then
    printf 'exact %s %s' "$L" "$p"
    return 0
  fi
  fate=$(rl_path_fate "$from" "$to" "$p") || { printf 'unverifiable 0 %s' "$p"; return 0; }
  kind="${fate%%$'\t'*}"
  np="${fate#*$'\t'}"
  case "$kind" in
    U) printf 'exact %s %s' "$L" "$p"; return 0 ;;
    D) printf 'deleted 0 %s' "$p"; return 0 ;;
    M | R | T) ;;
    *) printf 'unmapped 0 %s' "$p"; return 0 ;;
  esac
  out=$(git diff "${RL_DIFF_FLAGS[@]}" -U0 "$from:$p" "$to:$np" 2>/dev/null) || { printf 'unmapped 0 %s' "$np"; return 0; }
  if printf '%s\n' "$out" | grep -q '^Binary files '; then
    printf 'unmapped 0 %s' "$np"
    return 0
  fi
  printf '%s\n' "$out" | awk -v L="$L" -v np="$np" '
    /^@@ / {
      if (done) next
      h = $0; sub(/^@@ -/, "", h)
      sp = index(h, " "); o = substr(h, 1, sp - 1); h = substr(h, sp + 2)
      sp = index(h, " "); q = substr(h, 1, sp - 1)
      n = split(o, oa, ","); a = oa[1] + 0; b = (n > 1) ? oa[2] + 0 : 1
      n = split(q, qa, ","); c = qa[1] + 0; d = (n > 1) ? qa[2] + 0 : 1
      if (b == 0) {
        if (L <= a) { done = 1; res = L + delta }
      } else if (L < a) {
        done = 1; res = L + delta
      } else if (L <= a + b - 1) {
        done = 1; anchored = 1; res = (c < 1) ? 1 : c
      }
      delta += d - b
    }
    END {
      if (!done) res = L + delta
      kind = anchored ? "anchored" : (res == L ? "exact" : "shifted")
      printf "%s %d %s", kind, res, np
    }'
}

# --- scope verification (CLAUDE-49, P12) ------------------------------------

# Markdown: walk the heading stack (skipping fenced code) up to line L.
# Prints "<path>\t<innermost>\t<start>\t<end>\t<innermost-count>", where
# path joins headings with " > " and end is the line before the next
# heading of the same or a higher level.
rl_md_heading_path() {
  awk -v L="$2" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /^[ \t]*(```+|~~~+)/ {
      line = $0; sub(/^[ \t]*/, "", line)
      ch = substr(line, 1, 1); n = 0
      while (substr(line, n + 1, 1) == ch) n++
      if (!fence) { fence = 1; fchar = ch; flen = n }
      else if (ch == fchar && n >= flen) fence = 0
      next
    }
    fence { next }
    /^#{1,6}[ \t]/ {
      lvl = match($0, /[^#]/) - 1
      text = substr($0, lvl + 1); sub(/[ \t]#+[ \t]*$/, "", text); text = trim(text)
      seen[text]++
      if (NR <= L) {
        stack[lvl] = text; sline[lvl] = NR
        for (k = lvl + 1; k <= 6; k++) { delete stack[k]; delete sline[k] }
        inner = lvl
      } else if (!closed && inner > 0 && lvl <= inner) {
        closed = 1; endline = NR - 1
      }
    }
    END {
      if (inner == 0) exit 1
      path = ""
      for (k = 1; k <= 6; k++) if (k in stack) path = (path == "" ? stack[k] : path " > " stack[k])
      if (!closed) endline = NR
      printf "%s\t%s\t%d\t%d\t%d\n", path, stack[inner], sline[inner], endline, seen[stack[inner]]
    }' "$1"
}

rl_ctags_usable() {
  command -v ctags >/dev/null 2>&1 || return 1
  command -v timeout >/dev/null 2>&1 || return 1
  ctags --version 2>/dev/null | grep -q 'Universal Ctags' || return 1
  ctags --list-fields 2>/dev/null | grep -Eq '^e[[:space:]]+end'
}

# Code: universal-ctags on the blob (cached per content file + basename,
# since the filename is parser-relevant to ctags). A claim is
# accepted when every dotted segment is a tag containing the anchor line:
# by [line, end] when ctags reports `end` (Go, Python), otherwise from the
# tag line to the next sibling tag. Prints "<full>\t<start>\t<end>".
rl_ctags_scope() {
  local content="$1" path="$2" L="$3" claim="$4" dir tags base
  rl_ctags_usable || return 1
  base=$(basename -- "$path")
  dir="$content.ctags/$base"
  tags="$dir/tags.json"
  if [ ! -f "$tags" ]; then
    mkdir -p -- "$dir" || return 1
    cp -- "$content" "$dir/$base" || return 1
    (cd -- "$dir" && timeout "$RL_CTAGS_TIMEOUT" ctags --options=NONE --fields=+neKZ --output-format=json -o - -- "$base") >|"$tags" 2>/dev/null || {
      : >|"$tags"
      return 1
    }
  fi
  [ -s "$tags" ] || return 1
  jq -rs --argjson L "$L" --arg claim "$claim" '
    map(select(._type == "tag") | . + {full: (if (.scope // "") != "" then .scope + "." + .name else .name end)}) as $t
    | def span($x): ($x.end // ([ $t[] | select((.scope // "") == ($x.scope // "") and .line > $x.line) | .line ] | min | if . == null then 1e9 else . - 1 end));
      def holds($x): $x.line <= $L and $L <= span($x);
    ( if ($claim | contains(".")) then [ $t[] | select(.full == $claim) ]
      else [ $t[] | select(.name == $claim) ] as $c | if ($c | length) == 1 then $c else [] end end )
    | map(select(holds(.)))
    | map(. as $c | select(
        [ range(1; ($c.full | split(".") | length)) as $i
          | ($c.full | split(".") | .[0:$i] | join(".")) as $pre
          | any($t[]; .full == $pre and holds(.)) ] | all))
    | first // empty
    | "\(.full)\t\(.line)\t\(span(.) | if . >= 1e9 then 0 else . end)"' "$tags" 2>/dev/null | grep . || return 1
}

# rl_verify_scope <content-file> <path> <line> <claimed>
# Prints "verified\t<scope>\t<start>\t<end>" or "unscoped". <end> of 0
# means "to end of file".
rl_verify_scope() {
  local content="$1" path="$2" L="$3" claim="$4" md mpath inner start end count r
  claim=$(printf '%s' "$claim" | sed -E -e 's/^[#[:space:]]+//' -e 's/[[:space:]]+$//')
  if [ -z "$claim" ] || [[ "$RL_GENERIC_SCOPES" == *" $(printf '%s' "$claim" | tr 'A-Z' 'a-z') "* ]]; then
    printf 'unscoped'
    return 0
  fi
  case "$path" in
    *.md | *.mdx | *.MD | *.markdown)
      md=$(rl_md_heading_path "$content" "$L") || { printf 'unscoped'; return 0; }
      IFS=$'\t' read -r mpath inner start end count <<<"$md"
      if [ "$claim" = "$mpath" ] || { [ "$claim" = "$inner" ] && [ "$count" = 1 ]; }; then
        printf 'verified\t%s\t%s\t%s' "$mpath" "$start" "$end"
      else
        printf 'unscoped'
      fi
      return 0
      ;;
  esac
  claim=$(printf '%s' "$claim" | sed -E -e 's/::|#/./g' -e 's/\(\)$//' -e 's/[[:space:]]+//g')
  if r=$(rl_ctags_scope "$content" "$path" "$L" "$claim"); then
    printf 'verified\t%s' "$r"
  else
    printf 'unscoped'
  fi
}

# Occurrence of the anchor among identical normalized lines inside
# [start, end] (end 0 = EOF). Prints "k/n" when n > 1, nothing otherwise.
rl_occurrence() {
  awk -v L="$2" -v s="$3" -v e="$4" "$RL_AWK_NORM"'
    { line[NR] = norm($0) }
    END {
      if (e == 0 || e > NR) e = NR
      t = line[L]; n = 0; k = 0
      for (i = s; i <= e; i++) if (line[i] == t) { n++; if (i == L) k = n }
      if (n > 1 && k > 0) printf "%d/%d", k, n
    }' "$1"
}

# --- fold -------------------------------------------------------------------

# Fold in file (append) order, never by `at`. Unparseable lines and records
# with an unknown `v` are skipped and counted.
RL_FOLD_JQ='
  split("\n") | map(select(length > 0) | (try fromjson catch "bad"))
  | reduce .[] as $r ({skipped: 0, ids: [], obs: {}, first: {}, fps: {}, st: {}};
      if ($r | type) != "object" or $r.v != 1 then .skipped += 1
      elif $r.type == "observation" and ($r.finding_id | type) == "string" then
        (if .obs[$r.finding_id] == null and .st[$r.finding_id] == null then .ids += [$r.finding_id] else . end)
        | .obs[$r.finding_id] = $r
        | .first[$r.finding_id] = (.first[$r.finding_id] // $r.at)
        | .fps[$r.finding_id] = ((.fps[$r.finding_id] // []) + [$r.fingerprint] | unique)
      elif $r.type == "transition" and ($r.finding_id | type) == "string" then
        (.st[$r.finding_id] // {}) as $p
        | .st[$r.finding_id] = {
            state: $r.state, reason: $r.reason, actor: $r.actor, at: $r.at,
            head_sha: $r.head_sha,
            fix_sha: ($r.fix_sha // $p.fix_sha),
            published_head_sha: ($r.published_head_sha // $p.published_head_sha),
            proof: ($r.proof // $p.proof),
            depends_on: (if $r.state == "dismissed" then ($r.depends_on // []) else $p.depends_on end)
          }
      else .skipped += 1 end)
  | . as $f
  | [ $f.ids[] | select($f.obs[.] != null and $f.st[.] != null) as $id
      | {finding_id: $id, first_seen: $f.first[$id], fingerprints: $f.fps[$id], obs: $f.obs[$id]} + $f.st[$id] ] as $findings
  | {
      pending: ([ $findings[] | select(.state == "open" or .state == "reopened" or .state == "applied") ] | length),
      attention: ([ $findings[] | select(.state == "report_only" or .state == "stale") ] | length),
      by_state: (reduce $findings[] as $x ({}; .[$x.state] += 1)),
      category_split: ([ $findings[] | {k: "\(.obs.file)\u0000\(.obs.anchor_hash)", c: .obs.category} ]
                       | group_by(.k) | map(select((map(.c) | unique | length) > 1)) | length),
      skipped: $f.skipped,
      findings: $findings
    }'

rl_fold_file() {
  local file="$1"
  if [ ! -s "$file" ]; then
    printf '%s' '{"pending":0,"attention":0,"by_state":{},"category_split":0,"skipped":0,"findings":[]}'
    return 0
  fi
  jq -R -s -c "$RL_FOLD_JQ" "$file"
}

# Refresh <pr>.pending from a fold. Caller holds the lock.
rl_refresh_sidecar() {
  local dir="$1" pr="$2" fold="$3" f bytes
  f="$dir/$pr.jsonl"
  bytes=0
  [ -f "$f" ] && bytes=$(rl_file_size "$f")
  rl_atomic_write "$dir/$pr.pending" "$(printf '%s' "$fold" | jq -r '"\(.pending) \(.attention)"') $bytes"$'\n'
}

# --- transitions ------------------------------------------------------------

rl_edge_ok() {
  local from="$1" to="$2"
  case "$from:$to" in
    open:applied | open:dismissed | open:stale) return 0 ;;
    reopened:applied | reopened:dismissed | reopened:stale) return 0 ;;
    report_only:applied | report_only:dismissed | report_only:stale) return 0 ;;
    applied:applied | applied:fixed | applied:reopened) return 0 ;;
    stale:dismissed | stale:reopened) return 0 ;;
    fixed:reopened | dismissed:reopened) return 0 ;;
  esac
  return 1
}

# Build one transition record. Args: id state reason head actor fix pub proof deps-json
rl_transition_record() {
  jq -cn --arg id "$1" --arg state "$2" --arg reason "$3" --arg head "$4" --arg actor "$5" \
    --arg fix "$6" --arg pub "$7" --arg proof "$8" --argjson deps "${9:-null}" --arg at "$(rl_now)" '
    {v: 1, type: "transition", finding_id: $id, state: $state,
     reason: (if $reason == "" then null else $reason end),
     head_sha: (if $head == "" then null else $head end), at: $at, actor: $actor,
     fix_sha: (if $fix == "" then null else $fix end),
     published_head_sha: (if $pub == "" then null else $pub end),
     proof: (if $proof == "" then null else $proof end),
     depends_on: $deps}'
}

rl_redact_reason() {
  local r
  r=$(rl_redact "$1")
  printf '%s' "${r:0:500}"
}

# --- re-verification (CLAUDE-48; brainstorm Open Question 2) ----------------

# Lines at <T> that belong to sibling findings (same file and anchor hash)
# whose own line maps unchanged; the window search must not claim them.
rl_sibling_lines() {
  local fold="$1" id="$2" T="$3" rows shead sline sfile res ln np
  rows=$(printf '%s' "$fold" | jq -r --arg id "$id" '
    (.findings[] | select(.finding_id == $id) | .obs) as $o
    | .findings[] | select(.finding_id != $id and .obs.file == $o.file and .obs.anchor_hash == $o.anchor_hash
        and (.state | IN("open", "reopened", "applied", "report_only")) and (.obs.deletion | not))
    | .finding_id + "\t" + .obs.head_sha + "\t" + (.obs.line | tostring)' 2>/dev/null)
  [ -n "$rows" ] || return 0
  sfile=$(printf '%s' "$fold" | jq -r --arg id "$id" '.findings[] | select(.finding_id == $id) | .obs.file')
  while IFS=$'\t' read -r _ shead sline; do
    read -r res ln np <<<"$(rl_map_line "$shead" "$T" "$sfile" "$sline")"
    case "$res" in exact | shifted) printf '%s\n' "$ln" ;; esac
  done <<<"$rows"
}

# Search <content> for the anchor hash in [c-r, c+r], skipping excluded
# lines. Prints the hit line.
rl_window_hash() {
  local content="$1" c="$2" r="$3" hash="$4" excl="$5" i n lo hi
  n=$(rl_line_count "$content")
  lo=$((c - r)); [ "$lo" -lt 1 ] && lo=1
  hi=$((c + r)); [ "$hi" -gt "$n" ] && hi=$n
  for ((i = lo; i <= hi; i++)); do
    if [ -n "$excl" ] && printf '%s\n' "$excl" | grep -qx "$i"; then continue; fi
    if [ "$(rl_hash_line "$(rl_line_at "$content" "$i")")" = "$hash" ]; then
      printf '%s' "$i"
      return 0
    fi
  done
  return 1
}

# Nearest line in [c-40, c+40] whose similarity to <text> is >= 0.8.
rl_window_alias() {
  local content="$1" c="$2" text="$3" excl="$4"
  awk -v c="$c" -v t="$text" -v excl="$excl" "$RL_AWK_NORM"'
    function sim(a, b,   na, nb, i, m, g, ca) {
      if (a == b) return 1
      na = length(a) - 1; nb = length(b) - 1
      if (na < 1 || nb < 1) return 0
      for (i = 1; i <= na; i++) ca[substr(a, i, 2)]++
      m = 0
      for (i = 1; i <= nb; i++) { g = substr(b, i, 2); if (ca[g] > 0) { ca[g]--; m++ } }
      return (2 * m) / (na + nb)
    }
    BEGIN { n = split(excl, xs, "\n"); for (i = 1; i <= n; i++) skip[xs[i]] = 1; best = -1 }
    NR >= c - 40 && NR <= c + 40 && !(NR in skip) {
      if (sim(norm($0), t) >= 0.8) { d = NR - c; if (d < 0) d = -d; if (best < 0 || d < bestd) { best = NR; bestd = d } }
    }
    END { if (best > 0) print best; else exit 1 }' "$content"
}

# rl_reverify_finding <fold-json> <finding_id> <target-head> [strict]
# Prints reproduced | not_reproduced | unverifiable. `strict` disables the
# alias search; it is implied for `applied` findings, whose anchor line is
# expected to change (that is the fix) and would otherwise alias-match it.
rl_reverify_finding() {
  local fold="$1" id="$2" T="$3" strict="${4:-}" f res ln np entry content excl hit
  f=$(printf '%s' "$fold" | jq -c --arg id "$id" '.findings[] | select(.finding_id == $id)')
  [ -n "$f" ] || { printf 'unverifiable'; return 0; }
  local file line head hash occ deletion source state scope scope_status alines
  file=$(jq -r '.obs.file' <<<"$f")
  line=$(jq -r '.obs.line' <<<"$f")
  head=$(jq -r '.obs.head_sha' <<<"$f")
  hash=$(jq -r '.obs.anchor_hash' <<<"$f")
  occ=$(jq -r '.obs.occ // ""' <<<"$f")
  deletion=$(jq -r '.obs.deletion // false' <<<"$f")
  source=$(jq -r '.obs.anchor_source // "commit"' <<<"$f")
  state=$(jq -r '.state' <<<"$f")
  scope=$(jq -r '.obs.scope' <<<"$f")
  scope_status=$(jq -r '.obs.scope_status' <<<"$f")
  alines=$(jq -r 'if .obs.anchor_withheld then "" else (.obs.anchor_lines // [] | join(" ")) end' <<<"$f")
  [ "$state" = applied ] && strict=strict
  if rl_is_shallow || ! rl_have_commit "$T"; then
    printf 'unverifiable'
    return 0
  fi
  if [ "$deletion" = true ]; then
    if rl_tree_entry "$T" "$file" >/dev/null; then printf 'not_reproduced'; else printf 'reproduced'; fi
    return 0
  fi
  if [ "$source" = worktree ]; then
    res=anchored ln=$line np=$file
  else
    read -r res ln np <<<"$(rl_map_line "$head" "$T" "$file" "$line")"
  fi
  case "$res" in
    unverifiable | unmapped) printf 'unverifiable'; return 0 ;;
    deleted) printf 'not_reproduced'; return 0 ;;
    exact | shifted) printf 'reproduced'; return 0 ;;
  esac
  entry=$(rl_tree_entry "$T" "$np") || { printf 'not_reproduced'; return 0; }
  rl_regular_mode "${entry%% *}" || { printf 'not_reproduced'; return 0; }
  content=$(rl_blob_file "${entry##* }") || { printf 'unverifiable'; return 0; }
  excl=$(rl_sibling_lines "$fold" "$id" "$T")
  if hit=$(rl_window_hash "$content" "$ln" 3 "$hash" "$excl"); then
    if [ "$scope_status" != verified ] || [ "$(rl_verify_scope "$content" "$np" "$hit" "$scope" | cut -f2)" = "$scope" ]; then
      printf 'reproduced'
      return 0
    fi
  fi
  if [ -z "$strict" ] && [ -z "$occ" ] && [ -n "$alines" ]; then
    if hit=$(rl_window_alias "$content" "$ln" "$(rl_normalize_line "$alines")" "$excl"); then
      if [ "$scope_status" != verified ] || [ "$(rl_verify_scope "$content" "$np" "$hit" "$scope" | cut -f2)" = "$scope" ]; then
        printf 'reproduced'
        return 0
      fi
    fi
  fi
  printf 'not_reproduced'
}

# rl_publication <fold-json> <finding_id> <remote-head>
# proved:ancestor | proved:patch-id | unproved | abandoned | unverifiable
rl_publication() {
  local fold="$1" id="$2" H="$3" fix pid c
  fix=$(printf '%s' "$fold" | jq -r --arg id "$id" '.findings[] | select(.finding_id == $id) | .fix_sha // ""')
  [ -n "$fix" ] || { printf 'unproved'; return 0; }
  if rl_is_shallow || ! rl_have_commit "$H" || ! rl_have_commit "$fix"; then
    printf 'unverifiable'
    return 0
  fi
  if git merge-base --is-ancestor "$fix" "$H" 2>/dev/null; then
    printf 'proved:ancestor'
    return 0
  fi
  pid=$(git diff-tree -p -U0 --no-color --no-ext-diff "$fix" 2>/dev/null | git patch-id --stable 2>/dev/null | cut -d' ' -f1)
  if [ -n "$pid" ]; then
    while IFS= read -r c; do
      if [ "$(git diff-tree -p -U0 --no-color --no-ext-diff "$c" 2>/dev/null | git patch-id --stable 2>/dev/null | cut -d' ' -f1)" = "$pid" ]; then
        printf 'proved:patch-id'
        return 0
      fi
    done < <(git rev-list --no-merges --max-count=500 "$H" --not "$fix^" 2>/dev/null)
  fi
  if [ -z "$(git for-each-ref --contains "$fix" --format='%(refname)' 2>/dev/null)" ]; then
    printf 'abandoned'
    return 0
  fi
  printf 'unproved'
}

# Is a dismissal still applicable at <H>? The anchor must still match
# (strict re-verify) and every depends_on entry must be a regular file at
# <H> with the recorded blob (CLAUDE-44).
rl_dismissal_applicable() {
  local fold="$1" id="$2" H="$3" deps p blob entry
  [ "$(rl_reverify_finding "$fold" "$id" "$H" strict)" = reproduced ] || return 1
  deps=$(printf '%s' "$fold" | jq -r --arg id "$id" '.findings[] | select(.finding_id == $id) | (.depends_on // [])[] | .path + "\t" + .blob')
  [ -n "$deps" ] || return 0
  while IFS=$'\t' read -r p blob; do
    entry=$(rl_tree_entry "$H" "$p") || return 1
    rl_regular_mode "${entry%% *}" || return 1
    [ "${entry##* }" = "$blob" ] || return 1
  done <<<"$deps"
  return 0
}

# --- observe: per-finding candidate -----------------------------------------

RL_VALIDATE_FINDING_JQ='
  def int: type == "number" and . == floor;
  if (.title | type) != "string" or (.title | length) == 0 then "invalid-field:title"
  elif (.severity | IN("P0", "P1", "P2", "P3") | not) then "invalid-field:severity"
  elif (.category | type) != "string" or (.category | length) == 0 then "invalid-field:category"
  elif (.file | type) != "string" then "invalid-field:file"
  elif ((.line | int) and .line >= 1 | not) then "invalid-field:line"
  elif ((.confidence | int) and .confidence >= 0 and .confidence <= 100 | not) then "invalid-field:confidence"
  elif (.autofix_class | IN("safe_auto", "gated_auto", "manual", "advisory") | not) then "invalid-field:autofix_class"
  elif (.owner | IN("review-fixer", "downstream-resolver", "human", "release") | not) then "invalid-field:owner"
  elif (.requires_verification | type) != "boolean" then "invalid-field:requires_verification"
  elif (.pre_existing | type) != "boolean" then "invalid-field:pre_existing"
  elif (.suggested_fix | type | IN("string", "null") | not) then "invalid-field:suggested_fix"
  elif .pre_existing then "pre-existing"
  else "ok" end'

# rl_build_candidate <finding-json> <head> <base> <source commit|worktree>
# Prints a candidate observation (without finding_id), or "REJECT <reason>".
rl_build_candidate() {
  local fj="$1" H="$2" B="$3" src="$4" verdict file line vres where oid content n text hash
  local cat_raw cat rule rule_raw scope_claimed sv scope scope_status sstart send occ deletion
  local title fix mig bcc withheld alines report_only fp root
  verdict=$(jq -r "$RL_VALIDATE_FINDING_JQ" <<<"$fj" 2>/dev/null) || verdict=invalid-json
  [ "$verdict" = ok ] || { printf 'REJECT %s' "$verdict"; return 0; }
  file=$(jq -r '.file' <<<"$fj")
  line=$(jq -r '.line' <<<"$fj")
  if [ "$src" = worktree ]; then
    root=$(rl_repo_root) || { printf 'REJECT no-repo'; return 0; }
    vres=$(rl_validate_path anchor "$H" "$file") || { printf 'REJECT path:%s' "$vres"; return 0; }
    rl_worktree_entry_ok "$root" "$file" || { printf 'REJECT path:worktree-entry'; return 0; }
    content="$(rl_tmp)/wt-$RANDOM-$RANDOM"
    cp -- "$root/$file" "$content" || { printf 'REJECT path:unreadable'; return 0; }
    where='head'
  else
    vres=$(rl_validate_path anchor "$H" "$file" "$B") || { printf 'REJECT path:%s' "$vres"; return 0; }
    read -r _ oid where <<<"$vres"
    content=$(rl_blob_file "$oid") || { printf 'REJECT path:unreadable'; return 0; }
  fi
  deletion=false
  [ "$where" = base ] && deletion=true
  n=$(rl_line_count "$content")
  [ "$n" -lt 1 ] && n=1
  [ "$line" -gt "$n" ] && line=$n
  text=$(rl_line_at "$content" "$line")
  hash=$(rl_hash_line "$text")

  cat_raw=$(jq -r '.category' <<<"$fj")
  cat=$(rl_normalize_category "$cat_raw")
  if [ -z "$cat" ]; then
    cat=maintainability
  fi
  cat_stored=${cat_raw:0:64}
  rl_anchor_safe "$cat_stored" || cat_stored='[withheld]'
  rule_raw=$(jq -r '.rule // ""' <<<"$fj")
  scope_claimed=$(jq -r '.scope // ""' <<<"$fj")
  if [ -z "$rule_raw" ]; then rule=unclassified; else rule=$(rl_validate_rule "$cat" "$rule_raw"); fi

  sv=$(rl_verify_scope "$content" "$file" "$line" "$scope_claimed")
  scope=unscoped scope_status=unscoped occ=''
  if [ "${sv%%$'\t'*}" = verified ]; then
    IFS=$'\t' read -r _ scope sstart send <<<"$sv"
    scope_status=verified
    occ=$(rl_occurrence "$content" "$line" "$sstart" "$send")
  fi

  title=$(rl_redact "$(jq -r '.title' <<<"$fj")")
  fix=$(jq -r '.suggested_fix // ""' <<<"$fj")
  [ -n "$fix" ] && fix=$(rl_redact "$fix")
  mig=$(jq -r '.migration_path // ""' <<<"$fj")
  [ -n "$mig" ] && mig=$(rl_redact "$mig")
  bcc=$(jq -r '.breaking_change_class // "" | select(IN("name-rename", "signature-change", "removal", "semantics-change"))' <<<"$fj")
  [ -n "$scope_claimed" ] && scope_claimed=$(rl_redact "$scope_claimed")
  withheld=false
  if rl_anchor_safe "$text"; then alines=$(jq -cn --arg t "$text" '[$t]'); else alines=null withheld=true; fi
  report_only=$(jq -r 'if has("queue") then .queue == "report_only"
    else (.autofix_class == "advisory" or .owner == "human" or .owner == "release") end' <<<"$fj")
  if [ "$scope_status" = unscoped ]; then
    fp=$(jq -cn --arg f "$file" --arg c "$cat" --arg r "$rule" --arg s "$scope" --arg h "$hash" --argjson l "$line" --arg o "$occ" \
      '[$f, $c, $r, $s, $h, $l, (if $o == "" then null else $o end)]' | rl_sha256)
  else
    fp=$(jq -cn --arg f "$file" --arg c "$cat" --arg r "$rule" --arg s "$scope" --arg h "$hash" --arg o "$occ" \
      '[$f, $c, $r, $s, $h, null, (if $o == "" then null else $o end)]' | rl_sha256)
  fi
  jq -cn --argjson f "$fj" --arg fp "$fp" --arg cat "$cat" --arg cat_stored "$cat_stored" --arg rule "$rule" \
    --arg scope "$scope" --arg sc "$scope_claimed" --arg ss "$scope_status" --arg occ "$occ" \
    --arg file "$file" --argjson line "$line" --argjson del "$deletion" --arg hash "$hash" \
    --argjson alines "$alines" --argjson withheld "$withheld" --arg src "$src" --arg title "$title" \
    --arg fix "$fix" --arg bcc "$bcc" --arg mig "$mig" --argjson ro "$report_only" '
    def nn: if . == "" then null else . end;
    {fingerprint: $fp,
     reviewers: ((if ($f.reviewers | type) == "array" then $f.reviewers
                  elif ($f.reviewer | type) == "string" then [$f.reviewer] else ["unknown"] end)
                 | map(select(type == "string") | gsub("[^A-Za-z0-9._-]"; "")) | unique),
     severity: $f.severity, category: $cat, category_raw: ($cat_stored | gsub("[^A-Za-z0-9 ._\\[\\]-]"; "")),
     rule: $rule, scope: $scope, scope_claimed: ($sc | nn), scope_status: $ss, occ: ($occ | nn),
     file: $file, line: $line, deletion: $del, anchor_hash: $hash, anchor_lines: $alines,
     anchor_withheld: $withheld, anchor_source: $src, confidence: $f.confidence,
     autofix_class: $f.autofix_class, owner: $f.owner,
     requires_verification: $f.requires_verification, pre_existing: $f.pre_existing,
     title: $title, suggested_fix: ($fix | nn), breaking_change_class: ($bcc | nn),
     migration_path: ($mig | nn), report_only: $ro}'
}

# --- observe: matching and append (under the lock) --------------------------

# Globals set by cmd_observe: RL_O_DIR RL_O_PR RL_O_HEAD RL_O_BASE RL_O_RUN
# RL_O_STEP RL_O_SOURCE RL_O_CANDS (JSONL, one grouped candidate per line)
# RL_O_REJECTED (JSON array) RL_O_DEFAULTED RL_O_UNMAPPED.
rl_observe_locked() {
  local f fold n i c eid res ln np row from to cand_fp dist best bestd
  local -a cands match via unavail
  local -A claimed
  rl_writer_gate "$RL_O_DIR" "$RL_O_PR" || return $?
  f="$RL_O_DIR/$RL_O_PR.jsonl"
  rl_repair_tail "$f" || return 1
  fold=$(rl_fold_file "$f") || return 1
  mapfile -t cands <"$RL_O_CANDS"
  n=${#cands[@]}

  # Pass A: line-map siblings (same category, rule, scope and anchor hash)
  # whose recorded line maps unchanged to within 3 lines. Nearest wins,
  # and one existing finding absorbs at most one candidate per run.
  local pairs=''
  for ((i = 0; i < n; i++)); do
    c="${cands[$i]}"
    while IFS=$'\t' read -r eid from to row np_old; do
      [ -n "$eid" ] || continue
      read -r res ln np <<<"$(rl_map_line "$from" "$to" "$np_old" "$row")"
      if [ "$res" = unverifiable ]; then
        unavail[$i]=1
        continue
      fi
      [ "$np" = "$(jq -r '.file' <<<"$c")" ] || continue
      case "$res" in exact | shifted) ;; *) continue ;; esac
      dist=$((ln - $(jq -r '.line' <<<"$c")))
      dist=${dist#-}
      [ "$dist" -le 3 ] && pairs+="$dist"$'\t'"$i"$'\t'"$eid"$'\n'
    done < <(printf '%s' "$fold" | jq -r --argjson c "$c" --arg H "$RL_O_HEAD" --arg B "$RL_O_BASE" '
      .findings[] | select(.obs.category == $c.category and .obs.rule == $c.rule and .obs.scope == $c.scope
        and .obs.anchor_hash == $c.anchor_hash and ((.obs.deletion // false) == $c.deletion))
      | [.finding_id, (if $c.deletion then .obs.base_sha else .obs.head_sha end),
         (if $c.deletion then $B else $H end), (.obs.line | tostring), .obs.file] | join("\t")')
  done
  while IFS=$'\t' read -r dist i eid; do
    [ -n "$eid" ] || continue
    [ -n "${match[$i]:-}" ] && continue
    [ -n "${claimed[$eid]:-}" ] && continue
    match[$i]=$eid via[$i]=line
    claimed[$eid]=1
  done < <(printf '%s' "$pairs" | sort -n -k1,1)

  # Pass B: exact fingerprint. Occurrence-keyed candidates use it only when
  # line mapping was unavailable: their ordinal shifts when a sibling is
  # fixed, so the ordinal is not an identity.
  for ((i = 0; i < n; i++)); do
    [ -n "${match[$i]:-}" ] && continue
    c="${cands[$i]}"
    if [ "$(jq -r '.occ // ""' <<<"$c")" != "" ] && [ -z "${unavail[$i]:-}" ]; then continue; fi
    cand_fp=$(jq -r '.fingerprint' <<<"$c")
    while IFS= read -r eid; do
      [ -n "$eid" ] || continue
      [ -n "${claimed[$eid]:-}" ] && continue
      match[$i]=$eid via[$i]=exact
      claimed[$eid]=1
      break
    done < <(printf '%s' "$fold" | jq -r --arg fp "$cand_fp" '.findings[] | select(.fingerprints | index($fp)) | .finding_id')
  done

  # Pass C: alias — same category, rule and scope, no occurrence key, a
  # stored anchor, mapped line within 40, similarity >= 0.8. Nearest wins.
  # Only an existing finding whose own anchor line was edited (`anchored`)
  # can alias: one whose line maps unchanged is still a separate site.
  for ((i = 0; i < n; i++)); do
    [ -n "${match[$i]:-}" ] && continue
    c="${cands[$i]}"
    [ "$(jq -r 'if .occ == null and .anchor_lines != null then "y" else "n" end' <<<"$c")" = y ] || continue
    local ctext cline cfile
    ctext=$(rl_normalize_line "$(jq -r '.anchor_lines | join(" ")' <<<"$c")")
    cline=$(jq -r '.line' <<<"$c")
    cfile=$(jq -r '.file' <<<"$c")
    best='' bestd=41
    while IFS=$'\t' read -r eid from row np_old etext; do
      [ -n "$eid" ] || continue
      [ -n "${claimed[$eid]:-}" ] && continue
      read -r res ln np <<<"$(rl_map_line "$from" "$RL_O_HEAD" "$np_old" "$row")"
      [ "$res" = anchored ] || continue
      [ "$np" = "$cfile" ] || continue
      dist=$((ln - cline))
      dist=${dist#-}
      [ "$dist" -lt "$bestd" ] || continue
      awk -v s="$(rl_similarity "$ctext" "$(rl_normalize_line "$etext")")" 'BEGIN { exit !(s >= 0.8) }' || continue
      best=$eid bestd=$dist
    done < <(printf '%s' "$fold" | jq -r --argjson c "$c" '
      .findings[] | select(.obs.category == $c.category and .obs.rule == $c.rule and .obs.scope == $c.scope
        and .obs.occ == null and .obs.anchor_lines != null and ((.obs.deletion // false) | not) and ($c.deletion | not))
      | [.finding_id, .obs.head_sha, (.obs.line | tostring), .obs.file, (.obs.anchor_lines | join(" "))] | join("\t")')
    if [ -n "$best" ]; then
      match[$i]=$best via[$i]=alias
      claimed[$best]=1
    fi
  done

  # Actions.
  local new=0 merged=0 reopened=0 suppressed=0 id state at
  at=$(rl_now)
  for ((i = 0; i < n; i++)); do
    c="${cands[$i]}"
    id="${match[$i]:-}"
    obs() {
      jq -c --arg id "$1" --argjson pr "$RL_O_PR" --arg H "$RL_O_HEAD" --arg B "$RL_O_BASE" --arg at "$at" \
        --arg run "$RL_O_RUN" --arg src "$RL_O_SOURCE" --arg step "$RL_O_STEP" '
        {v: 1, type: "observation", finding_id: $id} + del(.report_only)
        + {pr: $pr, head_sha: $H, base_sha: (if $B == "" then null else $B end), at: $at, run_id: $run, source: $src, step: $step}' <<<"$c"
    }
    if [ -z "$id" ]; then
      id=$(jq -r '.fingerprint' <<<"$c")
      if printf '%s' "$fold" | jq -e --arg id "$id" 'any(.findings[]; .finding_id == $id)' >/dev/null; then
        id=$(printf '%s:%s:%s' "$id" "$RL_O_RUN" "$i" | rl_sha256)
      fi
      rl_append "$f" "$(obs "$id")" || return 1
      if [ "$(jq -r '.report_only' <<<"$c")" = true ]; then state=report_only; else state=open; fi
      rl_append "$f" "$(rl_transition_record "$id" "$state" "" "$RL_O_HEAD" "$RL_O_SOURCE" "" "" "" null)" || return 1
      new=$((new + 1))
      continue
    fi
    state=$(printf '%s' "$fold" | jq -r --arg id "$id" '.findings[] | select(.finding_id == $id) | .state')
    case "$state" in
      dismissed)
        if [ "${via[$i]}" != alias ] && rl_dismissal_applicable "$fold" "$id" "$RL_O_HEAD"; then
          suppressed=$((suppressed + 1))
        else
          rl_append "$f" "$(obs "$id")" || return 1
          rl_append "$f" "$(rl_transition_record "$id" reopened "dismissal no longer applies" "$RL_O_HEAD" "$RL_O_SOURCE" "" "" "" null)" || return 1
          reopened=$((reopened + 1))
        fi
        ;;
      fixed | stale)
        rl_append "$f" "$(obs "$id")" || return 1
        rl_append "$f" "$(rl_transition_record "$id" reopened "re-observed after $state" "$RL_O_HEAD" "$RL_O_SOURCE" "" "" "" null)" || return 1
        reopened=$((reopened + 1))
        ;;
      *)
        rl_append "$f" "$(obs "$id")" || return 1
        merged=$((merged + 1))
        ;;
    esac
  done
  fold=$(rl_fold_file "$f") || return 1
  rl_refresh_sidecar "$RL_O_DIR" "$RL_O_PR" "$fold" || rl_err "sidecar refresh failed"
  jq -cn --arg run "$RL_O_RUN" --argjson new "$new" --argjson merged "$merged" --argjson reopened "$reopened" \
    --argjson sup "$suppressed" --argjson def "$RL_O_DEFAULTED" --argjson unm "$RL_O_UNMAPPED" \
    --argjson rej "$RL_O_REJECTED" --argjson fold "$fold" '
    {run_id: $run, new: $new, merged: $merged, reopened: $reopened, suppressed_dismissed: $sup,
     defaulted: $def, category_unmapped: $unm, rejected: $rej,
     pending: $fold.pending, attention: $fold.attention}'
}

# --- subcommands ------------------------------------------------------------

rl_need_pr() {
  rl_validate_pr "${1:-}" || rl_die "$RL_EXIT_USAGE" "PR must be a positive integer"
}

# `shift 2` with one argument left fails without shifting, and the parse
# loop would spin forever; every value-taking flag checks first.
rl_need_val() {
  [ $# -ge 2 ] || rl_die "$RL_EXIT_USAGE" "$1 needs a value"
}

rl_need_sha() {
  rl_is_sha "${2:-}" || rl_die "$RL_EXIT_USAGE" "$1 must be a 40-hex commit SHA"
}

cmd_observe() {
  local pr="${1:-}" run='' step='' head='' base='' src=commit source=review-pr input count i fj cand
  rl_need_pr "$pr"
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --run-id) rl_need_val "$@"; run="${2:-}"; shift 2 ;;
      --step) rl_need_val "$@"; step="${2:-}"; shift 2 ;;
      --head) rl_need_val "$@"; head="${2:-}"; shift 2 ;;
      --base) rl_need_val "$@"; base="${2:-}"; shift 2 ;;
      --anchor-source) rl_need_val "$@"; src="${2:-}"; shift 2 ;;
      --source) rl_need_val "$@"; source="${2:-}"; shift 2 ;;
      *) rl_die "$RL_EXIT_USAGE" "observe: unknown argument" ;;
    esac
  done
  case "$step" in 6 | 8) ;; *) rl_die "$RL_EXIT_USAGE" "observe: --step must be 6 or 8" ;; esac
  case "$source" in review-pr | review-all) ;; *) rl_die "$RL_EXIT_USAGE" "observe: --source must be review-pr or review-all" ;; esac
  case "$src" in
    commit) ;;
    worktree) [ "$step" = 8 ] || rl_die "$RL_EXIT_USAGE" "observe: --anchor-source worktree is for --step 8 only" ;;
    *) rl_die "$RL_EXIT_USAGE" "observe: --anchor-source must be commit or worktree" ;;
  esac
  rl_need_sha --head "$head"
  [ -z "$base" ] || rl_need_sha --base "$base"
  [ -n "$run" ] || run=$(rl_new_run_id)
  [[ "$run" =~ ^[A-Za-z0-9-]{8,64}$ ]] || rl_die "$RL_EXIT_USAGE" "observe: bad --run-id"
  rl_have_commit "$head" || rl_die "$RL_EXIT_UNVERIFIABLE" "observe: head commit not in the object store"
  if [ "$src" = worktree ] && [ "$(git rev-parse HEAD 2>/dev/null)" != "$head" ]; then
    rl_die "$RL_EXIT_INVALID" "observe: --anchor-source worktree requires HEAD == --head"
  fi
  input="$(rl_tmp)/input.json"
  cat >|"$input"
  jq -e 'type == "array"' "$input" >/dev/null 2>&1 || rl_die "$RL_EXIT_INVALID" "observe: stdin must be a JSON array"
  count=$(jq 'length' "$input")
  RL_O_REJECTED='[]' RL_O_DEFAULTED=0 RL_O_UNMAPPED=0
  : >|"$(rl_tmp)/cands.jsonl"
  for ((i = 0; i < count; i++)); do
    fj=$(jq -c ".[$i]" "$input")
    cand=$(rl_build_candidate "$fj" "$head" "$base" "$src")
    case "$cand" in
      "REJECT "*)
        RL_O_REJECTED=$(jq -c --argjson o "$((i + 1))" --arg r "${cand#REJECT }" '. + [{ordinal: $o, reason: $r}]' <<<"$RL_O_REJECTED")
        ;;
      *)
        # rl_build_candidate ran in a subshell; re-derive its two flags.
        RL_O_DEFAULTED=$((RL_O_DEFAULTED + $(jq -r 'if (.rule // "") != "" and (.scope // "") != "" then 0 else 1 end' <<<"$fj")))
        if [ -z "$(rl_normalize_category "$(jq -r '.category' <<<"$fj")")" ]; then
          RL_O_UNMAPPED=$((RL_O_UNMAPPED + 1))
        fi
        printf '%s\n' "$cand" >>"$(rl_tmp)/cands.jsonl"
        ;;
    esac
  done
  # One candidate per fingerprint per run: merge two reviewers' copies.
  jq -sc 'group_by(.fingerprint) | map(
      .[0] + {reviewers: (map(.reviewers[]) | unique), severity: (map(.severity) | min),
              confidence: (map(.confidence) | max), report_only: (all(.report_only))}) | .[]' \
    "$(rl_tmp)/cands.jsonl" >|"$(rl_tmp)/grouped.jsonl" || rl_die 1 "observe: grouping failed"
  RL_O_DIR=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  RL_O_PR=$pr RL_O_HEAD=$head RL_O_BASE=$base RL_O_RUN=$run RL_O_STEP=$step RL_O_SOURCE=$source
  RL_O_CANDS="$(rl_tmp)/grouped.jsonl"
  rl_locked "$pr" rl_observe_locked
}

rl_transition_locked() {
  local f fold cur rec
  rl_writer_gate "$RL_T_DIR" "$RL_T_PR" || return $?
  f="$RL_T_DIR/$RL_T_PR.jsonl"
  rl_repair_tail "$f" || return 1
  fold=$(rl_fold_file "$f") || return 1
  cur=$(printf '%s' "$fold" | jq -r --arg id "$RL_T_ID" '.findings[] | select(.finding_id == $id) | .state')
  [ -n "$cur" ] || { rl_err "unknown finding_id"; return "$RL_EXIT_INVALID"; }
  rl_edge_ok "$cur" "$RL_T_STATE" || { rl_err "illegal transition $cur -> $RL_T_STATE"; return "$RL_EXIT_INVALID"; }
  if [ "$cur:$RL_T_STATE" = applied:applied ] && [ -z "$RL_T_FIX$RL_T_PUB" ]; then
    rl_err "applied -> applied must add --fix-sha or --published-head"
    return "$RL_EXIT_INVALID"
  fi
  rec=$(rl_transition_record "$RL_T_ID" "$RL_T_STATE" "$RL_T_REASON" "$RL_T_HEAD" "$RL_T_ACTOR" "$RL_T_FIX" "$RL_T_PUB" "$RL_T_PROOF" "$RL_T_DEPS")
  rl_append "$f" "$rec" || return 1
  fold=$(rl_fold_file "$f") || return 1
  rl_refresh_sidecar "$RL_T_DIR" "$RL_T_PR" "$fold" || rl_err "sidecar refresh failed"
  jq -cn --arg id "$RL_T_ID" --arg from "$cur" --arg to "$RL_T_STATE" --argjson fold "$fold" \
    '{finding_id: $id, from: $from, to: $to, pending: $fold.pending, attention: $fold.attention}'
}

cmd_transition() {
  local pr="${1:-}" id="${2:-}" state="${3:-}" reason='' fix='' pub='' proof='' depsj='' head='' actor=triage
  rl_need_pr "$pr"
  [[ "$id" =~ ^[0-9a-f]{64}$ ]] || rl_die "$RL_EXIT_USAGE" "transition: finding_id must be 64-hex"
  case "$state" in
    open | report_only | applied | fixed | dismissed | stale | reopened) ;;
    *) rl_die "$RL_EXIT_USAGE" "transition: unknown state" ;;
  esac
  shift 3
  while [ $# -gt 0 ]; do
    case "$1" in
      --reason) rl_need_val "$@"; reason="${2:-}"; shift 2 ;;
      --fix-sha) rl_need_val "$@"; fix="${2:-}"; rl_need_sha --fix-sha "$fix"; shift 2 ;;
      --published-head) rl_need_val "$@"; pub="${2:-}"; rl_need_sha --published-head "$pub"; shift 2 ;;
      --proof) rl_need_val "$@"; proof="${2:-}"; shift 2 ;;
      --depends-on-json) rl_need_val "$@"; depsj="${2:-}"; shift 2 ;;
      --head) rl_need_val "$@"; head="${2:-}"; rl_need_sha --head "$head"; shift 2 ;;
      --actor) rl_need_val "$@"; actor="${2:-}"; shift 2 ;;
      *) rl_die "$RL_EXIT_USAGE" "transition: unknown argument" ;;
    esac
  done
  case "$actor" in review-pr | review-all | triage | triage-noninteractive) ;; *) rl_die "$RL_EXIT_USAGE" "transition: bad --actor" ;; esac
  case "$proof" in '' | ancestor | patch-id | content) ;; *) rl_die "$RL_EXIT_USAGE" "transition: bad --proof" ;; esac
  [ -n "$head" ] || head=$(git rev-parse HEAD 2>/dev/null) || head=''
  RL_T_DEPS=null
  if [ -n "$depsj" ]; then
    [ "$state" = dismissed ] || rl_die "$RL_EXIT_USAGE" "transition: --depends-on-json is for dismissed only"
    jq -e 'type == "array" and all(.[]; type == "string")' <<<"$depsj" >/dev/null 2>&1 ||
      rl_die "$RL_EXIT_USAGE" "transition: --depends-on-json must be a JSON array of paths"
    local n i p v
    RL_T_DEPS='[]'
    n=$(jq 'length' <<<"$depsj")
    for ((i = 0; i < n; i++)); do
      p=$(jq -r ".[$i]" <<<"$depsj")
      v=$(rl_validate_path dependency "$head" "$p") || rl_die "$RL_EXIT_INVALID" "transition: depends_on entry $((i + 1)) rejected ($v)"
      read -r _ v _ <<<"$v"
      RL_T_DEPS=$(jq -c --arg p "$p" --arg b "$v" '. + [{path: $p, blob: $b}]' <<<"$RL_T_DEPS")
    done
  fi
  RL_T_DIR=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  RL_T_PR=$pr RL_T_ID=$id RL_T_STATE=$state RL_T_HEAD=$head RL_T_ACTOR=$actor
  RL_T_FIX=$fix RL_T_PUB=$pub RL_T_PROOF=$proof
  RL_T_REASON=''
  [ -n "$reason" ] && RL_T_REASON=$(rl_redact_reason "$reason")
  rl_locked "$pr" rl_transition_locked
}

# Read-side helper: repair the tail and fold, under the lock.
rl_fold_locked() {
  local f="$RL_R_DIR/$RL_R_PR.jsonl"
  if [ -f "$f" ]; then
    rl_repair_tail "$f" || return 1
  fi
  rl_fold_file "$f"
}

rl_read_fold() {
  RL_R_DIR=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  RL_R_PR=$1
  rl_locked "$1" rl_fold_locked
}

cmd_fold() {
  rl_need_pr "${1:-}"
  rl_read_fold "$1"
}

cmd_dismissed_context() {
  local pr="${1:-}" head='' fold id out='[]'
  rl_need_pr "$pr"
  [ "${2:-}" = --head ] && head="${3:-}"
  rl_need_sha --head "$head"
  fold=$(rl_read_fold "$pr") || exit $?
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    rl_dismissal_applicable "$fold" "$id" "$head" || continue
    out=$(printf '%s' "$fold" | jq -c --arg id "$id" --argjson acc "$out" '
      $acc + [.findings[] | select(.finding_id == $id)
        | {finding_id, reason, title: .obs.title, file: .obs.file, line: .obs.line,
           category: .obs.category, rule: .obs.rule, scope: .obs.scope, severity: .obs.severity}]')
  done < <(printf '%s' "$fold" | jq -r '.findings[] | select(.state == "dismissed") | .finding_id')
  printf '%s\n' "$out"
}

cmd_reverify() {
  local pr="${1:-}" id="${2:-}" head='' fold
  rl_need_pr "$pr"
  [ "${3:-}" = --head ] && head="${4:-}"
  rl_need_sha --head "$head"
  fold=$(rl_read_fold "$pr") || exit $?
  printf '%s\n' "$(rl_reverify_finding "$fold" "$id" "$head")"
}

cmd_publication() {
  local pr="${1:-}" id="${2:-}" head='' fold r
  rl_need_pr "$pr"
  [ "${3:-}" = --remote-head ] && head="${4:-}"
  rl_need_sha --remote-head "$head"
  fold=$(rl_read_fold "$pr") || exit $?
  r=$(rl_publication "$fold" "$id" "$head")
  printf '%s\n' "$r"
  [ "$r" = unverifiable ] && exit "$RL_EXIT_UNVERIFIABLE"
  return 0
}

cmd_validate_path() {
  local out rc
  [ $# -ge 3 ] || rl_die "$RL_EXIT_USAGE" "validate-path <anchor|dependency|restore> <rev> <path> [<base>]"
  out=$(rl_validate_path "$@")
  rc=$?
  printf '%s\n' "$out"
  return "$rc"
}

rl_prune_locked() {
  local d="$RL_R_DIR" pr="$RL_R_PR"
  rm -f -- "${d:?}/${pr:?}.jsonl" "${d:?}/${pr:?}.pending" "${d:?}/${pr:?}.state"
  rl_atomic_write "$d/$pr.closed" "$RL_R_STATE $(date -u +%s)"$'\n'
}

cmd_prune() {
  local pr="${1:-}" st
  rl_need_pr "$pr"
  st=$(rl_gh_state "$pr") || rl_die "$RL_EXIT_UNVERIFIABLE" "prune: could not read PR #$pr state"
  case "$st" in
    MERGED | CLOSED) ;;
    *) printf 'refused: PR #%s is %s\n' "$pr" "$st"; exit "$RL_EXIT_INVALID" ;;
  esac
  RL_R_DIR=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  RL_R_PR=$pr RL_R_STATE=$st
  rl_locked "$pr" rl_prune_locked || exit $?
  printf 'pruned: PR #%s (%s)\n' "$pr" "$st"
}

cmd_record_state() {
  local pr="${1:-}" st d
  rl_need_pr "$pr"
  st=$(rl_gh_state "$pr") || rl_die "$RL_EXIT_UNVERIFIABLE" "record-state: could not read PR #$pr state"
  d=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  rl_write_state "$d" "$pr" "$st"
  printf '%s\n' "$st"
}

# Per-PR counts: the sidecar when its byte count matches, else a fold.
rl_summary_one() {
  local d="$1" pr="$2" p a b fold
  if [ -f "$d/$pr.pending" ] && read -r p a b <"$d/$pr.pending" && [[ "$p$a$b" =~ ^[0-9]+$ ]] &&
    [ "$b" = "$(rl_file_size "$d/$pr.jsonl")" ]; then
    printf '{"pending":%s,"attention":%s}' "$p" "$a"
    return 0
  fi
  fold=$(rl_read_fold "$pr") || return 1
  printf '%s' "$fold" | jq -c '{pending, attention}'
}

cmd_summary() {
  local d f pr out='{}' one
  d=$(rl_ensure_dir) || rl_die 1 "cannot create ledger directory"
  if [ -n "${1:-}" ] && [ "$1" != --all ]; then
    rl_need_pr "$1"
    [ -f "$d/$1.jsonl" ] || { printf '{}\n'; return 0; }
    one=$(rl_summary_one "$d" "$1") || exit $?
    jq -cn --arg pr "$1" --argjson v "$one" '{($pr): $v}'
    return 0
  fi
  for f in "$d"/*.jsonl; do
    [ -f "$f" ] || continue
    pr=$(basename -- "$f" .jsonl)
    rl_validate_pr "$pr" || continue
    one=$(rl_summary_one "$d" "$pr") || one='null'
    out=$(jq -c --arg pr "$pr" --argjson v "$one" '. + {($pr): $v}' <<<"$out")
  done
  printf '%s\n' "$out"
}

rl_usage() {
  cat <<'USAGE'
review-ledger.sh <subcommand> [args]
  observe <pr> --head <sha> [--base <sha>] --step 6|8 [--run-id <id>]
          [--anchor-source commit|worktree] [--source review-pr|review-all]   (stdin: findings JSON array)
  transition <pr> <finding_id> <state> [--reason R] [--fix-sha S] [--published-head S]
          [--proof ancestor|patch-id|content] [--depends-on-json '["path"]'] [--head S] [--actor A]
  fold <pr>
  dismissed-context <pr> --head <sha>
  reverify <pr> <finding_id> --head <sha>
  publication <pr> <finding_id> --remote-head <sha>
  validate-path <anchor|dependency|restore> <rev> <path> [<base>]
  prune <pr> | record-state <pr> | summary [--all | <pr>] | new-run-id
USAGE
}

rl_main() {
  set -uo pipefail
  trap rl_cleanup EXIT
  # Create the scratch dir in this shell: `$(rl_tmp)` in a subshell would
  # otherwise mint a new one per call.
  rl_tmp >/dev/null
  local sub="${1:-}" bin
  [ $# -gt 0 ] && shift
  for bin in git jq flock; do
    command -v "$bin" >/dev/null 2>&1 || rl_die 1 "required binary not found: $bin"
  done
  case "$sub" in
    help | -h | --help) rl_usage ;;
    '') rl_usage >&2; exit "$RL_EXIT_USAGE" ;;
    new-run-id) rl_new_run_id; printf '\n' ;;
    observe | transition | fold | reverify | publication | prune | summary | dismissed-context | validate-path | record-state)
      git rev-parse --git-dir >/dev/null 2>&1 || rl_die 1 "not inside a git repository"
      "cmd_${sub//-/_}" "$@"
      ;;
    *) rl_usage >&2; exit "$RL_EXIT_USAGE" ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  rl_main "$@"
fi
