#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

# Tests for worktree-restack.sh. Real temp repos with one linked worktree per
# stack branch; stub gt/gh replay the stack with real `git rebase --onto`
# (mocks/), so git's own "already used by worktree" rule is in play. A logging
# git shim records every git call.

setup() {
  SCRIPT="$BATS_TEST_DIRNAME/../scripts/worktree-restack.sh"
  MOCKS="$BATS_TEST_DIRNAME/mocks"
  export STUB_MOCKS="$MOCKS"
  T="$BATS_TEST_TMPDIR"
  export HOME="$T/home"
  mkdir -p "$HOME"
  export LC_ALL=C GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  STUB_REAL_GIT="$(command -v git)"
  export STUB_REAL_GIT
  export STUB_DIR="$T/stub" STUB_STACK="$T/stub/stack"
  mkdir -p "$STUB_DIR/bin" "$STUB_DIR/base"
  local s
  for s in gt gh git; do ln -s "$MOCKS/$s" "$STUB_DIR/bin/$s"; done
  export PATH="$STUB_DIR/bin:$PATH"
  unset STUB_SKIP STUB_FORK STUB_GH_VERSION STUB_GH_UPGRADE STUB_GT_VERSION CLAUDE_PLUGIN_ROOT
  WTFMT='wt-%s'
  REPO="$T/repo"
}

# wtp NAME: worktree path of stack branch NAME.
# shellcheck disable=SC2059
wtp() { printf "$T/$WTFMT" "$1"; }

# mk_stack [conflict-file...]: main -> a -> b -> c, one worktree per branch,
# trunk advanced. With file args (b c), trunk adds those files with different
# content so restacking that branch conflicts. Leaves cwd in the `a` worktree.
mk_stack() {
  git init -q -b main "$REPO"
  cd "$REPO" || return 1
  printf 'base\n' >base.txt
  git add .
  git commit -q -m base
  local prev=main b f
  printf '%s\n' main >"$STUB_STACK"
  for b in a b c; do
    git rev-parse "refs/heads/$prev" >"$STUB_DIR/base/${b//\//__}"
    git checkout -q -b "$b" "$prev"
    printf '%s\n' "$b" >"$b.txt"
    git add "$b.txt"
    git commit -q -m "feat: $b"
    printf '%s\n' "$b" >>"$STUB_STACK"
    prev=$b
  done
  git checkout -q main
  for b in a b c; do git worktree add -q "$(wtp "$b")" "$b"; done
  if [ "$#" -gt 0 ]; then
    for f in "$@"; do printf 'trunk %s\n' "$f" >"$f.txt"; done
  else
    printf 'tm\n' >trunk.txt
  fi
  git add .
  git commit -q -m "trunk moves"
  cd "$(wtp a)" || return 1
  SD="$(cd "$REPO/.git" && pwd -P)/yellow-core/worktree-restack"
  COMMON="$(cd "$REPO/.git" && pwd -P)"
}

branch_of() { git -C "$1" branch --show-current; }

# resolve_in WT FILE: resolve a conflict by taking new content and staging it.
resolve_in() {
  printf 'resolved\n' >|"$1/$2"
  git -C "$1" add "$2"
}

gt_started() { [ -f "$STUB_DIR/gt.log" ] && grep -q "^restack" "$STUB_DIR/gt.log"; }

assert_all_restored() {
  [ "$(branch_of "$(wtp a)")" = a ]
  [ "$(branch_of "$(wtp b)")" = b ]
  [ "$(branch_of "$(wtp c)")" = c ]
  [ ! -e "$SD/state" ]
  [ ! -d "$SD/lock.d" ]
}

assert_stacked() {
  git -C "$REPO" merge-base --is-ancestor main a
  git -C "$REPO" merge-base --is-ancestor a b
  git -C "$REPO" merge-base --is-ancestor b c
}

# plant_rebase WT BRANCH ONTO: a rebase marker `git rebase --abort` can clear.
plant_rebase() {
  local wt=$1 br=$2 onto=$3 gd
  gd=$(git -C "$wt" rev-parse --path-format=absolute --git-dir)
  mkdir -p "$gd/rebase-merge"
  printf 'refs/heads/%s\n' "$br" >"$gd/rebase-merge/head-name"
  git -C "$wt" rev-parse "refs/heads/$br" >"$gd/rebase-merge/orig-head"
  git -C "$wt" rev-parse "$onto" >"$gd/rebase-merge/onto"
  printf '1\n' >"$gd/rebase-merge/msgnum"
  printf '1\n' >"$gd/rebase-merge/end"
}

# plant_stuck_rebase WT BRANCH: head-name only. `git rebase --abort` fails
# and the marker stays.
plant_stuck_rebase() {
  local wt=$1 br=$2 gd
  gd=$(git -C "$wt" rev-parse --path-format=absolute --git-dir)
  mkdir -p "$gd/rebase-merge"
  printf 'refs/heads/%s\n' "$br" >"$gd/rebase-merge/head-name"
}

rebase_marker() {
  local gd
  gd=$(git -C "$1" rev-parse --path-format=absolute --git-dir)
  [ -e "$gd/rebase-merge" ] || [ -e "$gd/rebase-apply" ]
}

