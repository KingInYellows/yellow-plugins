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
  # The runner refuses files outside the PR, so the PR's file list also names
  # src/new.txt (the stub otherwise lists only the fixture's committed changes).
  mv "$STUB_BIN/gh" "$STUB_BIN/gh-base"
  cat >| "$STUB_BIN/gh" <<'STUB'
#!/bin/sh
gh-base "$@" || exit $?
case "$*" in
  "api --paginate repos/{owner}/{repo}/pulls/"*"/files"*) echo src/new.txt ;;
esac
STUB
  chmod +x "$STUB_BIN/gh"
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

@test "credentials the command prints are redacted from the log, with the exit status kept" {
  verify 'echo "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789"; echo visible; exit 3' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .result)" = fail ]
  log=$(printf '%s' "$output" | jq -r .log)
  run ! grep -q 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' "$log"
  grep -q visible "$log"
  [ "$(mode "$log")" = 600 ]
}

@test "runs from the repository root" {
  cd src
  verify 'pwd' --timeout 5 --trusted -- src/a.txt src/new.txt
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

@test "refuses to run while the tree has changes the list does not name" {
  printf 'two\nstray\n' >| src/b.txt
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"change outside the listed files: src/b.txt"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
}

@test "an unlisted dirty file left after --revert-only makes treeClean false" {
  printf 'two\nstray\n' >| src/b.txt
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt
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

@test "watchdog timeout still escalates to KILL for a descendant that ignores TERM" {
  export YELLOW_REVIEW_NO_TIMEOUT_BIN=1
  # The command shell dies on TERM; its child ignores TERM and needs KILL.
  verify '(trap "" TERM; exec sleep 31.3) & wait' --timeout 1 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .result)" = timeout ]
  # The script waits out the KILL escalation, so nothing may survive.
  ! pgrep -f 'sleep 31\.3' >/dev/null
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

@test "an untracked stray left after --revert-only makes treeClean false" {
  printf 'stray\n' >| src/stray.txt
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .treeClean)" = false ]
}

@test "--revert-dirty reverts every change git sees, deny-listed and staged files included" {
  mkdir -p .claude
  printf '{}\n' >| .claude/settings.json
  git add .claude && git commit -q -m "chore: settings"
  printf '{"hooks":{}}\n' >| .claude/settings.json
  printf 'staged new\n' >| src/staged.txt
  git add src/staged.txt
  run --separate-stderr "$SCRIPT" --pr 7 --revert-dirty
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["reverted",true]' ]
  [ "$(cat .claude/settings.json)" = '{}' ]
  [ ! -e src/staged.txt ]
  [ ! -e src/new.txt ]
  grep -q 'hooks' "$(printf '%s' "$output" | jq -r .patch)"
}

@test "--revert-dirty keeps a newline in a filename from forging a second path" {
  victim="$(dirname -- "$REPO")/victim-$$"
  : >| "$victim"
  # One untracked file "x\n../victim-N"; split on newlines it would forge "../victim-N".
  bad=$(printf 'x\n../victim-%s' "$$")
  mkdir -p -- "$(dirname -- "$bad")"
  printf 'y\n' >| "$bad"
  run --separate-stderr "$SCRIPT" --pr 7 --revert-dirty
  [ "$status" -eq 0 ]
  [ -e "$victim" ]
  [ ! -e "$bad" ]
  rm -f -- "$victim"
}

@test "a failed tree listing exits 2 and neither runs nor reverts anything" {
  shim="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$shim"
  real=$(command -v git)
  {
    printf '#!/bin/bash\n'
    printf 'for a in "$@"; do [ "$a" = --others ] && exit 1; done\n'
    printf 'exec "%s" "$@"\n' "$real"
  } >| "$shim/git"
  chmod +x "$shim/git"
  PATH="$shim:$PATH" verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"cannot list tree changes"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
  PATH="$shim:$PATH" run --separate-stderr "$SCRIPT" --pr 7 --revert-dirty
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"cannot list tree changes"* ]]
  grep -q 'resolver edit' src/a.txt
  [ -f src/new.txt ]
}

@test "--revert-dirty takes no file list" {
  run "$SCRIPT" --pr 7 --revert-dirty -- src/a.txt
  [ "$status" -eq 2 ]
}

@test "--revert-only may revert a deny-listed path" {
  mkdir -p .claude
  printf '{}\n' >| .claude/settings.json
  git add .claude && git commit -q -m "chore: settings"
  printf '{"hooks":{}}\n' >| .claude/settings.json
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- .claude/settings.json src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(cat .claude/settings.json)" = '{}' ]
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
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted --unattended -- src/a.txt package.json src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .result)" = skipped ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == "runner files changed: package.json" ]]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
  grep -q 'resolver edit' src/a.txt
}

