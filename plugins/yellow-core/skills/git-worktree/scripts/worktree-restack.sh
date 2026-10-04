#!/usr/bin/env bash
# worktree-restack.sh - restack a stack whose branches live in separate git
# worktrees, through the active stacked-PR provider.
#
# A provider has to check a branch out to rebase it, and git refuses when
# another worktree holds that branch. Graphite path: record each stack
# worktree's branch, detach it, run one restack, restore every worktree.
# GitHub path (gh-stack >= 0.2.0): gh-stack rebases across worktrees itself,
# so nothing is detached.
#
# Usage:
#   bash worktree-restack.sh preflight --provider graphite|github
#   bash worktree-restack.sh start     --provider graphite|github [--submit]
#   bash worktree-restack.sh continue | abort | restore | status
#
# Run it from inside the stack worktree that holds the branch to restack from
# (the restack set is that branch plus everything stacked on it). It is never
# sourced; every subcommand is one process.
#
# Exit codes (one per outcome):
#    0 done (also: nothing to continue/abort)
#    2 usage
#    3 a restack is already in progress (lock or state exists)
#    4 state file invalid (nothing was run)
#    5 the active provider differs from the recorded one
#   10 paused on a conflict; worktrees stay detached, state kept
#   20 preflight refused (REFUSE lines say why); nothing was touched
#   30 restack failed; worktrees restored
#   40 partial restore: some worktree is still detached (per-entry lines say why)
#   50 restack incomplete (ancestry check failed); worktrees restored, no submit
#   60 restack finished and restored, but submit failed
#
# State: <git-common-dir>/yellow-core/worktree-restack/{state,lock.d}.
# The state file is fixed-field TSV, never sourced, and re-validated on every
# read. A model that writes a self-consistent state file is a documented
# residual (docs/solutions/security-issues/shell-owned-state-is-not-a-boundary-against-write.md).

set -uo pipefail
umask 077

readonly X_OK=0 X_USAGE=2 X_BUSY=3 X_STATE=4 X_PROVIDER=5 X_PAUSED=10
readonly X_REFUSED=20 X_FAILED=30 X_PARTIAL=40 X_INCOMPLETE=50 X_SUBMIT=60
readonly PAUSE_REASON='worktree:restack paused - do not commit; run /worktree:restack --continue or --abort'
readonly MAX_LISTED=20

# --- output helpers ---------------------------------------------------------

# v: a value (path, branch, ref) made printable - every control character,
# tabs and newlines included, is dropped.
v() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177'; }
err() { printf 'worktree-restack: %s\n' "$*" >&2; }
note() { printf '%s\n' "$*"; }
die() {
  local code=$1
  shift
  err "$*"
  exit "$code"
}
# q: shell-quote a value for a command line that is echoed back to the user.
q() { printf '%q' "$(v "$1")"; }
# cap_lines: print stdin, at most $1 lines, then a "+N more" line.
cap_lines() {
  local max=$1 n=0 line
  while IFS= read -r line; do
    n=$((n + 1))
    if [ "$n" -le "$max" ]; then printf '%s\n' "$(v "$line")"; fi
  done
  if [ "$n" -gt "$max" ]; then printf '+%d more\n' "$((n - max))"; fi
}

# --- environment checks -----------------------------------------------------

