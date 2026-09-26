#!/usr/bin/env bash
# ruvector-cli.sh — run the plugin-managed ruvector CLI from the project root.
#
# Usage: bash "${CLAUDE_PLUGIN_ROOT}/scripts/ruvector-cli.sh" <ruvector args...>
#   e.g. ... --version
#        ... hooks reembed --dry-run
#
# Resolves the same install the MCP launcher and hooks use (the plugin data
# dir's `current` install; never a global `ruvector` on PATH) and cds to the
# git toplevel first, because ruvector picks its store from process.cwd().
# Exits 1 with a hint when Node < 20 or nothing is installed yet.
set -euo pipefail

: "${CLAUDE_PLUGIN_ROOT:=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
export CLAUDE_PLUGIN_ROOT
# shellcheck source=../lib/install-ruvector.sh
. "${CLAUDE_PLUGIN_ROOT}/lib/install-ruvector.sh"
# shellcheck source=../hooks/scripts/lib/resolve.sh
. "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib/resolve.sh"

if ! ruvector_node_ok; then
  printf 'yellow-ruvector: Node.js 20 or later is required (found: %s)\n' "$(node --version 2>/dev/null || echo none)" >&2
  exit 1
fi
yellow_ruvector_data_dir
entry=$(yellow_ruvector_entry)
if [ ! -f "$entry" ]; then
  printf 'yellow-ruvector: ruvector is not installed in %s — run /ruvector:setup\n' "$RUVECTOR_DATA" >&2
  exit 1
fi
cd "$(ruvector_resolve_root "$PWD")"
exec node "$entry" "$@"