# --- success -----------------------------------------------------------------

@test "start: clean stack restacks, restores every worktree, clears state and lock" {
  mk_stack
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"restack complete"* ]]
  assert_all_restored
  assert_stacked
}

@test "start: prints manual recovery lines to stderr before changing anything" {
  mk_stack
  run --separate-stderr bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  # shellcheck disable=SC2154
  [[ $stderr == *"checkout b"* ]]
  [[ $stderr == *"checkout c"* ]]
}

@test "start: a worktree path containing a space works" {
  WTFMT='wt dir %s'
  mk_stack
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
  assert_stacked
}

@test "start: a worktree path containing a newline is refused" {
  WTFMT=$'wt\n%s'
  mk_stack
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"REFUSE"* ]]
  run gt_started
  [ "$status" -eq 1 ]
}

@test "start: a worktree path containing a carriage return is refused at preflight" {
  WTFMT=$'wt\r%s'
  mk_stack
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"control character"* ]]
}

@test "preflight: lists the worktrees to detach and writes nothing" {
  mk_stack
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *$'WORKTREE\t'*"wt-b"*$'\tb\tdetach'* ]]
  [[ $output == *$'PREFLIGHT\tok'* ]]
  [ ! -e "$SD/state" ]
  [ "$(branch_of "$(wtp b)")" = b ]
}

# --- refusals ----------------------------------------------------------------

@test "refuses a dirty stack worktree and detaches nothing" {
  mk_stack
  printf 'edit\n' >>"$(wtp b)/b.txt"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"uncommitted changes"* ]]
  [ "$(branch_of "$(wtp b)")" = b ]
  run gt_started
  [ "$status" -eq 1 ]
  [ ! -e "$SD/state" ]
}

@test "refuses a locked stack worktree and leaves its lock alone" {
  mk_stack
  git worktree lock "$(wtp b)"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"locked"* ]]
  run git worktree list --porcelain
  [[ $output == *"locked"* ]]
  [ "$(branch_of "$(wtp b)")" = b ]
}

@test "refuses a stack worktree in the middle of a rebase" {
  mk_stack
  mkdir -p "$(git -C "$(wtp b)" rev-parse --path-format=absolute --git-path rebase-merge)"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"operation in progress"* ]]
  [ "$(branch_of "$(wtp c)")" = c ]
}

@test "refuses a prunable stack worktree" {
  mk_stack
  rm -rf "$(wtp c)"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"prunable"* ]]
  [ "$(branch_of "$(wtp b)")" = b ]
}

@test "an untracked .ruvector symlink does not make a worktree dirty" {
  mk_stack
  ln -s "$T/nowhere" "$(wtp b)/.ruvector"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
}

@test "refuses a dirty run worktree" {
  mk_stack
  printf 'edit\n' >>"$(wtp a)/a.txt"
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"run worktree has uncommitted changes"* ]]
}

@test "refuses from trunk, from a detached HEAD, and when the stack forks" {
  mk_stack
  cd "$REPO"
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"trunk"* ]]
  cd "$(wtp a)"
  STUB_FORK=fx run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"forks"* ]]
  git checkout -q --detach
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 20 ]
  [[ $output == *"detached HEAD"* ]]
}

# --- conflicts ---------------------------------------------------------------

@test "conflict: pauses with exit 10, detached and locked, then --continue restores" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  [[ $output == *"PAUSED"* ]]
  [[ $output == *"b.txt"* ]]
  [ -z "$(branch_of "$(wtp b)")" ]
  [ -z "$(branch_of "$(wtp c)")" ]
  [ -e "$SD/state" ]
  run git worktree list --porcelain
  [[ $output == *"locked worktree:restack paused"* ]]

  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
  assert_stacked
  run git worktree list --porcelain
  run grep -c '^locked' <<<"$output"
  [ "$status" -eq 1 ]
}

@test "continue with files still unresolved stays paused" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 10 ]
  [[ $output == *"unresolved conflicts remain"* ]]
  [ -e "$SD/state" ]
  [ "$(cat "$SD/lock.d/pid")" = paused ]
  [ -z "$(branch_of "$(wtp b)")" ]
}

@test "conflict then --abort restores every worktree and rolls the stack back" {
  mk_stack b
  orig_a=$(git rev-parse a)
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"rolls the whole restack back"* ]]
  assert_all_restored
  [ "$(git rev-parse a)" = "$orig_a" ]
}

@test "a second conflict during --continue pauses again" {
  mk_stack b c
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 10 ]
  [[ $output == *"c.txt"* ]]
  [ -e "$SD/state" ]
  [ -z "$(branch_of "$(wtp b)")" ]
  resolve_in "$(wtp a)" c.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
  assert_stacked
}

@test "continue and abort with no state do nothing and exit 0" {
  mk_stack
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"no restack in progress"* ]]
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"no restack in progress"* ]]
  run gt_started
  [ "$status" -eq 1 ]
}

@test "start while a restack is paused exits 3" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 3 ]
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 3 ]
}

