#!/usr/bin/env bats
# Tests for commit-resolve-fixes (staging, new-commit, submit, head verify)

bats_require_minimum_version 1.5.0

load helpers/resolve-repo

SCRIPT="${RESOLVE_SCRIPTS}/commit-resolve-fixes"
MSG="fix: resolve PR #7 review comments (2 files)"

setup() {
  resolve_repo_init
}

# The fixture remotes are local bare repositories. The script reads each
# remote's push URL, so present the two local ones to it (and only it, via
# environment config: the tests' own git push calls still use local paths) as
# the PR's head repository, the gh stub's acme/widgets.
run_crf() {
  GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0="url.https://github.com/acme/widgets.git.pushInsteadOf" \
    GIT_CONFIG_VALUE_0="$BATS_TEST_TMPDIR/origin.git" \
    GIT_CONFIG_KEY_1="url.https://github.com/acme/widgets.git.pushInsteadOf" \
    GIT_CONFIG_VALUE_1="$BATS_TEST_TMPDIR/other.git" \
    run --separate-stderr "$SCRIPT" "$@"
}

# --- Usage ---

@test "rejects a missing provider with exit 2" {
  run_crf --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "rejects a message without a fix prefix" {
  run_crf --provider graphite --pr 7 --message "feat: sneak" -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "rejects a multi-line message" {
  run_crf --provider graphite --pr 7 --message "$(printf 'fix: a\nb')" -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "rejects a path outside the repository" {
  run_crf --provider graphite --pr 7 --message "$MSG" -- ../escape.txt
  [ "$status" -eq 2 ]
}

@test "a full run never invokes git push" {
  # A git shim that fails any push, and logs it, in front of the real git.
  real_git=$(command -v git)
  cat >| "$STUB_BIN/git" <<STUB
#!/bin/sh
for a in "\$@"; do
  if [ "\$a" = push ]; then echo "git push attempted" >> "$BATS_TEST_TMPDIR/push.log"; exit 99; fi
done
exec "$real_git" "\$@"
STUB
  chmod +x "$STUB_BIN/git"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  printf 'one\nfeature\nfix2\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ ! -e "$BATS_TEST_TMPDIR/push.log" ]
}

@test "rejects a missing or non-numeric --pr (exit 2)" {
  run_crf --provider graphite --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  run_crf --provider graphite --pr abc --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  run_crf --provider graphite --pr 0 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "rejects an unknown provider, an unknown flag and a flag missing its value (exit 2)" {
  run_crf --provider svn --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  run_crf --provider graphite --pr 7 --message "$MSG" --bogus
  [ "$status" -eq 2 ]
  run_crf --provider graphite --pr
  [ "$status" -eq 2 ]
}

@test "rejects a message over the length cap (exit 2)" {
  long="fix: $(printf 'x%.0s' $(seq 1 200))"
  run_crf --provider graphite --pr 7 --message "$long" -- src/a.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"exceeds"* ]]
}

@test "an unreadable --files-from is a usage error (exit 2)" {
  run_crf --provider graphite --pr 7 --message "$MSG" --files-from "$BATS_TEST_TMPDIR/nope"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"--files-from not readable"* ]]
}

@test "a detached HEAD is a usage error (exit 2)" {
  git checkout -q --detach
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"detached"* ]]
}

@test "running outside a git repository is a usage error (exit 2)" {
  cd "$BATS_TEST_TMPDIR"
  GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR" run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"not inside a git repository"* ]]
}

@test "a glob-shaped path is taken literally and stages nothing (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- 'src/*'
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"listed file has no changes: src/*"* ]]
  run_crf --provider graphite --pr 7 --message "$MSG" -- 'src/[ab].txt'
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"listed file has no changes: src/[ab].txt"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "a file whose name is a glob is committed alone" {
  printf 'x\n' >| 'src/*.txt'
  git add -f -- 'src/*.txt' && git commit -q -m "chore: glob name"
  git push -q origin feature 2>/dev/null
  printf 'y\n' >| 'src/*.txt'
  run_crf --provider graphite --pr 7 --message "$MSG" -- 'src/*.txt'
  [ "$status" -eq 0 ]
  [ "$(git show --name-only --format= HEAD)" = 'src/*.txt' ]
}

