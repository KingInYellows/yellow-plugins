#!/bin/bash
# yellow-morph SessionStart hook — pre-warm @morphllm/morphmcp install before
# the first MCP tool call so morph startup is fast on first use.
#
# Note: -e omitted intentionally — hook must output {"continue": true} on all
# paths, even when individual commands fail. start-morph.sh handles install
# synchronously as a correctness gate; this hook is purely an optimization.
#
# Async background pattern (H-01, audit 2026-05-07):
# The actual install work runs in a detached subshell so the parent process
# can yield to Claude Code in <1s. The previous synchronous form held the
# session-start critical path for up to 30s on cold caches — single largest
# user-visible perf cost in the marketplace. The accepted trade-off: if the
# user invokes a morph tool within ~30s of session start on a slow connection,
# they may still hit a cold cache (start-morph.sh runs install synchronously
# as the correctness fallback). The hook is purely an optimization; missing
# the async window is no worse than not having the hook at all.
#
# The parent acquires the lock; the subshell holds the install work and is
# the SOLE owner of the release trap. The parent has no EXIT trap on the
# lock, so its early exit does not orphan release. The parent then writes
# the subshell's PID (via $!) to the lock's pid file — works on bash 3.2+
# unlike $BASHPID, and collapses the race window between mkdir and pid
# overwrite to zero so concurrent stale-lock recovery never sees a dead
# owner.
set -uo pipefail

# Centralized JSON-output exit. Claude Code BLOCKS session startup if a
# SessionStart hook exits without printing this line, so every code path —
# including failures — must terminate via json_exit.
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[yellow-morph] %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}

# Source install primitives. The lib must be present; if it's missing the
# plugin install is broken in a more fundamental way and we can't safely
# do anything except yield.
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  json_exit "CLAUDE_PLUGIN_ROOT unset; skipping prewarm"
fi
LIB="${CLAUDE_PLUGIN_ROOT}/lib/install-morphmcp.sh"
if [ ! -r "$LIB" ]; then
  json_exit "lib/install-morphmcp.sh missing; skipping prewarm"
fi
# shellcheck source=../../lib/install-morphmcp.sh
. "$LIB"

yellow_morph_validate_paths || json_exit "path validation failed; skipping prewarm"

# Already in sync — nothing to do.
yellow_morph_needs_install || json_exit

mkdir -p "$CLAUDE_PLUGIN_DATA" || json_exit "mkdir failed; skipping prewarm"

# Acquire the lock in the parent — $$ is the parent's real, live PID at this
# point. Budget = 2 attempts (~2s worst case): the hook's overall timeout is
# 5s, and under live contention we must yield with budget left to spare for
# the json_exit print, or Claude Code SIGKILLs us mid-output and blocks
# session startup. 2 attempts is also the minimum that lets stale-lock
# recovery succeed (i=1 detects a dead owner and continues; i=2 acquires).
if ! yellow_morph_acquire_install_lock 2; then
  json_exit "install lock held by another process; yielding to start-morph.sh"
fi

# Re-check under the lock — wrapper or a previous prewarm may have finished
# while we were waiting.
if ! yellow_morph_needs_install; then
  yellow_morph_release_install_lock
  json_exit
fi

# Detached background install. The subshell's trap is the SOLE release
# point; parent has no EXIT trap, so its early exit does not orphan the
# lock. All child output → /dev/null to keep the parent's `{"continue":
# true}` stdout uncorrupted.
(
  trap 'yellow_morph_release_install_lock' EXIT INT TERM
  if ! yellow_morph_do_install; then
    yellow_morph_cleanup_failed_install
  fi
) >/dev/null 2>&1 &
sub_pid=$!
disown

# acquire_install_lock wrote $$ (parent's PID) to the lock's pid file; the
# parent is about to exit. Overwrite with $! (the subshell's PID, captured
# in the parent — works on bash 3.2 unlike $BASHPID) so any concurrent
# stale-lock check sees a live owner.
printf '%s' "$sub_pid" > "${CLAUDE_PLUGIN_DATA}/.install.lock/pid" 2>/dev/null || true

json_exit