@test "a stale lock with a dead pid and no state is reclaimed" {
  mk_stack
  mkdir -p "$SD/lock.d"
  bash -c 'echo $$' >"$SD/lock.d/pid"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
}

@test "a lock with no readable pid is never taken: start exits 3 and names the lock" {
  mk_stack
  mkdir -p "$SD/lock.d"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 3 ]
  [[ $output == *"lock.d"*"remove that directory"* ]]
  [ "$(branch_of "$(wtp b)")" = b ]
}

@test "a paused run leaves 'paused' in the lock, so a recycled pid cannot block --continue" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  [ "$(cat "$SD/lock.d/pid")" = paused ]
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
}

@test "a live lock blocks start" {
  mk_stack
  mkdir -p "$SD/lock.d"
  echo "$$" >"$SD/lock.d/pid"
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 3 ]
  [ "$(branch_of "$(wtp b)")" = b ]
}

@test "provider mismatch on continue exits 5 and runs nothing" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider github
  [ "$status" -eq 5 ]
  [[ $output == *"started with graphite"* ]]
  [ -e "$SD/state" ]
}

# --- state is untrusted ------------------------------------------------------

# forge PATH REF SHA [COMMON]: a self-consistent-looking state file.
forge() {
  mkdir -p "$SD"
  printf 'v1\nprovider\tgraphite\ncommon\t%s\nrun\t%s\nsubmit\t0\nchain\tmain\ta\tb\tc\nentry\t%s\t%s\t%s\n' \
    "${4:-$COMMON}" "$(cd "$(wtp a)" && pwd -P)" "$1" "$2" "$3" >"$SD/state"
}

@test "forged state never reaches git checkout" {
  mk_stack
  git -C "$(wtp b)" checkout -q --detach
  sha=$(git -C "$(wtp b)" rev-parse HEAD)
  wtb=$(cd "$(wtp b)" && pwd -P)
  local -a cases=(
    "$wtb|refs/tags/x|$sha|"
    "$wtb|refs/heads/-evil|$sha|"
    "$wtb|refs/heads/b|not-a-sha|"
    "$wtb|refs/heads/b|$sha|/tmp/other-repo/.git"
    "$wtb|refs/heads/../b|$sha|"
    "$wtb|refs/heads/not-in-stack|$sha|"
    "relative/path|refs/heads/b|$sha|"
  )
  local c p r s cm
  for c in "${cases[@]}"; do
    IFS='|' read -r p r s cm <<<"$c"
    rm -f "$STUB_DIR/git.log"
    forge "$p" "$r" "$s" "$cm"
    run bash "$SCRIPT" restore
    [ "$status" -eq 4 ]
    [ -z "$(branch_of "$wtb")" ]
    run grep -F 'checkout --quiet' "$STUB_DIR/git.log"
    [ "$status" -eq 1 ]
  done
}

@test "a forged entry path outside the worktree list is dropped, never checked out" {
  mk_stack
  git -C "$(wtp b)" checkout -q --detach
  sha=$(git -C "$(wtp b)" rev-parse HEAD)
  forge /nowhere/else refs/heads/b "$sha"
  run bash "$SCRIPT" restore
  [ "$status" -eq 0 ]
  [[ $output == *"dropped: /nowhere/else is no longer a worktree"* ]]
  [ -z "$(branch_of "$(wtp b)")" ]
  run grep -F 'checkout --quiet' "$STUB_DIR/git.log"
  [ "$status" -eq 1 ]
}

@test "a state with a duplicate entry path, the run worktree as an entry, or a bad chain is rejected" {
  mk_stack
  git -C "$(wtp b)" checkout -q --detach
  sha=$(git -C "$(wtp b)" rev-parse HEAD)
  wtb=$(cd "$(wtp b)" && pwd -P)
  forge "$wtb" refs/heads/b "$sha"
  printf 'entry\t%s\trefs/heads/b\t%s\n' "$wtb" "$sha" >>"$SD/state"
  run bash "$SCRIPT" restore
  [ "$status" -eq 4 ]
  [[ $output == *"duplicate entry path"* ]]
  forge "$(cd "$(wtp a)" && pwd -P)" refs/heads/a "$sha"
  run bash "$SCRIPT" restore
  [ "$status" -eq 4 ]
  forge "$wtb" refs/heads/b "$sha"
  { grep -v '^chain' "$SD/state"; printf 'chain\tmain\n'; } >|"$SD/state.new"
  mv -f "$SD/state.new" "$SD/state"
  run bash "$SCRIPT" restore
  [ "$status" -eq 4 ]
  [ -z "$(branch_of "$wtb")" ]
}

@test "a state file that is a symlink is rejected" {
  mk_stack
  mkdir -p "$SD"
  printf 'v1\n' >"$T/real-state"
  ln -s "$T/real-state" "$SD/state"
  run bash "$SCRIPT" restore
  [ "$status" -eq 4 ]
}

# --- restore edge cases ------------------------------------------------------

@test "a worktree removed during the pause is dropped and the rest restored" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  git worktree unlock "$(wtp c)"
  git worktree remove --force "$(wtp c)"
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"dropped:"*"no longer a worktree"* ]]
  [ "$(branch_of "$(wtp b)")" = b ]
  [ ! -e "$SD/state" ]
}