git_at_least() { # git_at_least MAJOR MINOR
  local ver maj min rest
  ver=$(git --version 2>/dev/null | awk '{print $3}')
  maj=${ver%%.*}
  rest=${ver#*.}
  min=${rest%%.*}
  maj=${maj//[!0-9]/}
  min=${min//[!0-9]/}
  [ -n "$maj" ] && [ -n "$min" ] || return 1
  [ "$maj" -gt "$1" ] || { [ "$maj" -eq "$1" ] && [ "$min" -ge "$2" ]; }
}

# ver_gt A B: dotted-numeric A > B (no sort -V: BSD sort lacks it).
ver_gt() {
  local -a a b
  local i x y
  IFS=. read -r -a a <<<"${1%%[-+]*}"
  IFS=. read -r -a b <<<"${2%%[-+]*}"
  for i in 0 1 2; do
    x=${a[i]:-0}
    y=${b[i]:-0}
    x=${x//[!0-9]/}
    y=${y//[!0-9]/}
    x=${x:-0}
    y=${y:-0}
    [ "$((10#$x))" -le "$((10#$y))" ] || return 0
    [ "$((10#$x))" -ge "$((10#$y))" ] || return 1
  done
  return 1
}

# --- repository and worktree discovery --------------------------------------

canon() { (cd -- "$1" 2>/dev/null && pwd -P); }

repo_top() {
  local top
  top=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$top" ] || return 1
  canon "$top"
}

common_dir() {
  local d
  if d=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && [ -n "$d" ] && [ "${d#/}" != "$d" ]; then
    canon "$d"
    return
  fi
  d=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
  canon "$d"
}

# load_worktrees fills WT_* from `git worktree list --porcelain -z`. Paths may
# hold spaces; newlines survive -z and are refused later.
load_worktrees() {
  WT_PATH=() WT_HEAD=() WT_BRANCH=() WT_LOCKED=() WT_PRUNABLE=() WT_BARE=()
  local rec i=-1
  while IFS= read -r -d '' rec; do
    case $rec in
      'worktree '*)
        i=$((i + 1))
        WT_PATH[i]=${rec#worktree }
        # git reports physical paths; fall back to the raw path if it is gone.
        WT_PATH[i]=$(canon "${WT_PATH[i]}" || printf '%s' "${WT_PATH[i]}")
        WT_HEAD[i]=""
        WT_BRANCH[i]=""
        WT_LOCKED[i]=0
        WT_PRUNABLE[i]=0
        WT_BARE[i]=0
        ;;
      'HEAD '*) [ "$i" -ge 0 ] && WT_HEAD[i]=${rec#HEAD } ;;
      'branch '*) [ "$i" -ge 0 ] && WT_BRANCH[i]=${rec#branch } ;;
      locked*) [ "$i" -ge 0 ] && WT_LOCKED[i]=1 ;;
      prunable*) [ "$i" -ge 0 ] && WT_PRUNABLE[i]=1 ;;
      bare) [ "$i" -ge 0 ] && WT_BARE[i]=1 ;;
    esac
  done < <(git worktree list --porcelain -z 2>/dev/null)
  return 0
}

# wt_index PATH: index into WT_* or -1.
wt_index() {
  local i
  for ((i = 0; i < ${#WT_PATH[@]}; i++)); do
    if [ "${WT_PATH[i]}" = "$1" ]; then
      printf '%d' "$i"
      return 0
    fi
  done
  printf '%d' -1
}

# branch_holder REF: path of the worktree that has REF checked out, if any.
branch_holder() {
  local i
  for ((i = 0; i < ${#WT_PATH[@]}; i++)); do
    if [ "${WT_BRANCH[i]}" = "$1" ]; then
      printf '%s' "${WT_PATH[i]}"
      return 0
    fi
  done
  return 1
}

# wt_git_path PATH NAME: absolute path of NAME inside PATH's per-worktree git dir.
wt_git_path() { git -C "$1" rev-parse --path-format=absolute --git-path "$2" 2>/dev/null; }

# wt_busy PATH: print the in-progress operation name and return 0 when PATH is
# in the middle of a rebase, merge, cherry-pick, revert or sequencer run.
wt_busy() {
  local name p
  for name in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD sequencer; do
    p=$(wt_git_path "$1" "$name") || continue
    if [ -n "$p" ] && [ -e "$p" ]; then
      printf '%s' "$name"
      return 0
    fi
  done
  return 1
}

# wt_dirty PATH: return 0 when PATH has changes. An untracked .ruvector
# symlink (made by worktree-manager.sh) is not a change.
wt_dirty() {
  local rec
  while IFS= read -r -d '' rec; do
    [ -n "$rec" ] || continue
    if [ "$rec" = '?? .ruvector' ] && [ -L "$1/.ruvector" ]; then continue; fi
    return 0
  done < <(git -C "$1" status --porcelain=v1 -z --untracked-files=normal 2>/dev/null)
  return 1
}

valid_branch() { # a short branch name that is safe to put on a command line
  local name=$1
  [ -n "$name" ] || return 1
  case $name in -* | *..* | *'@{'* | *[[:cntrl:]]*) return 1 ;; esac
  git check-ref-format --branch "$name" >/dev/null 2>&1
}

valid_ref() { # refs/heads/<valid branch>
  case $1 in refs/heads/*) valid_branch "${1#refs/heads/}" ;; *) return 1 ;; esac
}

valid_sha() { [[ $1 =~ ^[0-9a-f]{40}([0-9a-f]{24})?$ ]]; }

branch_exists() { git show-ref --verify --quiet "refs/heads/$1" 2>/dev/null; }

# --- state and lock ---------------------------------------------------------

init_paths() {
  COMMON=$(common_dir) || die "$X_USAGE" "not inside a git repository"
  STATE_DIR="$COMMON/yellow-core/worktree-restack"
  STATE_FILE="$STATE_DIR/state"
  LOCK_DIR="$STATE_DIR/lock.d"
}

ensure_state_dir() {
  mkdir -p -- "$STATE_DIR" || die "$X_FAILED" "cannot create $(v "$STATE_DIR")"
  chmod 700 -- "$STATE_DIR" "$(dirname -- "$STATE_DIR")" 2>/dev/null || true
}

mtime_of() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

lock_pid() { cat -- "$LOCK_DIR/pid" 2>/dev/null; }

lock_pid_alive() {
  local p
  p=$(lock_pid)
  [[ $p =~ ^[0-9]+$ ]] && [ "$p" -gt 0 ] && kill -0 "$p" 2>/dev/null
}

lock_generation() { printf '%s-%s' "$(ls -di -- "$LOCK_DIR" 2>/dev/null | awk '{print $1}')" "$(mtime_of "$LOCK_DIR")"; }

# Atomic: only one reclaimer wins the rename.
lock_reclaim() {
  mv -- "$LOCK_DIR" "$LOCK_DIR.reclaim.$$" 2>/dev/null || return 1
  rm -rf -- "$LOCK_DIR.reclaim.$$"
}

lock_stamp() {
  printf '%s\n' "$$" >|"$LOCK_DIR/pid" || return 1
  date -u +%Y-%m-%dT%H:%M:%SZ >|"$LOCK_DIR/started" 2>/dev/null || true
}

release_lock() {
  rm -f -- "$LOCK_DIR/pid" "$LOCK_DIR/started" 2>/dev/null
  rmdir -- "$LOCK_DIR" 2>/dev/null || true
}

# acquire_lock: new restack. A lock is reclaimable only when its owner is dead
# and no state file exists; with state present every path points to
# --continue, --abort or --status. An unreadable pid file (owner killed
# between mkdir and the pid write) counts as stale only when it is still
# unreadable on the same lock generation (inode + mtime) a second later.
acquire_lock() {
  local p gen1 gen2
  for _ in 1 2; do
    if mkdir -- "$LOCK_DIR" 2>/dev/null; then
      lock_stamp || {
        rm -rf -- "$LOCK_DIR"
        return 1
      }
      return 0
    fi
    [ ! -e "$STATE_FILE" ] || return 1
    lock_pid_alive && return 1
    p=$(lock_pid)
    if ! [[ $p =~ ^[0-9]+$ ]] || [ "$p" -eq 0 ]; then
      gen1=$(lock_generation)
      sleep 1
      gen2=$(lock_generation)
      p=$(lock_pid)
      { [ "$gen1" = "$gen2" ] && ! [[ $p =~ ^[0-9]+$ ]]; } || return 1
    fi
    lock_reclaim || return 1
  done
  return 1
}

# take_lock: continue/abort/restore resume a run whose process is gone.
take_lock() {
  if mkdir -- "$LOCK_DIR" 2>/dev/null; then
    lock_stamp
    return
  fi
  [ -d "$LOCK_DIR" ] || return 1
  if lock_pid_alive && [ "$(lock_pid)" != "$$" ]; then return 1; fi
  lock_stamp
}

write_state() {
  local tmp="$STATE_FILE.tmp.$$" i
  {
    printf 'v1\n'
    printf 'provider\t%s\n' "$S_PROVIDER"
    printf 'tool\t%s\n' "${S_TOOLVER:--}"
    printf 'common\t%s\n' "$S_COMMON"
    printf 'run\t%s\n' "$S_RUN"
    printf 'submit\t%s\n' "$S_SUBMIT"
    printf 'token\t%s\n' "$S_TOKEN"
    printf 'chain'
    for ((i = 0; i < ${#S_CHAIN[@]}; i++)); do printf '\t%s' "${S_CHAIN[i]}"; done
    printf '\n'
    for ((i = 0; i < ${#E_PATH[@]}; i++)); do
      printf 'entry\t%s\t%s\t%s\t%s\t%s\n' "${E_PATH[i]}" "${E_REF[i]}" "${E_SHA[i]}" "${E_PHASE[i]}" "${E_LOCK[i]}"
    done
  } >|"$tmp" || {
    rm -f -- "$tmp"
    return 1
  }
  mv -f -- "$tmp" "$STATE_FILE" || {
    rm -f -- "$tmp"
    return 1
  }
}

clear_state() { rm -f -- "$STATE_FILE" "$STATE_FILE".tmp.* 2>/dev/null; }

# read_state parses the fixed-field TSV; validate_state decides whether to trust it.
read_state() {
  S_PROVIDER="" S_TOOLVER="" S_COMMON="" S_RUN="" S_SUBMIT="" S_TOKEN=""
  S_CHAIN=() E_PATH=() E_REF=() E_SHA=() E_PHASE=() E_LOCK=()
  STATE_ERR=""
  if [ ! -f "$STATE_FILE" ] || [ -L "$STATE_FILE" ]; then
    STATE_ERR="state file is missing or not a regular file"
    return 1
  fi
  local line first=1 n=0
  local -a f
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$first" -eq 1 ]; then
      first=0
      [ "$line" = v1 ] || {
        STATE_ERR="unknown state schema"
        return 1
      }
      continue
    fi
    IFS=$'\t' read -r -a f <<<"$line"
    case ${f[0]:-} in
      provider) S_PROVIDER=${f[1]:-} ;;
      tool) S_TOOLVER=${f[1]:-} ;;
      common) S_COMMON=${f[1]:-} ;;
      run) S_RUN=${f[1]:-} ;;
      submit) S_SUBMIT=${f[1]:-} ;;
      token) S_TOKEN=${f[1]:-} ;;
      chain) S_CHAIN=("${f[@]:1}") ;;
      entry)
        E_PATH[n]=${f[1]:-}
        E_REF[n]=${f[2]:-}
        E_SHA[n]=${f[3]:-}
        E_PHASE[n]=${f[4]:-}
        E_LOCK[n]=${f[5]:-}
        n=$((n + 1))
        ;;
      '') ;;
      *)
        STATE_ERR="unknown field in state file"
        return 1
        ;;
    esac
  done <"$STATE_FILE"
  return 0
}

# validate_state: nothing read from the state file reaches git until it passes.
validate_state() {
  local i b p
  STATE_ERR=""
  case $S_PROVIDER in graphite | github) ;; *)
    STATE_ERR="bad provider"
    return 1
    ;;
  esac
  [ "$S_COMMON" = "$COMMON" ] || {
    STATE_ERR="state belongs to another repository"
    return 1
  }
  case $S_SUBMIT in 0 | 1) ;; *)
    STATE_ERR="bad submit flag"
    return 1
    ;;
  esac
  [[ $S_TOKEN =~ ^[0-9a-f]{8,64}$ ]] || {
    STATE_ERR="bad token"
    return 1
  }
  [ "${#S_CHAIN[@]}" -ge 2 ] || {
    STATE_ERR="chain too short"
    return 1
  }
  for b in "${S_CHAIN[@]}"; do
    valid_branch "$b" || {
      STATE_ERR="invalid branch name in chain"
      return 1
    }
  done
  load_worktrees
  case $S_RUN in /*) ;; *)
    STATE_ERR="run worktree is not an absolute path"
    return 1
    ;;
  esac
  [ "$(wt_index "$S_RUN")" -ge 0 ] || {
    STATE_ERR="run worktree is not a worktree of this repository"
    return 1
  }
  if [ "$S_PROVIDER" = github ] && [ "${#E_PATH[@]}" -ne 0 ]; then
    STATE_ERR="github state must have no detached entries"
    return 1
  fi
  for ((i = 0; i < ${#E_PATH[@]}; i++)); do
    p=${E_PATH[i]}
    case $p in /*) ;; *)
      STATE_ERR="entry path is not absolute"
      return 1
      ;;
    esac
    case $p in
      *[[:cntrl:]]* | */../* | */..)
        STATE_ERR="entry path has control characters or '..'"
        return 1
        ;;
    esac
    [ "$(wt_index "$p")" -ge 0 ] || {
      STATE_ERR="entry path is not a worktree of this repository"
      return 1
    }
    [ "$p" != "$S_RUN" ] || {
      STATE_ERR="run worktree listed as detached entry"
      return 1
    }
    valid_ref "${E_REF[i]}" || {
      STATE_ERR="entry ref is not a valid refs/heads/ name"
      return 1
    }
    valid_sha "${E_SHA[i]}" || {
      STATE_ERR="entry sha is not a commit id"
      return 1
    }
    case ${E_PHASE[i]} in detached | restored) ;; *)
      STATE_ERR="bad entry phase"
      return 1
      ;;
    esac
    case ${E_LOCK[i]} in 0 | 1) ;; *)
      STATE_ERR="bad entry lock flag"
      return 1
      ;;
    esac
  done
  return 0
}

# --- provider: Graphite -----------------------------------------------------
# Mirrors the registry's inspectStack / rebaseUpstack / continueConflict /
# abortConflict / submitStack entries (plugins/yellow-core/lib/stack-operation-registry.js).

gt_tool_version() { gt --version 2>/dev/null | head -n 1; }

# gt_stack_parse: `gt log short --stack --no-interactive` is top-first with
# trunk last; the current branch carries a filled glyph. Fills G_NAMES, G_CUR
# and G_FORK (any line with text before its glyph is a second column).
gt_stack_parse() {
  local out line glyph prefix rest name
  G_NAMES=() G_CUR=-1 G_FORK=0
  out=$(gt log short --stack --no-interactive 2>/dev/null) || return 1
  while IFS= read -r line; do
    case $line in
      *'◉'*) glyph='◉' ;;
      *'◯'*) glyph='◯' ;;
      *) continue ;;
    esac
    prefix=${line%%"$glyph"*}
    rest=${line#*"$glyph"}
    [ -z "$prefix" ] || G_FORK=1
    name=$(printf '%s' "$rest" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*([^)]*)[[:space:]]*$//' -e 's/[[:space:]]*$//')
    [ -n "$name" ] || continue
    [ "$glyph" != '◉' ] || G_CUR=${#G_NAMES[@]}
    G_NAMES+=("$name")
  done <<<"$out"
  [ "${#G_NAMES[@]}" -gt 0 ]
}

# gt_paused DIR: a Graphite conflict is rebase-merge/ (or rebase-apply/) AND
# .gtcontinue in DIR's per-worktree git dir. .gtcontinue alone survives
# `gt abort`, so it never counts by itself.
gt_paused() {
  local gd
  gd=$(git -C "$1" rev-parse --path-format=absolute --git-dir 2>/dev/null) || return 1
  { [ -d "$gd/rebase-merge" ] || [ -d "$gd/rebase-apply" ]; } && [ -e "$gd/.gtcontinue" ]
}

# --- provider: GitHub (gh-stack >= 0.2.0, through the github-workflow adapter)

gh_stack_version() {
  gh extension list 2>/dev/null | awk -F'\t' '$1 ~ /^gh stack/ {print $3; exit}'
}

# gh_version_ok VER: v0.2.0 or newer; an unparseable version fails.
gh_version_ok() {
  [[ $1 =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+) ]] || return 1
  local maj=${BASH_REMATCH[1]} min=${BASH_REMATCH[2]}
  [ "$((10#$maj))" -gt 0 ] || [ "$((10#$min))" -ge 2 ]
}