# --- Staging ---

@test "stages unstaged resolver edits and makes a new commit (graphite)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  printf 'two\nfeature\nfix\n' >| src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt src/b.txt
  [ "$status" -eq 0 ]
  sha=$(git rev-parse HEAD)
  [ "$output" = "{\"status\":\"PUSHED\",\"sha\":\"$sha\",\"branch\":\"feature\"}" ]
  # A new commit on top; the previous commit is untouched.
  [ "$(git rev-parse HEAD^)" = "$FIRST_SHA" ]
  [ "$(git log -1 --format=%s HEAD^)" = "feat: first pass" ]
  [ "$(git log -1 --format=%s)" = "$MSG" ]
  [ "$(git show --name-only --format= HEAD | sort | tr '\n' ' ')" = "src/a.txt src/b.txt " ]
  [ -z "$(git status --porcelain)" ]
  grep -q '^gt submit --no-interactive --no-edit$' "$STUB_LOG"
}

@test "refuses a leading-dash filename (exit 2) and commits nothing" {
  printf 'changed\n' >| ./-dash.txt
  before=$(git rev-parse HEAD)
  run_crf --provider graphite --pr 7 --message "$MSG" -- -dash.txt src/b.txt
  [ "$status" -eq 2 ]
  [ "$(git rev-parse HEAD)" = "$before" ]
}

@test "handles a deletion" {
  git rm -q --cached src/b.txt && rm src/b.txt && git reset -q -- src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/b.txt
  [ "$status" -eq 0 ]
  [ "$(git show --name-status --format= HEAD | sort | tr '\t\n' ': ')" = "D:src/b.txt " ]
}

@test "the github provider commits with git and submits via the runtime" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
  grep -q '^node .*github-stack-runtime.js submit --remote origin$' "$STUB_LOG"
  ! grep -q '^gt ' "$STUB_LOG"
}

@test "a listed file without changes refuses the commit (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt src/b.txt
  [ "$status" -eq 3 ]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "a tracked change outside the expected set aborts before committing (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  printf 'two\nstray\n' >| src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"outside the expected set: src/b.txt"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt ' "$STUB_LOG"
}

@test "no files but a dirty tree is refused (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"outside the expected set: src/a.txt"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ ! -s "$STUB_LOG" ]
}

@test "a staged stray outside the expected set aborts before committing (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  printf 'two\nstray\n' >| src/b.txt
  git add src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"outside the expected set: src/b.txt"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt ' "$STUB_LOG"
}

@test "no files and a clean tree is NOOP without committing or submitting" {
  run_crf --provider graphite --pr 7 --message "$MSG" --
  [ "$status" -eq 0 ]
  [ "$output" = "{\"status\":\"NOOP\",\"sha\":\"$FIRST_SHA\",\"branch\":\"feature\"}" ]
  [ ! -s "$STUB_LOG" ]
}

# --- Commit, submit and verify failures ---

@test "a failed gt modify exits 4" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_GT_MODIFY_FAIL=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
}

@test "a failed graphite submit exits 5" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_SUBMIT_FAIL=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 5 ]
}

@test "a non-SUCCESS github runtime status exits 5" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_SUBMIT_FAIL=1
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"PUSH_REJECTED"* ]]
}

@test "a submit that never reaches origin exits 6 without polling the PR" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_SUBMIT_SKIP_PUBLISH=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  # The pre-commit branch binding calls gh pr view; only the head polling
  # asks for headRefOid.
  ! grep -q '^gh pr view.*headRefOid' "$STUB_LOG"
}

@test "a PR headRefOid that disagrees with origin exits 6 after the backoff" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_PR_HEAD=0000000000000000000000000000000000000000
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"head not verified"* ]]
  # One check plus one per backoff entry ("0 0").
  [ "$(grep -c '^gh pr view.*headRefOid' "$STUB_LOG")" -eq 3 ]
}

@test "a PR headRefOid that lags then matches is verified after the backoff" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  mv "$STUB_BIN/gh" "$STUB_BIN/gh.real"
  cat >| "$STUB_BIN/gh" <<'STUB'
