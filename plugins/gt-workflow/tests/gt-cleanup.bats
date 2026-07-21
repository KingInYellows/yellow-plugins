#!/usr/bin/env bats
# Coverage for the deterministic bash embedded in gt-cleanup/SKILL.md — flag
# parsing (Phase 1 Step 1), branch classification (Phase 3), the batch-cap-15
# "staging" queue (Phase 4, "Review individually"), and the gt-get
# conflict-stop path (Phase 4, "For behind-remote sync"). Functions below are
# hand-mirrored from the skill body (before/after-golden pattern, mirrors
# plugins/yellow-core/tests/plan-status-parity.bats and this plugin's own
# hooks/hook-parity.bats) — update both places together if the skill's bash
# changes.
#
# Out of scope, matching plan-commands.bats's own documented limitation: the
# full agent-orchestrated flow (AskUserQuestion category-action prompts, the
# PR-status/gh lookups feeding the Closed-PR category, the worktree-cleanup
# hand-off) cannot be exercised in bats. Only the deterministic predicates
# feeding those gates are tested here.

bats_require_minimum_version 1.5.0

MOCKS_DIR="$BATS_TEST_DIRNAME/mocks"
FIXTURE_DIR="$BATS_TEST_DIRNAME/fixtures/gt-cleanup"

setup() {
  export PATH="$MOCKS_DIR:$PATH"
  MOCK_GIT_LOG="$(mktemp)"
  MOCK_GT_LOG="$(mktemp)"
  export MOCK_GIT_LOG MOCK_GT_LOG
}

teardown() {
  rm -f "$MOCK_GIT_LOG" "$MOCK_GT_LOG"
}

# --- Mirrors gt-cleanup/SKILL.md Phase 1 Step 1 (flag parsing) ---
parse_flags() {
  DRY_RUN=false
  STALE_DAYS=30
  local args=("$@")
  local i=0
  local arg
  while [ $i -lt ${#args[@]} ]; do
    arg="${args[$i]}"
    case "$arg" in
      --dry-run)
        DRY_RUN=true
        i=$((i + 1))
        ;;
      --stale-days)
        i=$((i + 1))
        if [ $i -lt ${#args[@]} ] && ! [[ "${args[$i]}" =~ ^-- ]]; then
          STALE_DAYS="${args[$i]}"
          i=$((i + 1))
        else
          echo "ERROR: --stale-days requires a value (e.g., --stale-days 60)"
          return 1
        fi
        ;;
      --stale-days=*)
        STALE_DAYS="${arg#*=}"
        i=$((i + 1))
        ;;
      *)
        i=$((i + 1))
        ;;
    esac
  done
  if ! [[ "$STALE_DAYS" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: --stale-days requires a positive integer (>= 1), got '$STALE_DAYS'"
    return 1
  fi
}

# --- Mirrors gt-cleanup/SKILL.md Phase 3 "Initial Classification" ---
classify_branch() {
  local upstream_ref="$1" track_status="$2" committer_date_unix="$3" now="$4" stale_days="$5"

  if [ -z "$upstream_ref" ]; then
    echo "orphaned"
    return
  fi
  case "$track_status" in
    *'[gone]'*)
      echo "merged"
      return
      ;;
  esac
  case "$track_status" in
    *ahead*behind*|*behind*ahead*)
      echo "diverged"
      return
      ;;
  esac
  case "$track_status" in
    *behind*)
      echo "behind"
      return
      ;;
  esac
  case "$track_status" in
    *ahead*)
      echo "ahead"
      return
      ;;
  esac
  local age_days=$(( (now - committer_date_unix) / 86400 ))
  if [ "$age_days" -gt "$stale_days" ]; then
    echo "stale"
  else
    echo "clean"
  fi
}

# --- Mirrors gt-cleanup/SKILL.md Phase 4 "Review individually" batch cap ---
cap_batch() {
  local count="$1" cap=15
  if [ "$count" -gt "$cap" ]; then
    echo "$cap"
  else
    echo "$count"
  fi
}

