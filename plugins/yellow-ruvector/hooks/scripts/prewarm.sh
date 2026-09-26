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

# Nothing to do when installed and the model is cached.
if ! yellow_ruvector_needs_install && yellow_ruvector_model_cached; then
  json_exit
fi

yellow_ruvector_acquire_install_lock 2 \
  || json_exit

(
  yellow_ruvector_trap_release
  if yellow_ruvector_needs_install; then
    yellow_ruvector_do_install || exit 0
  fi
  yellow_ruvector_model_cached || yellow_ruvector_warm_model 300 || true
) >/dev/null 2>&1 &
sub_pid=$!
disown

printf '%s' "$sub_pid" > "${RUVECTOR_DATA}/.install.lock/pid" 2>/dev/null || true

json_exit