# resolve_adapter: the checkout layout first, then the highest installed
# version in the plugin cache (cache/<plugin>/<version>/).
resolve_adapter() {
  local root cand best="" best_v="" ver
  root=${CLAUDE_PLUGIN_ROOT:-}
  [ -n "$root" ] || root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd -P)
  ADAPTER=""
  cand="$root/../github-workflow/lib/github-stack-runtime.js"
  if [ -f "$cand" ]; then
    ADAPTER=$cand
    return 0
  fi
  for cand in "$root"/../../github-workflow/*/lib/github-stack-runtime.js; do
    [ -f "$cand" ] || continue
    ver=${cand%/lib/github-stack-runtime.js}
    ver=${ver##*/}
    if [ -z "$best" ] || ver_gt "$ver" "$best_v"; then
      best=$cand
      best_v=$ver
    fi
  done
  [ -n "$best" ] || return 1
  ADAPTER=$best
}

# adapter_run ARGS...: run the adapter from the run worktree; it exits 0 with
# JSON on stdout and inherits cwd. Sets AD_JSON, AD_STATUS, AD_STDERR, AD_RECOVERY.
adapter_run() {
  AD_JSON=$(cd -- "$RUN_WT" && node "$ADAPTER" "$@" 2>/dev/null)
  AD_STATUS=$(printf '%s' "$AD_JSON" | jq -r '.status // "ERROR"' 2>/dev/null) || AD_STATUS=ERROR
  AD_STDERR=$(printf '%s' "$AD_JSON" | jq -r '.stderr // ""' 2>/dev/null) || AD_STDERR=""
  AD_RECOVERY=$(printf '%s' "$AD_JSON" | jq -r '.recoveryAction // ""' 2>/dev/null) || AD_RECOVERY=""
  return 0
}