@test "--unattended skips a file outside the PR" {
  git checkout -q -- src/a.txt && rm src/new.txt
  printf 'edited\n' >| src/c.txt
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted --unattended -- src/c.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = skipped ]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
}

@test "--unattended runs when every file is in the PR and not a runner" {
  rm src/new.txt
  verify 'true' --timeout 5 --trusted --unattended -- src/a.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = pass ]
}

@test "an interactive run also skips a file outside the PR" {
  git checkout -q -- src/a.txt && rm src/new.txt
  printf 'edited\n' >| src/c.txt
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted -- src/c.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = skipped ]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
}

@test "an interactive run skips when the PR's files cannot be listed" {
  export STUB_PR_DIFF_FAIL=1
  verify 'touch "$BATS_TEST_TMPDIR/ran"' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = skipped ]
  [ ! -e "$BATS_TEST_TMPDIR/ran" ]
}

@test "an interactive run does not skip a runner file in the PR" {
  rm src/new.txt
  printf '{"name":"y"}\n' >| package.json
  verify 'true' --timeout 5 --trusted -- src/a.txt package.json
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
  run ! grep -q $'\033' "$patch"
  git apply "$patch"
  grep -q 'resolver edit' src/a.txt
}

@test "a credential-shaped edit is reverted but never archived in a patch" {
  printf 'one\nfeature\nAPI_KEY=abcd1234efgh5678\n' >| src/a.txt
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .patch, .treeClean]')" = '["fail",null,true]' ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == *"credential"* ]]
  [ -z "$(git status --porcelain)" ]
  [ -z "$(find "$PATCH_DIR" -name '*.patch' 2>/dev/null)" ]
  run ! grep -rq 'abcd1234efgh5678' "$PATCH_DIR"
}

@test "an untracked dangling symlink is kept in the patch before it is removed" {
  ln -s missing-target src/dangling
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt src/dangling
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .treeClean)" = true ]
  patch=$(printf '%s' "$output" | jq -r .patch)
  grep -q 'src/dangling' "$patch"
  grep -q 'missing-target' "$patch"
  [ ! -L src/dangling ]
}

@test "a patch that cannot be saved reverts nothing" {
  shim="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$shim"
  real=$(command -v git)
  {
    printf '#!/bin/bash\n'
    printf 'for a in "$@"; do [ "$a" = --binary ] && exit 128; done\n'
    printf 'exec "%s" "$@"\n' "$real"
  } >| "$shim/git"
  chmod +x "$shim/git"
  PATH="$shim:$PATH" verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.patch, .treeClean]')" = '[null,false]' ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == *"nothing was reverted"* ]]
  grep -q 'resolver edit' src/a.txt
  [ -f src/new.txt ]
  [ -z "$(find "$PATCH_DIR" -name '*.patch' 2>/dev/null)" ]
}

@test "keeps only the newest 10 patches and logs of a PR, and never prunes another PR's" {
  mkdir -p "$PATCH_DIR"
  for i in 1 2 3; do
    : >| "$PATCH_DIR/99-2020010${i}T000000Z-1.patch"
    : >| "$PATCH_DIR/99-2020010${i}T000000Z-1.log"
  done
  rm src/new.txt
  for i in $(seq 1 12); do
    printf 'one\nfeature\nedit %s\n' "$i" >| src/a.txt
    verify 'exit 1' --timeout 5 --trusted -- src/a.txt
    sleep 0.01
  done
  [ "$(find "$PATCH_DIR" -name '7-*.patch' | wc -l)" -eq 10 ]
  [ "$(find "$PATCH_DIR" -name '7-*.log' | wc -l)" -eq 10 ]
  [ "$(find "$PATCH_DIR" -name '99-*.patch' | wc -l)" -eq 3 ]
  [ "$(find "$PATCH_DIR" -name '99-*.log' | wc -l)" -eq 3 ]
}

@test "passing runs prune that PR's logs too" {
  for i in $(seq 1 12); do
    verify 'true' --timeout 5 --trusted -- src/a.txt src/new.txt
    sleep 0.01
  done
  [ "$(find "$PATCH_DIR" -name '7-*.log' | wc -l)" -eq 10 ]
}

@test "patch and log names end in the UTC stamp and the pid, and no temp files are left behind" {
  verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  patch=$(printf '%s' "$output" | jq -r .patch)
  log=$(printf '%s' "$output" | jq -r .log)
  [[ "$patch" =~ /7-[0-9]{8}T[0-9]{6}Z-[0-9]+\.patch$ ]]
  [[ "$log" =~ /7-[0-9]{8}T[0-9]{6}Z-[0-9]+\.log$ ]]
  [ -z "$(find "$PATCH_DIR" -mindepth 1 -name '.*')" ]
}

