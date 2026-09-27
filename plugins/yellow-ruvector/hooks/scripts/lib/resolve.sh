#!/usr/bin/env bash
# Shared resolution for yellow-ruvector hooks and bin/start-ruvector.sh:
# project root, worktree store heal, the plugin-managed ruvector binary,
# the Node version floor, and a budgeted-call wrapper.
#
# Source this file. Do not execute it. Never sets -e or calls exit.

_RUVECTOR_RESOLVE_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Plugin root: CLAUDE_PLUGIN_ROOT when the host sets it, else three levels up
# from hooks/scripts/lib (bats and manual runs).
RUVECTOR_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(CDPATH= cd -- "${_RUVECTOR_RESOLVE_DIR}/../../.." && pwd)}"
unset _RUVECTOR_RESOLVE_DIR

# ruvector_resolve_root <start-dir>
# Print the project root: the git toplevel of <start-dir>, else
# CLAUDE_PROJECT_DIR, else <start-dir>, else PWD. Git comes first because
# ruvector's getIntelPath() only looks at process.cwd(); a session launched
# from a subdirectory must still use <root>/.ruvector.
ruvector_resolve_root() {
  local start="${1:-}" top
  [ -n "$start" ] || start="${CLAUDE_PROJECT_DIR:-$PWD}"
  if top=$(git -C "$start" rev-parse --show-toplevel 2>/dev/null) && [ -n "$top" ]; then
    printf '%s' "$top"
    return 0
  fi
  printf '%s' "${CLAUDE_PROJECT_DIR:-$start}"
}

