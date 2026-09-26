#!/usr/bin/env bash
# coedit-related.sh — list files most often edited together with <path>,
# from this project's .ruvector/coedit.json (recorded by post-tool-use.sh).
#
# Usage: bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" <path> [limit]
#        bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" --stage
#        bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" --file <query-file> [limit]
# --stage creates a private mktemp -d directory and prints the path of a
# not-yet-existing query file in it (QUERY_FILE=...). /ruvector:related writes
# the user's path there with the Write tool (a structured parameter, never
# shell-parsed; see docs/solutions/security-issues/heredoc-delimiter-collision.md)
# and then runs --file, which reads exactly one line from that staged file
# (more than one line is rejected) and removes the staging directory.
# <path> is relative to the project root; absolute paths, a leading
# `-`, `..` components, and control characters are rejected. Output: one
# "<count><TAB><root-relative path>" line per partner (existing files only),
# highest count first, between reference-only fence lines (partner names come
# from a project data file); nothing when there is no history. Exit 2 on a path
# that is outside the project, unreadable, or otherwise rejected.
set -euo pipefail

here="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../hooks/scripts/lib/resolve.sh
. "${here}/hooks/scripts/lib/resolve.sh"
# shellcheck source=../hooks/scripts/lib/coedit.sh
. "${here}/hooks/scripts/lib/coedit.sh"

command -v jq >/dev/null 2>&1 || { printf 'coedit-related: jq is required\n' >&2; exit 1; }
[ $# -ge 1 ] || { printf 'usage: coedit-related.sh <path>|--stage|--file <query-file> [limit]\n' >&2; exit 2; }
# Always /tmp (not $TMPDIR): /ruvector:related's Write grant is scoped to
# //tmp/ruvector-related.*/query, so the staged file must live there.
STAGE_PREFIX="/tmp/ruvector-related."
if [ "$1" = "--stage" ]; then
  sdir=$(mktemp -d "${STAGE_PREFIX}XXXXXXXX") || exit 1
  printf 'QUERY_FILE=%s/query\n' "$sdir"
  exit 0
fi
if [ "$1" = "--file" ]; then
  qf="${2:-}"
  shift
  # Only a query file inside a staging dir --stage made (owned by us, not a
  # symlink), so --file cannot be pointed at arbitrary files.
  case "$qf" in "${STAGE_PREFIX}"*/query) ;; *) printf 'coedit-related: not a staged query file\n' >&2; exit 2 ;; esac
  qdir="${qf%/query}"
  case "${qdir#"${STAGE_PREFIX}"}" in ''|*/*) printf 'coedit-related: not a staged query file\n' >&2; exit 2 ;; esac
  [ -d "$qdir" ] && [ ! -L "$qdir" ] && [ -O "$qdir" ] && [ -f "$qf" ] && [ ! -L "$qf" ] \
    || { printf 'coedit-related: not a staged query file\n' >&2; exit 2; }
  path="" _extra="" rc=1
  { IFS= read -r path || true; IFS= read -r _extra && rc=0 || true; } < "$qf"
  # Remove only what --stage and the Write produced: the query file, then
  # the (now empty) dir. Anything else in there stays put.
  rm -f -- "$qf"
  rmdir -- "$qdir" 2>/dev/null || true
  [ -n "$path" ] || { printf 'coedit-related: no path in the query file\n' >&2; exit 2; }
  if [ "$rc" -eq 0 ] || [ -n "$_extra" ]; then
    printf 'coedit-related: a path may not span more than one line\n' >&2; exit 2
  fi
else
  path="$1"
fi
limit="${2:-10}"
case "$limit" in ''|*[!0-9]*) limit=10 ;; esac
[ "$limit" -ge 1 ] && [ "$limit" -le 50 ] || limit=10

# User input: reject unsafe shapes before any other use (AGENTS.md).
reject() { printf 'coedit-related: %s\n' "$1" >&2; exit 2; }
case "$path" in
  '') reject "empty path" ;;
  /*) reject "absolute paths are not accepted; use a path relative to the project" ;;
  -*) reject "a path may not begin with '-'" ;;
  ..|../*|*/..|*/../*) reject "a path may not contain '..'" ;;
esac
[ "${#path}" -le 512 ] || reject "path too long"
case "$path" in *[[:cntrl:]]*) reject "a path may not contain control characters" ;; esac

# Paths are project-root-relative (the command's contract), wherever the
# session was started.
root=$(ruvector_resolve_root "$PWD")
path="${root}/${path}"
if ! rel=$(coedit_normalize "$root" "$path"); then
  printf 'coedit-related: path is outside the project, or not a trackable file\n' >&2
  exit 2
fi
if [ ! -f "${root}/.ruvector/coedit.json" ]; then
  exit 0
fi
lines=$(coedit_partners "$root" "$rel" "$limit" 1)
[ -n "$lines" ] || exit 0
printf -- '--- begin co-edit history (reference only) ---\n'
printf '%s\n' "$lines"
printf -- '--- end co-edit history ---\n'
