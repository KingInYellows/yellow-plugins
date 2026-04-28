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

# Defense in depth — refuse to write outside the user's home or /tmp.
case "${CLAUDE_PLUGIN_DATA:-}" in
  "${HOME:-/__unset__}"/*|/tmp/*) ;;
  '') json_exit "CLAUDE_PLUGIN_DATA unset; skipping prewarm" ;;
  *) json_exit "CLAUDE_PLUGIN_DATA outside HOME and /tmp; skipping prewarm" ;;
esac

if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  json_exit "CLAUDE_PLUGIN_ROOT unset; skipping prewarm"
fi

# Already in sync — nothing to do.
if diff -q "${CLAUDE_PLUGIN_ROOT}/package-lock.json" \
           "${CLAUDE_PLUGIN_DATA}/package-lock.json" >/dev/null 2>&1; then
  json_exit
fi

mkdir -p "$CLAUDE_PLUGIN_DATA" || json_exit "mkdir failed; skipping prewarm"
cp "${CLAUDE_PLUGIN_ROOT}/package.json"      "${CLAUDE_PLUGIN_DATA}/package.json" \
  || json_exit "package.json copy failed; skipping prewarm"
cp "${CLAUDE_PLUGIN_ROOT}/package-lock.json" "${CLAUDE_PLUGIN_DATA}/package-lock.json" \
  || json_exit "package-lock.json copy failed; skipping prewarm"

# Install in a subshell that does NOT inherit MORPH_API_KEY — a malicious
# postinstall script in any transitive dep could otherwise exfiltrate the key
# before the real MCP server starts.
if (cd "$CLAUDE_PLUGIN_DATA" && env -u MORPH_API_KEY \
    npm ci --no-audit --no-fund --loglevel=error) >&2; then
  json_exit
fi

# Install failed — remove the copied manifest+lockfile so the next session
# retries from a clean state instead of seeing an out-of-sync install.
rm -f "${CLAUDE_PLUGIN_DATA}/package.json" \
      "${CLAUDE_PLUGIN_DATA}/package-lock.json"
json_exit "npm ci failed; start-morph.sh will retry synchronously on first MCP call"