#!/bin/sh
case "$*" in
  "pr view "*isCrossRepository*) ;;
  "pr view "*)
    n=$(cat "$LAG_COUNT" 2>/dev/null || echo 0)
    if [ "$n" -lt 2 ]; then
      echo $((n + 1)) >| "$LAG_COUNT"
      printf 'gh %s\n' "$*" >> "$STUB_LOG"
      printf '{"headRefOid":"0000000000000000000000000000000000000000"}\n'
      exit 0
    fi
    ;;
esac
exec "$(dirname "$0")/gh.real" "$@"
STUB
  chmod +x "$STUB_BIN/gh"
  export LAG_COUNT="$BATS_TEST_TMPDIR/lag"
  export YELLOW_REVIEW_VERIFY_BACKOFF="0 0 0"
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
  [ "$(grep -c '^gh pr view.*headRefOid' "$STUB_LOG")" -eq 3 ]
}

@test "a submit that exceeds the timeout exits 5" {
  command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1 || skip "no timeout command"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  cat >| "$STUB_BIN/gt" <<'STUB'
#!/bin/sh
case "$1" in
  modify) exec git commit -q -m "$(printf '%s' "$*" | sed 's/.* -m //; s/ --no-interactive$//')" ;;
  submit) exec sleep 30 ;;
esac
STUB
  chmod +x "$STUB_BIN/gt"
  export YELLOW_REVIEW_SUBMIT_TIMEOUT=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"timed out"* ]]
}

# --- Untrusted file lists ---

@test "--files-from reads one path per line" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  printf 'two\nfeature\nfix\n' >| src/b.txt
  printf 'src/a.txt\nsrc/b.txt\n' >| "$BATS_TEST_TMPDIR/files"
  run_crf --provider graphite --pr 7 --message "$MSG" --files-from "$BATS_TEST_TMPDIR/files"
  [ "$status" -eq 0 ]
  [ "$(git show --name-only --format= HEAD | sort | tr '\n' ' ')" = "src/a.txt src/b.txt " ]
}

@test "--files-from passes shell metacharacters through as plain file names" {
  printf 'x\n' >| 'src/$(touch pwned).txt'
  git add 'src/$(touch pwned).txt' && git commit -q -m "chore: odd name"
  git push -q origin feature 2>/dev/null
  printf 'y\n' >| 'src/$(touch pwned).txt'
  printf '%s\n' 'src/$(touch pwned).txt' >| "$BATS_TEST_TMPDIR/files"
  run_crf --provider graphite --pr 7 --message "$MSG" --files-from "$BATS_TEST_TMPDIR/files"
  [ "$status" -eq 0 ]
  [ ! -e pwned ]
}

@test "a deny-listed path is refused before anything is staged (exit 3)" {
  mkdir -p .github/workflows
  printf 'on: push\n' >| .github/workflows/ci.yml
  git add .github && git commit -q -m "ci: add" && git push -q origin feature 2>/dev/null
  base=$(git rev-parse HEAD)
  printf 'on: [push]\n' >| .github/workflows/ci.yml
  run_crf --provider graphite --pr 7 --message "$MSG" -- .github/workflows/ci.yml
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"deny-listed"* ]]
  [ "$(git rev-parse HEAD)" = "$base" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "a file the PR does not change is refused (exit 3)" {
  printf 'edited\n' >| src/c.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/c.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"not one of PR #7's changed files: src/c.txt"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "an unreadable PR file list refuses the commit (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_PR_FILES_FAIL=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
}

@test "an untracked file outside the set aborts before committing (exit 3)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  printf 'import os\n' >| conftest.py
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"outside the expected set: conftest.py"* ]]
}

@test "--unattended refuses runner files; attended commits them" {
  printf '{"name":"y"}\n' >| package.json
  run_crf --provider graphite --pr 7 --message "$MSG" --unattended -- package.json
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"runner file"* ]]
  run_crf --provider graphite --pr 7 --message "$MSG" -- package.json
  [ "$status" -eq 0 ]
}

@test "a non-canonical path is rejected, not normalized (exit 2)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- ./src/a.txt
  [ "$status" -eq 2 ]
  run_crf --provider graphite --pr 7 --message "$MSG" -- src//a.txt
  [ "$status" -eq 2 ]
}