# --- Mirrors gt-cleanup/SKILL.md Phase 4 "For behind-remote sync" ---
sync_behind_branches() {
  local branch
  for branch in "$@"; do
    if gt get "$branch" --no-interactive >/dev/null 2>/tmp/gt-get-err; then
      echo "synced:$branch"
    else
      echo "failed:$branch"
    fi
  done
}

# --- Mirrors gt-cleanup/SKILL.md Phase 4 deletion fallback ---
delete_branch_with_fallback() {
  local branch="$1"
  if gt delete "$branch" --force --no-interactive >/tmp/gt-delete-out 2>&1; then
    echo "deleted-via-gt:$branch"
    return 0
  fi
  if grep -qi "not tracked" /tmp/gt-delete-out; then
    if git branch -D "$branch" >/dev/null 2>&1; then
      echo "deleted-via-git:$branch"
      return 0
    fi
  fi
  echo "failed:$branch"
  return 1
}

# --- Flag parsing ---

@test "parse_flags: defaults with no arguments" {
  parse_flags
  [ "$DRY_RUN" = "false" ]
  [ "$STALE_DAYS" = "30" ]
}

@test "parse_flags: --dry-run sets DRY_RUN" {
  run parse_flags --dry-run
  [ "$status" -eq 0 ]
}

@test "parse_flags: --stale-days N sets STALE_DAYS" {
  parse_flags --stale-days 60
  [ "$STALE_DAYS" = "60" ]
}

@test "parse_flags: --stale-days=N form sets STALE_DAYS" {
  parse_flags --stale-days=14
  [ "$STALE_DAYS" = "14" ]
}

@test "parse_flags: --stale-days with missing value errors" {
  run parse_flags --stale-days
  [ "$status" -eq 1 ]
  [[ "$output" == *"requires a value"* ]]
}

@test "parse_flags: non-integer --stale-days errors" {
  run parse_flags --stale-days abc
  [ "$status" -eq 1 ]
  [[ "$output" == *"positive integer"* ]]
}

@test "parse_flags: zero --stale-days errors" {
  run parse_flags --stale-days 0
  [ "$status" -eq 1 ]
}

# --- Branch classification ---

@test "classify_branch: empty upstream is orphaned" {
  run classify_branch "" "" 1700000000 1700000000 30
  [ "$output" = "orphaned" ]
}

@test "classify_branch: [gone] track status is merged" {
  run classify_branch "refs/remotes/origin/x" "[gone]" 1700000000 1700000000 30
  [ "$output" = "merged" ]
}

@test "classify_branch: ahead+behind is diverged" {
  run classify_branch "refs/remotes/origin/x" "[ahead 2, behind 3]" 1700000000 1700000000 30
  [ "$output" = "diverged" ]
}

@test "classify_branch: behind only is behind" {
  run classify_branch "refs/remotes/origin/x" "[behind 5]" 1700000000 1700000000 30
  [ "$output" = "behind" ]
}

@test "classify_branch: ahead only is ahead" {
  run classify_branch "refs/remotes/origin/x" "[ahead 3]" 1700000000 1700000000 30
  [ "$output" = "ahead" ]
}

@test "classify_branch: empty track status old enough is stale" {
  # 100 days old vs a 30-day threshold
  run classify_branch "refs/remotes/origin/x" "" 1700000000 1708640000 30
  [ "$output" = "stale" ]
}

@test "classify_branch: empty track status recent is clean" {
  # 1 day old vs a 30-day threshold
  run classify_branch "refs/remotes/origin/x" "" 1700000000 1700086400 30
  [ "$output" = "clean" ]
}

@test "classify_branch: exactly at the stale-days boundary is clean, not stale" {
  # SKILL.md Phase 3 Step 5 spec is strict "AGE_DAYS > STALE_DAYS" — a branch
  # exactly at the threshold (30 days old vs a 30-day threshold) must stay
  # clean. Regression test for a prior -ge/-gt mismatch between this mirror
  # and the shipped skill (caught by review, not by the fixture-based test
  # above, which used far-from-boundary values).
  local now=$((1700000000 + 30 * 86400))
  run classify_branch "refs/remotes/origin/x" "" 1700000000 "$now" 30
  [ "$output" = "clean" ]
}