@test "the log keeps the last 1 MiB of a chatty command, which still exits with its own status" {
  verify 'yes 0123456789abcdef | head -c 5000000; echo done-marker; exit 5' --timeout 60 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .result)" = fail ]
  log=$(printf '%s' "$output" | jq -r .log)
  [ "$(wc -c <"$log")" -le 1048576 ]
  [ "$(wc -c <"$log")" -gt 1000000 ]
  tail -n 1 "$log" | grep -q "done-marker$"
  [ "$(mode "$log")" = 600 ]
}

@test "a process left holding the output open is killed and the log is kept" {
  verify 'echo hello; sleep 31.9 &' --timeout 60 --trusted -- src/a.txt src/new.txt
  [ "$(printf '%s' "$output" | jq -r .result)" = pass ]
  grep -q hello "$(printf '%s' "$output" | jq -r .log)"
  run ! pgrep -f 'sleep 31\.9'
}

@test "a pass that left changes outside the listed files reports treeClean false and reverts nothing" {
  verify 'printf stray > src/stray.txt' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '[.result, .treeClean] | join(",")')" = "pass,false" ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == *"src/stray.txt"* ]]
  [ -f src/stray.txt ]
  grep -q 'resolver edit' src/a.txt
}

# Starts the script in the background, waits for the verify command to be
# running, sends TERM and leaves the JSON in $BATS_TEST_TMPDIR/out.
terminate_while_running() {
  printf '%s\n' 'touch "$BATS_TEST_TMPDIR/started"; sleep 31.1 & sleep 31.1; wait' >| "$CMD"
  "$SCRIPT" --pr 7 --command-file "$CMD" --timeout 60 --trusted -- src/a.txt src/new.txt \
    >| "$BATS_TEST_TMPDIR/out" 2>/dev/null 3>&- &
  local pid=$!
  for _ in $(seq 1 100); do
    [ -e "$BATS_TEST_TMPDIR/started" ] && break
    sleep 0.1
  done
  [ -e "$BATS_TEST_TMPDIR/started" ]
  kill -TERM "$pid"
  wait "$pid"
}

assert_interrupted_and_reverted() {
  [ "$(jq -c '[.result, .treeClean]' "$BATS_TEST_TMPDIR/out")" = '["fail",true]' ]
  [[ "$(jq -r .reason "$BATS_TEST_TMPDIR/out")" == *"interrupted by SIGTERM"* ]]
  grep -q '+resolver edit' "$(jq -r .patch "$BATS_TEST_TMPDIR/out")"
  [ -z "$(git status --porcelain)" ]
  run ! pgrep -f 'sleep 31\.1'
}

@test "TERM stops the command and its group, then saves the edits and reverts them" {
  has_kill_after || skip "timeout --kill-after not available"
  terminate_while_running
  assert_interrupted_and_reverted
}

@test "TERM under the watchdog fallback stops the group and the watchdog, then reverts" {
  export YELLOW_REVIEW_NO_TIMEOUT_BIN=1
  terminate_while_running
  assert_interrupted_and_reverted
  # The watchdog's sleep for the 60 s timeout must not outlive the script.
  run ! pgrep -f 'sleep 60'
}

@test "a binary-marked file cannot smuggle a credential into the patch" {
  printf 'API_KEY=abcd1234efgh5678\n\0' >| src/bin.dat
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt src/bin.dat
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.patch, .treeClean]')" = '[null,true]' ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == *"credential"* ]]
  [ ! -e src/bin.dat ]
  run ! grep -rq 'abcd1234efgh5678' "$PATCH_DIR"
}

@test "a clean binary file is kept in the patch as a binary patch" {
  printf 'plain\0data\n' >| src/bin.dat
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt src/bin.dat
  grep -q 'GIT binary patch' "$(printf '%s' "$output" | jq -r .patch)"
  [ ! -e src/bin.dat ]
}

@test "a credential screen that cannot answer is treated as a hit" {
  shim="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$shim"
  real=$(command -v awk)
  {
    printf '#!/bin/bash\n'
    printf 'for a in "$@"; do [ -f "$a" ] && exit 2; done\n'
    printf 'exec "%s" "$@"\n' "$real"
  } >| "$shim/awk"
  chmod +x "$shim/awk"
  PATH="$shim:$PATH" run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.patch, .treeClean]')" = '[null,true]' ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == *"screen failed"* ]]
  [ -z "$(git status --porcelain)" ]
}