@test "the github runtime is found in the installed cache layout" {
  unset YELLOW_REVIEW_GITHUB_STACK_RUNTIME
  cache="$BATS_TEST_TMPDIR/cache/yellow-plugins"
  mkdir -p "$cache/yellow-review/1.0.0/skills/pr-review-workflow" "$cache/github-workflow/2.3.0/lib" "$cache/github-workflow/2.10.0/lib"
  cp -R "$RESOLVE_SCRIPTS" "$cache/yellow-review/1.0.0/skills/pr-review-workflow/scripts"
  cp -R "$(dirname "$RESOLVE_SCRIPTS")/../../lib" "$cache/yellow-review/1.0.0/lib"
  : >| "$cache/github-workflow/2.3.0/lib/github-stack-runtime.js"
  : >| "$cache/github-workflow/2.10.0/lib/github-stack-runtime.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://github.com/acme/widgets.git.pushInsteadOf" \
    GIT_CONFIG_VALUE_0="$BATS_TEST_TMPDIR/origin.git" \
    run --separate-stderr "$cache/yellow-review/1.0.0/skills/pr-review-workflow/scripts/commit-resolve-fixes" \
    --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q "^node .*github-workflow/2.10.0/lib/github-stack-runtime.js submit --remote origin$" "$STUB_LOG"
}

@test "gt and hooks do not inherit literal-pathspec mode" {
  # The script never sets the flag (it uses a per-call --literal-pathspecs), so
  # clear any ambient value to keep the check independent of the runner's env.
  unset GIT_LITERAL_PATHSPECS
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q '^gt-env literal=unset$' "$STUB_LOG"
  grep -q '^gh api --paginate repos/{owner}/{repo}/pulls/7/files' "$STUB_LOG"
}

