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
COEDIT_MAX_PAIRS="${COEDIT_MAX_PAIRS:-5000}"
# A store past this size is set aside unparsed (5000 pairs of 512-char paths
# stay well under it).
COEDIT_MAX_BYTES="${COEDIT_MAX_BYTES:-4194304}"

# coedit_sanitize_session <id> — print a filename-safe session id, or fail.
coedit_sanitize_session() {
  local sid
  sid=$(printf '%s' "${1:-}" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-128)
  case "$sid" in ''|.|..) return 1 ;; esac
  printf '%s' "$sid"
}

# coedit_normalize <root> <path> — print <path> relative to the physical
# root, or fail for: empty, control characters, over 512 chars, outside the
# root (symlinks resolved, the final component included), or inside
# .ruvector/, .git/, or docs/solutions/.
coedit_normalize() {
  local root="${1:-}" p="${2:-}" abs dir rroot rel link hops=0
  [ -n "$root" ] && [ -n "$p" ] || return 1
  [ "${#p}" -le 512 ] || return 1
  if printf '%s' "$p" | LC_ALL=C grep -q '[[:cntrl:]]'; then return 1; fi
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
  if printf '%s' "$rel" | LC_ALL=C grep -q '[[:cntrl:]]'; then return 1; fi
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
    command -v ruvector_main_worktree >/dev/null 2>&1 || return 1
    main=$(ruvector_main_worktree "$root") || return 1
    main=$(CDPATH= cd -- "$main" 2>/dev/null && pwd -P) || return 1
    [ "$phys" = "${main}/.ruvector" ] || return 1
  fi
  printf '%s' "$phys"
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
  if cat > "$tmp" && [ -s "$tmp" ]; then
    mv -f -- "$tmp" "$f"
  else
    rm -f -- "$tmp"
    return 1
  fi
}

# coedit_lock_path <lock-dir> — take a mkdir lock, waiting up to 10 x 50ms:
# concurrent edits queue up instead of dropping their work; past ~0.5s the
# caller skips, leaving headroom under the hook's 1s timeout so it still
# prints its allow JSON. A lock older than a minute is from a killed hook
# (the hook's timeout is 1s). Each stale lock generation (its directory
# inode) is reclaimed at most once: the reclaimer first creates the marker
# <lock>.reclaim.<inode> (atomic mkdir) and re-checks the inode and age, so
# two waiters that judged the same lock stale cannot both act, and neither
# can delete a fresh lock that replaced it. Markers are pruned after 10
# minutes, long after any waiter that saw that generation has finished.
coedit_lock_path() {
  local lock="$1" tries=0 ino marker
  until mkdir "$lock" 2>/dev/null; do
    tries=$((tries + 1))
    [ "$tries" -le 10 ] || return 1
    if [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
      ino=$(ls -di "$lock" 2>/dev/null | awk '{print $1}')
      case "$ino" in ''|*[!0-9]*) sleep 0.05; continue ;; esac
      find "$(dirname -- "$lock")" -maxdepth 1 -type d -name "$(basename -- "$lock").reclaim.*" \
        -mmin +10 -exec rmdir {} + 2>/dev/null
      marker="${lock}.reclaim.${ino}"
      if mkdir "$marker" 2>/dev/null \
         && [ "$(ls -di "$lock" 2>/dev/null | awk '{print $1}')" = "$ino" ] \
         && [ -n "$(find "$lock" -maxdepth 0 -mmin +1 2>/dev/null)" ]; then
        rmdir "$lock" 2>/dev/null
      fi
      continue
    fi
    sleep 0.05
  done
  return 0
}

coedit_unlock_path() { rmdir "$1" 2>/dev/null; }