@test "restore: a deleted branch is dropped, a branch still in a rebase is kept (exit 40)" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  git branch -D c
  run bash "$SCRIPT" restore
  [ "$status" -eq 40 ]
  [[ $output == *"dropped: branch c no longer exists"* ]]
  [[ $output == *"kept: checkout of b"*"was refused"* ]]
  [ -e "$SD/state" ]
}

@test "restore: a worktree the user switched to another branch is left alone (exit 40)" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  git -C "$(wtp c)" checkout -q -b other
  run bash "$SCRIPT" restore
  [ "$status" -eq 40 ]
  [[ $output == *"kept:"*"is now on other, not c"* ]]
  [[ $output == *"fix: git -C "*"checkout c"* ]]
  [ "$(branch_of "$(wtp c)")" = other ]
  [ -e "$SD/state" ]
}

@test "a commit made in a detached worktree during the pause is never orphaned" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  git -C "$(wtp c)" commit -q --allow-empty -m floating-work
  floating=$(git -C "$(wtp c)" rev-parse HEAD)
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 40 ]
  [[ $output == *"floating commit: "*"floating-work"* ]]
  [[ $output == *"rescue: git -C "* ]]
  [ -z "$(branch_of "$(wtp c)")" ]
  [ "$(git -C "$(wtp c)" rev-parse HEAD)" = "$floating" ]
  [ "$(branch_of "$(wtp b)")" = b ]
  [ -e "$SD/state" ]
}

@test "status reports a detached worktree, and a stranded one when no state exists" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  run bash "$SCRIPT" status
  [ "$status" -eq 0 ]
  [[ $output == *"restack in progress"* ]]
  [[ $output == *"detached:"*"wt-b"* ]]
  [[ $output == *"a conflict is paused"* ]]
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  git -C "$(wtp b)" checkout -q --detach
  run bash "$SCRIPT" status
  [[ $output == *"no restack in progress"* ]]
  [[ $output == *"possibly stranded"*"wt-b"* ]]
}

@test "restore is idempotent" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  run bash "$SCRIPT" restore
  [ "$status" -eq 0 ]
  [[ $output == *"no restack in progress"* ]]
}

# --- success is ancestry -----------------------------------------------------

@test "a silently skipped branch fails the ancestry check: exit 50, restored, no submit" {
  mk_stack
  STUB_SKIP=b run bash "$SCRIPT" start --provider graphite --submit
  [ "$status" -eq 50 ]
  [[ $output == *"not restacked: b does not contain its parent a"* ]]
  assert_all_restored
  run grep '^submit' "$STUB_DIR/gt.log"
  [ "$status" -eq 1 ]
}

# --- submit ------------------------------------------------------------------

@test "--submit submits through the provider after a clean restack, never via git push" {
  mk_stack
  run bash "$SCRIPT" start --provider graphite --submit
  [ "$status" -eq 0 ]
  grep -q '^submit --stack --no-interactive' "$STUB_DIR/gt.log"
  run grep -E '(^| )push( |$)' "$STUB_DIR/git.log"
  [ "$status" -eq 1 ]
}

@test "without --submit nothing is submitted" {
  mk_stack
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  run grep '^submit' "$STUB_DIR/gt.log"
  [ "$status" -eq 1 ]
}

@test "--submit survives a pause and runs after --continue" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite --submit
  [ "$status" -eq 10 ]
  run grep '^submit' "$STUB_DIR/gt.log"
  [ "$status" -eq 1 ]
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  grep -q '^submit --stack --no-interactive' "$STUB_DIR/gt.log"
  run grep -E '(^| )push( |$)' "$STUB_DIR/git.log"
  [ "$status" -eq 1 ]
}

@test "a failed submit exits 60 and leaves the restack and restore in place" {
  mk_stack
  STUB_SUBMIT_RC=1 run bash "$SCRIPT" start --provider graphite --submit
  [ "$status" -eq 60 ]
  assert_all_restored
  assert_stacked
}

# --- GitHub path -------------------------------------------------------------

@test "github (gh-stack 0.2.x): rebases from the current worktree with no detach" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 0 ]
  assert_all_restored
  assert_stacked
  grep -q "pwd=$(cd "$(wtp a)" && pwd -P) stack rebase --upstack" "$STUB_DIR/gh.log"
  run grep -F 'checkout --quiet --detach' "$STUB_DIR/git.log"
  [ "$status" -eq 1 ]
}

@test "github: a conflict pauses with no detach and --continue finishes" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  [[ $output == *"Conflict worktree:"* ]]
  [ -e "$SD/state" ]
  resolve_in "$(wtp b)" b.txt
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" continue --provider github
  [ "$status" -eq 0 ]
  assert_all_restored
  assert_stacked
}

@test "github: a conflict then --abort clears the state" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" abort --provider github
  [ "$status" -eq 0 ]
  assert_all_restored
}

@test "github: restore during a paused conflict keeps state and the gh-stack marker, exit 40" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  run bash "$SCRIPT" restore
  [ "$status" -eq 40 ]
  [[ $output == *"GitHub restack conflict is still paused"* ]]
  [ -e "$SD/state" ]
  [ -e "$COMMON/gh-stack-rebase-state" ]
}