@test "--unattended refuses a credential in added lines and leaves nothing staged" {
  printf 'one\nfeature\nkey = "AKIAABCDEFGHIJKLMNOP"\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --unattended -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"credential"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "a scanner failure refuses the commit like a credential and leaves nothing staged" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  # Fail only the scanner's awk call (-v strict=...); everything else runs for real.
  printf '#!/bin/sh\ncase "$1" in -v) exit 2 ;; esac\nexec %s "$@"\n' "$(command -v awk)" >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  printf 'one\nfeature changed\n' >| src/a.txt
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run_crf --provider graphite --pr 7 --message "$MSG" --unattended -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"could not be scanned"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "an attended run refuses a credential too, unless the user confirmed an override" {
  printf 'one\nfeature\nkey = "AKIAABCDEFGHIJKLMNOP"\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"credential-shaped"* ]]
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt
  [ "$status" -eq 0 ]
}

@test "--allow-credential-shaped is refused with --unattended" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --unattended --allow-credential-shaped -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "an added line that starts with ++ is still scanned" {
  printf 'one\nfeature\n++ key = "AKIAABCDEFGHIJKLMNOP"\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --unattended -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"credential-shaped"* ]]
}

@test "a hook that stages an extra file makes the commit undo itself (exit 4)" {
  printf '#!/bin/sh\nprintf "two\\nfeature\\nhook\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"a hook changed it"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
  [ "$(git status --porcelain | sort | tr '\n' ' ')" = " M src/a.txt  M src/b.txt " ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "a rejected graphite commit restacks the upstack back onto the reset branch" {
  stub_gt_child_branch
  printf '#!/bin/sh\nprintf "two\\nfeature\\nhook\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  grep -q '^gt restack --upstack' "$STUB_LOG"
  # The child sits directly on the reset parent again, without the rejected commit.
  [ "$(git rev-parse child~1)" = "$FIRST_SHA" ]
  [ "$(git rev-list --count "$FIRST_SHA"..child)" = 1 ]
  [ "$(git symbolic-ref --short HEAD)" = feature ]
}

@test "a failed restack after an undo is reported with the gt restack hint (still exit 4)" {
  stub_gt_child_branch
  export STUB_GT_RESTACK_FAIL=1
  printf '#!/bin/sh\nprintf "two\\nfeature\\nhook\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"retry \`gt restack\`"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "the github provider never runs gt restack when it undoes a commit" {
  printf '#!/bin/sh\nprintf "late\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  ! grep -q '^gt ' "$STUB_LOG"
}

@test "a hook that adds a credential-shaped line makes the commit undo itself (exit 4)" {
  printf '#!/bin/sh\nprintf "key = \\"AKIAABCDEFGHIJKLMNOP\\"\\n" >> src/a.txt && git add src/a.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"credential-shaped"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "a hook that leaves an untracked file makes the commit undo itself (exit 4)" {
  printf '#!/bin/sh\nprintf "generated\\n" > src/generated.txt\n' >| .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"not clean"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "changes left staged by a post-commit hook undo the commit (exit 4)" {
  printf '#!/bin/sh\nprintf "late\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"remain staged"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "a sole remote not named origin is the one verified" {
  git remote rename origin upstream
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
}

@test "submit and verification use the same remote when pushDefault and pushRemote differ" {
  OTHER="$BATS_TEST_TMPDIR/other.git"
  git init -q --bare -b main "$OTHER"
  git remote add other "$OTHER"
  git config remote.pushDefault other
  git config branch.feature.pushRemote origin
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
  grep -q '^node .* submit --remote origin$' "$STUB_LOG"
  [ "$(git --git-dir="$OTHER" rev-parse -q --verify refs/heads/feature || true)" = "" ]
}

@test "pushDefault alone selects the remote for submit and verification" {
  OTHER="$BATS_TEST_TMPDIR/other.git"
  git init -q --bare -b main "$OTHER"
  git remote add other "$OTHER"
  git push -q other main feature 2>/dev/null
  git config remote.pushDefault other
  export ORIGIN_DIR="$OTHER"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q '^node .* submit --remote other$' "$STUB_LOG"
}

@test "branch.<name>.remote alone is not passed on: the runtime refuses several remotes (exit 5)" {
  git remote rename origin upstream
  git remote add other "$BATS_TEST_TMPDIR/other.git"
  git config branch.feature.remote upstream
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"INVALID_ARGS"* ]]
  grep -q '^node .* submit$' "$STUB_LOG"
}

@test "several remotes and no configuration leave the refusal to the runtime (exit 5)" {
  git remote add other "$BATS_TEST_TMPDIR/other.git"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 5 ]
  grep -q '^node .* submit$' "$STUB_LOG"
  ! grep -q -- '--remote' "$STUB_LOG"
}

@test "branch pushRemote with several remotes is passed explicitly" {
  git remote add other "$BATS_TEST_TMPDIR/other.git"
  git config branch.feature.pushRemote origin
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q '^node .* submit --remote origin$' "$STUB_LOG"
}

@test "graphite verifies against the remote gt repo remote names, not git's pushRemote" {
  OTHER="$BATS_TEST_TMPDIR/other.git"
  git init -q --bare -b main "$OTHER"
  git remote add other "$OTHER"
  git push -q other main feature 2>/dev/null
  git config branch.feature.pushRemote origin
  export STUB_GT_REMOTE=other ORIGIN_DIR="$OTHER"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
}

@test "a gt repo remote that is not a configured remote falls back to git's choice" {
  export STUB_GT_REMOTE=ghost
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

@test "a local upstream (.) with a sole remote uses that remote" {
  git remote rename origin upstream
  git config branch.feature.remote .
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q '^node .* submit --remote upstream$' "$STUB_LOG"
}

@test "a missing github runtime fails before committing (exit 2)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/missing.js"
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

# --- Listing failures after the commit undo it ---

# A git shim in front of the real git that exits 128 for one diff invocation.
git_shim_failing() {
  real_git=$(command -v git)
  cat >| "$STUB_BIN/git" <<STUB
#!/bin/sh
$1
exec "$real_git" "\$@"
STUB
  chmod +x "$STUB_BIN/git"
}

@test "a failed staged-file listing exits 3 and unstages" {
  git_shim_failing 'if [ "$1" = diff ] && [ "$2" = --cached ] && [ "$3" = --no-renames ] && [ "$4" = --name-only ]; then exit 128; fi'
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"could not list the staged files"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "a failed committed-file listing undoes the commit (exit 4)" {
  # The two-revision diff of the new commit is the only 6-argument call.
  git_shim_failing 'if [ "$1" = diff ] && [ "$2" = --no-renames ] && [ "$3" = --name-only ] && [ $# -eq 6 ] && [ "$6" != -- ]; then exit 128; fi'
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"could not list the committed files"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "a failed tree listing after the commit is not read as clean (exit 4, undone)" {
  # The post-commit hook arms the shim, so only the listing after the commit fails.
  printf '#!/bin/sh\n: >| "%s/armed"\n' "$BATS_TEST_TMPDIR" >| .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
  git_shim_failing "if [ -e \"$BATS_TEST_TMPDIR/armed\" ] && [ \"\$1\" = ls-files ]; then exit 128; fi"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"could not list tree changes"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

# --- Rename handling ---

@test "a rename of listed files is committed as both paths under diff.renames" {
  git config diff.renames true
  # The PR deletes src/c.txt, so c.txt is a PR file; the resolver then moves
  # src/a.txt onto it, which `git add` plus diff.renames reports as one rename.
  git rm -q src/c.txt && git commit -q -m "feat: drop c"
  git push -q origin feature 2>/dev/null
  base=$(git rev-parse HEAD)
  mv src/a.txt src/c.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt src/c.txt
  [ "$status" -eq 0 ]
  [ "$(git rev-parse HEAD^)" = "$base" ]
  [ "$(git diff --no-renames --name-only "$base" HEAD | tr '\n' ' ')" = "src/a.txt src/c.txt " ]
}

# --- Network timeouts and diagnostics ---

need_timeout_bin() {
  command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1 || skip "no timeout command"
}

@test "a git ls-remote that exceeds the net timeout exits 6" {
  need_timeout_bin
  git_shim_failing 'if [ "$1" = ls-remote ]; then exec sleep 30; fi'
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export YELLOW_REVIEW_NET_TIMEOUT=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"ls-remote timed out after 1s"* ]]
}

@test "a gh pr view head poll that exceeds the net timeout exits 6" {
  need_timeout_bin
  mv "$STUB_BIN/gh" "$STUB_BIN/gh.real"
  cat >| "$STUB_BIN/gh" <<'STUB'
#!/bin/sh
case "$*" in
  "pr view "*headRefOid*) exec sleep 30 ;;
esac
exec "$(dirname "$0")/gh.real" "$@"
STUB
  chmod +x "$STUB_BIN/gh"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export YELLOW_REVIEW_NET_TIMEOUT=1 YELLOW_REVIEW_VERIFY_BACKOFF="0"
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"gh pr view timed out after 1s"* ]]
}

