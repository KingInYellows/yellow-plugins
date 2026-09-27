#!/usr/bin/env bash
# yellow-ruvector MCP server launcher (mcpServers.ruvector.command).
#
#   1. Ensure the pinned ruvector (plugin package-lock.json) is installed
#      under the plugin data dir; install synchronously under the install
#      lock if missing or out of date, waiting for a live installer (the
#      SessionStart prewarm) instead of failing.
#   2. Resolve the project root (git toplevel first — ruvector picks its
#      store from process.cwd() only), heal a linked worktree's .ruvector
#      symlink, and cd there.
#   3. Guard the model: when it is not verified, warm it first (under the
#      install lock — ruvector's model temp files have fixed names). If it
#      still is not verified (offline), start without the model-using tools
#      (hooks_recall, hooks_remember, hooks_pretrain): a tool call would
#      download it outside the model lock, and the server's hash fallback
#      could stamp a fresh store hash/64d (ADR-210). The next session with
#      network restores them.
#   4. exec the server (no wrapper process left behind).
#
# Env: CLAUDE_PLUGIN_ROOT (required), CLAUDE_PLUGIN_DATA (optional; XDG
# fallback), RUVECTOR_MCP_ALLOW (tool allowlist from the manifest),
# RUVECTOR_INSTALL_WAIT (seconds to wait for a running install, default 25).
set -euo pipefail

# One line per message: paths inside (data dir, install) are flattened
# (control characters as spaces, dash runs shortened).
log() { printf 'yellow-ruvector: %s\n' "$(printf '%s' "$*" | LC_ALL=C tr '\000-\037\177' ' ' | sed -E 's/-{3,}/--/g')" >&2; }

: "${CLAUDE_PLUGIN_ROOT:?yellow-ruvector launcher: CLAUDE_PLUGIN_ROOT is unset}"
# shellcheck source=../lib/install-ruvector.sh
. "${CLAUDE_PLUGIN_ROOT}/lib/install-ruvector.sh"
# shellcheck source=../hooks/scripts/lib/resolve.sh
. "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/resolve.sh"

if ! ruvector_node_ok; then
  log "Node.js 20 or later is required (found: $(node --version 2>/dev/null || echo none)). Update Node, then restart Claude Code."
  exit 1
fi
yellow_ruvector_validate_paths || exit 1

wait_secs="${RUVECTOR_INSTALL_WAIT:-25}"
case "$wait_secs" in ''|*[!0-9]*) wait_secs=25 ;; esac
# Everything before the MCP handshake (lock waits, warm-up) shares one
# budget of wait_secs, kept under Claude Code's MCP startup timeout; only a
# first `npm ci` can run past it.
t0=$SECONDS
budget_left() { echo $(( wait_secs - (SECONDS - t0) )); }

# --- 1. Install ---
# Needed when `current` is not this lockfile's install, or when this
# version's install-<hash> is gone (another plugin version's prune removed it).
# The health probe gets at most the budget left (10s cap), and an install
# that failed it once is not probed again: a hung CLI would otherwise spend
# the probe three times (here, after the lock, and in do_install) before
# the repair starts.
_YR_KNOWN_UNHEALTHY=""
needs_install() {
  local s
  yellow_ruvector_needs_install && return 0
  [ -f "$(yellow_ruvector_pinned_entry)" ] || return 0
  [ -z "$_YR_KNOWN_UNHEALTHY" ] || return 0
  s=$(budget_left); [ "$s" -le 10 ] || s=10; [ "$s" -ge 1 ] || s=1
  yellow_ruvector_install_healthy "$s" && return 1
  _YR_KNOWN_UNHEALTHY=1
  return 0
}
# ensure_pinned_install — set `entry` to this plugin version's install-<hash>
# CLI, installing or restoring it under the lock. Never `current` or another
# version's install: the server must match this session's hooks, and prune
# must see which install it still uses. Two passes: a prune that ran before
# the lease was taken can still have removed it.
ensure_pinned_install() {
  local _pass wait hash
  entry=""
  # Lease this version's install before any existence check, so a prune in
  # another session cannot remove it between the check and exec.
  if hash=$(yellow_ruvector_lock_hash); then yellow_ruvector_take_lease "install-${hash}"; fi
  for _pass in 1 2; do
    if needs_install; then
      wait=$(budget_left); [ "$wait" -ge 1 ] || wait=1
      if ! yellow_ruvector_acquire_install_lock "$wait"; then
        log "timed out after ${wait_secs}s waiting for another ruvector install (${RUVECTOR_DATA}/.install.lock)."
        log "Run /ruvector:setup, or raise MCP_TIMEOUT (ms) if first installs are slow on this network."
        exit 1
      fi
      yellow_ruvector_trap_release
      if needs_install; then
        log "installing ruvector into ${RUVECTOR_DATA}..."
        if ! yellow_ruvector_do_install; then
          log "install failed. Run /ruvector:setup to diagnose."
          exit 1
        fi
      fi
      # An EXIT trap does not fire on exec — release explicitly.
      yellow_ruvector_release_install_lock
      trap - EXIT INT TERM
    fi
    entry=$(yellow_ruvector_pinned_entry) || entry=""
    [ -f "$entry" ] && return 0
  done
  log "this plugin version's ruvector install is missing (${entry:-no lockfile hash}). Run /ruvector:setup."
  exit 1
}
ensure_pinned_install