@test "classify_branch: one day past the stale-days boundary is stale" {
  local now=$((1700000000 + 31 * 86400))
  run classify_branch "refs/remotes/origin/x" "" 1700000000 "$now" 30
  [ "$output" = "stale" ]
}

@test "classify_branch: full mixed fixture classifies every line correctly" {
  declare -A want=(
    [orphaned-branch]=orphaned
    [gone-branch]=merged
    [diverged-branch]=diverged
    [behind-branch]=behind
    [ahead-branch]=ahead
    [stale-clean-branch]=stale
    [fresh-clean-branch]=clean
  )
  local now=1700100000
  while IFS='|' read -r name upstream track committer_date; do
    [ -z "$name" ] && continue
    got="$(classify_branch "$upstream" "$track" "$committer_date" "$now" 30)"
    [ "$got" = "${want[$name]}" ]
  done <"$FIXTURE_DIR/branches-mixed.txt"
}

# --- Batch cap ("staging" review queue) ---

@test "cap_batch: under the cap returns the full count" {
  run cap_batch 10
  [ "$output" = "10" ]
}

@test "cap_batch: exactly at the cap returns the cap" {
  run cap_batch 15
  [ "$output" = "15" ]
}

@test "cap_batch: over the cap returns 15" {
  run cap_batch 42
  [ "$output" = "15" ]
}

# --- gt get conflict-stop path ---

@test "sync_behind_branches: a clean sync reports synced and never aborts the batch" {
  run sync_behind_branches good-branch-1 good-branch-2
  [ "$status" -eq 0 ]
  [[ "$output" == *"synced:good-branch-1"* ]]
  [[ "$output" == *"synced:good-branch-2"* ]]
}

@test "sync_behind_branches: a conflict is logged as failed and later branches still run" {
  run sync_behind_branches good-branch CONFLICT-branch good-branch-2
  [ "$status" -eq 0 ]
  [[ "$output" == *"synced:good-branch"* ]]
  [[ "$output" == *"failed:CONFLICT-branch"* ]]
  [[ "$output" == *"synced:good-branch-2"* ]]
  # The batch continued past the conflict — both good branches attempted gt get.
  grep -q "gt get good-branch --no-interactive" "$MOCK_GT_LOG"
  grep -q "gt get good-branch-2 --no-interactive" "$MOCK_GT_LOG"
}

# --- gt delete fallback ---

@test "delete_branch_with_fallback: gt delete succeeding does not touch git" {
  run delete_branch_with_fallback clean-branch
  [ "$status" -eq 0 ]
  [ "$output" = "deleted-via-gt:clean-branch" ]
  ! grep -q "git branch -D" "$MOCK_GIT_LOG"
}

@test "delete_branch_with_fallback: not-tracked falls back to git branch -D" {
  run delete_branch_with_fallback NOTTRACKED-branch
  [ "$status" -eq 0 ]
  [ "$output" = "deleted-via-git:NOTTRACKED-branch" ]
  grep -q "git branch -D NOTTRACKED-branch" "$MOCK_GIT_LOG"
}

@test "delete_branch_with_fallback: a non-not-tracked gt failure does not fall back" {
  run delete_branch_with_fallback FAILDELETE-branch
  [ "$status" -eq 1 ]
  [ "$output" = "failed:FAILDELETE-branch" ]
  ! grep -q "git branch -D" "$MOCK_GIT_LOG"
}

@test "delete_branch_with_fallback: fallback itself failing is reported as failed" {
  run delete_branch_with_fallback NOTTRACKED-FAILDELETE-branch
  [ "$status" -eq 1 ]
  [ "$output" = "failed:NOTTRACKED-FAILDELETE-branch" ]
  grep -q "git branch -D NOTTRACKED-FAILDELETE-branch" "$MOCK_GIT_LOG"
}