@test "a PR file listing that exceeds the net timeout refuses the commit (exit 3)" {
  need_timeout_bin
  mv "$STUB_BIN/gh" "$STUB_BIN/gh.real"
  cat >| "$STUB_BIN/gh" <<'STUB'
#!/bin/sh
case "$1" in
  api) exec sleep 30 ;;
esac
exec "$(dirname "$0")/gh.real" "$@"
STUB
  chmod +x "$STUB_BIN/gh"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export YELLOW_REVIEW_NET_TIMEOUT=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"could not list PR #7's changed files"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "the last gh error reaches the verify message with URL credentials masked" {
  mv "$STUB_BIN/gh" "$STUB_BIN/gh.real"
  cat >| "$STUB_BIN/gh" <<'STUB'
#!/bin/sh
case "$*" in
  "pr view "*headRefOid*)
    echo "fatal: unable to access https://user:tok3n@example.com/o/r: connection reset" >&2
    exit 1
    ;;
esac
exec "$(dirname "$0")/gh.real" "$@"
STUB
  chmod +x "$STUB_BIN/gh"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"connection reset"* ]]
  [[ "$stderr" != *"tok3n"* ]]
}

@test "without a timeout binary the run is unbounded and warns once" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export YELLOW_REVIEW_NO_TIMEOUT_BIN=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s\n' "$stderr" | grep -c 'no timeout binary')" -eq 1 ]
}

@test "a NOOP run makes no network call and does not warn about timeouts" {
  export YELLOW_REVIEW_NO_TIMEOUT_BIN=1
  run_crf --provider graphite --pr 7 --message "$MSG" --
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"no timeout binary"* ]]
}

