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

# --- 2. Ensure morphmcp is installed in the persistent data directory.
: "${CLAUDE_PLUGIN_ROOT:?yellow-morph wrapper: CLAUDE_PLUGIN_ROOT is unset}"
: "${CLAUDE_PLUGIN_DATA:?yellow-morph wrapper: CLAUDE_PLUGIN_DATA is unset}"

# Defense in depth: Claude Code sets CLAUDE_PLUGIN_DATA to a path under the
# user's home directory. If something else populated these vars with an
# unexpected path (misconfiguration or compromised env), refuse to install —
# we do not want `cp` / `npm ci` to write to e.g. /etc or /var.
#
# `${HOME:-/__unset__}` sentinel — an unset HOME would otherwise expand to
# `/*`, matching ANY absolute path and bypassing the check entirely. The
# sentinel is a path that cannot match any real CLAUDE_PLUGIN_DATA value.
case "$CLAUDE_PLUGIN_DATA" in
  "${HOME:-/__unset__}"/*|/tmp/*) ;;
  *) printf 'yellow-morph: refusing install — CLAUDE_PLUGIN_DATA is not under $HOME or /tmp: %s\n' "$CLAUDE_PLUGIN_DATA" >&2; exit 1 ;;
esac
case "$CLAUDE_PLUGIN_ROOT" in
  "${HOME:-/__unset__}"/*|/tmp/*|/usr/*|/opt/*) ;;
  *) printf 'yellow-morph: refusing install — CLAUDE_PLUGIN_ROOT has unexpected prefix: %s\n' "$CLAUDE_PLUGIN_ROOT" >&2; exit 1 ;;
esac

MORPH_ENTRY="${CLAUDE_PLUGIN_DATA}/node_modules/@morphllm/morphmcp/dist/index.js"
LOCK_DIR="${CLAUDE_PLUGIN_DATA}/.install.lock"

# Reinstall when the entry file is missing OR the persistent install
# diverges from CLAUDE_PLUGIN_ROOT (e.g., after a plugin version bump).
# Without the lockfile check, an upgraded morphmcp pin would run only on
# next session unless the SessionStart prewarm hook caught it — and a
# failed prewarm (network blip, timeout) would silently leave the user
# on the stale install.
needs_install() {
  [ ! -f "$MORPH_ENTRY" ] && return 0
  ! diff -q "${CLAUDE_PLUGIN_ROOT}/package-lock.json" \
            "${CLAUDE_PLUGIN_DATA}/package-lock.json" >/dev/null 2>&1
}

if needs_install; then
  mkdir -p "$CLAUDE_PLUGIN_DATA"

  # Acquire an atomic mkdir-lock to serialize against the SessionStart
  # prewarm hook. `npm ci` deletes node_modules before installing, so two
  # concurrent runs against the same target would corrupt the install.
  # mkdir is atomic across POSIX systems (no flock dependency).
  LOCK_ACQUIRED=0
  for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      LOCK_ACQUIRED=1
      trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM
      break
    fi
    sleep 1
  done

  if [ "$LOCK_ACQUIRED" -eq 0 ]; then
    printf 'yellow-morph: timed out (20s) waiting for install lock at %s\n' "$LOCK_DIR" >&2
    printf 'yellow-morph: another install may be running, or a stale lock\n' >&2
    printf 'yellow-morph: needs manual cleanup: rmdir %s\n' "$LOCK_DIR" >&2
    exit 1
  fi

  # Re-check under the lock — the prewarm hook may have completed the
  # install while we were waiting, in which case we have nothing to do.
  if needs_install; then
    # Copy both the manifest AND the committed lockfile so `npm ci` can do a
    # deterministic, transitive-pinned install. Without the lockfile, npm
    # falls back to lockfile-less resolution and silently installs whatever
    # transitive versions the registry currently advertises — a supply-chain
    # risk that defeats the point of pinning @morphllm/morphmcp.
    cp "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json"
    cp "${CLAUDE_PLUGIN_ROOT}/package-lock.json" "${CLAUDE_PLUGIN_DATA}/package-lock.json"
    # Install in a subshell that does NOT inherit MORPH_API_KEY — a malicious
    # postinstall script in any transitive dep could otherwise exfiltrate the
    # key before the real MCP server ever starts.
    printf 'yellow-morph: installing @morphllm/morphmcp into %s...\n' \
      "$CLAUDE_PLUGIN_DATA" >&2
    if ! (unset MORPH_API_KEY; cd "$CLAUDE_PLUGIN_DATA" && npm ci --no-audit --no-fund --loglevel=error) >&2; then
      printf 'yellow-morph: npm ci failed. Run /morph:setup to diagnose.\n' >&2
      # Remove the copied manifest+lockfile so the next session retries
      # instead of seeing an out-of-sync state.
      rm -f "${CLAUDE_PLUGIN_DATA}/package.json" "${CLAUDE_PLUGIN_DATA}/package-lock.json"
      exit 1
    fi
  fi
fi

# --- 3. Exec morphmcp. By this point the install lock (if we held one) is
# released by the EXIT trap before exec runs.
exec node "$MORPH_ENTRY" "$@"
