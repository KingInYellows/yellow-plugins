#!/bin/bash
# prewarm.sh — SessionStart: install the pinned ruvector and warm the ONNX
# model in the background, so the MCP launcher and session-start recall do
# not pay the first-install (~119MB npm fetch) or the first model download
# (~90MB from huggingface.co) on the critical path.
#
# Purely an optimization: bin/start-ruvector.sh installs synchronously as
# the correctness gate. Follows yellow-morph's prewarm-morph.sh pattern —
# the parent takes the install lock (2 attempts, within the 5s hook
# timeout), a detached subshell does the work and is the SOLE owner of the
# release trap, and the parent rewrites the lock pid to the subshell's $! so
# stale-lock recovery never sees a dead owner. The model warm-up runs under
# the same lock so two sessions never download it concurrently (ruvector's
# temp file names are fixed).
#
# -e omitted: every path must print the dual-client allow JSON.
set -uo pipefail

_HOOK_LIB="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib"
# shellcheck source=lib/hook-json.sh
. "${_HOOK_LIB}/hook-json.sh"
# shellcheck source=lib/resolve.sh
. "${_HOOK_LIB}/resolve.sh"
unset _HOOK_LIB

# Drain stdin; this hook needs nothing from the event payload.
cat >/dev/null 2>&1 || true

LIB="${RUVECTOR_PLUGIN_ROOT}/lib/install-ruvector.sh"
[ -r "$LIB" ] || json_exit "lib/install-ruvector.sh missing; skipping prewarm"
# shellcheck source=../../lib/install-ruvector.sh
. "$LIB"
: "${CLAUDE_PLUGIN_ROOT:=$RUVECTOR_PLUGIN_ROOT}"
export CLAUDE_PLUGIN_ROOT

ruvector_node_ok || json_exit "Node.js 20+ not found; ruvector hooks inactive"
yellow_ruvector_validate_paths || json_exit "path validation failed; skipping prewarm"

# The ONNX model only matters when the env does not select the hash
# embedder (same rule as the launcher); with hash selected there is nothing
# to warm and no verification marker would ever be written.
model_ready() { ruvector_hash_selected || yellow_ruvector_model_cached; }

# A live installer (another session's prewarm or launcher) is already doing
# this work under the lock: probing now would only hold the hook, and the
# lock wait after it could push past the 5s hook timeout.
yellow_ruvector_install_in_progress && json_exit

# Nothing to do when installed, healthy (a 2s --version probe, plus its 1s
# KILL grace, inside the 5s hook), and the model is ready.
_probe_start=$SECONDS
if ! yellow_ruvector_needs_install && yellow_ruvector_install_healthy 2 \
   && model_ready; then
  json_exit
fi

# One shared budget: after a slow probe, try the lock once instead of twice.
_attempts=2
[ $(( SECONDS - _probe_start )) -lt 2 ] || _attempts=1
yellow_ruvector_acquire_install_lock "$_attempts" \
  || json_exit

(
  # Wait for the handoff before doing (or releasing) anything: until the
  # parent writes this job's pid, the lock names the parent ($$ here too),
  # and a job that finished and released early could let another session
  # take the lock just before the parent's write overwrote its pid. The
  # handed pid is recorded, so the release matches it even on bash 3.2
  # (no BASHPID).
  # The handoff token is this job's own pid (what the parent writes as
  # $!): any other value (a launcher that reclaimed a dead parent's lock)
  # is not ours, and the job exits without touching that lock.
  _me=${BASHPID:-$(sh -c 'echo "$PPID"')}
  _YR_LOCK_OWNER=""
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    [ "$(cat "${RUVECTOR_DATA}/.install.lock/pid" 2>/dev/null)" = "$_me" ] && { _YR_LOCK_OWNER=$_me; break; }
    sleep 0.1
  done
  [ -n "$_YR_LOCK_OWNER" ] || exit 0
  yellow_ruvector_trap_release
  if yellow_ruvector_needs_install || ! yellow_ruvector_install_healthy; then
    yellow_ruvector_do_install || exit 0
  fi
  model_ready || yellow_ruvector_warm_model 300 || true
) >/dev/null 2>&1 &
sub_pid=$!
disown

# Hand the lock to the child. If that write fails the lock would name this
# exiting shell (or nothing) and a waiter would reclaim it mid-install: stop
# the child and release the lock instead.
# The start-time stamp goes first, so the lock never names a pid without it.
yellow_ruvector_stamp_pid "${RUVECTOR_DATA}/.install.lock" "$sub_pid"
if ! printf '%s' "$sub_pid" > "${RUVECTOR_DATA}/.install.lock/pid" 2>/dev/null; then
  # Stop the job and wait (up to ~2s, then KILL) until it and its direct
  # children are gone before the lock path is released, so nothing the lock
  # protects can still be running when another installer takes it.
  pkill -TERM -P "$sub_pid" 2>/dev/null
  kill -TERM "$sub_pid" 2>/dev/null
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    kill -0 "$sub_pid" 2>/dev/null || pgrep -P "$sub_pid" >/dev/null 2>&1 || break
    sleep 0.1
  done
  pkill -KILL -P "$sub_pid" 2>/dev/null
  kill -KILL "$sub_pid" 2>/dev/null
  if ! kill -0 "$sub_pid" 2>/dev/null; then
    yellow_ruvector_unlock_dir "${RUVECTOR_DATA}/.install.lock"
  fi
  json_exit "could not hand the install lock to the background job; skipping prewarm"
fi

json_exit
