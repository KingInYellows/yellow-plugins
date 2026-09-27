#!/usr/bin/env bash
# Co-edit tracking ("files usually edited together") owned by this plugin.
#
# Why not ruvector's own co-edit data: `hooks post-edit` only records a file
# sequence when Intelligence.lastEditedFile is set, and that field lives in
# memory only (ruvector 0.3.3 cli.js:3131/3797) — with one process per hook it
# is always null, so nothing was ever recorded. `hooks coedit-record` does
# persist, but into intelligence.json, which the MCP server overwrites with
# its startup snapshot on every save (mcp-server.js:223, :418-430). So pairs
# live in a file only this plugin writes, with jq, no Node.
#
# Layout (under <root>/.ruvector/, shared across worktrees via the symlink):
#   coedit.json                 {"version":1,"pairs":{"a":{"b":N},"b":{"a":N}}}
#   coedit-sessions/<session>   {"last":"a","epoch":1790000000,...}
# Paths are root-relative, physical, and never outside the root.
#
# Source this file. Do not execute it. Never sets -e or calls exit; every
# function returns 0 on "skip" so a hook can never fail because of it.

COEDIT_WINDOW_SECS="${COEDIT_WINDOW_SECS:-60}"
COEDIT_MAX_PAIRS="${COEDIT_MAX_PAIRS:-2000}"
# A store past this size is set aside unparsed (2000 directed pairs of
# ordinary paths are a few hundred KB).
COEDIT_MAX_BYTES="${COEDIT_MAX_BYTES:-1048576}"
# Hook budget (the hooks have 1s): lock waits share COEDIT_LOCK_TRIES x 50ms
# per hook call, and each jq over project data is killed after
# COEDIT_JQ_SECS, so every path still prints its allow JSON.
COEDIT_LOCK_TRIES="${COEDIT_LOCK_TRIES:-8}"
COEDIT_JQ_SECS="${COEDIT_JQ_SECS:-0.3}"
# A linked worktree's main-worktree lookup is bounded by COEDIT_WT_SECS and
# charged against the same lock budget (coedit_reset_tries), so lookup +
# lock waits + one bounded jq stay under the 1s hook timeout.
COEDIT_WT_SECS="${COEDIT_WT_SECS:-0.15}"
COEDIT_WT_TRIES="${COEDIT_WT_TRIES:-3}"

# The validate-and-rewrite program for coedit_bump (see there).
_COEDIT_BUMP_JQ='
    if (type == "object" and (.pairs | type) == "object"
        and all(.pairs[]; type == "object" and all(.[]; type == "number"))) | not
    then halt_error(3) else . end
    | def safe: type == "string" and length > 0 and length <= 512
      and (test("[[:cntrl:]\u0085\u2028\u2029]") | not) and (startswith("/") | not)
      and ((split("/") | map(select(. == "" or . == "." or . == "..")) | length) == 0)
      and (test("^(\\.ruvector|\\.git)(/|$)|^docs/solutions/") | not);
    [.pairs | to_entries[] | select(.key | safe) | .key as $k
     | .value | to_entries[]
     | select((.key | safe) and .key != $k and .value > 0)
     | {k: ([$k, .key] | min), o: ([$k, .key] | max), n: (.value | floor)}]
    | group_by([.k, .o]) | map(.[0] + {n: (map(.n) | max)})
    # The new pair gets the same check: a session file is project data too.
    | if ($a | safe) and ($b | safe) and $a != $b then
        ([$a, $b] | min) as $k | ([$a, $b] | max) as $o
        | if any(.[]; .k == $k and .o == $o)
          then map(if .k == $k and .o == $o then .n += 1 | .cur = true else . end)
          else . + [{k: $k, o: $o, n: 1, cur: true}] end
      else . end
    # Cap: keep the highest counts, whole pairs at a time, within both the
    # pair cap and a byte budget (80% of COEDIT_MAX_BYTES; each undirected
    # pair costs about 2 * (both paths as JSON-encoded UTF-8 bytes) + 24), so the
    # writer never produces a file the size check would set aside. The pair
    # just updated is always kept (it goes first), so at the cap a new pair
    # displaces the lowest-ranked one and can accumulate instead of being
    # evicted on every observation.
    | sort_by(-.n, .k, .o) | (map(select(.cur)) + map(select(.cur | not)))
    | .[0:($cap / 2 | floor)]
    | reduce .[] as $e ({acc: [], used: 0};
        (2 * (($e.k | tojson | utf8bytelength) + ($e.o | tojson | utf8bytelength)) + 24) as $c
        | if .used + $c <= ($maxbytes * 0.8) then .acc += [$e] | .used += $c else . end)
    | .acc
    | {version: 1,
       pairs: (reduce .[] as $e ({}; .[$e.k][$e.o] = $e.n | .[$e.o][$e.k] = $e.n))}
'

# coedit_jq <jq args...> — jq bounded by COEDIT_JQ_SECS (run_budgeted from
# resolve.sh; plain jq when that is not loaded).
coedit_jq() {
  if command -v run_budgeted >/dev/null 2>&1; then
    [ -n "${TIMEOUT_CMD+x}" ] || ruvector_probe_timeout >/dev/null 2>&1 || true
    run_budgeted "$COEDIT_JQ_SECS" jq "$@"
  else
    jq "$@"
  fi
}

# coedit_sanitize_session <id> — print a filename-safe session id, or fail.
coedit_sanitize_session() {
  # Validate, never rewrite: mapping characters (a/b and a?b both to a_b) or
  # truncating would let two sessions share one state file. Claude Code
  # session ids are UUIDs; anything else outside [A-Za-z0-9._-], over 128
  # chars, or starting with "." (lock files are ".<sid>.lock") is refused.
  local sid="${1:-}"
  [ -n "$sid" ] && [ "${#sid}" -le 128 ] || return 1
  case "$sid" in .*|*[!A-Za-z0-9._-]*) return 1 ;; esac
  printf '%s' "$sid"
}

