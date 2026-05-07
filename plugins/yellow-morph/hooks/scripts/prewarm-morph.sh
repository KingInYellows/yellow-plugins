#!/bin/bash
# yellow-morph SessionStart hook — pre-warm @morphllm/morphmcp install before
# the first MCP tool call so morph startup is fast on first use.
#
# Note: -e omitted intentionally — hook must output {"continue": true} on all
# paths, even when individual commands fail. start-morph.sh handles install
# synchronously as a correctness gate; this hook is purely an optimization.
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

# 5s budget. Prewarm is purely an optimization — if we can't acquire the
# lock quickly, yield to whoever has it (probably the wrapper) and exit.
if ! yellow_morph_acquire_install_lock 5; then
  json_exit "install lock held by another process; yielding to start-morph.sh"
fi
trap 'yellow_morph_release_install_lock' EXIT INT TERM

# Re-check under the lock — the wrapper or a previous prewarm may have
# completed the install while we were waiting.
yellow_morph_needs_install || json_exit

if yellow_morph_do_install >&2; then
  json_exit
fi

yellow_morph_cleanup_failed_install
json_exit "npm ci failed; start-morph.sh will retry synchronously on first MCP call"
