#!/usr/bin/env bats
# Tests for commit-resolve-fixes (staging, new-commit, submit, head verify)

bats_require_minimum_version 1.5.0

load helpers/resolve-repo

SCRIPT="${RESOLVE_SCRIPTS}/commit-resolve-fixes"
MSG="fix: resolve PR #7 review comments (2 files)"

setup() {
  resolve_repo_init
}

run_crf() {
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

@test "the script never runs git push" {
  run grep -c 'git push' "$SCRIPT"
  [ "$output" = 0 ]
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

@test "handles a leading-dash filename and a deletion" {
  printf 'changed\n' >| ./-dash.txt
  git rm -q --cached src/b.txt && rm src/b.txt && git reset -q -- src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- -dash.txt src/b.txt
  [ "$status" -eq 0 ]
  [ "$(git show --name-status --format= HEAD | sort | tr '\t\n' ': ')" = "D:src/b.txt M:-dash.txt " ]
}

@test "the github provider commits with git and submits via the runtime" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
  grep -q '^node .*github-stack-runtime.js submit$' "$STUB_LOG"
  ! grep -q '^gt ' "$STUB_LOG"
}

@test "a listed file without changes is a staged mismatch (exit 3)" {
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
  ! grep -q '^gh pr view' "$STUB_LOG"
}

@test "a PR headRefOid that disagrees with origin exits 6 after the backoff" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_PR_HEAD=0000000000000000000000000000000000000000
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"head not verified"* ]]
  # One check plus one per backoff entry ("0 0").
  [ "$(grep -c '^gh pr view' "$STUB_LOG")" -eq 3 ]
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
  export STUB_PR_DIFF_FAIL=1
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
  run --separate-stderr "$cache/yellow-review/1.0.0/skills/pr-review-workflow/scripts/commit-resolve-fixes" \
    --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  grep -q "^node .*github-workflow/2.10.0/lib/github-stack-runtime.js submit$" "$STUB_LOG"
}

@test "gt and hooks do not inherit literal-pathspec mode" {
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

@test "a missing github runtime fails before committing (exit 2)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/missing.js"
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}
