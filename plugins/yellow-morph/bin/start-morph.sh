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

MORPH_ENTRY="${CLAUDE_PLUGIN_DATA}/node_modules/@morphllm/morphmcp/dist/index.js"

if [ ! -f "$MORPH_ENTRY" ]; then
  mkdir -p "$CLAUDE_PLUGIN_DATA"
  # Copy the plugin's package.json so `npm install` has a manifest to act on.
  cp "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json"
  # Install. Emit progress to stderr so Claude Code shows it during the
  # first-session delay instead of hanging the tool call silently.
  printf 'yellow-morph: first-run install of @morphllm/morphmcp into %s...\n' \
    "$CLAUDE_PLUGIN_DATA" >&2
  if ! (cd "$CLAUDE_PLUGIN_DATA" && npm install --no-audit --no-fund --loglevel=error) >&2; then
    printf 'yellow-morph: npm install failed. Run /morph:setup to diagnose.\n' >&2
    # Remove the copied manifest so the next session retries instead of
    # seeing an out-of-sync state.
    rm -f "${CLAUDE_PLUGIN_DATA}/package.json"
    exit 1
  fi
fi

# --- 3. Exec morphmcp. The SessionStart hook may have done the same install
# in parallel; that's OK — npm install is idempotent, and by the time we
# reach this line the entry file exists.
exec node "$MORPH_ENTRY" "$@"
