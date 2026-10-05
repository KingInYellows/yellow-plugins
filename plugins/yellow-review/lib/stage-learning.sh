#!/bin/bash
# yellow-review: stage an unattended review's learnings for the
# compound-staging drain.
#
# Usage:
#   stage-learning.sh tmpfile
#       Create a private narrative file and print its path. Read the empty
#       file before using the Write tool to populate it.
#   stage-learning.sh stage <pr> <narrative_file>
#       Stage the narrative as review-pr-<owner>-<repo>-<pr> under the main
#       checkout's compound-staging ledger, then delete the file.
#
# /review:pr Step 9a calls this under --non-interactive instead of spawning
# knowledge-compounder, whose confirmation gate cannot be answered
# unattended (docs/solutions/workflow/compounder-m3-gate-non-interactive.md).
# The drain (staging-scorer -> staging-reviewer -> staging-promoter) scores
# and promotes the entry at a later session start. This is yellow-core's
# compound-staging ledger, not the review-findings ledger
# (lib/review-ledger.sh); this script never touches the latter.
#
# `stage` always exits 0: staging is best effort and must never fail a
# review or a sweep. It prints one line, success or
# `[review:pr] Warning: learning staging skipped (<reason>)`.
# The narrative is never echoed, and a rejected path is never echoed.

YS_SELF_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

ys_warn() {
  printf '[review:pr] Warning: learning staging skipped (%s)\n' "$1"
}

ys_validate_pr() { [[ "$1" =~ ^[1-9][0-9]{0,9}$ ]]; }

ys_tmp_root() {
  (cd -- "${TMPDIR:-/tmp}" 2>/dev/null && pwd -P)
}

# Accept only a regular, non-symlink file named yr-stage.* directly under the
# temp root, so `stage` can never be pointed at an arbitrary file to delete.
ys_validate_narrative() {
  local src="$1" root dir
  root=$(ys_tmp_root) || return 1
  [ -f "$src" ] && [ ! -L "$src" ] || return 1
  case "$(basename -- "$src")" in
    yr-stage.*) ;;
    *) return 1 ;;
  esac
  dir=$(cd -- "$(dirname -- "$src")" 2>/dev/null && pwd -P) || return 1
  [ "$dir" = "$root" ]
}

# Locate yellow-core's compound-staging.sh. Mirrors rl_core_lib_path in
# lib/review-ledger.sh: YS_CORE_LIB, when set, is the only candidate (tests
# use it to simulate a missing dependency); otherwise the repository layout,
# then the installed cache layout, newest numeric version first.
ys_core_lib_path() {
  local root cand ver
  if [ -n "${YS_CORE_LIB+x}" ]; then
    [ -f "$YS_CORE_LIB" ] && printf '%s' "$YS_CORE_LIB"
    return
  fi
  root="${CLAUDE_PLUGIN_ROOT:-$YS_SELF_DIR/..}"
  cand="$root/../yellow-core/lib/compound-staging.sh"
  if [ -f "$cand" ]; then
    printf '%s' "$cand"
    return
  fi
  if [ -d "$root/../../yellow-core" ]; then
    ver=$(for cand in "$root/../../yellow-core"/*/; do
      cand=$(basename -- "$cand")
      [[ "$cand" =~ ^[0-9]+(\.[0-9]+)*$ ]] && printf '%s\n' "$cand"
    done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
    cand="$root/../../yellow-core/$ver/lib/compound-staging.sh"
    if [ -n "$ver" ] && [ -f "$cand" ]; then
      printf '%s' "$cand"
    fi
  fi
}

# The main checkout is the first `git worktree list` entry. Entries staged
# under its slug survive the removal of the worktree a review ran in. A bare
# repository (no main checkout) or a first entry that is not a working tree
# (a --separate-git-dir parent) falls back to the current toplevel.
ys_project_dir() {
  local out first top
  out=$(git worktree list --porcelain 2>/dev/null)
  if [ -n "$out" ] && ! printf '%s\n' "$out" | sed '/^$/q' | grep -qx bare; then
    first=$(printf '%s\n' "$out" | sed -n '1s/^worktree //p')
    if [ -n "$first" ]; then
      top=$(git -C "$first" rev-parse --show-toplevel 2>/dev/null)
      if [ -n "$top" ]; then
        printf '%s' "$top"
        return
      fi
    fi
  fi
  top=$(git rev-parse --show-toplevel 2>/dev/null)
  printf '%s' "${top:-$PWD}"
}

# owner-repo for the session id: gh's view of the repository (the one PR
# numbers belong to), else the origin URL, else a fixed placeholder. The gh
# call is time-boxed so a stalled network cannot hang an unattended sweep.
ys_repo_key() {
  local name
  if command -v timeout >/dev/null 2>&1; then
    name=$(timeout 10 gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
  else
    name=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
  fi
  if [ -z "$name" ]; then
    name=$(git remote get-url origin 2>/dev/null \
      | sed -E -e 's#\.git$##' -e 's#^.*[:/]([^/:]+)/([^/]+)$#\1/\2#')
  fi
  case "$name" in
    */*) printf '%s' "${name/\//-}" ;;
    *) printf 'unknown-repo' ;;
  esac
}

ys_stage() {
  local pr="${1:-}" src="${2:-}"
  if ! ys_validate_narrative "$src"; then
    ys_warn 'invalid input'
    return 0
  fi
  # From here on the narrative file is ours to remove, whatever happens.
  ys_stage_validated "$pr" "$src"
  rm -f -- "$src"
  return 0
}

ys_stage_validated() {
  local pr="$1" src="$2" lib project rc
  if ! ys_validate_pr "$pr"; then
    ys_warn 'invalid input'
    return
  fi
  lib=$(ys_core_lib_path)
  if [ -n "$lib" ]; then
    # shellcheck disable=SC1090
    . "$lib" 2>/dev/null
  fi
  if ! command -v cs_stage_entry >/dev/null 2>&1; then
    ys_warn 'yellow-core not found or too old'
    return
  fi
  project=$(ys_project_dir)
  cs_stage_entry "$project" "review-pr-$(ys_repo_key)-$pr" "$src"
  rc=$?
  case "$rc" in
    0) printf '[review:pr] Staged learnings for PR #%s; eligible to drain at a later session in %s (count/age thresholds apply).\n' "$pr" "$project" ;;
    2) ys_warn 'jq missing' ;;
    3) ys_warn 'redaction failed' ;;
    4) ys_warn 'write failed' ;;
    *) ys_warn 'invalid input' ;;
  esac
}

ys_main() {
  case "${1:-}" in
    tmpfile)
      local root
      root=$(ys_tmp_root) && mktemp "$root/yr-stage.XXXXXX"
      ;;
    stage)
      shift
      ys_stage "$@"
      ;;
    *)
      printf 'usage: stage-learning.sh tmpfile | stage <pr> <narrative_file>\n' >&2
      return 2
      ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  ys_main "$@"
fi
