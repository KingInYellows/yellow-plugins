#!/usr/bin/env bash
# remove-legacy-hooks.sh — list, and on request remove, hook entries left in a
# Claude Code settings.json by a past `ruvector hooks init`. They run the
# global ruvector binary (post-edit, post-command, pre-edit, pre-command,
# session-start, session-end) and write edit/command memories that stamp a
# fresh store hash (ADR-210). Only those hook entries are touched; other
# hooks, including git-ai and this plugin's own, are kept.
#
# Usage: remove-legacy-hooks.sh <settings.json> [--apply]
#   <settings.json> must be $HOME/.claude/settings.json or the project's
#   <git toplevel or cwd>/.claude/settings.json (the same allowlist as
#   repair-cursor-pretooluse.sh). The project file arrives with a clone, so
#   it must resolve to the real .claude/settings.json inside the project (a
#   symlinked file or .claude dir is refused); a symlinked user file is
#   followed to its regular-file target.
#   Without --apply: print one "<event>: <command>" line per legacy entry.
#   With --apply: also copy the file to a new <file>.bak-XXXXXX (mktemp, so
#   never a pre-planted path) and rewrite the resolved file in place.
# Exit: 0 = entries found (listed or removed), 1 = none, 2 = error.
set -uo pipefail

f="${1:-}"
apply="${2:-}"
command -v jq >/dev/null 2>&1 || { printf 'remove-legacy-hooks: jq is required\n' >&2; exit 2; }
[ -n "$f" ] && [ -f "$f" ] || { printf 'remove-legacy-hooks: no settings file %s\n' "$f" >&2; exit 2; }
case "$apply" in ''|--apply) ;; *) printf 'usage: remove-legacy-hooks.sh <settings.json> [--apply]\n' >&2; exit 2 ;; esac

resolve_path() {
  realpath -- "$1" 2>/dev/null \
    || node -p 'require("fs").realpathSync(process.argv[1])' "$1" 2>/dev/null
}
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
user_settings="${HOME:-/__unset__}/.claude/settings.json"
project_settings="${root}/.claude/settings.json"
if [ "$f" = "$project_settings" ]; then
  # Checked first: when HOME is the project the two strings are equal, and a
  # cloned .claude symlink must still be refused rather than followed.
  resolved=$(resolve_path "$f") || resolved=""
  resolved_root=$(resolve_path "$root") || resolved_root=""
  if [ -z "$resolved" ] || [ -z "$resolved_root" ] || [ "$resolved" != "${resolved_root}/.claude/settings.json" ]; then
    printf 'remove-legacy-hooks: refusing project settings that resolve outside the project: %s\n' "$f" >&2
    exit 2
  fi
  target="$resolved"
elif [ "$f" = "$user_settings" ]; then
  target=$(resolve_path "$f") || target=""
else
  printf 'remove-legacy-hooks: refusing a settings path outside the allowlist: %s\n' "$f" >&2
  exit 2
fi
[ -n "$target" ] && [ -f "$target" ] && [ ! -L "$target" ] \
  || { printf 'remove-legacy-hooks: not a regular file: %s\n' "$f" >&2; exit 2; }
f="$target"

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
backup=$(mktemp "${f}.bak-XXXXXX") || exit 2
cat -- "$f" > "$backup" || exit 2
cat "$tmp" > "$f" || { printf 'remove-legacy-hooks: could not rewrite %s (backup kept at %s)\n' "$f" "$backup" >&2; exit 2; }
printf 'removed; backup: %s\n' "$backup"
exit 0