@test "a failed pre-commit diff extraction refuses with exit 3 and leaves nothing staged" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  # Fail only rt_added_lines' awk call (its program starts with /^diff);
  # every other awk call runs for real.
  printf '#!/bin/sh\ncase "$1" in "/^diff"*) exit 2 ;; esac\nexec %s "$@"\n' "$(command -v awk)" >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  printf 'one\nfeature changed\n' >| src/a.txt
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run_crf --provider graphite --pr 7 --message "$MSG" --unattended -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"could not extract the added lines"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "with --allow-credential-shaped, a hook that adds a different credential-shaped line is refused and undone (exit 4)" {
  # The approved line and the hook's line are assembled from pieces.
  approved="key = \"AKIA""ABCDEFGHIJKLMNOP\""
  printf '#!/bin/sh\nprintf "other = \\"AKIA%s\\"\\n" >> src/a.txt && git add src/a.txt\n' "QRSTUVWXYZ012345" >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  printf 'one\nfeature\n%s\n' "$approved" >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"credential-shaped"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "with --allow-credential-shaped, a hook that changes nothing is still allowed" {
  printf '#!/bin/sh\nexit 0\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  printf 'one\nfeature\nkey = "AKIA%s"\n' "ABCDEFGHIJKLMNOP" >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q '^gt submit' "$STUB_LOG"
}

# --- The chosen remote must push to the PR's head repository ---

# remote_with_push_url <name> <url>: a remote that fetches from origin's bare
# repository (so the stubs still publish) but reports <url> as its push URL.
remote_with_push_url() {
  git remote add "$1" "$ORIGIN"
  git config "remote.$1.pushurl" "$2"
}

@test "a pushRemote that pushes to another owner/repo is refused before committing (exit 3)" {
  remote_with_push_url fork https://github.com/mallory/widgets.git
  git config branch.feature.pushRemote fork
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"remote 'fork' does not push to PR #7's head repository"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^node ' "$STUB_LOG"
}

@test "a graphite remote that pushes to another repository is refused before committing (exit 3)" {
  remote_with_push_url fork git@github.com:acme/other-repo.git
  export STUB_GT_REMOTE=fork
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"remote 'fork' does not push to PR #7's head repository"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt modify\|^gt submit' "$STUB_LOG"
}

@test "a push URL that cannot be parsed is refused (exit 3)" {
  remote_with_push_url odd /some/local/path
  git config branch.feature.pushRemote odd
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"cannot tell which repository remote 'odd' pushes to"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "a PR whose head repository cannot be read is refused (exit 3)" {
  export STUB_PR_HEAD_REPO=none
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"could not read PR #7's head repository"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "a push URL of the PR's head repository is accepted in every common form" {
  n=0
  for url in \
    https://github.com/acme/widgets \
    https://github.com/acme/widgets.git \
    HTTPS://GitHub.com/Acme/Widgets.git/ \
    ssh://git@github.com/acme/widgets.git \
    ssh://git@github.com:22/acme/widgets \
    git@github.com:acme/widgets.git \
    git@github.com:acme/widgets \
    github.com:Acme/Widgets.git; do
    n=$((n + 1))
    git remote add "r$n" "$ORIGIN"
    git config "remote.r$n.pushurl" "$url"
    git config branch.feature.pushRemote "r$n"
    printf 'one\nfeature\nfix%s\n' "$n" >| src/a.txt
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "rejected: $url: $stderr" >&2; return 1; }
    grep -q "^node .* submit --remote r$n\$" "$STUB_LOG"
  done
}

@test "credentials in a push URL never reach stderr" {
  remote_with_push_url fork https://user:s3cr3t-tok3n@github.com/mallory/widgets.git
  git config branch.feature.pushRemote fork
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" != *"s3cr3t-tok3n"* ]]
  [[ "$stderr" != *"user:"* ]]
  # Unparseable, with credentials.
  git remote add odd "$ORIGIN"
  git config remote.odd.pushurl 'https://user:s3cr3t-tok3n@github.com'
  git config branch.feature.pushRemote odd
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" != *"s3cr3t-tok3n"* ]]
  # A pushRemote that is itself a URL with credentials.
  git config branch.feature.pushRemote 'https://user:s3cr3t-tok3n@github.com/mallory/widgets.git'
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" != *"s3cr3t-tok3n"* ]]
}
