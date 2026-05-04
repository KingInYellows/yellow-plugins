#!/usr/bin/env bash
# yellow-morph MCP server wrapper.
#
# Responsibilities (correctness gate — do NOT rely on the SessionStart hook
# for install; it races MCP startup per community precedent):
#   1. Resolve MORPH_API_KEY from userConfig (preferred) or shell env.
#   2. Ensure @morphllm/morphmcp is installed in ${CLAUDE_PLUGIN_DATA};
#      install synchronously if missing or out of sync with the plugin
#      install. Reinstall is serialized against the SessionStart prewarm
#      hook via an atomic mkdir-lock so concurrent `npm ci` cannot corrupt
#      node_modules.
#   3. Exec morphmcp.
#
# Required env from plugin.json:
#   CLAUDE_PLUGIN_ROOT         — plugin install dir (read-only at runtime).
#   CLAUDE_PLUGIN_DATA         — plugin persistent data dir (writable).
#   MORPH_API_KEY_USERCONFIG   — userConfig-substituted value (may be empty).
#
# Optional inherited env:
#   MORPH_API_KEY              — shell fallback for power users.
#
set -euo pipefail

# --- 1. Resolve the API key. userConfig wins; shell env is fallback.
if [ -n "${MORPH_API_KEY_USERCONFIG:-}" ]; then
  export MORPH_API_KEY="$MORPH_API_KEY_USERCONFIG"
fi
unset MORPH_API_KEY_USERCONFIG
# If neither userConfig nor shell MORPH_API_KEY is set, morphmcp will emit
# its own warning and exit — we don't duplicate that error path here.

# --- 2. Source install primitives and ensure morphmcp is installed.
: "${CLAUDE_PLUGIN_ROOT:?yellow-morph wrapper: CLAUDE_PLUGIN_ROOT is unset}"
# shellcheck source=../lib/install-morphmcp.sh
. "${CLAUDE_PLUGIN_ROOT}/lib/install-morphmcp.sh"

yellow_morph_validate_paths || exit 1

LOCK_ACQUIRED=0
if yellow_morph_needs_install; then
  mkdir -p "$CLAUDE_PLUGIN_DATA"

  # 20s budget — synchronous correctness gate. If we can't acquire after
  # 20s the prior holder is either still installing or stuck; the lib's
  # stale-PID recovery covers crashed holders. A live holder finishing
  # within ~20s is the common case.
  if ! yellow_morph_acquire_install_lock 20; then
    printf 'yellow-morph: timed out (20s) waiting for install lock at %s\n' \
      "${CLAUDE_PLUGIN_DATA}/.install.lock" >&2
    printf 'yellow-morph: another install may be running, or the lock is\n' >&2
    printf 'yellow-morph: held by an unkillable process — manual cleanup:\n' >&2
    printf 'yellow-morph:   rmdir %s\n' "${CLAUDE_PLUGIN_DATA}/.install.lock" >&2
    exit 1
  fi
  LOCK_ACQUIRED=1
  trap 'yellow_morph_release_install_lock' EXIT INT TERM

  # Re-check under the lock — the prewarm hook may have completed the
  # install while we were waiting, in which case there is nothing to do.
  if yellow_morph_needs_install; then
    printf 'yellow-morph: installing @morphllm/morphmcp into %s...\n' \
      "$CLAUDE_PLUGIN_DATA" >&2
    if ! yellow_morph_do_install >&2; then
      printf 'yellow-morph: npm ci failed. Run /morph:setup to diagnose.\n' >&2
      yellow_morph_cleanup_failed_install
      exit 1
    fi
  fi
fi

# --- 3. Release the install lock explicitly before exec. Bash's EXIT
# trap does NOT fire when `exec` replaces the shell with another program —
# the shell never "exits" in the sense that triggers EXIT. Without this
# manual cleanup, an exec into a long-running morphmcp would leave the
# lock dir behind for the entire session, blocking future upgrades.
if [ "$LOCK_ACQUIRED" -eq 1 ]; then
  yellow_morph_release_install_lock
  trap - EXIT INT TERM
fi

MORPH_ENTRY="${CLAUDE_PLUGIN_DATA}/node_modules/@morphllm/morphmcp/dist/index.js"
exec node "$MORPH_ENTRY" "$@"
