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
# The lock + install live INSIDE the subshell so the parent's exit does not
# release the lock while install is still running. The subshell's EXIT trap
# is the single owner of lock release.
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

# Detached background install. The subshell owns the lock and all install
# work; the parent does not acquire the lock and exits as soon as the
# subshell is spawned. All child output goes to /dev/null — corrupting the
# parent's `{"continue": true}` stdout would block session startup.
#
# Lock acquisition uses the same 5s budget as the previous synchronous form:
# if another process (e.g., the start-morph.sh wrapper) holds the lock, the
# subshell yields silently. The subshell's EXIT/INT/TERM trap is the single
# owner of lock release.
(
  if ! yellow_morph_acquire_install_lock 5; then
    exit 0
  fi
  trap 'yellow_morph_release_install_lock' EXIT INT TERM

  # Re-check under the lock — the wrapper or a previous prewarm may have
  # completed the install while we were waiting.
  yellow_morph_needs_install || exit 0

  if ! yellow_morph_do_install; then
    yellow_morph_cleanup_failed_install
  fi
) >/dev/null 2>&1 & disown

json_exit