# ruvector_main_worktree <dir> — print the main worktree of <dir>'s repo:
# the first entry of `git worktree list --porcelain`, unless it is bare or is
# not a real checkout. For a --separate-git-dir repo git reports the parent
# of the separate git dir, which lacks the tracked files; that is refused
# rather than mistaken for the main checkout. With nothing tracked the two
# layouts look identical to git, so a repo with no tracked files has no
# main worktree here (fail closed: no shared store).
ruvector_main_worktree() {
  local out block first main tracked=""
  out=$(git -C "${1:-.}" worktree list --porcelain 2>/dev/null) || return 1
  block=$(printf '%s\n' "$out" | sed '/^$/q')
  case "$block" in
    *$'\n'bare|*$'\n'bare$'\n'*) return 1 ;;
  esac
  first="${block%%$'\n'*}"
  case "$first" in
    "worktree "?*) main="${first#worktree }" ;;
    *) return 1 ;;
  esac
  # A gitfile in the reported checkout that resolves to the common git dir
  # proves it (a --separate-git-dir parent holds the git dir itself, never a
  # gitfile to it). A .git directory proves nothing on its own: that parent
  # has one too.
  local common gd
  common=$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    && common=$(CDPATH= cd -- "$common" 2>/dev/null && pwd -P) || common=""
  if [ -n "$common" ] && [ -f "${main}/.git" ] && [ ! -L "${main}/.git" ]; then
    gd=$(sed -n '1s/^gitdir: //p' "${main}/.git" 2>/dev/null)
    case "$gd" in /*) ;; ?*) gd="${main}/${gd}" ;; esac
    gd=$(CDPATH= cd -- "$gd" 2>/dev/null && pwd -P) || gd=""
    [ -n "$gd" ] && [ "$gd" = "$common" ] && { printf '%s' "$main"; return 0; }
  fi
  # Otherwise: a real checkout has its tracked files, matching the index; the separate
  # git dir's parent does not. Walk the checked-out ("H") entries (sparse
  # "S" entries are not expected on disk and are skipped), collecting the
  # files present on disk in batches of 50, and ask git which of each batch
  # differ from the index. One present, unmodified file is enough, so
  # locally deleted or edited files do not matter, while a file that merely
  # shares a tracked name in the git dir's parent (its stat and content will
  # not match) is not. Bounded: at most 2000 entries and 10 batches.
  # Assume-unchanged ("h") entries are checked out too, but diff-files never
  # stats them (it would call any same-named file clean): up to 20 of them
  # are compared by content against the index blob instead, only if no "H"
  # entry proved the checkout.
  local n=0 batches=0 present=() assumed=() probe=()
  while [ "$n" -lt 2000 ] && IFS= read -r -d '' tracked; do
    case "$tracked" in
      "h "?*)
        n=$((n + 1))
        [ "${#assumed[@]}" -lt 20 ] && [ -f "${main}/${tracked#h }" ] && assumed+=("${tracked#h }") ;;
      "H "?*)
        n=$((n + 1))
        [ -e "${main}/${tracked#H }" ] || continue
        [ "${#probe[@]}" -lt 20 ] && [ -f "${main}/${tracked#H }" ] && probe+=("${tracked#H }")
        present+=(":(literal)${tracked#H }")
        [ "${#present[@]}" -ge 50 ] || continue
        _ruvector_any_clean "$main" "${present[@]}" && { printf '%s' "$main"; return 0; }
        present=()
        batches=$((batches + 1))
        [ "$batches" -lt 10 ] || return 1 ;;
    esac
  done < <(git -C "$main" ls-files -v -z 2>/dev/null)
  [ "${#present[@]}" -gt 0 ] && _ruvector_any_clean "$main" "${present[@]}" \
    && { printf '%s' "$main"; return 0; }
  # Every present file differs from the index (a checkout with all its files
  # edited): the index still records each file's inode, and only the real
  # checkout's file can carry it (a same-named file in the git dir's parent
  # never does). Editors that save by rename change the inode, so up to 20
  # files are tried. The index keeps the low 32 bits.
  local rel dbg ino dev disk ddev
  for rel in ${probe[@]+"${probe[@]}"}; do
    dbg=$(git -C "$main" ls-files --debug -- ":(literal)${rel}" 2>/dev/null | sed -n 's/.*dev: \([0-9][0-9]*\).*ino: \([0-9][0-9]*\).*/\1 \2/p' | head -n 1)
    dev=${dbg%% *}; ino=${dbg#* }
    disk=$(stat -c %i -- "${main}/${rel}" 2>/dev/null || stat -f %i -- "${main}/${rel}" 2>/dev/null)
    ddev=$(stat -c %d -- "${main}/${rel}" 2>/dev/null || stat -f %d -- "${main}/${rel}" 2>/dev/null)
    case "$dev" in ''|*[!0-9]*) continue ;; esac
    case "$ino" in ''|0|*[!0-9]*) continue ;; esac
    case "$disk" in ''|*[!0-9]*) continue ;; esac
    [ "$ino" = "$(( disk % 4294967296 ))" ] || continue
    # The device too (when the index recorded one): inode numbers repeat
    # across filesystems.
    if [ "$dev" != 0 ]; then
      case "$ddev" in ''|*[!0-9]*) continue ;; esac
      [ "$dev" = "$(( ddev % 4294967296 ))" ] || continue
    fi
    printf '%s' "$main"; return 0
  done
  local blob
  for rel in ${assumed[@]+"${assumed[@]}"}; do
    blob=$(git -C "$main" ls-files -s -z -- ":(literal)${rel}" 2>/dev/null | tr '\0' '\n' | awk 'NR == 1 {print $2}')
    [ -n "$blob" ] || continue
    [ "$(git -C "$main" hash-object --path="$rel" -- "${main}/${rel}" 2>/dev/null)" = "$blob" ] \
      && { printf '%s' "$main"; return 0; }
  done
  return 1
}

# _ruvector_any_clean <main> <:(literal)path>... — true when git reports at
# least one of the (present) paths as unmodified against the index. Without
# -z git quotes only names holding a quote, backslash or control character;
# those are skipped as evidence rather than mis-compared.
_ruvector_any_clean() {
  local main="$1" dirty rel
  shift
  dirty=$(git -c core.quotePath=false -C "$main" diff-files --name-only -- "$@" 2>/dev/null) || return 1
  for rel in "$@"; do
    rel="${rel#:(literal)}"
    case "$rel" in *'"'*|*'\'*|*[[:cntrl:]]*) continue ;; esac
    case $'\n'"$dirty"$'\n' in *$'\n'"$rel"$'\n'*) continue ;; esac
    return 0
  done
  return 1
}

