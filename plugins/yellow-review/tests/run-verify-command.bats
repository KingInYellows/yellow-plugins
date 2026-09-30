#!/usr/bin/env bats
# Tests for run-verify-command (trust gate, pass/fail/timeout, patch + revert)

bats_require_minimum_version 1.5.0

load helpers/resolve-repo

SCRIPT="${RESOLVE_SCRIPTS}/run-verify-command"

setup() {
  resolve_repo_init
  unset YELLOW_REVIEW_NO_TIMEOUT_BIN
  CMD="$BATS_TEST_TMPDIR/verify.sh"
  PATCH_DIR="$REPO/.git/yellow-review/resolve-patches"
  # Resolver edits: one tracked file changed, one new untracked file.
  printf 'one\nfeature\nresolver edit\n' >| src/a.txt
  printf 'new\n' >| src/new.txt
}

verify() {
  printf '%s\n' "$1" >| "$CMD"
  shift
  run --separate-stderr "$SCRIPT" --pr 7 --command-file "$CMD" "$@"
}

has_kill_after() {
  command -v timeout >/dev/null 2>&1 && timeout --kill-after=1 1 true >/dev/null 2>&1
}

@test "refuses to run without --trusted" {
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 -- src/a.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"untrusted"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
}

@test "rejects a non-numeric timeout" {
  verify 'true' --timeout soon --trusted -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "pass leaves the resolver edits in place" {
  verify 'test -f src/a.txt && echo checked' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .patch, .treeClean]')" = '["pass",null,true]' ]
  grep -q 'resolver edit' src/a.txt
  [ -f src/new.txt ]
  grep -q checked "$(printf '%s' "$output" | jq -r .log)"
}

@test "runs from the repository root" {
  cd src
  verify 'pwd' --timeout 5 --trusted -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(cat "$(printf '%s' "$output" | jq -r .log)")" = "$(cd "$REPO" && pwd -P)" ]
}

@test "fail saves a patch, reverts tracked and untracked files, and reports a clean tree" {
  verify 'echo boom >&2; exit 3' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["fail",true]' ]
  patch=$(printf '%s' "$output" | jq -r .patch)
  [[ "$patch" == "$PATCH_DIR/7-"*.patch ]]
  grep -q '+resolver edit' "$patch"
  grep -q '+new' "$patch"
  [ "$(stat -c %a "$patch")" = 600 ]
  [ "$(stat -c %a "$PATCH_DIR")" = 700 ]
  [ -z "$(git status --porcelain)" ]
  grep -q boom "$(printf '%s' "$output" | jq -r .log)"
}

@test "the saved patch re-applies the resolver edits" {
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  patch=$(printf '%s' "$output" | jq -r .patch)
  git apply "$patch"
  grep -q 'resolver edit' src/a.txt
  [ -f src/new.txt ]
}

@test "an unlisted dirty file makes treeClean false" {
  printf 'two\nstray\n' >| src/b.txt
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .treeClean)" = false ]
}

@test "timeout via the timeout binary" {
  has_kill_after || skip "timeout --kill-after not available"
  verify 'sleep 30' --timeout 1 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["timeout",true]' ]
}

@test "timeout via the watchdog fallback kills the whole process group" {
  export YELLOW_REVIEW_NO_TIMEOUT_BIN=1
  start=$(date +%s)
  # A distinctive duration so pgrep matches only this test's children.
  verify 'sleep 31.7 & sleep 31.7; wait' --timeout 1 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .result)" = timeout ]
  [ $(( $(date +%s) - start )) -lt 15 ]
  # TERM is delivered before the script returns; allow the children a
  # moment to exit before asserting none survived.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pgrep -f 'sleep 31\.7' >/dev/null || break
    sleep 0.2
  done
  ! pgrep -f 'sleep 31\.7' >/dev/null
}

@test "a command exiting 124 on its own under the watchdog is fail, not timeout" {
  export YELLOW_REVIEW_NO_TIMEOUT_BIN=1
  verify 'exit 124' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = fail ]
}

@test "keeps only the newest 10 patches" {
  for i in $(seq 1 12); do
    printf 'one\nfeature\nedit %s\n' "$i" >| src/a.txt
    verify 'exit 1' --timeout 5 --trusted -- src/a.txt
    sleep 0.01
  done
  [ "$(find "$PATCH_DIR" -name '*.patch' | wc -l)" -eq 10 ]
}
