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
# Staging dirs live in a private (0700) per-user directory, never shared
# /tmp: /ruvector:related pre-approves Write only for
# ~/.cache/yellow-ruvector/related/q.*/query, and no other user can plant a
# symlink there for that grant to follow. Always $HOME/.cache (not
# XDG_CACHE_HOME), so the path matches the grant.
case "${HOME:-}" in /?*) ;; *) printf 'coedit-related: HOME must be an absolute path\n' >&2; exit 1 ;; esac
STAGE_BASE="${HOME%/}/.cache/yellow-ruvector/related"
STAGE_PREFIX="${STAGE_BASE}/q."
# --stage records the staging dir here, so --run takes no argument and
# /ruvector:related can pre-approve both commands exactly, with no wildcard
# tail a prompt-injected model could extend with shell syntax.
# One record per Claude Code session, so concurrent sessions never consume
# each other's query: the session id when the host exports it, else the pid
# of the process that runs the Bash tool's shells (this script's
# grandparent: the host -> the tool's shell -> this script).
PTR_DIR="${XDG_CACHE_HOME:-${HOME:-/nonexistent}/.cache}/yellow-ruvector"
_key="${CLAUDE_CODE_SESSION_ID:-}"
[ -n "$_key" ] || _key="ppid-$(ps -o ppid= -p "$PPID" 2>/dev/null | tr -d ' ')"
_key=$(printf '%s' "$_key" | LC_ALL=C tr -cd 'A-Za-z0-9_-' | cut -c1-80)
[ -n "$_key" ] && [ "$_key" != "ppid-" ] || _key="default"
PTR="${PTR_DIR}/related-stage.${_key}"
# drop_stage <pointer> — remove a pointer record and what it staged: only
# the query file and the (then empty) dir, and only a dir --stage made
# (under the prefix, one level, ours, not a symlink).
drop_stage() {
  local d=""
  [ -f "$1" ] && [ ! -L "$1" ] && [ -O "$1" ] || return 0
  IFS= read -r d < "$1" || true
  case "$d" in "${STAGE_PREFIX}"?*) ;; *) d="" ;; esac
  case "${d#"${STAGE_PREFIX}"}" in */*) d="" ;; esac
  if [ -n "$d" ] && [ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ]; then
    # Best effort: a `query` that is not a file (a directory) stays, and
    # so does its dir, but the pointer below is always dropped, so the
    # next --stage never trips over it again (set -e would abort here).
    rm -f -- "${d}/query" 2>/dev/null || true
    rmdir -- "$d" 2>/dev/null || true
  fi
  rm -f -- "$1"
}
if [ "$1" = "--stage" ]; then
  ( umask 077; mkdir -p "$STAGE_BASE" ) 2>/dev/null || exit 1
  [ -d "$STAGE_BASE" ] && [ ! -L "$STAGE_BASE" ] && [ -O "$STAGE_BASE" ] || {
    printf 'coedit-related: %s must be a directory you own (not a symlink)\n' "$STAGE_BASE" >&2; exit 1; }
  chmod 700 "$STAGE_BASE" 2>/dev/null || exit 1
  sdir=$(mktemp -d "${STAGE_PREFIX}XXXXXXXX") || exit 1
  ( umask 077; mkdir -p "$PTR_DIR" ) 2>/dev/null || exit 1
  [ -d "$PTR_DIR" ] && [ ! -L "$PTR_DIR" ] && [ -O "$PTR_DIR" ] || exit 1
  # A stage this session never ran, and records (with their staging dirs)
  # other sessions left unrun for over a day (at most 100 per call).
  drop_stage "$PTR"
  while IFS= read -r old; do
    drop_stage "$old"
  done < <(find "$PTR_DIR" ! -name "${PTR_DIR##*/}" -prune -type f -name 'related-stage.*' -mtime +0 \
    2>/dev/null | head -n 100)
  # A non-regular file at the pointer path (a directory would take the
  # rename *inside* it) is removed first; PTR_DIR is ours and not a symlink.
  if [ -L "$PTR" ] || { [ -e "$PTR" ] && [ ! -f "$PTR" ]; }; then
    rm -rf -- "$PTR" 2>/dev/null || true
  fi
  if [ -L "$PTR" ] || { [ -e "$PTR" ] && [ ! -f "$PTR" ]; }; then
    printf 'coedit-related: %s is not a regular file; remove it and retry\n' "$PTR" >&2
    rmdir -- "$sdir" 2>/dev/null || true
    exit 1
  fi
  ptmp=$(mktemp "${PTR}.XXXXXX") || exit 1
  printf '%s\n' "$sdir" > "$ptmp" && mv -f -- "$ptmp" "$PTR" || { rm -f -- "$ptmp"; exit 1; }
  printf 'QUERY_FILE=%s/query\n' "$sdir"
  exit 0
fi
if [ "$1" = "--run" ]; then
  [ -f "$PTR" ] && [ ! -L "$PTR" ] && [ -O "$PTR" ] \
    || { printf 'coedit-related: nothing staged (run --stage first)\n' >&2; exit 2; }
  IFS= read -r _sdir < "$PTR" || _sdir=""
  # No query written (the Write step failed or never ran): drop the record
  # together with its empty staging dir, so nothing is left unreachable.
  if [ ! -f "${_sdir}/query" ] || [ -L "${_sdir}/query" ]; then
    drop_stage "$PTR"
    printf 'coedit-related: no query was written (run --stage again)\n' >&2
    exit 2
  fi
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
  path="" _extra="" rc=1 has_nul=0
  # read drops NUL bytes silently (src/a<NUL>b.ts would become src/ab.ts),
  # so count them at the byte level first.
  [ "$(LC_ALL=C tr -d '\000' < "$qf" | wc -c)" -eq "$(wc -c < "$qf")" ] || has_nul=1
  { IFS= read -r path || true; IFS= read -r _extra && rc=0 || true; } < "$qf"
  # Remove only what --stage and the Write produced: the query file, then
  # the (now empty) dir. Anything else in there stays put.
  rm -f -- "$qf"
  rmdir -- "$qdir" 2>/dev/null || true
  [ "$has_nul" -eq 0 ] || { printf 'coedit-related: a path may not contain control characters\n' >&2; exit 2; }
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
case "$path" in *[[:cntrl:]]*|*$'\xc2\x85'*|*$'\xe2\x80\xa8'*|*$'\xe2\x80\xa9'*)
  reject "a path may not contain control characters or line separators" ;; esac

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
# budgets (and a 10s main-worktree lookup from a linked worktree), so many
# stale high-count partners never hide valid ones. The
# component budget covers every candidate in full: a stored path is at most
# 512 characters, so at most 256 components deep.
lines=$(COEDIT_SCAN="$COEDIT_MAX_PAIRS" COEDIT_PHYS_CHECKS="$COEDIT_MAX_PAIRS" \
  COEDIT_COMP_CHECKS=$((COEDIT_MAX_PAIRS * 256)) COEDIT_JQ_SECS=5 COEDIT_WT_SECS=10 \
  coedit_partners "$root" "$rel" "$limit" 1)
[ -n "$lines" ] || exit 0
printf -- '--- begin co-edit history (reference only) ---\n'
# Paths are printed verbatim (a rewritten name would point at the wrong
# file): each line starts with the count and a tab, and a partner holds no
# control characters or Unicode line breaks, so no path can form a fence
# line.
printf '%s\n' "$lines"
printf -- '--- end co-edit history ---\n'