# coedit_normalize <root> <path> — print <path> relative to the physical
# root, or fail for: empty, control characters, a root-relative result over
# 512 chars (raw input over 4096), outside the root (symlinks resolved, the
# final component included), or inside .ruvector/, .git/, or docs/solutions/.
coedit_normalize() {
  local root="${1:-}" p="${2:-}" abs dir rroot rel link hops=0
  [ -n "$root" ] && [ -n "$p" ] || return 1
  # Edit paths arrive absolute, so only a loose raw bound here; the 512 cap
  # applies to the stored root-relative path below.
  [ "${#p}" -le 4096 ] || return 1
  # A shell pattern, not grep: grep reads line by line, so a newline in the
  # path would split it into clean-looking records and pass.
  case "$p" in *$'\n'*|*$'\r'*|*[[:cntrl:]]*) return 1 ;; esac
  # Unicode line breaks (NEL, LINE/PARAGRAPH SEPARATOR) as raw UTF-8 bytes,
  # so the check holds in any locale.
  case "$p" in *$'\xc2\x85'*|*$'\xe2\x80\xa8'*|*$'\xe2\x80\xa9'*) return 1 ;; esac
  case "$p" in
    /*) abs="$p" ;;
    *) abs="${root}/${p}" ;;
  esac
  rroot=$(CDPATH= cd -- "$root" 2>/dev/null && pwd -P) || return 1
  # pwd -P resolves the directories only; follow a symlinked final component
  # too (bounded hops), so a link to a file outside the root is rejected.
  while :; do
    dir=$(CDPATH= cd -- "$(dirname -- "$abs")" 2>/dev/null && pwd -P) || return 1
    abs="${dir}/$(basename -- "$abs")"
    [ -L "$abs" ] || break
    hops=$((hops + 1))
    [ "$hops" -le 16 ] || return 1
    link=$(readlink -- "$abs") || return 1
    case "$link" in
      /*) abs="$link" ;;
      *) abs="${dir}/${link}" ;;
    esac
  done
  case "$abs" in
    "$rroot"/*) rel="${abs#"$rroot"/}" ;;
    *) return 1 ;;
  esac
  [ -n "$rel" ] && [ "${#rel}" -le 512 ] || return 1
  case "$rel" in *$'\n'*|*$'\r'*|*[[:cntrl:]]*) return 1 ;; esac
  case "$rel" in *$'\xc2\x85'*|*$'\xe2\x80\xa8'*|*$'\xe2\x80\xa9'*) return 1 ;; esac
  case "$rel" in
    .ruvector|.ruvector/*|.git|.git/*|docs/solutions/*) return 1 ;;
  esac
  printf '%s' "$rel"
}

# coedit_store_dir <root> — print the physical store dir for <root>, or fail.
# The store is <root>/.ruvector, or, in a linked worktree, the main
# worktree's .ruvector that ruvector_heal_store links to. Anything else (a
# checkout shipping .ruvector as a symlink to elsewhere) is refused, so the
# hooks never write to or prune files outside the project's store.
coedit_store_dir() {
  local root="${1:-}" phys rroot main
  [ -n "$root" ] && [ -d "${root}/.ruvector" ] || return 1
  phys=$(CDPATH= cd -- "${root}/.ruvector" 2>/dev/null && pwd -P) || return 1
  rroot=$(CDPATH= cd -- "$root" 2>/dev/null && pwd -P) || return 1
  if [ "$phys" != "${rroot}/.ruvector" ]; then
    [ -f "${root}/.git" ] || return 1
    # The main worktree as resolve.sh identifies it: never a bare repo's
    # parent or a --separate-git-dir's parent.
    # Bounded (COEDIT_WT_SECS, 0.15s) inside the 1s hook: on a large or slow
    # main checkout the lookup is abandoned and this edit is not recorded,
    # but the hook still answers. TIMEOUT_CMD is cleared so run_budgeted
    # uses its background runner (timeout(1) cannot run a shell function).
    command -v ruvector_main_worktree >/dev/null 2>&1 || return 1
    main=$(TIMEOUT_CMD='' run_budgeted "$COEDIT_WT_SECS" ruvector_main_worktree "$root") || return 1
    [ -n "$main" ] || return 1
    main=$(CDPATH= cd -- "$main" 2>/dev/null && pwd -P) || return 1
    [ "$phys" = "${main}/.ruvector" ] || return 1
  fi
  printf '%s' "$phys"
}

# coedit_reset_tries <root> <store-dir> — start a hook call's lock budget:
# COEDIT_LOCK_TRIES, less COEDIT_WT_TRIES when <store-dir> is another
# worktree's store (coedit_store_dir spent up to COEDIT_WT_SECS finding it).
coedit_reset_tries() {
  _coedit_tries_left=$COEDIT_LOCK_TRIES
  [ "$2" = "$(CDPATH= cd -- "$1" 2>/dev/null && pwd -P)/.ruvector" ] && return 0
  _coedit_tries_left=$((COEDIT_LOCK_TRIES - COEDIT_WT_TRIES))
  [ "$_coedit_tries_left" -ge 0 ] || _coedit_tries_left=0
}

# coedit_write_atomic <file> — write stdin to <file> via a same-dir temp file
# and rename, so a concurrent reader sees the old or the new file, never a
# torn one.
coedit_write_atomic() {
  local f="$1" tmp
  # Only ever replace a regular file: `mv` onto a directory would drop the
  # temp file inside it, and onto a symlink would follow nothing useful.
  if [ -e "$f" ] || [ -L "$f" ]; then
    [ -f "$f" ] && [ ! -L "$f" ] || return 1
  fi
  tmp="${f}.tmp.$$.${RANDOM}"
  if cat > "$tmp" && [ -s "$tmp" ] && mv -f -- "$tmp" "$f"; then
    return 0
  fi
  # Any failure, the rename included, leaves no temp file behind.
  rm -f -- "$tmp"
  return 1
}

# coedit_lock_path <lock-dir> — take a mkdir lock, waiting 50ms per try out
# of the hook call's shared budget (_coedit_tries_left, reset to
# COEDIT_LOCK_TRIES by each coedit_record / coedit_suggest_once call), so
# concurrent edits queue up instead of dropping their work while the session
# and store locks together never outlast ~0.4s. Out of budget: the caller
# skips. A lock older than a minute is from a killed hook (the hook timeout
# is 1s). Each stale lock generation (directory inode + mtime; inodes alone
# are reused at once) is reclaimed at most once: the reclaimer first creates
# the marker <lock>.reclaim.<inode>-<mtime> (atomic mkdir) and re-checks
# the inode and mtime (an unchanged mtime keeps it stale), so two waiters
# that judged the same lock stale cannot both act and neither can delete a
# fresh lock that replaced it. Ages come from stat + date, not find -mmin.
# Markers are pruned after 10 minutes.
coedit_lock_path() {
  local lock="$1" ino mt marker
  : "${_coedit_tries_left:=$COEDIT_LOCK_TRIES}"
  until mkdir "$lock" 2>/dev/null; do
    [ "$_coedit_tries_left" -gt 0 ] || return 1
    _coedit_tries_left=$((_coedit_tries_left - 1))
    mt=$(coedit_mtime "$lock")
    if coedit_older_than "$mt" 60; then
      ino=$(ls -di "$lock" 2>/dev/null | awk '{print $1}')
      case "$ino" in ''|*[!0-9]*) sleep 0.05; continue ;; esac
      marker="${lock}.reclaim.${ino}-${mt}"
      # This generation's own marker is checked first: if a reclaimer died
      # after creating it (over 10 minutes ago), it is removed so this
      # reclaim can proceed, however many other markers sort before it.
      [ -d "$marker" ] && [ ! -L "$marker" ] && coedit_older_than "$(coedit_mtime "$marker")" 600 \
        && rmdir "$marker" 2>/dev/null
      # Other generations' markers are never listed here (a checkout can
      # ship any number of them, and even a glob would eat the hook's 1s
      # budget): the SessionStart worker sweeps expired ones, bounded.
      # A stale lock may not be empty (a checkout or crash can leave files
      # in it): rename it aside atomically (that alone frees the lock), then
      # remove the renamed copy in a detached job, so a large tree never
      # holds the hook past its 1s budget.
      local aside="${lock}.stale.${ino}-${mt}.$$"
      if mkdir "$marker" 2>/dev/null \
         && [ "$(ls -di "$lock" 2>/dev/null | awk '{print $1}')" = "$ino" ] \
         && [ "$(coedit_mtime "$lock")" = "$mt" ] \
         && mv -- "$lock" "$aside" 2>/dev/null; then
        ( rm -rf -- "$aside" ) </dev/null >/dev/null 2>&1 &
      fi
      continue
    fi
    sleep 0.05
  done
  return 0
}

# coedit_mtime <path> — modification time in epoch seconds, portably (GNU
# `stat -c %Y`, BSD/macOS `stat -f %m`); prints nothing on failure.
coedit_mtime() {
  stat -c %Y -- "$1" 2>/dev/null || stat -f %m -- "$1" 2>/dev/null
}

# coedit_older_than <epoch-mtime> <secs> — true when the mtime is numeric and
# more than <secs> seconds ago (no GNU/BSD find -mmin differences).
coedit_older_than() {
  local now
  case "${1:-}" in ''|*[!0-9]*) return 1 ;; esac
  now=$(date +%s)
  [ $((now - $1)) -gt "$2" ]
}

coedit_unlock_path() { rmdir "$1" 2>/dev/null; }

# coedit_quarantine <file> — set a store file aside under a fresh unique
# name. mktemp creates the destination exclusively (never an existing path
# or symlink a checkout planted), so `mv` renames over that new regular
# file instead of moving the store into a directory a symlink points at.
coedit_quarantine() {
  local dest
  if [ -d "$1" ] && [ ! -L "$1" ]; then
    # A directory cannot replace a file: move it into a fresh private dir.
    dest=$(mktemp -d "${1}.corrupt-XXXXXX" 2>/dev/null) || return 1
    mv -f -- "$1" "$dest/" 2>/dev/null || { rmdir -- "$dest" 2>/dev/null; return 1; }
    return 0
  fi
  dest=$(mktemp "${1}.corrupt-XXXXXX" 2>/dev/null) || return 1
  mv -f -- "$1" "$dest" 2>/dev/null || { rm -f -- "$dest"; return 1; }
}

# coedit_bump <store-dir> <a> <b> — add one to the symmetric pair a<->b.
# The caller holds the store lock (<store-dir>/.coedit.lock).
coedit_bump() {
  local dir="$1" a="$2" b="$3" f cur="" size
  f="${dir}/coedit.json"
  # A symlinked (or non-regular) store file could import another project's
  # pairs or swallow writes, and an oversized one (a checkout can ship it)
  # would not parse inside the hook's 1s: set it aside unparsed.
  if [ -L "$f" ] || { [ -e "$f" ] && [ ! -f "$f" ]; }; then
    coedit_quarantine "$f"
  fi
  if [ -f "$f" ]; then
    size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
    case "$size" in ''|*[!0-9]*) size=0 ;; esac
    if [ "$size" -gt "$COEDIT_MAX_BYTES" ]; then
      coedit_quarantine "$f"
    else
      cur="$f"
    fi
  fi
  # Existing keys are project data (a checkout can ship a coedit.json):
  # every rewrite keeps only root-relative paths coedit_normalize could have
  # produced, only the version/pairs fields, and rebuilds the pairs as
  # undirected (both directions carry the larger of the two counts), so the
  # store is symmetric after every write. One bounded jq validates and
  # rewrites: a malformed store is set aside; a timeout skips the increment.
  local out rc=0
  if [ -n "$cur" ]; then
    out=$(coedit_jq -c --arg a "$a" --arg b "$b" --argjson cap "$COEDIT_MAX_PAIRS" --argjson maxbytes "$COEDIT_MAX_BYTES" "$_COEDIT_BUMP_JQ" "$cur" 2>/dev/null) || rc=$?
  else
    out=$(printf '{"version":1,"pairs":{}}' | coedit_jq -c --arg a "$a" --arg b "$b" --argjson cap "$COEDIT_MAX_PAIRS" --argjson maxbytes "$COEDIT_MAX_BYTES" "$_COEDIT_BUMP_JQ" 2>/dev/null) || rc=$?
  fi
  # jq exits 2 or 4 on unparseable input (by version), 3 on our validation
  # failure, 5 on a runtime type error: all malformed. 124/137/143 are the
  # time bound. A clean exit with no document (an empty or whitespace-only
  # file) or with several (concatenated JSON values) is malformed too.
  if [ "$rc" -eq 0 ]; then
    case "$out" in ''|*"
"*) rc=3 ;; esac
  fi
  if [ "$rc" -ge 2 ] && [ "$rc" -le 5 ]; then
    coedit_quarantine "$f"
    out=$(printf '{"version":1,"pairs":{}}' | coedit_jq -c --arg a "$a" --arg b "$b" --argjson cap "$COEDIT_MAX_PAIRS" --argjson maxbytes "$COEDIT_MAX_BYTES" "$_COEDIT_BUMP_JQ" 2>/dev/null) || return 0
  elif [ "$rc" -ne 0 ]; then
    return 0
  fi
  [ -n "$out" ] && printf '%s\n' "$out" | coedit_write_atomic "$f"
  return 0
}

# coedit_record <root> <session-id> <path> — note an edit of <path>; when the
# same session edited a different file within COEDIT_WINDOW_SECS, count the
# pair. Needs <root>/.ruvector to exist (the project opted in).
# Locks: a per-session lock covers the whole read-decide-write of the session
# file, so parallel edits in one session never read the same prior state and
# the session always advances to the latest edit; the store lock is only
# taken for the pair update, and when it is busy only that increment is lost.
coedit_record() {
  local root="$1" sid rel dir sdir sfile slock now last="" epoch=0 state
  dir=$(coedit_store_dir "$root") || return 0
  sid=$(coedit_sanitize_session "${2:-}") || return 0
  rel=$(coedit_normalize "$root" "${3:-}") || return 0
  sdir="${dir}/coedit-sessions"
  # A symlinked session dir (from a hostile checkout) could point anywhere.
  [ -L "$sdir" ] && return 0
  mkdir -p "$sdir" 2>/dev/null || return 0
  sfile="${sdir}/${sid}"
  slock="${sdir}/.${sid}.lock"
  coedit_reset_tries "$root" "$dir"
  coedit_lock_path "$slock" || return 0
  now=$(date +%s)
  state='{}'
  # Session files are tiny; a large one (shipped by a checkout) is ignored.
  # Exactly one JSON object, or the state is reset: jq -e would pass a
  # multi-document file on its last value, and writing it back would keep
  # every later read multi-valued.
  if [ -f "$sfile" ] && [ ! -L "$sfile" ] && [ "$(wc -c < "$sfile" | tr -d ' ')" -le 65536 ] \
     && state=$(jq -c -s 'if length == 1 and (.[0] | type) == "object" then .[0] else error("malformed") end' "$sfile" 2>/dev/null) \
     && [ -n "$state" ]; then
    # Control characters are rejected inside jq, before the shell sees the
    # string: a NUL would be dropped by $(...) and alias another path.
    last=$(printf '%s' "$state" | jq -r 'if (.last | type) == "string" and (.last | test("[[:cntrl:]\u0085\u2028\u2029]") | not) then .last else "" end')
    epoch=$(printf '%s' "$state" | jq -r 'if (.epoch | type) == "number" then .epoch | floor else 0 end')
  else
    state='{}'
  fi
  case "$epoch" in ''|*[!0-9]*) epoch=0 ;; esac
  local pair=""
  if [ -n "$last" ] && [ "$last" != "$rel" ] && [ $((now - epoch)) -ge 0 ] && [ $((now - epoch)) -le "$COEDIT_WINDOW_SECS" ]; then
    # The stored path is project data: re-resolve it (symlinks included)
    # exactly as a fresh edit would be before it can enter the store.
    if last=$(coedit_normalize "$root" "$last") && [ "$last" != "$rel" ]; then
      pair=1
    fi
  fi
  # Persist this edit and release the session lock BEFORE waiting on the
  # store lock, so the session's next edit never queues behind a busy store
  # and always sees this path as its predecessor.
  # A session state that could not be saved keeps its old predecessor, so
  # counting this pair would seed false pairs later: skip the increment.
  # Only the known fields are written (an unrecognized or oversized field
  # would push the file past the 64 KB its readers accept); `surfaced` is
  # kept when it is an array within the 32 KB its writer allows.
  if ! printf '%s' "$state" | jq -c --arg l "$rel" --argjson e "$now" '
      {last: $l, epoch: $e}
      + (if (.surfaced | type) == "array" and (.surfaced | tojson | utf8bytelength) <= 32768
         then {surfaced: .surfaced} else {} end)' 2>/dev/null \
       | coedit_write_atomic "$sfile"; then
    pair=""
  fi
  coedit_unlock_path "$slock"
  if [ -n "$pair" ] && coedit_lock_path "${dir}/.coedit.lock"; then
    coedit_bump "$dir" "$last" "$rel"
    coedit_unlock_path "${dir}/.coedit.lock"
  fi
  return 0
}

# coedit_shard [digit] — a random -name bracket expression covering one of
# eight slices of the session-id alphabet [A-Za-z0-9_-] (or, with `digit`,
# one of five pairs of digits). COEDIT_SHARD (an index) pins it for tests.
coedit_shard() {
  local -a sh
  if [ "${1:-}" = digit ]; then
    sh=('[01]' '[23]' '[45]' '[67]' '[89]')
  else
    sh=('[0-3]' '[4-7]' '[89ab]' '[cdef]' '[g-p]' '[q-z]' '[A-M]' '[N-Z_-]')
  fi
  local i="${COEDIT_SHARD:-$RANDOM}"
  case "$i" in ''|*[!0-9]*) i=$RANDOM ;; esac
  printf '%s' "${sh[$(( i % ${#sh[@]} ))]}"
}

# coedit_prune_sessions <root> — delete session files untouched for 7+ days.
# Never follows a symlinked store or session dir: it could point at
# unrelated files.
coedit_prune_sessions() {
  local store sdir
  store=$(coedit_store_dir "${1:-}") || return 0
  sdir="${store}/coedit-sessions"
  [ -d "$sdir" ] && [ ! -L "$sdir" ] || return 0
  # POSIX-only primaries (no -mindepth/-maxdepth/-delete): the top level
  # of $sdir, regular session files older than 7 days.
  # Detached and time-bounded: a huge or slow session dir must never delay
  # the SessionStart response (the hook prints its JSON without waiting).
  # The worker first enters the dir and checks it is physically the
  # validated session dir ($sdir is built from the physical store path);
  # from then on `find .` works on that directory itself, so a symlink
  # swapped in afterwards cannot redirect the deletes.
  # Each candidate is deleted only under its per-session lock (the one
  # coedit_record holds) after its age is checked again, so a session that
  # was resumed and rewritten after `find` listed it is never removed.
  ( CDPATH= cd -P -- "$sdir" 2>/dev/null && [ "$(pwd -P)" = "$sdir" ] || exit 0
    SECONDS=0
    # A full listing gets 3s. If it times out (a huge or slow dir), the next
    # 2s go to one random name shard (session ids are [A-Za-z0-9_-]; -name
    # is tested before the stat-costly primaries), so over several runs
    # every part of the dir is reached, not only the prefix a timed-out
    # listing always stops in.
    { run_budgeted 3 find . ! -name . -prune -type f -mtime +7 ! -name '.*' \
        || LC_ALL=C run_budgeted 2 find . ! -name . -prune -name "$(coedit_shard)*" -type f -mtime +7
    } 2>/dev/null \
      | while IFS= read -r f && [ "$SECONDS" -lt 5 ]; do
          f="${f#./}"
          sid=$(coedit_sanitize_session "$f") && [ "$sid" = "$f" ] || continue
          # coedit_lock_path also reclaims a lock left by a killed hook (over
          # a minute old), so an abandoned session is still pruned.
          _coedit_tries_left=1
          coedit_lock_path ".${sid}.lock" || continue
          if [ -f "$f" ] && [ ! -L "$f" ] && coedit_older_than "$(coedit_mtime "$f")" 604800; then
            rm -f -- "$f"
            # Its reclaim markers are left to the bounded marker sweep below
            # (every marker over 10 minutes old), never globbed here.
            coedit_unlock_path ".${sid}.lock"
            continue
          fi
          coedit_unlock_path ".${sid}.lock"
        done
      # Expired reclaim markers (over 10 minutes old, long after any reclaim
      # of that generation finished), of the session locks here and of the
      # store lock in the store dir; the hooks never list them. Discovery is
      # top-level finds under a 2s bound each feeding a random sample of at
      # most 500 names (O(sample) memory, never a full glob), and the sweep
      # is bounded by time and by removals (50), not by entries looked at, so
      # markers that cannot be removed (not empty) never keep it from
      # reaching later ones. Each cleanup phase gets its own 5s budget
      # (SECONDS restarts), so a slow session-file scan above never starves
      # the marker and stale-tree sweeps below.
      SECONDS=0
      nl='
'
      markers=()
      # A timed-out listing is followed by one random name shard (session
      # locks by the session id's first character, the store lock's by the
      # inode's first digit), as for the session files above.
      while IFS= read -r m; do markers+=("${m#./}"); done < <(
        { run_budgeted 2 find . ! -name . -prune -type d -name '.*.lock.reclaim.*' ! -name "*${nl}*" \
            || LC_ALL=C run_budgeted 1 find . ! -name . -prune -name ".$(coedit_shard)*.lock.reclaim.*" -type d ! -name "*${nl}*"
          run_budgeted 2 find .. ! -name .. -prune -type d -name '.coedit.lock.reclaim.*' ! -name "*${nl}*" \
            || LC_ALL=C run_budgeted 1 find .. ! -name .. -prune -name ".coedit.lock.reclaim.$(coedit_shard digit)*" -type d ! -name "*${nl}*"
        } 2>/dev/null \
          | LC_ALL=C awk -v k=500 'BEGIN { srand() }
              { t++; if (t <= k) r[t] = $0; else { j = int(rand() * t) + 1; if (j <= k) r[j] = $0 } }
              END { c = (t < k) ? t : k; for (i = 1; i <= c; i++) print r[i] }'
      )
      # Timed-out listings plus their shard passes can take 6s: the sweep
      # itself always keeps at least 2s of the phase's 5.
      [ "$SECONDS" -le 3 ] || SECONDS=3
      total=${#markers[@]} tried=0 removed=0 i=0
      [ "$total" -eq 0 ] || i=$(( ((RANDOM << 15) | RANDOM) % total ))
      while [ "$tried" -lt "$total" ] && [ "$removed" -lt 50 ] && [ "$SECONDS" -lt 5 ]; do
        m=${markers[$(( (i + tried) % total ))]}
        tried=$((tried + 1))
        [ -d "$m" ] && [ ! -L "$m" ] || continue
        coedit_older_than "$(coedit_mtime "$m")" 600 && rmdir -- "$m" 2>/dev/null && removed=$((removed + 1))
      done
      SECONDS=0
      # Stale lock trees a reclaim renamed aside (<lock>.stale.*) whose
      # background delete was interrupted: here and in the store dir, only
      # when untouched for 10 minutes (a delete still in progress keeps
      # updating the dir's mtime). rm -rf never follows symlinks inside the
      # tree, and a symlinked entry is skipped. Bounded (at most 50 tried,
      # 10 removed per run) and started at a random entry, so trees that
      # cannot be removed never keep the sweep from reaching later ones.
      # Discovery is bounded too: top-level-only finds (-type d never
      # matches a symlink), 2s each, instead of expanding every match. One
      # awk pass over what they list keeps O(window) memory: a max-heap of
      # the COEDIT_STALE_WINDOW (2000) smallest names after the one the
      # previous window ended on (.stale-sweep-cursor), and a random sample
      # of the same size. After a complete scan the window is the heap and
      # the cursor moves to its end (or wraps once every remaining name
      # fitted). After a partial scan (a find timed out) nothing proves
      # which names were not listed, so the cursor stays put and the window
      # is the random sample: trees that can never be removed cannot pin the
      # sweep, and no unseen name is ever skipped. A tree that could not be
      # removed is moved into .coedit-stale-held (retried there a few per
      # run), so a timed-out find never keeps re-listing the same prefix.
      win=${COEDIT_STALE_WINDOW:-2000}
      case "$win" in ''|*[!0-9]*|0) win=2000 ;; esac
      cur=""
      if [ -f .stale-sweep-cursor ] && [ ! -L .stale-sweep-cursor ]; then
        IFS= read -r cur < .stale-sweep-cursor || true
        [ "${#cur}" -le 1024 ] || cur=""
      fi
      ctl="" found=() stale=()
      # Names holding a newline are never listed (every tree a reclaim renames
      # aside has a plain name), so each find line is one whole name starting
      # with "." ("./…" or "../…"): END can only be the marker that both
      # finds completed, and the awk's first output line (CURSOR<TAB>… or
      # KEEP) can only be its control line.
      nl='
'
      while IFS= read -r m; do
        if [ -z "$ctl" ]; then ctl="$m"; else found+=("$m"); fi
      done < <(
        { run_budgeted 2 find . ! -name . -prune -type d -name '.*.lock.stale.*' ! -name "*${nl}*"; a=$?
          run_budgeted 2 find .. ! -name .. -prune -type d -name '.coedit.lock.stale.*' ! -name "*${nl}*"; b=$?
          [ "$a" -eq 0 ] && [ "$b" -eq 0 ] && printf 'END\n'; } 2>/dev/null \
          | COEDIT_CUR="$cur" LC_ALL=C awk -v k="$win" '
              function sw(i, j,  t) { t = h[i]; h[i] = h[j]; h[j] = t }
              function push(x,  i, p) {
                h[++n] = x; i = n
                while (i > 1) { p = int(i / 2); if (h[p] >= h[i]) break; sw(p, i); i = p }
              }
              function pop(  i, c, l) {
                h[1] = h[n]; delete h[n]; n--; i = 1
                while (1) {
                  l = 2 * i; c = i
                  if (l <= n && h[l] > h[c]) c = l
                  if (l + 1 <= n && h[l + 1] > h[c]) c = l + 1
                  if (c == i) break
                  sw(i, c); i = c
                }
              }
              BEGIN { cur = ENVIRON["COEDIT_CUR"]; n = 0; m = 0; t = 0; done = 0; srand() }
              $0 == "END" { done = 1; next }
              {
                t++
                if (t <= k) r[t] = $0; else { j = int(rand() * t) + 1; if (j <= k) r[j] = $0 }
                if ($0 > cur) {
                  m++
                  if (n < k) push($0); else if ($0 < h[1]) { pop(); push($0) }
                }
              }
              END {
                if (done) {
                  if (m <= k) print "CURSOR\t"; else print "CURSOR\t" h[1]
                  for (i = 1; i <= n; i++) print h[i]
                } else {
                  print "KEEP"
                  c = (t < k) ? t : k
                  for (i = 1; i <= c; i++) print r[i]
                }
              }'
      )
      case "$ctl" in
        CURSOR$'\t'*) next=${ctl#CURSOR$'\t'} ;;
        *) next="$cur" ;;
      esac
      if [ "$next" != "$cur" ]; then
        # The session dir is project data: a symlink planted at the cursor
        # path is removed (never followed), and coedit_write_atomic replaces
        # only a regular file, so the rename cannot land outside the dir.
        [ -L .stale-sweep-cursor ] && rm -f -- .stale-sweep-cursor
        # Anything else that is not a regular file there (a directory, a
        # FIFO) would make the write fail forever: remove it, bounded.
        if [ -e .stale-sweep-cursor ] && [ ! -f .stale-sweep-cursor ]; then
          run_budgeted 2 rm -rf -- .stale-sweep-cursor 2>/dev/null
        fi
        printf '%s\n' "$next" | coedit_write_atomic .stale-sweep-cursor || true
      fi
      for m in ${found[@]+"${found[@]}"}; do
        [ -d "$m" ] && [ ! -L "$m" ] && stale+=("$m")
      done
      total=${#stale[@]} tried=0 removed=0
      if [ "$total" -gt 0 ]; then
        # Two RANDOMs (15 bits each): a start anywhere in up to 2^30 entries.
        i=$(( ((RANDOM << 15) | RANDOM) % total ))
        while [ "$tried" -lt "$total" ] && [ "$tried" -lt 50 ] && [ "$removed" -lt 10 ] && [ "$SECONDS" -lt 5 ]; do
          m=${stale[$(( (i + tried) % total ))]}
          tried=$((tried + 1))
          coedit_older_than "$(coedit_mtime "$m")" 600 || continue
          # Each deletion is bounded too (a huge tree or slow filesystem);
          # what is left is picked up by a later sweep.
          run_budgeted 2 rm -rf -- "$m" 2>/dev/null
          if [ ! -e "$m" ]; then
            removed=$((removed + 1))
          else
            # Not removable now (permissions, or too big for one bounded
            # rm): move it out of the listing into .coedit-stale-held, so a
            # find that times out on a huge directory reaches further next
            # time instead of re-listing the same stuck prefix.
            h="${m%/*}/.coedit-stale-held"
            { [ -d "$h" ] && [ ! -L "$h" ]; } || { [ ! -e "$h" ] && [ ! -L "$h" ] && mkdir "$h" 2>/dev/null; }
            [ -d "$h" ] && [ ! -L "$h" ] && mv -- "$m" "$h/" 2>/dev/null
          fi
        done
      fi
      # Held trees get a few bounded retries per run.
      for h in ./.coedit-stale-held ../.coedit-stale-held; do
        [ "$SECONDS" -lt 5 ] || break
        [ -d "$h" ] && [ ! -L "$h" ] || continue
        while IFS= read -r m; do
          [ "$SECONDS" -lt 5 ] || break
          [ -d "$m" ] && [ ! -L "$m" ] && run_budgeted 2 rm -rf -- "$m" 2>/dev/null
        done < <(run_budgeted 1 find "$h" ! -name "${h##*/}" -prune -type d -name '.*.lock.stale.*' ! -name "*${nl}*" 2>/dev/null | head -n 3)
        rmdir -- "$h" 2>/dev/null
      done ) \
    </dev/null >/dev/null 2>&1 &
  return 0
}

