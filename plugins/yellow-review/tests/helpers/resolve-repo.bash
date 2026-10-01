# Shared fixtures for commit-resolve-fixes.bats and run-verify-command.bats:
# a throwaway repository on a feature branch with a bare "origin", plus
# stub gt / node / gh that publish by updating origin the way the real
# providers would. The stubs live only in BATS_TEST_TMPDIR/bin.
# shellcheck shell=bash

RESOLVE_SCRIPTS="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/skills/pr-review-workflow/scripts"

resolve_repo_init() {
  STUB_BIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$STUB_BIN"
  export PATH="$STUB_BIN:$PATH"
  export STUB_LOG="$BATS_TEST_TMPDIR/stub.log"
  : >| "$STUB_LOG"
  unset STUB_GT_CHILD STUB_GT_RESTACK_FAIL STUB_GT_MODIFY_FAIL STUB_SUBMIT_FAIL STUB_SUBMIT_SKIP_PUBLISH STUB_PR_HEAD STUB_PR_DIFF_FAIL
  export YELLOW_REVIEW_VERIFY_BACKOFF="0 0"
  # Fixture repos must not inherit the developer's or CI's git config.
  # GIT_CONFIG_GLOBAL needs git 2.32; sandboxing HOME works on every
  # supported version (2.31+).
  export GIT_CONFIG_NOSYSTEM=1
  export HOME="$BATS_TEST_TMPDIR/home"
  export XDG_CONFIG_HOME="$BATS_TEST_TMPDIR/xdg"
  mkdir -p "$HOME" "$XDG_CONFIG_HOME"

  ORIGIN="$BATS_TEST_TMPDIR/origin.git"
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q --bare -b main "$ORIGIN"
  git init -q -b main "$REPO"
  cd "$REPO" || return 1
  git config user.email test@test.com
  git config user.name Test
  git config commit.gpgsign false
  git remote add origin "$ORIGIN"
  mkdir -p src
  printf 'one\n' >| src/a.txt
  printf 'two\n' >| src/b.txt
  printf 'three\n' >| '-dash.txt'
  printf 'untouched\n' >| src/c.txt
  printf '{}\n' >| package.json
  git add -A && git commit -q -m "chore: initial"
  git checkout -q -b feature
  # The PR changes every fixture file except src/c.txt.
  printf 'one\nfeature\n' >| src/a.txt
  printf 'two\nfeature\n' >| src/b.txt
  printf 'three\nfeature\n' >| '-dash.txt'
  printf '{"name":"x"}\n' >| package.json
  git commit -q -am "feat: first pass"
  # origin needs main too: the stub `gh pr diff` compares main...feature.
  git push -q origin main feature 2>/dev/null
  FIRST_SHA=$(git rev-parse HEAD)

  # Publish HEAD to origin, as a successful submit would.
  cat >| "$STUB_BIN/publish" <<'STUB'
#!/bin/sh
b=$(git symbolic-ref --short HEAD)
git --git-dir="$ORIGIN_DIR" fetch -q "$(git rev-parse --show-toplevel)" "+refs/heads/$b:refs/heads/$b"
STUB
  chmod +x "$STUB_BIN/publish"
  export ORIGIN_DIR="$ORIGIN"

  cat >| "$STUB_BIN/gt" <<'STUB'
#!/bin/sh
printf 'gt %s\n' "$*" >> "$STUB_LOG"
case "$1" in
  modify)
    [ "${STUB_GT_MODIFY_FAIL:-0}" = 1 ] && exit 1
    # Hooks and gt must not inherit literal-pathspec mode.
    printf 'gt-env literal=%s\n' "${GIT_LITERAL_PATHSPECS:-unset}" >> "$STUB_LOG"
    # Mirror gt modify -c: commit what is staged, never stage anything.
    case " $* " in *" -c "*) ;; *) echo "stub gt: amend not expected" >&2; exit 1 ;; esac
    msg=""; next=0
    for a in "$@"; do
      [ "$next" = 1 ] && { msg="$a"; next=0; }
      [ "$a" = "-m" ] && next=1
    done
    git commit -q -m "$msg" || exit 1
    # Like gt, restack the child branch onto the new commit and record the
    # parent revision it was restacked onto.
    if [ -n "${STUB_GT_CHILD:-}" ]; then
      cur=$(git symbolic-ref --short HEAD)
      git rebase -q --autostash --onto "$cur" "$(cat "$STUB_GT_CHILD_BASE")" "$STUB_GT_CHILD" >/dev/null 2>&1 || exit 1
      git checkout -q "$cur"
      git rev-parse HEAD > "$STUB_GT_CHILD_BASE"
    fi
    exit 0
    ;;
  restack)
    [ "${STUB_GT_RESTACK_FAIL:-0}" = 1 ] && exit 1
    # Only the stub's single child branch is tracked; --upstack from the
    # current branch rebases it when its recorded parent revision is stale.
    if [ -n "${STUB_GT_CHILD:-}" ]; then
      cur=$(git symbolic-ref --short HEAD)
      if [ "$(cat "$STUB_GT_CHILD_BASE")" != "$(git rev-parse "$cur")" ]; then
        # gt restacks with unstaged changes present; autostash mirrors that.
        git rebase -q --autostash --onto "$cur" "$(cat "$STUB_GT_CHILD_BASE")" "$STUB_GT_CHILD" >/dev/null 2>&1 || exit 1
        git checkout -q "$cur"
        git rev-parse "$cur" > "$STUB_GT_CHILD_BASE"
      fi
    fi
    exit 0
    ;;
  submit)
    [ "${STUB_SUBMIT_FAIL:-0}" = 1 ] && exit 1
    [ "${STUB_SUBMIT_SKIP_PUBLISH:-0}" = 1 ] && exit 0
    exec publish
    ;;
