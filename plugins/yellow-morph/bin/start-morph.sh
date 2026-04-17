#!/usr/bin/env bash
# yellow-morph MCP server wrapper.
#
# Responsibilities (correctness gate — do NOT rely on the SessionStart hook
# for install; it races MCP startup per community precedent):
#   1. Resolve MORPH_API_KEY from userConfig (preferred) or shell env.
#   2. Ensure @morphllm/morphmcp is installed in ${CLAUDE_PLUGIN_DATA};
#      install synchronously if missing.
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
set -eu

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
case "$CLAUDE_PLUGIN_DATA" in
  "$HOME"/*|/tmp/*) ;;
  *) printf 'yellow-morph: refusing install — CLAUDE_PLUGIN_DATA is not under $HOME or /tmp: %s\n' "$CLAUDE_PLUGIN_DATA" >&2; exit 1 ;;
esac
case "$CLAUDE_PLUGIN_ROOT" in
  "$HOME"/*|/tmp/*|/usr/*|/opt/*) ;;
  *) printf 'yellow-morph: refusing install — CLAUDE_PLUGIN_ROOT has unexpected prefix: %s\n' "$CLAUDE_PLUGIN_ROOT" >&2; exit 1 ;;
esac

MORPH_ENTRY="${CLAUDE_PLUGIN_DATA}/node_modules/@morphllm/morphmcp/dist/index.js"

if [ ! -f "$MORPH_ENTRY" ]; then
  mkdir -p "$CLAUDE_PLUGIN_DATA"
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
  printf 'yellow-morph: first-run install of @morphllm/morphmcp into %s...\n' \
    "$CLAUDE_PLUGIN_DATA" >&2
  if ! (unset MORPH_API_KEY; cd "$CLAUDE_PLUGIN_DATA" && npm ci --no-audit --no-fund --loglevel=error) >&2; then
    printf 'yellow-morph: npm ci failed. Run /morph:setup to diagnose.\n' >&2
    # Remove the copied manifest+lockfile so the next session retries
    # instead of seeing an out-of-sync state.
    rm -f "${CLAUDE_PLUGIN_DATA}/package.json" "${CLAUDE_PLUGIN_DATA}/package-lock.json"
    exit 1
  fi
fi

# --- 3. Exec morphmcp. The SessionStart hook may have done the same install
# in parallel; that's OK — npm install is idempotent, and by the time we
# reach this line the entry file exists.
exec node "$MORPH_ENTRY" "$@"
