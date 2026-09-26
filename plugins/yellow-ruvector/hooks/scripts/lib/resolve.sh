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
  main=$(dirname "$common")
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
  yellow_ruvector_data_dir
  yellow_ruvector_install_in_progress && return 1
  local entry
  entry=$(yellow_ruvector_entry)
  [ -f "$entry" ] || return 1
  RUVECTOR_CMD=(node "$entry")
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

# run_budgeted <seconds> <cmd...> — run for at most <seconds>: under
# TIMEOUT_CMD when available, otherwise (stock macOS) with a background
# watcher that sends TERM (to the command and its children), then KILL
# 0.2s later. The watcher's stdio goes to /dev/null so the caller's $(...)
# is not held open by it.
run_budgeted() {
  local cap="$1" pid watcher rc=0
  shift
  if [ -n "${TIMEOUT_CMD:-}" ]; then
    "$TIMEOUT_CMD" --kill-after=0.1 "$cap" "$@"
    return
  fi
  "$@" &
  pid=$!
  ( sleep "$cap"; pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null
    sleep 0.2; pkill -KILL -P "$pid" 2>/dev/null; kill -KILL "$pid" 2>/dev/null ) \
    </dev/null >/dev/null 2>&1 &
  watcher=$!
  wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null
  return "$rc"
}