@test "github: a failed provider abort keeps the state and the gh-stack marker, exit 31" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  STUB_GH_VERSION=v0.2.1 STUB_FAIL=abort run bash "$SCRIPT" abort --provider github
  [ "$status" -eq 31 ]
  [[ $output == *"state kept"* ]]
  [ -e "$SD/state" ]
  [ -e "$(git rev-parse --path-format=absolute --git-common-dir)/gh-stack-rebase-state" ]
}

@test "github: gh-stack 0.1.0, an unparseable version, or none exits 20 with an upgrade message" {
  mk_stack
  local v
  for v in v0.1.0 garbage ""; do
    STUB_GH_VERSION=$v run bash "$SCRIPT" start --provider github
    [ "$status" -eq 20 ]
    [[ $output == *"gh extension upgrade stack"* ]]
  done
  run grep -E 'stack rebase' "$STUB_DIR/gh.log"
  [ "$status" -eq 1 ]
  assert_all_restored
}

@test "github: an Upgrade available column does not hide the installed gh-stack version" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  STUB_GH_UPGRADE=1 STUB_GH_VERSION=v0.2.0 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 0 ]
  STUB_GH_UPGRADE=1 STUB_GH_VERSION=v0.1.0 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 20 ]
  [[ $output == *"found: v0.1.0"* ]]
}

@test "github: an installed adapter that predates --timeout-ms is skipped, a newer one is used" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  mkdir -p "$T/cache/yellow-core/2.6.2" "$T/cache/github-workflow/1.0.0/lib" "$T/cache/github-workflow/0.9.0/lib"
  cat >"$T/cache/github-workflow/1.0.0/lib/github-stack-runtime.js" <<'JSEOF'
// an old adapter that knows no timeout flag (it runs the view for the probe)
process.stdout.write(JSON.stringify({status:'SUCCESS',stdout:JSON.stringify({trunk:'old_adapter',branches:[{name:'a',isCurrent:true}]})}));
JSEOF
  cat >"$T/cache/github-workflow/0.9.0/lib/github-stack-runtime.js" <<'JSEOF'
if (process.argv.includes('--timeout-ms') && process.argv[process.argv.indexOf('--timeout-ms') + 1] === '0') { console.error('--timeout-ms must be a positive integer'); process.exit(1); }
process.stdout.write(JSON.stringify({status:'SUCCESS',stdout:JSON.stringify({trunk:'timeout_aware',branches:[{name:'a',isCurrent:true}]})}));
JSEOF
  CLAUDE_PLUGIN_ROOT="$T/cache/yellow-core/2.6.2" STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 0 ]
  [[ $output == *$'CHAIN\ttimeout_aware\ta'* ]]
  rm -rf "$T/cache/github-workflow/0.9.0"
  CLAUDE_PLUGIN_ROOT="$T/cache/yellow-core/2.6.2" STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 20 ]
  [[ $output == *"adapter not found"* ]]
}

@test "github: the adapter is found in the installed plugin cache, highest version wins" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  local ver
  mkdir -p "$T/cache/yellow-core/2.6.2"
  for ver in 1.9.0 1.10.0; do
    mkdir -p "$T/cache/github-workflow/$ver/lib"
    cat >"$T/cache/github-workflow/$ver/lib/github-stack-runtime.js" <<JSEOF
if (process.argv.includes('--timeout-ms') && process.argv[process.argv.indexOf('--timeout-ms') + 1] === '0') { console.error('--timeout-ms must be a positive integer'); process.exit(1); }
process.stdout.write(JSON.stringify({status:'SUCCESS',stdout:JSON.stringify({trunk:'from_${ver//./_}',branches:[{name:'a',isCurrent:true}]})}));
JSEOF
  done
  CLAUDE_PLUGIN_ROOT="$T/cache/yellow-core/2.6.2" STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 0 ]
  [[ $output == *$'CHAIN\tfrom_1_10_0\ta'* ]]
  rm -rf "$T/cache/github-workflow"
  CLAUDE_PLUGIN_ROOT="$T/cache/yellow-core/2.6.2" STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 20 ]
  [[ $output == *"adapter not found"* ]]
}

# --- failure, signals, mid-stack and resume edge cases -------------------------

@test "a provider restack failure restores every worktree and exits 30" {
  mk_stack
  STUB_FAIL=restack run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 30 ]
  [[ $output == *"restack failed; restoring worktrees"* ]]
  assert_all_restored
}

@test "a SIGTERM during the restack restores every worktree" {
  mk_stack
  STUB_GT_SLEEP=3 bash "$SCRIPT" start --provider graphite >"$T/out" 2>&1 &
  pid=$!
  for _ in $(seq 100); do [ -z "$(branch_of "$(wtp b)")" ] && break; sleep 0.1; done
  [ -z "$(branch_of "$(wtp b)")" ]
  kill -TERM "$pid"
  rc=0
  wait "$pid" || rc=$?
  [ "$rc" -eq 143 ]
  assert_all_restored
}