# ruvector_heal_store <project-root>
# In a linked git worktree whose .ruvector is missing (or a dangling
# symlink), link it to the main checkout's store — the shared-store contract
# yellow-core's worktree-manager sets up at creation. Never replaces a real
# directory or file (it may hold per-worktree data); warns instead. No-op for
# ordinary checkouts, non-git dirs, and git < 2.31 (no --path-format).
# Always returns 0; diagnostics go to stderr.
ruvector_heal_store() {
  local root="${1:-}" target common gitdir main
  [ -n "$root" ] || return 0
  target="${root}/.ruvector"
  # A linked worktree's .git is a FILE; ordinary checkouts skip here with
  # zero subprocesses.
  [ -f "${root}/.git" ] || return 0
  [ -L "$target" ] && [ -e "$target" ] && return 0
  common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 0
  gitdir=$(git -C "$root" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 0
  [ -n "$common" ] && [ -n "$gitdir" ] && [ "$common" != "$gitdir" ] || return 0
  # The main worktree as git reports it: never the parent of a bare repo or
  # of a --separate-git-dir common dir.
  main=$(ruvector_main_worktree "$root") || return 0
  [ "$main" != "$root" ] && [ -d "${main}/.ruvector" ] || return 0
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    printf '[ruvector] Warning: %s is a non-symlink path diverged from the shared store %s/.ruvector — merge or relink manually\n' "$target" "$main" >&2
    return 0
  fi
  # -sfn also heals a dangling symlink (plain ln -s fails with EEXIST).
  ln -sfn "${main}/.ruvector" "$target" 2>/dev/null \
    || printf '[ruvector] Warning: worktree store-heal could not link %s\n' "$target" >&2
  return 0
}

# ruvector_hash_selected — true when the env explicitly selects the hash
# embedder, with upstream resolveEmbedderSelection precedence:
# RUVECTOR_EMBEDDER=hash selects hash; =auto|minilm selects ONNX regardless
# of RUVECTOR_ONNX; only when RUVECTOR_EMBEDDER is unset or unrecognized does
# RUVECTOR_ONNX=0 select hash.
ruvector_hash_selected() {
  local sel
  sel=$(printf '%s' "${RUVECTOR_EMBEDDER:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  case "$sel" in
    hash) return 0 ;;
    auto|minilm) return 1 ;;
    *) [ "${RUVECTOR_ONNX:-}" = "0" ] ;;
  esac
}

# ruvector_node_ok — Node.js >= 20 on PATH (ruvector 0.3.3 engines).
ruvector_node_ok() {
  local v major
  v=$(node --version 2>/dev/null) || return 1
  v="${v#v}"
  major="${v%%.*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -ge 20 ]
}

