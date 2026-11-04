#!/usr/bin/env bats
# Tests for report-only-root, the script that gives `/review:pr --report-only`
# a tree at the PR head without changing the caller's checkout. The contract
# under test: `git status` and HEAD are unchanged whatever mode open picks,
# and close removes only its own worktrees.

bats_require_minimum_version 1.5.0

load helpers/ledger-repo

ROR="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/skills/pr-review-workflow/scripts/report-only-root"

setup() {
  BATS_TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
  ledger_repo_init
  export RL_FETCH_BACKOFF=0
  printf 'base\n' >|a.txt
  BASE=$(commit_all base)
  git push -q origin HEAD:refs/heads/main 2>/dev/null
  git checkout -q -b feat
  printf 'base\nchanged\n' >|a.txt
  printf 'new\n' >|b.txt
  PRHEAD=$(commit_all feat)
  git push -q origin "HEAD:refs/pull/$LEDGER_PR/head" 2>/dev/null
  export MOCK_GH_HEAD_OID=$PRHEAD
  git checkout -q main
}

field() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p"
}

@test "open on another branch adds a detached worktree and leaves HEAD and status alone" {
  printf 'local edit\n' >|a.txt
  before_status=$(git status --porcelain)
  before_head=$(git rev-parse HEAD)
  before_branch=$(git symbolic-ref HEAD)
  run -0 "$ROR" open "$LEDGER_PR"
  [ "$(field "$output" mode)" = worktree ]
  root=$(field "$output" review_root)
  [ "$(field "$output" head)" = "$PRHEAD" ]
  [ "$(git rev-parse HEAD)" = "$before_head" ]
  [ "$(git symbolic-ref HEAD)" = "$before_branch" ]
  [ "$(git status --porcelain)" = "$before_status" ]
  [ "$(git -C "$root" rev-parse HEAD)" = "$PRHEAD" ]
  [ "$(cat "$root/b.txt")" = new ]
  [ -z "$(git -C "$root" status --porcelain)" ]
  run -0 "$ROR" close "$root"
  [ ! -e "$root" ]
  [ "$(git worktree list | wc -l)" -eq 1 ]
  [ "$(git status --porcelain)" = "$before_status" ]
}

@test "open reviews in place when HEAD is the PR head and the tree is clean" {
  git checkout -q feat
  run -0 "$ROR" open "$LEDGER_PR"
  [ "$(field "$output" mode)" = in-place ]
  [ "$(field "$output" review_root)" = "$(git rev-parse --show-toplevel)" ]
  [ "$(git worktree list | wc -l)" -eq 1 ]
}

@test "open refuses an in-place root whose path is not quote-safe" {
  git checkout -q feat
  here=$(pwd)
  cd ..
  mv "$here" "$here'q"
  cd "$here'q"
  run -1 "$ROR" open "$LEDGER_PR"
  [[ "$output" == *"unsafe characters"* ]]
  [ "$(git worktree list | wc -l)" -eq 1 ]
}

@test "open uses a worktree when HEAD is the PR head but the tree is dirty" {
  git checkout -q feat
  printf 'uncommitted\n' >|b.txt
  run -0 "$ROR" open "$LEDGER_PR"
  [ "$(field "$output" mode)" = worktree ]
  root=$(field "$output" review_root)
  [ "$(cat "$root/b.txt")" = new ]
  [ "$(cat b.txt)" = uncommitted ]
  "$ROR" close "$root"
}

@test "open exits 3 and creates nothing when the head cannot be verified" {
  MOCK_GH_HEAD_OID=0123456789012345678901234567890123456789 run -3 "$ROR" open "$LEDGER_PR"
  [ "$(git worktree list | wc -l)" -eq 1 ]
  [ ! -d .git/yellow-review/report-only ] || [ -z "$(ls .git/yellow-review/report-only)" ]
}

@test "open rejects a non-numeric PR" {
  run -2 "$ROR" open '12;rm'
  run -2 "$ROR" open ''
}

@test "close refuses the caller's checkout and paths outside its directory" {
  top=$(git rev-parse --show-toplevel)
  run -2 "$ROR" close "$top"
  [ -f "$top/a.txt" ]
  run -2 "$ROR" close "$top/.git/yellow-review/report-only/../../hooks"
  run -2 "$ROR" close "$top/.git/yellow-review/report-only/pr-1.x/sub"
  run -2 "$ROR" close '/tmp/pr-1 x'
}