@test "a SIGTERM while a conflict is paused keeps the state, the locks and a paused lock" {
  mk_stack b
  gd=$(git -C "$(wtp a)" rev-parse --path-format=absolute --git-dir)
  STUB_HANG_ON_CONFLICT=3 bash "$SCRIPT" start --provider graphite >"$T/out" 2>&1 &
  pid=$!
  for _ in $(seq 100); do [ -e "$gd/.gtcontinue" ] && break; sleep 0.1; done
  [ -e "$gd/.gtcontinue" ]
  kill -TERM "$pid"
  rc=0
  wait "$pid" || rc=$?
  [ "$rc" -eq 143 ]
  [ -e "$SD/state" ]
  [ "$(cat "$SD/lock.d/pid")" = paused ]
  run git worktree list --porcelain
  [[ $output == *"locked worktree:restack paused"* ]]
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  assert_all_restored
}

@test "running from a mid-stack branch leaves the downstack worktree alone" {
  mk_stack
  cd "$(wtp b)"
  run bash "$SCRIPT" preflight --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *$'WORKTREE\t'*"wt-c"*$'\tc\tdetach'* ]]
  [[ $output != *"wt-a"* ]]
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 0 ]
  run grep -F "wt-a checkout" "$STUB_DIR/git.log"
  [ "$status" -eq 1 ]
  assert_all_restored
}

@test "github: running from a mid-stack branch checks ancestry against its parent, not trunk" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  cd "$(wtp b)"
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 0 ]
  [[ $output == *$'CHAIN\ta\tb\tc'* ]]
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 0 ]
  [[ $output == *"restack complete"* ]]
}

@test "github: --submit goes through the adapter after a clean rebase" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github --submit
  [ "$status" -eq 0 ]
  grep -q 'stack submit' "$STUB_DIR/gh.log"
}

@test "github: a failed step with gh-stack's own rebase record present is a pause, not a failure" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  STUB_GH_VERSION=v0.2.1 STUB_FAIL=rebase-marker run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  [[ $output == *"no conflict details were reported"* ]]
  [ -e "$SD/state" ]
}

@test "github: an adapter SPAWN_FAILURE keeps state as a pause, not a failure" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  mkdir -p "$T/cache/yellow-core/2.6.2"
  mkdir -p "$T/cache/github-workflow/1.0.0/lib"
  cat >"$T/cache/github-workflow/1.0.0/lib/github-stack-runtime.js" <<'JSEOF'
if (process.argv.includes('--timeout-ms') && process.argv[process.argv.indexOf('--timeout-ms') + 1] === '0') { console.error('--timeout-ms must be a positive integer'); process.exit(1); }
const op = process.argv.slice(2).find((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg));
if (op === 'view') {
  process.stdout.write(JSON.stringify({
    status: 'SUCCESS',
    stdout: JSON.stringify({ trunk: 'main', branches: [{ name: 'a', isCurrent: true }, { name: 'b' }, { name: 'c' }] }),
  }));
} else {
  process.stdout.write(JSON.stringify({
    status: 'SPAWN_FAILURE',
    stderr: 'spawnSync ETIMEDOUT',
    recoveryAction: 'The subprocess did not finish (timed out or failed to start).',
    mayHaveMutated: true,
  }));
}
JSEOF
  CLAUDE_PLUGIN_ROOT="$T/cache/yellow-core/2.6.2" STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  [[ $output == *"no conflict details were reported"* ]]
  [ -e "$SD/state" ]
}

@test "--continue keeps the state while git is still rebasing and the provider has no record of it" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  rm -f "$COMMON/gh-stack-rebase-state"
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" continue --provider github
  [ "$status" -eq 10 ]
  [[ $output == *"is still in progress"* ]]
  [ -e "$SD/state" ]
  [ -d "$SD/lock.d" ]
}

@test "github: --continue with no paused provider rebase verifies and finishes" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  STUB_GH_VERSION=v0.2.1 STUB_FAIL=rebase-marker run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  rm -f "$COMMON/gh-stack-rebase-state"
  # The stub aborted before rebasing: finish the restack by hand so the
  # verification step has a stacked tree to accept.
  git -C "$(wtp a)" rebase -q main
  git -C "$(wtp b)" rebase -q a
  git -C "$(wtp c)" rebase -q b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" continue --provider github
  [ "$status" -eq 0 ]
  [[ $output == *"no provider rebase is paused"* ]]
  assert_all_restored
  assert_stacked
}

@test "github: the version gate accepts 0.2.0, 0.10.0 and 1.0.0" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  local v
  for v in v0.2.0 v0.10.0 v1.0.0; do
    STUB_GH_VERSION=$v run bash "$SCRIPT" preflight --provider github
    [ "$status" -eq 0 ]
  done
}

@test "continue, abort and restore refuse a lock held by a live process (exit 3)" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  echo "$$" >|"$SD/lock.d/pid"
  local sub
  for sub in continue abort restore; do
    run bash "$SCRIPT" $sub --provider graphite
    [ "$status" -eq 3 ]
    [[ $output == *"remove that directory"* ]]
  done
  [ -e "$SD/state" ]
  [ -z "$(branch_of "$(wtp b)")" ]
}