@test "a staged deletion is saved in the patch before the revert restores the file" {
  git rm -q src/c.txt
  run --separate-stderr "$SCRIPT" --pr 7 --revert-only -- src/a.txt src/new.txt src/c.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["reverted",true]' ]
  grep -q 'deleted file mode' "$(printf '%s' "$output" | jq -r .patch)"
  [ -f src/c.txt ]
  [ -z "$(git status --porcelain)" ]
}

@test "failed revert steps are named in the reason" {
  shim="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$shim"
  real=$(command -v git)
  {
    printf '#!/bin/bash\n'
    printf 'for a in "$@"; do [ "$a" = checkout ] && exit 1; done\n'
    printf 'exec "%s" "$@"\n' "$real"
  } >| "$shim/git"
  chmod +x "$shim/git"
  PATH="$shim:$PATH" verify 'exit 1' --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .treeClean)" = false ]
  [[ "$(printf '%s' "$output" | jq -r .reason)" == *"revert failed: git checkout src/a.txt"* ]]
  [ ! -e src/new.txt ]
}

@test "--revert-dirty and --revert-only together still revert every change" {
  run --separate-stderr "$SCRIPT" --pr 7 --revert-dirty --revert-only
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.result, .treeClean]')" = '["reverted",true]' ]
  [ ! -e src/new.txt ]
}

@test "bad arguments exit 2 before anything runs" {
  printf 'true\n' >| "$CMD"
  : >| "$BATS_TEST_TMPDIR/empty"
  run "$SCRIPT" --timeout 5 --command-file "$CMD" --trusted -- src/a.txt
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 0 --timeout 5 --command-file "$CMD" --trusted -- src/a.txt
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr abc --revert-only
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --bogus
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --timeout 0 --command-file "$CMD" --trusted -- src/a.txt
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --timeout 5 --trusted -- src/a.txt
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --timeout 5 --command-file "$BATS_TEST_TMPDIR/missing" --trusted -- src/a.txt
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --timeout 5 --command-file "$BATS_TEST_TMPDIR/empty" --trusted -- src/a.txt
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --revert-only --files-from "$BATS_TEST_TMPDIR/missing"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --pr 7 --revert-only -- /etc/passwd
  [ "$status" -eq 2 ]
  grep -q 'resolver edit' src/a.txt
  [ -f src/new.txt ]
}

# A copy of the plugin's script and libraries, to run where yellow-core is or
# is not a sibling. Prints the copied script's path.
copy_plugin() {
  mkdir -p "$1/lib" "$1/skills/pr-review-workflow/scripts"
  cp "$BATS_TEST_DIRNAME/../lib/resolve-paths.sh" "$BATS_TEST_DIRNAME/../lib/resolve-text.sh" \
    "$BATS_TEST_DIRNAME/../lib/verify-run.sh" "$1/lib/"
  cp "$SCRIPT" "$1/skills/pr-review-workflow/scripts/"
  printf '%s' "$1/skills/pr-review-workflow/scripts/run-verify-command"
}

SECRET_COMMAND='echo "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789"; echo visible'

@test "without yellow-core the log is withheld rather than kept raw" {
  copy=$(copy_plugin "$BATS_TEST_TMPDIR/solo/yellow-review")
  printf '%s\n' "$SECRET_COMMAND" >| "$CMD"
  run --separate-stderr "$copy" --pr 7 --command-file "$CMD" --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  log=$(printf '%s' "$output" | jq -r .log)
  [ "$(cat "$log")" = '[withheld: log redaction unavailable]' ]
}

@test "the installed-cache layout finds the newest numeric yellow-core version" {
  market="$BATS_TEST_TMPDIR/market"
  copy=$(copy_plugin "$market/yellow-review/1.0.0")
  mkdir -p "$market/yellow-core/1.10.0/lib" "$market/yellow-core/1.9.0/lib" "$market/yellow-core/next/lib"
  cp "$BATS_TEST_DIRNAME/../../yellow-core/lib/compound-staging.sh" "$market/yellow-core/1.10.0/lib/"
  # Older and non-numeric versions would leave the token in the log.
  printf 'cs_redact_secrets() { cat; }\n' >| "$market/yellow-core/1.9.0/lib/compound-staging.sh"
  cp "$market/yellow-core/1.9.0/lib/compound-staging.sh" "$market/yellow-core/next/lib/"
  printf '%s\n' "$SECRET_COMMAND" >| "$CMD"
  run --separate-stderr "$copy" --pr 7 --command-file "$CMD" --timeout 5 --trusted -- src/a.txt src/new.txt
  [ "$status" -eq 0 ]
  log=$(printf '%s' "$output" | jq -r .log)
  grep -q visible "$log"
  run ! grep -q 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' "$log"
  grep -q 'REDACTED' "$log"
}