# coedit_bump <store-dir> <a> <b> — add one to the symmetric pair a<->b.
# The caller holds the store lock (<store-dir>/.coedit.lock).
coedit_bump() {
  local dir="$1" a="$2" b="$3" f cur size
  f="${dir}/coedit.json"
  cur='{"version":1,"pairs":{}}'
  # A symlinked (or non-regular) store file could import another project's
  # pairs or swallow writes, and an oversized one (a checkout can ship it)
  # would not parse inside the hook's 1s: set it aside unparsed.
  if [ -L "$f" ] || { [ -e "$f" ] && [ ! -f "$f" ]; }; then
    mv -f -- "$f" "${f}.corrupt-$(date +%s)" 2>/dev/null
  fi
  if [ -f "$f" ]; then
    size=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
    case "$size" in ''|*[!0-9]*) size=0 ;; esac
    if [ "$size" -gt "$COEDIT_MAX_BYTES" ]; then
      mv -f -- "$f" "${f}.corrupt-$(date +%s)" 2>/dev/null
    elif jq -e 'type == "object" and (.pairs | type) == "object"
              and all(.pairs[]; type == "object" and all(.[]; type == "number"))' "$f" >/dev/null 2>&1; then
      cur=$(cat "$f")
    else
      mv -f -- "$f" "${f}.corrupt-$(date +%s)" 2>/dev/null
    fi
  fi
  # Existing keys are project data (a checkout can ship a coedit.json):
  # every rewrite keeps only root-relative paths coedit_normalize could have
  # produced, only the version/pairs fields, and rebuilds the pairs as
  # undirected (both directions carry the larger of the two counts), so the
  # store is symmetric after every write.
  printf '%s' "$cur" | jq -c --arg a "$a" --arg b "$b" --argjson cap "$COEDIT_MAX_PAIRS" '
    def safe: type == "string" and length > 0 and length <= 512
      and (test("[[:cntrl:]]") | not) and (startswith("/") | not)
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
          then map(if .k == $k and .o == $o then .n += 1 else . end)
          else . + [{k: $k, o: $o, n: 1}] end
      else . end
    # Cap: keep the highest counts, whole pairs at a time.
    | sort_by(-.n, .k, .o) | .[0:($cap / 2 | floor)]
    | {version: 1,
       pairs: (reduce .[] as $e ({}; .[$e.k][$e.o] = $e.n | .[$e.o][$e.k] = $e.n))}
  ' 2>/dev/null | coedit_write_atomic "$f"
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
  coedit_lock_path "$slock" || return 0
  now=$(date +%s)
  state='{}'
  if [ -f "$sfile" ] && [ ! -L "$sfile" ] && jq -e 'type == "object"' "$sfile" >/dev/null 2>&1; then
    state=$(cat "$sfile")
    last=$(printf '%s' "$state" | jq -r 'if (.last | type) == "string" then .last else "" end')
    epoch=$(printf '%s' "$state" | jq -r 'if (.epoch | type) == "number" then .epoch | floor else 0 end')
  fi
  case "$epoch" in ''|*[!0-9]*) epoch=0 ;; esac
  if [ -n "$last" ] && [ "$last" != "$rel" ] && [ $((now - epoch)) -ge 0 ] && [ $((now - epoch)) -le "$COEDIT_WINDOW_SECS" ]; then
    # The stored path is project data: re-resolve it (symlinks included)
    # exactly as a fresh edit would be before it can enter the store.
    if last=$(coedit_normalize "$root" "$last") && [ "$last" != "$rel" ]; then
      if coedit_lock_path "${dir}/.coedit.lock"; then
        coedit_bump "$dir" "$last" "$rel"
        coedit_unlock_path "${dir}/.coedit.lock"
      fi
    fi
  fi
  printf '%s' "$state" | jq -c --arg l "$rel" --argjson e "$now" '.last = $l | .epoch = $e' 2>/dev/null \
    | coedit_write_atomic "$sfile"
  coedit_unlock_path "$slock"
  return 0
}

# coedit_prune_sessions <root> — delete session files untouched for 7+ days.
# Never follows a symlinked store or session dir: it could point at
# unrelated files.
coedit_prune_sessions() {
  local store sdir
  store=$(coedit_store_dir "${1:-}") || return 0
  sdir="${store}/coedit-sessions"
  [ -d "$sdir" ] && [ ! -L "$sdir" ] || return 0
  find "$sdir" -mindepth 1 -maxdepth 1 -type f -mtime +7 -delete 2>/dev/null
  return 0
}