esac
echo "stub gt: unexpected: $*" >&2
exit 1
STUB
  chmod +x "$STUB_BIN/gt"

  cat >| "$STUB_BIN/node" <<'STUB'
#!/bin/sh
printf 'node %s\n' "$*" >> "$STUB_LOG"
if [ "${STUB_SUBMIT_FAIL:-0}" = 1 ]; then
  printf '{"status":"PUSH_REJECTED","recoveryAction":"sync first"}\n'
  exit 0
fi
# Publish to the remote named by --remote, as the real runtime would.
prev=""
for a in "$@"; do
  [ "$prev" = "--remote" ] && ORIGIN_DIR=$(git remote get-url "$a") && export ORIGIN_DIR
  prev="$a"
done
if ! publish >/dev/null 2>&1; then
  printf '{"status":"PUSH_REJECTED","recoveryAction":"sync first"}\n'
  exit 0
fi
printf '{"status":"SUCCESS"}\n'
STUB
  chmod +x "$STUB_BIN/node"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/github-stack-runtime.js"
  : >| "$YELLOW_REVIEW_GITHUB_STACK_RUNTIME"

  # gh pr view reports origin's branch head unless STUB_PR_HEAD overrides.
  cat >| "$STUB_BIN/gh" <<'STUB'
#!/bin/sh
printf 'gh %s\n' "$*" >> "$STUB_LOG"
case "$*" in
  "pr view "*)
    oid="${STUB_PR_HEAD:-$(git --git-dir="$ORIGIN_DIR" rev-parse -q --verify refs/heads/feature)}"
    printf '{"headRefOid":"%s","headRefName":"feature","isCrossRepository":false}\n' "$oid"
    exit 0
    ;;
  "api --paginate repos/{owner}/{repo}/pulls/"*"/files"*)
    # The PR's changed files (the stub ignores --jq and prints names).
    [ "${STUB_PR_DIFF_FAIL:-0}" = 1 ] && exit 1
    exec git --git-dir="$ORIGIN_DIR" diff --name-only main...feature
    ;;
esac
echo "stub gh: unexpected: $*" >&2
exit 1
STUB
  chmod +x "$STUB_BIN/gh"
}

# stub_gt_child_branch: add a branch "child" on top of the feature branch and
# make the gt stub restack it, as gt does for an upstack branch. Leaves the
# repository on "feature".
stub_gt_child_branch() {
  git checkout -q -b child
  printf 'child\n' >| src/child.txt
  git add src/child.txt && git commit -q -m "feat: child"
  git checkout -q feature
  export STUB_GT_CHILD=child STUB_GT_CHILD_BASE="$BATS_TEST_TMPDIR/child.base"
  git rev-parse feature >| "$STUB_GT_CHILD_BASE"
}
