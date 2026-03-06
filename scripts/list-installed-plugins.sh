#!/usr/bin/env bash

set -euo pipefail

plugin_cache="${1:-$HOME/.claude/plugins/cache}"

if [ ! -d "$plugin_cache" ]; then
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  while IFS= read -r -d '' plugin_json; do
    python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('name', ''))" "$plugin_json" 2>/dev/null || true
  done < <(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0)
elif command -v jq >/dev/null 2>&1; then
  while IFS= read -r -d '' plugin_json; do
    jq -r '.name // empty' "$plugin_json" 2>/dev/null || true
  done < <(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0)
else
  echo 'python3 or jq is required to inspect installed plugin manifests' >&2
  exit 1
fi | sed '/^$/d' | LC_ALL=C sort -u