@test "a stale lock guard blocks takeover and the hint names it" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  mkdir "$SD/lock.guard"
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 3 ]
  [[ $output == *"lock.guard"* ]]
  rmdir "$SD/lock.guard"
}

@test "a failed provider abort keeps the state and exits 31" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  STUB_FAIL=abort run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 31 ]
  [[ $output == *"state kept"* ]]
  [ -e "$SD/state" ]
  [ "$(cat "$SD/lock.d/pid")" = paused ]
}

@test "--continue after the user finished the provider's continue by hand verifies and restores" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  resolve_in "$(wtp a)" b.txt
  (cd "$(wtp a)" && gt continue --no-interactive)
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"no conflict is paused"* ]]
  assert_all_restored
  assert_stacked
}

@test "--abort clears an in-chain rebase the provider no longer records, then restores" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  rm -f "$(git -C "$(wtp a)" rev-parse --path-format=absolute --git-dir)/.gtcontinue"
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"aborted"* ]]
  assert_all_restored
  run rebase_marker "$(wtp a)"
  [ "$status" -eq 1 ]
}

@test "--abort clears a rebase paused in a non-run worktree when the provider marker is gone" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 10 ]
  rebase_marker "$(wtp b)"
  run rebase_marker "$(wtp a)"
  [ "$status" -eq 1 ]
  rm -f "$COMMON/gh-stack-rebase-state"
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" abort --provider github
  [ "$status" -eq 0 ]
  [[ $output == *"aborted"* ]]
  assert_all_restored
  run rebase_marker "$(wtp b)"
  [ "$status" -eq 1 ]
}

@test "--abort clears in-chain rebases in the run worktree and another worktree" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  rm -f "$(git -C "$(wtp a)" rev-parse --path-format=absolute --git-dir)/.gtcontinue"
  plant_rebase "$(wtp c)" c b
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"aborted"* ]]
  assert_all_restored
  run rebase_marker "$(wtp a)"
  [ "$status" -eq 1 ]
  run rebase_marker "$(wtp c)"
  [ "$status" -eq 1 ]
}

@test "a second --abort finishes an in-chain rebase the first abort left behind" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  rm -f "$(git -C "$(wtp a)" rev-parse --path-format=absolute --git-dir)/.gtcontinue"
  plant_stuck_rebase "$(wtp c)" c
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 31 ]
  [[ $output == *"still in progress"* ]]
  [ -e "$SD/state" ]
  run rebase_marker "$(wtp a)"
  [ "$status" -eq 1 ]
  rebase_marker "$(wtp c)"
  rm -rf "$(git -C "$(wtp c)" rev-parse --path-format=absolute --git-dir)/rebase-merge"
  plant_rebase "$(wtp c)" c b
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"aborted"* ]]
  assert_all_restored
  run rebase_marker "$(wtp c)"
  [ "$status" -eq 1 ]
}

@test "--abort ignores a rebase in a worktree outside the recorded stack" {
  mk_stack b
  git -C "$REPO" branch side main
  git -C "$REPO" worktree add -q "$T/wt-side" side
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  plant_stuck_rebase "$T/wt-side" side
  run bash "$SCRIPT" abort --provider graphite
  [ "$status" -eq 0 ]
  [[ $output == *"aborted"* ]]
  assert_all_restored
  rebase_marker "$T/wt-side"
}

@test "a rejected state file (exit 4) still lists pause-locked worktrees" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  printf 'v2\n' >|"$SD/state"
  run bash "$SCRIPT" status
  [ "$status" -eq 4 ]
  [[ $output == *"left locked by a paused restack"* ]]
  [[ $output == *"git worktree unlock"* ]]
}

@test "status without a state file reports worktrees left locked by a paused restack" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  rm -f "$SD/state"
  run bash "$SCRIPT" status
  [ "$status" -eq 0 ]
  [[ $output == *"left locked by a paused restack"* ]]
}

@test "restore never unlocks a worktree whose lock carries a different reason" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite
  [ "$status" -eq 10 ]
  git worktree unlock "$(wtp c)"
  git worktree lock --reason "someone else" "$(wtp c)"
  run bash "$SCRIPT" restore
  run git worktree list --porcelain
  [[ $output == *"locked someone else"* ]]
}

@test "a partial restore combined with --submit never submits" {
  mk_stack b
  run bash "$SCRIPT" start --provider graphite --submit
  [ "$status" -eq 10 ]
  git -C "$(wtp c)" commit -q --allow-empty -m floating-work
  resolve_in "$(wtp a)" b.txt
  run bash "$SCRIPT" continue --provider graphite
  [ "$status" -eq 40 ]
  run grep '^submit' "$STUB_DIR/gt.log"
  [ "$status" -eq 1 ]
}

# --- usage and invariants ----------------------------------------------------

@test "usage errors exit 2" {
  mk_stack
  run bash "$SCRIPT" bogus
  [ "$status" -eq 2 ]
  run bash "$SCRIPT" start
  [ "$status" -eq 2 ]
  run bash "$SCRIPT" start --provider nope
  [ "$status" -eq 2 ]
  run bash "$SCRIPT" start --provider graphite --wat
  [ "$status" -eq 2 ]
}

