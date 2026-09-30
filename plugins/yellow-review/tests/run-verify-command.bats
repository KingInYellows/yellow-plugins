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

mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

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
  [ "$(mode "$patch")" = 600 ]
  [ "$(mode "$PATCH_DIR")" = 700 ]
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

@test "a command exiting 137 quickly under the timeout binary is fail, not timeout" {
  has_kill_after || skip "timeout --kill-after not available"
  verify 'exit 137' --timeout 30 --trusted -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = fail ]
}

@test "--files-from lists the files to revert" {
  printf 'src/a.txt\nsrc/new.txt\n' >| "$BATS_TEST_TMPDIR/files"
  verify 'exit 1' --timeout 5 --trusted --files-from "$BATS_TEST_TMPDIR/files"
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["fail",true]' ]
  [ ! -e src/new.txt ]
}

@test "refuses a gitignored file so a revert can never delete it" {
  printf 'secret.txt\n' >| .gitignore
  git add .gitignore && git commit -q -m "chore: ignore"
  printf 'user data\n' >| secret.txt
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt secret.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"gitignored"* ]]
  [ -f secret.txt ]
}

@test "refuses a listed file without changes" {
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/b.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"no changes: src/b.txt"* ]]
  grep -q 'resolver edit' src/a.txt
}

@test "list entries are literal paths, never globs" {
  verify 'exit 1' --timeout 5 --trusted -- 'src/*'
  [ "$status" -eq 2 ]
  grep -q 'resolver edit' src/a.txt
  [ -f src/new.txt ]
}

@test "an untracked stray left after the revert makes treeClean false" {
  printf 'stray\n' >| src/stray.txt
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .treeClean)" = false ]
}

@test "refuses a deny-listed path" {
  printf 'X=1\n' >| .env
  verify 'exit 1' --timeout 5 --trusted -- .env
  [ "$status" -eq 2 ]
  [ -f .env ]
}

@test "the verify command does not inherit literal-pathspec mode" {
  verify 'printf "%s\n" "${GIT_LITERAL_PATHSPECS:-unset}"' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$(cat "$(printf '%s' "$output" | jq -r .log)")" = unset ]
}

@test "--unattended skips a runner file without running the command" {
  printf '{"name":"y"}\n' >| package.json
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted --unattended -- src/a.txt package.json
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .result)" = skipped ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == "runner files changed: package.json" ]]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
  grep -q 'resolver edit' src/a.txt
}

@test "--unattended skips a file outside the PR" {
  printf 'edited\n' >| src/c.txt
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted --unattended -- src/c.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = skipped ]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
}

@test "--unattended runs when every file is in the PR and not a runner" {
  verify 'true' --timeout 5 --trusted --unattended -- src/a.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = pass ]
}

@test "--revert-only saves a patch and reverts without --trusted or a command" {
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["reverted",true]' ]
  grep -q '+resolver edit' "$(printf '%s' "$output" | jq -r .patch)"
  [ -z "$(git status --porcelain)" ]
}

@test "the saved patch ignores colour and prefix settings" {
  git config color.ui always
  git config diff.noprefix true
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  patch=$(printf '%s' "$output" | jq -r .patch)
  ! grep -q $'\033' "$patch"
  git apply "$patch"
  grep -q 'resolver edit' src/a.txt
}

@test "keeps only the newest 10 patches" {
  for i in $(seq 1 12); do
    printf 'one\nfeature\nedit %s\n' "$i" >| src/a.txt
    verify 'exit 1' --timeout 5 --trusted -- src/a.txt
    sleep 0.01
  done
  [ "$(find "$PATCH_DIR" -name '*.patch' | wc -l)" -eq 10 ]
}