# --- the restack plan -------------------------------------------------------

refuse() { REFUSALS+=("$1"); }

# build_plan PROVIDER: fills RUN_WT, RUN_REF, S_CHAIN (base, then the restack
# set bottom-to-top), SEL_* (the other worktrees holding a set branch) and
# REFUSALS. Nothing is mutated.
build_plan() {
  local provider=$1 ri i b ref wi
  REFUSALS=() SEL_PATH=() SEL_BRANCH=() SEL_ACTION=() S_CHAIN=() SET_BRANCHES=()
  RUN_WT="" RUN_REF="" S_TOOLVER=""
  load_worktrees
  RUN_WT=$(repo_top) || {
    refuse "not inside a git worktree"
    return
  }
  ri=$(wt_index "$RUN_WT")
  if [ "$ri" -lt 0 ]; then
    refuse "current directory is not a registered worktree"
    return
  fi
  RUN_REF=${WT_BRANCH[ri]}
  if [ -z "$RUN_REF" ]; then
    refuse "the current worktree is on a detached HEAD; check out a stack branch"
    return
  fi

  case $provider in
    graphite) plan_graphite_stack ;;
    github) plan_github_stack ;;
  esac
  [ "${#REFUSALS[@]}" -eq 0 ] || return

  for b in "${SET_BRANCHES[@]}"; do
    ref="refs/heads/$b"
    wi=-1
    for ((i = 0; i < ${#WT_PATH[@]}; i++)); do
      if [ "${WT_BRANCH[i]}" = "$ref" ]; then
        wi=$i
        break
      fi
    done
    [ "$wi" -ge 0 ] || continue
    [ "${WT_PATH[wi]}" != "$RUN_WT" ] || continue
    SEL_PATH+=("${WT_PATH[wi]}")
    SEL_BRANCH+=("$b")
    if [ "$provider" = graphite ]; then SEL_ACTION+=(detach); else SEL_ACTION+=(keep); fi
  done

  local why
  for ((i = 0; i < ${#SEL_PATH[@]}; i++)); do
    local p=${SEL_PATH[i]} label
    label="$(v "$p") ($(v "${SEL_BRANCH[i]}"))"
    wi=$(wt_index "$p")
    case $p in *$'\t'* | *$'\n'*) refuse "worktree path contains a tab or newline: $label" ;; esac
    [ "${WT_LOCKED[wi]}" -eq 0 ] || refuse "worktree is locked (owned by someone else): $label"
    if [ "${WT_PRUNABLE[wi]}" -ne 0 ]; then
      refuse "worktree is prunable (its directory is missing): $label"
      continue
    fi
    if why=$(wt_busy "$p"); then refuse "worktree has an operation in progress ($why): $label"; fi
    if wt_dirty "$p"; then refuse "worktree has uncommitted changes: $label"; fi
  done
  case $RUN_WT in *$'\t'* | *$'\n'*) refuse "run worktree path contains a tab or newline" ;; esac
  if why=$(wt_busy "$RUN_WT"); then refuse "run worktree has an operation in progress ($why)"; fi
  if wt_dirty "$RUN_WT"; then refuse "run worktree has uncommitted changes"; fi
  return 0
}

plan_graphite_stack() {
  local i b last
  command -v gt >/dev/null 2>&1 || {
    refuse "gt (Graphite CLI) is not installed"
    return
  }
  S_TOOLVER=$(gt_tool_version)
  gt_stack_parse || {
    refuse "could not read the Graphite stack (the current branch may not be tracked)"
    return
  }
  if [ "$G_CUR" -lt 0 ]; then
    refuse "the current branch is not in a Graphite stack"
    return
  fi
  last=$((${#G_NAMES[@]} - 1))
  if [ "$G_CUR" -eq "$last" ]; then
    refuse "the current branch is trunk; check out a stack branch"
    return
  fi
  if [ "$G_FORK" -ne 0 ]; then
    refuse "the stack forks at or above the current branch (not a linear stack)"
    return
  fi
  for b in "${G_NAMES[@]}"; do
    valid_branch "$b" || {
      refuse "unusable branch name in the stack listing"
      return
    }
    branch_exists "$b" || {
      refuse "stack branch has no local ref: $(v "$b")"
      return
    }
  done
  if [ "refs/heads/${G_NAMES[G_CUR]}" != "$RUN_REF" ]; then
    refuse "the stack listing's current branch does not match this worktree's branch"
    return
  fi
  S_CHAIN=("${G_NAMES[G_CUR + 1]}")
  for ((i = G_CUR; i >= 0; i--)); do
    S_CHAIN+=("${G_NAMES[i]}")
    SET_BRANCHES+=("${G_NAMES[i]}")
  done
}

plan_github_stack() {
  local ver i cur=-1 trunk names n
  command -v jq >/dev/null 2>&1 || {
    refuse "jq is required for the GitHub path"
    return
  }
  command -v node >/dev/null 2>&1 || {
    refuse "node is required for the GitHub path"
    return
  }
  ver=$(gh_stack_version)
  S_TOOLVER=${ver:-}
  if ! gh_version_ok "$ver"; then
    refuse "gh-stack >= 0.2.0 is required (found: ${ver:-none or unparseable}); run: gh extension upgrade stack"
    return
  fi
  resolve_adapter || {
    refuse "github-workflow adapter not found; install the github-workflow plugin"
    return
  }
  adapter_run view
  if [ "$AD_STATUS" != SUCCESS ]; then
    refuse "gh stack view failed ($(v "$AD_STATUS")): $(v "$AD_RECOVERY")"
    return
  fi
  trunk=$(printf '%s' "$AD_JSON" | jq -r '.stdout | fromjson | .trunk // empty' 2>/dev/null)
  n=$(printf '%s' "$AD_JSON" | jq -r '.stdout | fromjson | .branches | length' 2>/dev/null)
  [[ $n =~ ^[0-9]+$ ]] && [ "$n" -gt 0 ] && [ -n "$trunk" ] || {
    refuse "could not read the stack from gh stack view"
    return
  }
  names=()
  for ((i = 0; i < n; i++)); do
    names+=("$(printf '%s' "$AD_JSON" | jq -r ".stdout | fromjson | .branches[$i].name")")
    if [ "$(printf '%s' "$AD_JSON" | jq -r ".stdout | fromjson | .branches[$i].isCurrent")" = true ]; then cur=$i; fi
  done
  valid_branch "$trunk" || {
    refuse "unusable trunk name from gh stack view"
    return
  }
  if [ "$cur" -lt 0 ] || [ "refs/heads/${names[cur]}" != "$RUN_REF" ]; then
    refuse "the current branch is not in a GitHub stack"
    return
  fi
  S_CHAIN=("$trunk")
  for ((i = cur; i < n; i++)); do
    valid_branch "${names[i]}" || {
      refuse "unusable branch name from gh stack view"
      return
    }
    branch_exists "${names[i]}" || {
      refuse "stack branch has no local ref: $(v "${names[i]}")"
      return
    }
    S_CHAIN+=("${names[i]}")
    SET_BRANCHES+=("${names[i]}")
  done
}

# --- restore ----------------------------------------------------------------

# report_floating I: when entry I's worktree is detached at a commit other than
# the recorded one (someone committed or moved HEAD during the pause), print the
# floating commits and a rescue line and return 0. A checkout would orphan
# them, so restore never runs over them.
report_floating() {
  local i=$1 path=${E_PATH[$1]} sha=${E_SHA[$1]} head
  head=$(git -C "$path" rev-parse HEAD 2>/dev/null) || return 1
  [ "$head" != "$sha" ] || return 1
  err "$(v "$path") is detached at a different commit than recorded ($(v "${head:0:12}") vs $(v "${sha:0:12}")); not restoring it"
  git -C "$path" log --oneline -n "$MAX_LISTED" "$sha..HEAD" 2>/dev/null | while IFS= read -r line; do
    printf '  floating commit: %s\n' "$(v "$line")"
  done
  printf '  rescue: git -C %s branch <new-name> HEAD   (or cherry-pick onto %s)\n' "$(q "$path")" "$(q "${E_REF[i]#refs/heads/}")"
  return 0
}

unlock_entry() { # unlock a worktree this run locked
  if [ "${E_LOCK[$1]}" = 1 ]; then git worktree unlock -- "${E_PATH[$1]}" >/dev/null 2>&1 || true; fi
}

# restore_entries: per-entry best effort over E_*. Restored and dropped entries
# leave the arrays; the rest stay (phase detached). Returns 0 when none remain.
restore_entries() {
  local i n=${#E_PATH[@]} path ref br wi cur holder out
  local -a kp=() kr=() ks=() kph=() kl=()
  load_worktrees
  for ((i = 0; i < n; i++)); do
    path=${E_PATH[i]}
    ref=${E_REF[i]}
    br=${ref#refs/heads/}
    if [ "${E_PHASE[i]}" = restored ]; then continue; fi
    wi=$(wt_index "$path")
    if [ "$wi" -lt 0 ] || [ "${WT_PRUNABLE[wi]}" -ne 0 ]; then
      note "dropped: $(v "$path") is no longer a worktree"
      continue
    fi
    if ! branch_exists "$br"; then
      note "dropped: branch $(v "$br") no longer exists (worktree $(v "$path"))"
      unlock_entry "$i"
      continue
    fi
    cur=${WT_BRANCH[wi]}
    if [ "$cur" = "$ref" ]; then
      unlock_entry "$i"
      note "restored: $(v "$path") is on $(v "$br")"
      continue
    fi
    if [ -n "$cur" ]; then
      note "kept: $(v "$path") is now on $(v "${cur#refs/heads/}"), not $(v "$br"); left alone"
    elif report_floating "$i"; then
      :
    elif holder=$(branch_holder "$ref"); then
      note "kept: $(v "$br") is checked out in $(v "$holder"); not restoring $(v "$path")"
    elif out=$(git -C "$path" checkout --quiet "$br" -- 2>&1); then
      unlock_entry "$i"
      note "restored: $(v "$path") -> $(v "$br")"
      continue
    else
      note "kept: checkout of $(v "$br") in $(v "$path") was refused: $(printf '%s' "$out" | head -n 1 | tr -d '\000-\037\177')"
      note "  fix: git -C $(q "$path") checkout $(q "$br")"
    fi
    kp+=("$path")
    kr+=("$ref")
    ks+=("${E_SHA[i]}")
    kph+=(detached)
    kl+=("${E_LOCK[i]}")
  done
  E_PATH=() E_REF=() E_SHA=() E_PHASE=() E_LOCK=()
  for ((i = 0; i < ${#kp[@]}; i++)); do
    E_PATH+=("${kp[i]}")
    E_REF+=("${kr[i]}")
    E_SHA+=("${ks[i]}")
    E_PHASE+=("${kph[i]}")
    E_LOCK+=("${kl[i]}")
  done
  [ "${#E_PATH[@]}" -eq 0 ]
}

# restore_and_clear: restore, then drop state and lock if everything is back.
# Returns 0 on a full restore, 1 when entries remain (state rewritten).
restore_and_clear() {
  if restore_entries; then
    clear_state
    release_lock
    return 0
  fi
  write_state || err "could not rewrite the state file"
  err "some worktrees are still detached; resolve them, then run /worktree:restack --continue, --abort or the restore subcommand again"
  return 1
}

lock_detached_entries() {
  local i
  for ((i = 0; i < ${#E_PATH[@]}; i++)); do
    [ "${E_PHASE[i]}" = detached ] && [ "${E_LOCK[i]}" = 0 ] || continue
    if git worktree lock --reason "$PAUSE_REASON" -- "${E_PATH[i]}" >/dev/null 2>&1; then E_LOCK[i]=1; fi
  done
}

# --- finishing --------------------------------------------------------------

check_ancestry() {
  local i par child bad=0
  for ((i = 1; i < ${#S_CHAIN[@]}; i++)); do
    par=${S_CHAIN[i - 1]}
    child=${S_CHAIN[i]}
    if ! branch_exists "$par"; then
      note "ancestry: skipping $(v "$child"); base $(v "$par") has no local ref"
      continue
    fi
    if ! git merge-base --is-ancestor "refs/heads/$par" "refs/heads/$child" 2>/dev/null; then
      err "not restacked: $(v "$child") does not contain its parent $(v "$par")"
      bad=1
    fi
  done
  return "$bad"
}

provider_submit() {
  if [ "$S_PROVIDER" = graphite ]; then
    (cd -- "$S_RUN" && gt submit --stack --no-interactive)
  else
    resolve_adapter || return 1
    RUN_WT=$S_RUN
    adapter_run submit
    [ "$AD_STATUS" = SUCCESS ] || {
      err "submit failed ($(v "$AD_STATUS")): $(v "$AD_RECOVERY")"
      return 1
    }
  fi
}

# finish_restack: the provider reports done. Success is ancestry, not an exit
# code. Restore always runs; submit only after a clean restore and ancestry.
# Returns the exit code.
finish_restack() {
  local anc=0 rc=0
  check_ancestry || anc=1
  restore_and_clear || rc=$X_PARTIAL
  if [ "$rc" -eq 0 ] && [ "$anc" -eq 1 ]; then rc=$X_INCOMPLETE; fi
  if [ "$rc" -eq 0 ]; then
    note "restack complete"
    if [ "$S_SUBMIT" = 1 ]; then
      provider_submit || {
        err "submit failed; the restack and restore are done and stay in place"
        rc=$X_SUBMIT
      }
    fi
  fi
  return "$rc"
}

fail_and_restore() {
  ARMED=0
  err "restack failed; restoring worktrees"
  if [ "${#E_PATH[@]}" -eq 0 ]; then
    clear_state
    release_lock
    exit "$X_FAILED"
  fi
  if restore_and_clear; then exit "$X_FAILED"; fi
  exit "$X_PARTIAL"
}

# do_pause: leave worktrees detached (locked), keep state and lock, tell the user how to resume.
do_pause() {
  local i gd head
  ARMED=0
  lock_detached_entries
  write_state || err "could not rewrite the state file"
  note "PAUSED: restack stopped on a conflict"
  if [ "$S_PROVIDER" = graphite ]; then
    gd=$(git -C "$S_RUN" rev-parse --path-format=absolute --git-dir 2>/dev/null)
    head=$(cat -- "$gd/rebase-merge/head-name" 2>/dev/null || true)
    [ -z "$head" ] || note "conflict while restacking: $(v "${head#refs/heads/}")"
    note "conflicted files (worktree $(v "$S_RUN")):"
    git -C "$S_RUN" diff --name-only --diff-filter=U -z 2>/dev/null | tr '\0' '\n' | cap_lines "$MAX_LISTED" | sed 's/^/  /'
  else
    printf '%s\n' "$AD_STDERR" | grep -m 1 '^Conflict worktree:' | tr -d '\000-\010\013-\037\177' || true
    note "conflicted files:"
    printf '%s\n' "$AD_STDERR" | awk '/^Conflicted files:/{f=1;next} f&&/^$/{exit} f{print}' | cap_lines "$MAX_LISTED"
  fi
  if [ "${#E_PATH[@]}" -gt 0 ]; then
    note "detached stack worktrees - do not commit in them until --continue or --abort:"
    for ((i = 0; i < ${#E_PATH[@]}; i++)); do
      note "  $(v "${E_PATH[i]}")  (${E_REF[i]#refs/heads/})"
    done
  fi
  note "resolve the files, stage them with git add, then run /worktree:restack --continue (or --abort)"
  exit "$X_PAUSED"
}

on_exit() {
  local rc=$?
  trap - EXIT
  [ -z "${LOG:-}" ] || rm -f -- "$LOG"
  if [ "${ARMED:-0}" = 1 ]; then
    ARMED=0
    err "interrupted; restoring worktrees"
    if ! restore_and_clear && [ "$rc" -eq 0 ]; then rc=$X_PARTIAL; fi
  fi
  exit "$rc"
}

arm_cleanup() {
  ARMED=1
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
}

show_log() { [ -z "${LOG:-}" ] || cap_lines 40 <"$LOG"; }

# --- provider steps ---------------------------------------------------------
# Each sets RESULT to ok | conflict | failed.

step_graphite() { # step_graphite restack|continue|abort
  LOG=$(mktemp "$STATE_DIR/run.XXXXXX") || die "$X_FAILED" "cannot create a log file"
  local rc=0
  case $1 in
    restack) (cd -- "$S_RUN" && gt restack --upstack --no-interactive) >|"$LOG" 2>&1 || rc=$? ;;
    continue) (cd -- "$S_RUN" && gt continue --no-interactive) >|"$LOG" 2>&1 || rc=$? ;;
    abort) (cd -- "$S_RUN" && gt abort --force) >|"$LOG" 2>&1 || rc=$? ;;
  esac
  show_log
  rm -f -- "$LOG"
  LOG=""
  if [ "$rc" -eq 0 ]; then
    RESULT=ok
  elif [ "$1" != abort ] && gt_paused "$S_RUN"; then
    RESULT=conflict
  else
    RESULT=failed
  fi
}

step_github() { # step_github upstack|continue|abort
  resolve_adapter || die "$X_FAILED" "github-workflow adapter not found; install the github-workflow plugin"
  RUN_WT=$S_RUN
  adapter_run rebase --mode "$1"
  case $AD_STATUS in
    SUCCESS) RESULT=ok ;;
    CONFLICT) RESULT=conflict ;;
    *)
      err "gh stack rebase ($1): $(v "$AD_STATUS") $(v "$AD_RECOVERY")"
      printf '%s\n' "$AD_STDERR" | cap_lines 10 >&2
      if [ "$1" = continue ] && [ -e "$COMMON/gh-stack-rebase-state" ]; then RESULT=conflict; else RESULT=failed; fi
      ;;
  esac
}

# --- subcommands ------------------------------------------------------------

parse_flags() { # sets PROVIDER, SUBMIT
  PROVIDER="" SUBMIT=0
  while [ $# -gt 0 ]; do
    case $1 in
      --provider)
        [ $# -ge 2 ] || die "$X_USAGE" "--provider needs a value"
        PROVIDER=$2
        shift
        ;;
      --submit) SUBMIT=1 ;;
      *) die "$X_USAGE" "unknown argument: $(v "$1")" ;;
    esac
    shift
  done
  case $PROVIDER in '' | graphite | github) ;; *) die "$X_USAGE" "--provider must be graphite or github" ;; esac
}

need_provider() { [ -n "$PROVIDER" ] || die "$X_USAGE" "--provider graphite|github is required"; }

in_progress() { [ -e "$STATE_FILE" ] || { [ -d "$LOCK_DIR" ] && lock_pid_alive; }; }

new_token() {
  local t
  t=$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')
  [[ $t =~ ^[0-9a-f]{16}$ ]] || t=$(printf '%08x%08x' "$(date +%s)" "$$")
  printf '%s' "$t"
}

require_env() {
  git_at_least 2 36 || die "$X_USAGE" "git >= 2.36 is required (git worktree list --porcelain -z)"
}

print_plan() {
  local i
  note "PROVIDER	$PROVIDER"
  note "RUN	$(v "$RUN_WT")	${RUN_REF#refs/heads/}"
  printf 'CHAIN'
  for i in "${S_CHAIN[@]}"; do printf '\t%s' "$(v "$i")"; done
  printf '\n'
  for ((i = 0; i < ${#SEL_PATH[@]}; i++)); do
    note "WORKTREE	$(v "${SEL_PATH[i]}")	$(v "${SEL_BRANCH[i]}")	${SEL_ACTION[i]}"
  done
  for i in "${REFUSALS[@]+"${REFUSALS[@]}"}"; do note "REFUSE	$(v "$i")"; done
}

cmd_preflight() {
  parse_flags "$@"
  need_provider
  require_env
  init_paths
  if in_progress; then
    note "REFUSE	a restack is already in progress; run status, then --continue or --abort"
    note "PREFLIGHT	in-progress"
    exit "$X_BUSY"
  fi
  build_plan "$PROVIDER"
  print_plan
  if [ "${#REFUSALS[@]}" -gt 0 ]; then
    note "PREFLIGHT	refused"
    exit "$X_REFUSED"
  fi
  note "PREFLIGHT	ok"
}

cmd_start() {
  parse_flags "$@"
  need_provider
  require_env
  init_paths
  ensure_state_dir
  if in_progress; then
    die "$X_BUSY" "a restack is already in progress; run status, then --continue or --abort"
  fi
  build_plan "$PROVIDER"
  if [ "${#REFUSALS[@]}" -gt 0 ]; then
    print_plan
    note "PREFLIGHT	refused"
    exit "$X_REFUSED"
  fi

  local i
  if [ "${#SEL_PATH[@]}" -gt 0 ] && [ "$PROVIDER" = graphite ]; then
    err "recovery, if this run is killed: restore each worktree with"
    for ((i = 0; i < ${#SEL_PATH[@]}; i++)); do
      err "  git -C $(q "${SEL_PATH[i]}") checkout $(q "${SEL_BRANCH[i]}")"
    done
  fi

  acquire_lock || die "$X_BUSY" "could not take the restack lock; a restack is in progress"
  S_PROVIDER=$PROVIDER S_COMMON=$COMMON S_RUN=$RUN_WT S_SUBMIT=$SUBMIT
  S_TOKEN=$(new_token)
  E_PATH=() E_REF=() E_SHA=() E_PHASE=() E_LOCK=()
  if [ "$PROVIDER" = graphite ]; then
    for ((i = 0; i < ${#SEL_PATH[@]}; i++)); do
      E_PATH+=("${SEL_PATH[i]}")
      E_REF+=("refs/heads/${SEL_BRANCH[i]}")
      E_SHA+=("$(git -C "${SEL_PATH[i]}" rev-parse HEAD)")
      E_PHASE+=(detached)
      E_LOCK+=(0)
    done
  fi
  write_state || {
    release_lock
    die "$X_FAILED" "could not write the state file"
  }
  arm_cleanup

  if [ "$PROVIDER" = graphite ]; then
    for ((i = 0; i < ${#E_PATH[@]}; i++)); do
      git -C "${E_PATH[i]}" checkout --quiet --detach 2>/dev/null || {
        err "could not detach $(v "${E_PATH[i]}")"
        fail_and_restore
      }
    done
    step_graphite restack
  else
    step_github upstack
  fi
  drive_result
}

drive_result() {
  case $RESULT in
    ok)
      finish_restack
      local rc=$?
      ARMED=0
      exit "$rc"
      ;;
    conflict) do_pause ;;
    *) fail_and_restore ;;
  esac
}

# load_state_or_exit: shared by continue, abort, restore, status.
load_state_or_exit() {
  init_paths
  if [ ! -e "$STATE_FILE" ]; then
    if [ -d "$LOCK_DIR" ] && ! lock_pid_alive; then release_lock; fi
    note "no restack in progress"
    exit "$X_OK"
  fi
  read_state && validate_state || die "$X_STATE" "state file rejected: ${STATE_ERR:-invalid}; nothing was run. Inspect $(v "$STATE_FILE"), restore the worktrees by hand, then delete it"
  if [ -n "$PROVIDER" ] && [ "$PROVIDER" != "$S_PROVIDER" ]; then
    die "$X_PROVIDER" "this restack was started with $S_PROVIDER but the active provider is $PROVIDER; switch back to $S_PROVIDER to continue or abort, or run the restore subcommand"
  fi
  RUN_WT=$S_RUN
}

report_all_floating() {
  local i found=0
  for ((i = 0; i < ${#E_PATH[@]}; i++)); do
    if report_floating "$i"; then found=1; fi
  done
  return "$found"
}

need_lock() {
  take_lock || die "$X_BUSY" "another restack process is running"
}

cmd_continue() {
  parse_flags "$@"
  require_env
  load_state_or_exit
  ensure_state_dir
  need_lock
  report_all_floating || true
  if [ "$S_PROVIDER" = graphite ]; then
    command -v gt >/dev/null 2>&1 || die "$X_FAILED" "gt (Graphite CLI) is not installed"
    if gt_paused "$S_RUN"; then
      if [ -n "$(git -C "$S_RUN" diff --name-only --diff-filter=U -z 2>/dev/null | head -c 1)" ]; then
        note "unresolved conflicts remain in $(v "$S_RUN"):"
        git -C "$S_RUN" diff --name-only --diff-filter=U -z | tr '\0' '\n' | cap_lines "$MAX_LISTED" | sed 's/^/  /'
        note "resolve and git add them, then run /worktree:restack --continue again"
        exit "$X_PAUSED"
      fi
      step_graphite continue
    else
      note "no conflict is paused in $(v "$S_RUN"); verifying and restoring"
      RESULT=ok
    fi
  else
    step_github continue
  fi
  drive_result
}

cmd_abort() {
  parse_flags "$@"
  require_env
  load_state_or_exit
  ensure_state_dir
  need_lock
  report_all_floating || true
  if [ "$S_PROVIDER" = graphite ]; then
    command -v gt >/dev/null 2>&1 || die "$X_FAILED" "gt (Graphite CLI) is not installed"
    if gt_paused "$S_RUN"; then
      note "warning: aborting rolls the whole restack back, including branches that had already restacked cleanly"
      step_graphite abort
      if [ "$RESULT" != ok ]; then die "$X_FAILED" "the provider's abort failed; state kept, nothing restored"; fi
    fi
    if restore_and_clear; then
      note "aborted"
      exit "$X_OK"
    fi
    exit "$X_PARTIAL"
  fi
  step_github abort
  if [ "$RESULT" != ok ]; then die "$X_FAILED" "the provider's abort failed; state kept"; fi
  clear_state
  release_lock
  note "aborted"
}

cmd_restore() {
  parse_flags "$@"
  require_env
  load_state_or_exit
  ensure_state_dir
  need_lock
  report_all_floating || true
  if restore_and_clear; then
    note "all worktrees restored"
    exit "$X_OK"
  fi
  exit "$X_PARTIAL"
}

cmd_status() {
  parse_flags "$@"
  require_env
  load_state_or_exit
  local i wi cur
  note "restack in progress"
  note "provider: $S_PROVIDER ${S_TOOLVER:--}"
  note "run worktree: $(v "$S_RUN")"
  note "submit after restack: $([ "$S_SUBMIT" = 1 ] && echo yes || echo no)"
  printf 'stack: %s' "$(v "${S_CHAIN[0]}")"
  for ((i = 1; i < ${#S_CHAIN[@]}; i++)); do printf ' -> %s' "$(v "${S_CHAIN[i]}")"; done
  printf '\n'
  if gt_paused "$S_RUN" 2>/dev/null; then note "a conflict is paused in the run worktree"; fi
  for ((i = 0; i < ${#E_PATH[@]}; i++)); do
    wi=$(wt_index "${E_PATH[i]}")
    cur=${WT_BRANCH[wi]}
    if [ "$cur" = "${E_REF[i]}" ]; then
      note "  on branch: $(v "${E_PATH[i]}") ($(v "${E_REF[i]#refs/heads/}"))"
    elif [ -z "$cur" ]; then
      note "  detached:  $(v "${E_PATH[i]}") ($(v "${E_REF[i]#refs/heads/}"))"
      report_floating "$i" || true
    else
      note "  moved:     $(v "${E_PATH[i]}") is on $(v "${cur#refs/heads/}")"
    fi
  done
}

# status with no state still looks for a stranded worktree: detached at the tip
# of a local branch that no worktree has checked out.
stranded_scan() {
  local i b sha tip
  load_worktrees
  for ((i = 0; i < ${#WT_PATH[@]}; i++)); do
    [ -z "${WT_BRANCH[i]}" ] && [ "${WT_BARE[i]}" -eq 0 ] && [ -n "${WT_HEAD[i]}" ] || continue
    while IFS= read -r b; do
      tip=$(git rev-parse "refs/heads/$b" 2>/dev/null) || continue
      [ "$tip" = "${WT_HEAD[i]}" ] || continue
      branch_holder "refs/heads/$b" >/dev/null && continue
      note "possibly stranded: $(v "${WT_PATH[i]}") is detached at the tip of $(v "$b")"
      note "  fix: git -C $(q "${WT_PATH[i]}") checkout $(q "$b")"
    done < <(git for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null)
  done
}

main() {
  local sub=${1:-}
  [ $# -eq 0 ] || shift
  repo_top >/dev/null || die "$X_USAGE" "not inside a git repository"
  cd -- "$(repo_top)" || exit "$X_USAGE"
  case $sub in
    preflight) cmd_preflight "$@" ;;
    start) cmd_start "$@" ;;
    continue) cmd_continue "$@" ;;
    abort) cmd_abort "$@" ;;
    restore) cmd_restore "$@" ;;
    status)
      require_env
      init_paths
      if [ ! -e "$STATE_FILE" ]; then
        note "no restack in progress"
        stranded_scan
        exit "$X_OK"
      fi
      cmd_status "$@"
      ;;
    -h | --help | help)
      sed -n '2,35p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      ;;
    *) die "$X_USAGE" "usage: worktree-restack.sh preflight|start|continue|abort|restore|status [--provider graphite|github] [--submit]" ;;
  esac
}

main "$@"