COEDIT_MIN_COUNT="${COEDIT_MIN_COUNT:-3}"
COEDIT_MAX_SUGGESTIONS="${COEDIT_MAX_SUGGESTIONS:-3}"

# coedit_partners <root> <rel> <limit> <min> — print "count<TAB>partner"
# lines, highest count first. Every partner is re-validated: coedit.json is
# project data (a cloned repo could ship one), so a partner that does not
# normalize to itself, or no longer exists as a file under the root, is
# dropped and never printed.
# coedit_partner_ok <root> <physical-root> <rel> — a stored partner is shown
# only if it is exactly a path coedit_normalize could have produced: lexically
# safe and root-relative, an existing regular file that is not a symlink,
# under a directory that physically resolves to the same place inside the
# root. Lexical and missing-file rejections cost no subprocess; the physical
# directory check (one subshell) runs once per directory and at most
# _coedit_phys_left times per lookup, so a long candidate list fits the
# hook budget.
coedit_partner_ok() {
  local root="$1" rroot="$2" p="$3" d phys
  [ -n "$p" ] && [ "${#p}" -le 512 ] || return 1
  case "$p" in
    /*|-*|./*|../*|*/./*|*/../*|*/.|*/..|.|..|*//*) return 1 ;;
    .ruvector|.ruvector/*|.git|.git/*|docs/solutions/*) return 1 ;;
  esac
  case "$p" in *[[:cntrl:]]*|*$'\xc2\x85'*|*$'\xe2\x80\xa8'*|*$'\xe2\x80\xa9'*) return 1 ;; esac
  [ -f "${root}/${p}" ] && [ ! -L "${root}/${p}" ] || return 1
  case "$p" in
    */*)
      d="${p%/*}"
      case "${_coedit_ok_dirs:-}" in *$'\n'"$d"$'\n'*) return 0 ;; esac
      case "${_coedit_bad_dirs:-}" in *$'\n'"$d"$'\n'*) return 1 ;; esac
      # Symlinked components are rejected with builtin tests, before the
      # budgeted subshell: a store full of symlinked-dir partners must not
      # use up the checks the real partners below them need. The walk has
      # its own total budget per lookup (_coedit_comp_left), so hundreds of
      # deep candidates stay inside the hook's 1s.
      local rest="$d/" pre=""
      while [ -n "$rest" ]; do
        [ "${_coedit_comp_left:-0}" -gt 0 ] || return 1
        _coedit_comp_left=$((_coedit_comp_left - 1))
        pre="${pre}${rest%%/*}"; rest="${rest#*/}"
        if [ -L "${root}/${pre}" ] || [ ! -d "${root}/${pre}" ]; then
          _coedit_bad_dirs="${_coedit_bad_dirs:-}"$'\n'"$d"$'\n'
          return 1
        fi
        pre="${pre}/"
      done
      [ "${_coedit_phys_left:-0}" -gt 0 ] || return 1
      _coedit_phys_left=$((_coedit_phys_left - 1))
      phys=$(CDPATH= cd -- "${root}/${d}" 2>/dev/null && pwd -P) || return 1
      [ "$phys" = "${rroot}/${d}" ] || return 1
      _coedit_ok_dirs="${_coedit_ok_dirs}${d}"$'\n' ;;
  esac
  return 0
}