# --- 2. Project root ---
root=$(ruvector_resolve_root "$PWD")
ruvector_heal_store "$root"
cd "$root"

# --- 3. Fresh-store guard ---
allow="${RUVECTOR_MCP_ALLOW:-hooks_capabilities,hooks_pretrain,hooks_recall,hooks_remember,hooks_stats}"
intel=".ruvector/intelligence.json"
# A missing store counts as unstamped: the first write would create it.
stamp=""
if [ -f "$intel" ] && command -v jq >/dev/null 2>&1; then
  stamp=$(jq -r '.embeddingProvenance.embedderKind // empty' "$intel" 2>/dev/null || true)
fi
# An explicitly selected hash embedder (RUVECTOR_EMBEDDER=hash, or
# RUVECTOR_ONNX=0) needs no model and stamping hash is intended: no guard.
# "Cached" means a warm-up verified these exact model files (a truncated
# download is not cached). The warm-up only runs while the startup budget
# lasts (2s kept for the handshake); otherwise start without model tools.
# The warm-up runs whenever the model is needed and unverified, stamped store
# or not: the first MCP tool call would otherwise load (download) it while
# prewarm may be downloading through the same fixed cache file names. If it
# stays unverified, every model-using tool is withheld.
if ! ruvector_hash_selected && ! yellow_ruvector_model_cached; then
  left=$(( $(budget_left) - 2 ))
  if [ "$left" -ge 3 ] && yellow_ruvector_acquire_install_lock "$left"; then
    yellow_ruvector_trap_release
    left=$(( $(budget_left) - 2 ))
    [ "$left" -le 15 ] || left=15
    yellow_ruvector_model_cached || { [ "$left" -ge 3 ] && yellow_ruvector_warm_model "$left"; } || true
    yellow_ruvector_release_install_lock
    trap - EXIT INT TERM
  fi
  if ! yellow_ruvector_model_cached; then
    # Any model-using tool would load (download) the model outside the
    # model lock, through the same fixed cache files another session's
    # prewarm or status probe may be writing under it, and on an unstamped
    # store a failed load would stamp it hash. Until a warm-up verifies the
    # model, keep only the tools that never embed.
    allow=$(printf '%s' "$allow" | tr ',' '\n' | grep -vxE 'hooks_recall|hooks_remember|hooks_pretrain' | paste -sd, - || true)
    # An allowlist that filtering emptied would read as allow-all (every
    # tool): a name that matches no tool keeps the policy closed.
    [ -n "$allow" ] || allow="yellow_ruvector_none"
    # DENY wins over ALLOW and any profile in ruvector's policy.
    export RUVECTOR_MCP_DENY="${RUVECTOR_MCP_DENY:+${RUVECTOR_MCP_DENY},}hooks_recall,hooks_remember,hooks_pretrain"
    if yellow_ruvector_install_in_progress || yellow_ruvector_model_lock_busy; then
      log "the ONNX model is still being fetched by another session: starting without hooks_recall, hooks_remember and hooks_pretrain. Restart Claude Code once it finishes to use them."
    else
      log "ONNX model unavailable or unverified (offline?): starting without hooks_recall, hooks_remember and hooks_pretrain so nothing downloads it outside the model lock or stamps the store hash. The next session with network restores them."
    fi
  fi
fi
export RUVECTOR_MCP_ALLOW="$allow"
# A profile inherited from the environment would union its tools (hooks_recall
# among them) into the allowlist: only the plugin's own list applies.
unset RUVECTOR_MCP_PROFILE

# --- 4. Run ---
# Re-check right before exec: root heal and the store parse take time, and
# another plugin version's prune may have removed this install meanwhile.
[ -f "$entry" ] || ensure_pinned_install
exec node "$entry" mcp start