# ruvector_resolve_bin — set RUVECTOR_CMD to the plugin-managed CLI.
# Order: RUVECTOR_BIN (test seam; must be executable) -> node + the entry
# under <data>/current. Returns 1 (caller exits silently) when Node is too
# old, no install exists yet, or an install is in progress. A global
# `ruvector` on PATH is deliberately never used: it can skew from the pin.
ruvector_resolve_bin() {
  RUVECTOR_CMD=()
  if [ -n "${RUVECTOR_BIN:-}" ]; then
    [ -x "$RUVECTOR_BIN" ] || return 1
    RUVECTOR_CMD=("$RUVECTOR_BIN")
    return 0
  fi
  ruvector_node_ok || return 1
  # shellcheck source=../../../lib/install-ruvector.sh
  . "${RUVECTOR_PLUGIN_ROOT}/lib/install-ruvector.sh" 2>/dev/null || return 1
  # The same path checks as the MCP launcher (allowed prefixes, canonical,
  # no escaping symlink), so a hook never runs a CLI planted under a data
  # dir the launcher would refuse.
  : "${CLAUDE_PLUGIN_ROOT:=$RUVECTOR_PLUGIN_ROOT}"
  yellow_ruvector_validate_paths --data-only >/dev/null 2>&1 || return 1
  yellow_ruvector_install_in_progress && return 1
  local entry hash
  # Lease this plugin version's install before resolving its entry (as the
  # MCP launcher does): a prune that already moved it aside restores a
  # leased install, and skips it until this hook exits; the lease file goes
  # when the hook's shell does.
  hash=$(CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$RUVECTOR_PLUGIN_ROOT}" yellow_ruvector_lock_hash) || return 1
  yellow_ruvector_take_lease "install-${hash}"
  _RUVECTOR_LEASE="${RUVECTOR_DATA}/.lease.install-${hash}.$$"
  trap 'rm -f -- "$_RUVECTOR_LEASE" 2>/dev/null' EXIT
  # Pin to this plugin version's install, never whatever `current` says now.
  entry=$(CLAUDE_PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$RUVECTOR_PLUGIN_ROOT}" yellow_ruvector_pinned_entry) || return 1
  [ -f "$entry" ] || return 1
  RUVECTOR_CMD=(node "$entry")
  return 0
}

# ruvector_lease_pid <pid> — lease the resolved install for a background
# worker ("${RUVECTOR_CMD[@]}" … &; the forked pid execs node and keeps it),
# written while this shell's own lease still stands, so the hook can exit
# without leaving the worker unleased. Prune sweeps it once the pid is gone.
# No-op when RUVECTOR_BIN overrode resolution.
ruvector_lease_pid() {
  [ -n "${_RUVECTOR_LEASE:-}" ] && [ -n "${1:-}" ] || return 0
  : > "${_RUVECTOR_LEASE%.*}.${1}" 2>/dev/null
  return 0
}

# ruvector_probe_timeout — set TIMEOUT_CMD to the first timeout/gtimeout
# that supports GNU --kill-after (BusyBox's applet does not and would fail
# every call), or empty. Never use --foreground: it stops timeout from
# killing forked descendants.
ruvector_probe_timeout() {
  local name cmd
  TIMEOUT_CMD=""
  for name in timeout gtimeout; do
    cmd="$(command -v "$name" || true)"
    if [ -n "$cmd" ] && "$cmd" --kill-after=0.1 0.1 true >/dev/null 2>&1; then
      TIMEOUT_CMD="$cmd"
      return 0
    fi
  done
  return 1
}

# ruvector_proc_tree <pid> — print <pid> and all its descendants (pgrep -P
# walk; just <pid> where pgrep is missing).
ruvector_proc_tree() {
  local c
  printf '%s\n' "$1"
  for c in $(pgrep -P "$1" 2>/dev/null); do ruvector_proc_tree "$c"; done
}

# run_budgeted <seconds> <cmd...> — run for at most <seconds>: under
# TIMEOUT_CMD when available, otherwise (stock macOS) with a background
# watcher that sends TERM to the command's whole process tree (a function or
# $(...) runs its programs as grandchildren), then KILL 0.2s later to every
# process it found. The watcher's stdio goes to /dev/null so the caller's
# $(...) is not held open by it.
run_budgeted() {
  local cap="$1" pid watcher rc=0
  shift
  if [ -n "${TIMEOUT_CMD:-}" ]; then
    "$TIMEOUT_CMD" --kill-after=0.1 "$cap" "$@"
    return
  fi
  # <&0: a background job would otherwise read /dev/null, not the
  # caller's stdin.
  "$@" <&0 &
  pid=$!
  ( sleep "$cap"; tree=$(ruvector_proc_tree "$pid")
    # shellcheck disable=SC2086
    kill -TERM $tree 2>/dev/null
    sleep 0.2
    # shellcheck disable=SC2086
    kill -KILL $tree $(ruvector_proc_tree "$pid") 2>/dev/null ) \
    </dev/null >/dev/null 2>&1 &
  watcher=$!
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null
  return "$rc"
}
