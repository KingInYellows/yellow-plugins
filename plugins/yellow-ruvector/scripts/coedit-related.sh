#!/usr/bin/env bash
# coedit-related.sh — list files most often edited together with <path>,
# from this project's .ruvector/coedit.json (recorded by post-tool-use.sh).
#
# Usage: bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" <path> [limit]
# <path> is absolute or relative to the current directory. Output: one
# "<count><TAB><root-relative path>" line per partner (existing files only),
# highest count first; nothing when there is no history. Exit 2 on a path
# that is outside the project, unreadable, or otherwise rejected.
set -euo pipefail

here="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../hooks/scripts/lib/resolve.sh
. "${here}/hooks/scripts/lib/resolve.sh"
# shellcheck source=../hooks/scripts/lib/coedit.sh
. "${here}/hooks/scripts/lib/coedit.sh"

command -v jq >/dev/null 2>&1 || { printf 'coedit-related: jq is required\n' >&2; exit 1; }
[ $# -ge 1 ] || { printf 'usage: coedit-related.sh <path> [limit]\n' >&2; exit 2; }
path="$1"
limit="${2:-10}"
case "$limit" in ''|*[!0-9]*) limit=10 ;; esac
[ "$limit" -ge 1 ] && [ "$limit" -le 50 ] || limit=10

root=$(ruvector_resolve_root "$PWD")
case "$path" in
  /*) ;;
  *) path="${PWD}/${path}" ;;
esac
if ! rel=$(coedit_normalize "$root" "$path"); then
  printf 'coedit-related: path is outside the project, or not a trackable file\n' >&2
  exit 2
fi
if [ ! -f "${root}/.ruvector/coedit.json" ]; then
  exit 0
fi
coedit_partners "$root" "$rel" "$limit" 1
