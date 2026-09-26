#!/usr/bin/env bash
# remove-legacy-hooks.sh — list, and on request remove, hook entries left in a
# Claude Code settings.json by a past `ruvector hooks init`. They run the
# global ruvector binary (post-edit, post-command, pre-edit, pre-command,
# session-start, session-end) and write edit/command memories that stamp a
# fresh store hash (ADR-210). Only those hook entries are touched; other
# hooks, including git-ai and this plugin's own, are kept.
#
# Usage: remove-legacy-hooks.sh <settings.json> [--apply]
#   Without --apply: print one "<event>: <command>" line per legacy entry.
#   With --apply: also back the file up to <file>.bak-<epoch> and rewrite it
#   in place (a symlinked settings.json stays a symlink).
# Exit: 0 = entries found (listed or removed), 1 = none, 2 = error.
set -uo pipefail

f="${1:-}"
apply="${2:-}"
command -v jq >/dev/null 2>&1 || { printf 'remove-legacy-hooks: jq is required\n' >&2; exit 2; }
[ -n "$f" ] && [ -f "$f" ] || { printf 'remove-legacy-hooks: no settings file %s\n' "$f" >&2; exit 2; }
case "$apply" in ''|--apply) ;; *) printf 'usage: remove-legacy-hooks.sh <settings.json> [--apply]\n' >&2; exit 2 ;; esac

re='ruvector[^"]* hooks (post-edit|post-command|pre-edit|pre-command|session-start|session-end)'

list=$(jq -r --arg re "$re" '
  (.hooks // {}) | if type == "object" then to_entries[] else empty end
  | .key as $e | (.value | if type == "array" then .[] else empty end)
  | (.hooks | if type == "array" then .[] else empty end)
  | select((.command // "" | tostring) | test($re))
  | "\($e): \(.command)"' "$f" 2>/dev/null) || { printf 'remove-legacy-hooks: %s is not valid JSON\n' "$f" >&2; exit 2; }
[ -n "$list" ] || exit 1
printf '%s\n' "$list"
[ "$apply" = --apply ] || exit 0

tmp=$(mktemp "${TMPDIR:-/tmp}/rv-settings.XXXXXX") || exit 2
trap 'rm -f "$tmp"' EXIT
jq --arg re "$re" '
  if (.hooks | type) == "object" then
    .hooks |= (with_entries(.value |= (if type == "array" then
        map(if (.hooks | type) == "array"
            then .hooks |= map(select((.command // "" | tostring) | test($re) | not))
            else . end)
        | map(select((.hooks | type) != "array" or (.hooks | length) > 0))
      else . end))
      | with_entries(select((.value | type) != "array" or (.value | length) > 0)))
  else . end' "$f" > "$tmp" || exit 2
[ -s "$tmp" ] || exit 2
backup="${f}.bak-$(date +%s)"
cp -p -- "$f" "$backup" || exit 2
cat "$tmp" > "$f" || { printf 'remove-legacy-hooks: could not rewrite %s (backup kept at %s)\n' "$f" "$backup" >&2; exit 2; }
printf 'removed; backup: %s\n' "$backup"
exit 0