# coedit_partners <root> <rel> [limit] [min-count] [store-dir] — print up to
# <limit> validated "<count>\t<partner>" lines, highest count first.
coedit_partners() {
  local root="$1" rel="$2" limit="${3:-10}" min="${4:-1}" store="${5:-}" f count partner norm n=0
  # A caller that already resolved the store passes it (in a linked worktree
  # resolving it scans the main checkout's index; do that once per hook).
  [ -n "$store" ] || store=$(coedit_store_dir "$root") || return 0
  f="${store}/coedit.json"
  [ -f "$f" ] && [ ! -L "$f" ] || return 0
  # An oversized file would not parse inside the 1s PreToolUse budget; the
  # next PostToolUse write sets it aside.
  local size
  size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  case "$size" in ''|*[!0-9]*) return 0 ;; esac
  [ "$size" -le "$COEDIT_MAX_BYTES" ] || return 0
  # jq is time-bounded (COEDIT_JQ_SECS) and yields the top COEDIT_SCAN
  # candidates by count. Validation runs before the limit, so deleted or
  # unsafe partners at the top never hide valid ones below them; stale
  # entries cost no subprocess and the directory checks are budgeted, so a
  # hostile store cannot keep the loop busy. The defaults fit the 1s hook;
  # the on-demand /ruvector:related raises all four (coedit-related.sh).
  local rroot
  rroot=$(CDPATH= cd -- "$root" 2>/dev/null && pwd -P) || return 0
  _coedit_phys_left=${COEDIT_PHYS_CHECKS:-50}
  _coedit_comp_left=${COEDIT_COMP_CHECKS:-1500}
  _coedit_ok_dirs=$'\n'; _coedit_bad_dirs=$'\n'
  # Capture the candidates first: streamed through a pipe, a large list
  # would block jq on the full pipe while the validation loop runs, and the
  # jq time bound would then cut the list short.
  local cands
  cands=$(coedit_jq -r --arg r "$rel" --argjson min "$min" --argjson scan "${COEDIT_SCAN:-500}" '
      (.pairs[$r] // {}) | to_entries
      | map(select((.value | type) == "number" and .value >= $min
                   and .key != $r
                   and (.key | test("[[:cntrl:]\u0085\u2028\u2029]") | not)))
      | sort_by(-.value, .key) | .[0:$scan][] | "\(.value | floor)\t\(.key)"
    ' "$f" 2>/dev/null) || return 0
  [ -n "$cands" ] || return 0
  while IFS=$'\t' read -r count partner; do
    case "$count" in ''|*[!0-9]*) continue ;; esac
    coedit_partner_ok "$root" "$rroot" "$partner" || continue
    printf '%s\t%s\n' "$count" "$partner"
    n=$((n + 1))
    [ "$n" -ge "$limit" ] && break
  done <<< "$cands"
  return 0
}

