#!/usr/bin/env bash
# coedit-related.sh — list files most often edited together with <path>,
# from this project's .ruvector/coedit.json (recorded by post-tool-use.sh).
#
# Usage: bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" --stage
#        bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" --run
#        bash "${CLAUDE_PLUGIN_ROOT}/scripts/coedit-related.sh" --file <query-file> [limit]
# --stage creates a private mktemp -d directory and prints the path of a
# not-yet-existing query file in it (QUERY_FILE=...). /ruvector:related writes
# the user's path there with the Write tool (a structured parameter, never
# shell-parsed; see docs/solutions/security-issues/heredoc-delimiter-collision.md)
# and then runs --file, which reads exactly one line from that staged file
# (more than one line is rejected) and removes the staging directory. There
# is no positional <path> form: the user's path never appears in a command
# line, so /ruvector:related can pre-approve only these two fixed shapes.
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
USAGE='usage: coedit-related.sh --stage | --run | --file <query-file> [limit]'
[ $# -ge 1 ] || { printf '%s\n' "$USAGE" >&2; exit 2; }
# Always /tmp (not $TMPDIR): /ruvector:related's Write grant is scoped to
# //tmp/ruvector-related.*/query, so the staged file must live there.
STAGE_PREFIX="/tmp/ruvector-related."
# --stage records the staging dir here, so --run takes no argument and
# /ruvector:related can pre-approve both commands exactly, with no wildcard
# tail a prompt-injected model could extend with shell syntax.
PTR_DIR="${XDG_CACHE_HOME:-${HOME:-/nonexistent}/.cache}/yellow-ruvector"
PTR="${PTR_DIR}/related-stage"
if [ "$1" = "--stage" ]; then
  sdir=$(mktemp -d "${STAGE_PREFIX}XXXXXXXX") || exit 1
  ( umask 077; mkdir -p "$PTR_DIR" ) 2>/dev/null || exit 1
  [ -d "$PTR_DIR" ] && [ ! -L "$PTR_DIR" ] && [ -O "$PTR_DIR" ] || exit 1
  ptmp=$(mktemp "${PTR}.XXXXXX") || exit 1
  printf '%s\n' "$sdir" > "$ptmp" && mv -f -- "$ptmp" "$PTR" || { rm -f -- "$ptmp"; exit 1; }
  printf 'QUERY_FILE=%s/query\n' "$sdir"
  exit 0
fi
if [ "$1" = "--run" ]; then
  [ -f "$PTR" ] && [ ! -L "$PTR" ] && [ -O "$PTR" ] \
    || { printf 'coedit-related: nothing staged (run --stage first)\n' >&2; exit 2; }
  IFS= read -r _sdir < "$PTR" || _sdir=""
  rm -f -- "$PTR"
  # Same checks as --file below; the limit is fixed at 50.
  set -- --file "${_sdir}/query" 50
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
  printf '%s\n' "$USAGE" >&2
  exit 2
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
# On demand, not inside a 1s hook: scan every partner the store can hold
# (it is capped at COEDIT_MAX_PAIRS directed pairs) with larger check
# budgets, so many stale high-count partners never hide valid ones. The
# component budget covers every candidate in full: a stored path is at most
# 512 characters, so at most 256 components deep.
lines=$(COEDIT_SCAN="$COEDIT_MAX_PAIRS" COEDIT_PHYS_CHECKS="$COEDIT_MAX_PAIRS" \
  COEDIT_COMP_CHECKS=$((COEDIT_MAX_PAIRS * 256)) COEDIT_JQ_SECS=5 coedit_partners "$root" "$rel" "$limit" 1)
[ -n "$lines" ] || exit 0
printf -- '--- begin co-edit history (reference only) ---\n'
# Paths are printed verbatim (a rewritten name would point at the wrong
# file): each line starts with the count and a tab, and a partner holds no
# control characters, so no path can form a fence line.
printf '%s\n' "$lines"
printf -- '--- end co-edit history ---\n'