@test "the script has no force, merge, stash, hard-reset or ignore-other-worktrees path" {
  # Comments may mention the words; only code lines count.
  code=$(grep -v '^[[:space:]]*#' "$SCRIPT")
  run grep -nE '(checkout|switch)[^|;&]*[[:space:]](-f|--force|-m|--merge)([[:space:]]|$)|reset --hard|--ignore-other-worktrees|stash' <<<"$code"
  [ "$status" -eq 1 ]
}

# --- github: --remote ----------------------------------------------------------

# add_remotes: two configured remotes, none of them reachable (nothing is fetched).
add_remotes() {
  git -C "$REPO" remote add origin "$T/o.git"
  git -C "$REPO" remote add fork "$T/f.git"
}

@test "github: preflight refuses several remotes without --remote or a valid remote.pushDefault" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  add_remotes
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 20 ]
  [[ $output == *"several remotes exist"* ]]
  [[ $output == *"pass --remote NAME"* ]]
  git config remote.pushDefault nope
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 20 ]
  # start refuses the same way, before anything is touched.
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github
  [ "$status" -eq 20 ]
  [ ! -e "$SD/state" ]
  [ ! -f "$STUB_DIR/gh.log" ] || ! grep -q 'stack rebase' "$STUB_DIR/gh.log"
}

@test "github: a valid remote.pushDefault needs no --remote" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  add_remotes
  git config remote.pushDefault fork
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 0 ]
}

@test "github: a clone with a single remote needs no --remote and no remote.pushDefault" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  git remote add origin "$T/o.git"
  [ "$(git remote | wc -l)" -eq 1 ]
  ! git config --get remote.pushDefault >/dev/null
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github
  [ "$status" -eq 0 ]
}

@test "github: a remote name with a slash is accepted, an empty one is a usage error" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  git -C "$REPO" remote add origin "$T/o.git"
  git -C "$REPO" remote add team/foo "$T/t.git"
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github --remote team/foo
  [ "$status" -eq 0 ]
  [[ $output == *$'REMOTE\tteam/foo'* ]]
  for bad in '' 'team/' '/foo' 'team//foo' 'a/../b'; do
    STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github --remote "$bad"
    [ "$status" -eq 2 ] || { echo "accepted: '$bad'"; false; }
  done
}

@test "github: --remote is forwarded to the rebase and to the submit, and shown in the plan" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  add_remotes
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github --remote fork
  [ "$status" -eq 0 ]
  [[ $output == *$'REMOTE\tfork'* ]]
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github --submit --remote fork
  [ "$status" -eq 0 ]
  grep -q 'stack rebase --upstack --remote fork' "$STUB_DIR/gh.log"
  grep -q 'stack submit --auto --remote fork' "$STUB_DIR/gh.log"
}

@test "--remote must name a configured remote and belongs to github preflight and start only" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack
  add_remotes
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github --remote nope
  [ "$status" -eq 20 ]
  [[ $output == *"not a configured remote"* ]]
  for bad in 'bad name' '-x' 'a..b'; do
    STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" preflight --provider github --remote "$bad"
    [ "$status" -eq 2 ] || { echo "accepted: $bad"; false; }
  done
  run bash "$SCRIPT" preflight --provider graphite --remote fork
  [ "$status" -eq 2 ]
  [[ $output == *"--remote applies to --provider github only"* ]]
  for sub in continue abort restore; do
    run bash "$SCRIPT" "$sub" --remote fork
    [ "$status" -eq 2 ] || { echo "accepted by $sub"; false; }
  done
}

@test "github: a paused run keeps its remote in the state file and submits to it after --continue" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  add_remotes
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github --submit --remote fork
  [ "$status" -eq 10 ]
  [ "$(awk -F'\t' '$1=="remote"{print $2}' "$SD/state")" = fork ]
  resolve_in "$(wtp b)" b.txt
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" continue --provider github
  [ "$status" -eq 0 ]
  grep -q 'stack submit --auto --remote fork' "$STUB_DIR/gh.log"
}

@test "a state file that names a remote that is not configured, or a remote for graphite, is rejected (exit 4)" {
  command -v jq >/dev/null && command -v node >/dev/null || skip "jq and node are required"
  mk_stack b
  add_remotes
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" start --provider github --remote fork
  [ "$status" -eq 10 ]
  sed -i.bak 's/^remote\tfork$/remote\tgone/' "$SD/state" && rm -f "$SD/state.bak"
  STUB_GH_VERSION=v0.2.1 run bash "$SCRIPT" status
  [ "$status" -eq 4 ]
  [[ $output == *"recorded remote is not a configured remote"* ]]
  sed -i.bak 's/^provider\tgithub$/provider\tgraphite/; s/^remote\tgone$/remote\tfork/' "$SD/state" && rm -f "$SD/state.bak"
  run bash "$SCRIPT" status
  [ "$status" -eq 4 ]
  [[ $output == *"a remote is recorded for a non-GitHub provider"* ]]
}