# coedit_suggest_once <root> <session-id> <path> — print a fenced suggestion
# block for <path> the first time this session edits it (and only when some
# partner clears COEDIT_MIN_COUNT); record it as surfaced. Prints nothing
# otherwise.
coedit_suggest_once() {
  local root="$1" store sid rel sfile slock lines seen
  store=$(coedit_store_dir "$root") || return 0
  [ -L "${store}/coedit-sessions" ] && return 0
  sid=$(coedit_sanitize_session "${2:-}") || return 0
  rel=$(coedit_normalize "$root" "${3:-}") || return 0
  sfile="${store}/coedit-sessions/${sid}"
  # Only a regular session file (or none) is read: a FIFO or device there
  # would block jq past the hook's 1s budget.
  [ -L "$sfile" ] && return 0
  { [ -e "$sfile" ] && [ ! -f "$sfile" ]; } && return 0
  # Same session-size policy as coedit_record: never parse an oversized
  # session file inside the 1s hook (the next record resets it).
  if [ -f "$sfile" ] && [ "$(wc -c < "$sfile" | tr -d ' ')" -gt 65536 ]; then
    return 0
  fi
  if [ -f "$sfile" ] && jq -e --arg r "$rel" '(.surfaced | if type == "array" then map(select(type == "string")) else [] end) | index($r) != null' "$sfile" >/dev/null 2>&1; then
    return 0
  fi
  lines=$(coedit_partners "$root" "$rel" "$COEDIT_MAX_SUGGESTIONS" "$COEDIT_MIN_COUNT" "$store")
  [ -n "$lines" ] || return 0
  mkdir -p "${store}/coedit-sessions" 2>/dev/null || return 0
  # The same per-session lock as coedit_record: a parallel PostToolUse
  # rewrite of this session file must not drop `surfaced` (or `last`).
  slock="${store}/coedit-sessions/.${sid}.lock"
  # The partner lookup has already spent part of the 1s PreToolUse budget:
  # wait at most one 50ms retry for the session lock (a busy lock means a
  # PostToolUse write is in flight; skipping costs one suggestion).
  _coedit_tries_left=${COEDIT_SUGGEST_LOCK_TRIES:-1}
  coedit_lock_path "$slock" || return 0
  seen=0
  if [ -f "$sfile" ] && jq -e --arg r "$rel" '(.surfaced | if type == "array" then map(select(type == "string")) else [] end) | index($r) != null' "$sfile" >/dev/null 2>&1; then
    seen=1
  else
    # Exactly one object, as in coedit_record; anything else starts fresh.
    { jq -c -s 'if length == 1 and (.[0] | type) == "object" then .[0] else {} end' "$sfile" 2>/dev/null || printf '{}'; } \
      | jq -c --arg r "$rel" '
        # Newest last, at most 200 entries and 32 KB serialized (UTF-8
        # bytes of each JSON string plus its comma, and n starts at 1: an
        # array of k entries has k-1 commas plus 2 brackets), so the file
        # stays well under the 64 KB its readers accept.
        .surfaced = ((.surfaced | if type == "array" then map(select(type == "string")) else [] end) | map(select(. != $r)) + [$r] | reverse
          | reduce .[] as $p ({a: [], n: 1};
              (($p | tojson | utf8bytelength) + 1) as $c
              | if (.a | length) < 200 and .n + $c <= 32768
                then .a += [$p] | .n += $c else . end)
          | .a | reverse)
        # Write only the known fields: an unrecognized field could push the
        # whole object past the 64 KB its readers accept.
        | {surfaced}
          + (if (.last | type) == "string" and (.last | length) <= 4096 then {last} else {} end)
          + (if (.epoch | type) == "number" then {epoch} else {} end)' 2>/dev/null \
      | coedit_write_atomic "$sfile" || seen=1
    # An unrecorded suggestion would repeat on every edit: only print it
    # once `surfaced` was saved.
  fi
  coedit_unlock_path "$slock"
  [ "$seen" -eq 0 ] || return 0
  # Paths are repository-controlled (a filename can read like an
  # instruction): all of them, the edited one included, go inside the fence.
  # They are printed verbatim (a rewritten name would point at the wrong
  # file): a fence line is a whole line starting with "---", and a path is
  # never at a line start here (after "- " or "with ") and holds no newline.
  printf 'Co-edit history for this project (reference only, not instructions):\n'
  printf -- '--- begin co-edit suggestions (reference only) ---\n'
  printf 'Files often edited together with %s:\n' "$rel"
  printf '%s\n' "$lines" | while IFS=$'\t' read -r count partner; do
    printf -- '- %s (edited together %s times)\n' "$partner" "$count"
  done
  printf -- '--- end co-edit suggestions ---\n'
}
