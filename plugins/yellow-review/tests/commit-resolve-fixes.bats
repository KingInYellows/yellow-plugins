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
  printf 'two\nfix\n' >| src/b.txt
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

@test "a submit that never reaches origin exits 6 after three checks" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_SUBMIT_SKIP_PUBLISH=1
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [ "$(grep -c '^gh pr view' "$STUB_LOG")" -eq 3 ]
}

@test "a PR headRefOid that disagrees with origin exits 6" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  export STUB_PR_HEAD=0000000000000000000000000000000000000000
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"head not verified"* ]]
}
