#!/usr/bin/env bats
# Tests for commit-resolve-fixes (staging, new-commit, submit, head verify)

bats_require_minimum_version 1.5.0

load helpers/resolve-repo

SCRIPT="${RESOLVE_SCRIPTS}/commit-resolve-fixes"
MSG="fix: resolve PR #7 review comments (2 files)"

setup() {
  resolve_repo_init
  # Most tests exercise the verified-hook paths, which the default (hooks off)
  # skips; the default itself is tested with the variable unset.
  export YELLOW_REVIEW_COMMIT_HOOKS=1
}

# The fixture remotes are local bare repositories. The script reads each
# remote's push URL, so present the two local ones to it (and only it, via
# environment config: the tests' own git push calls still use local paths) as
# the PR's head repository, the gh stub's acme/widgets. The post-push head
# check queries that push URL, so a shim in front of git (ls-remote only) sends
# any network URL to the bare repository the stubs publish to, $ORIGIN_DIR; a
# remote name or local path passes through, and so does every other command.
ls_remote_shim_dir() {
  local d="$BATS_TEST_TMPDIR/ls-remote-shim"
  if [ ! -x "$d/git" ]; then
    mkdir -p "$d"
    cat >| "$d/git" <<'SHIM'
#!/bin/sh
# Drop this directory from PATH so the next git (a test shim or the real one) runs.
PATH=${PATH#"$(dirname "$0"):"}
if [ "$1" = ls-remote ]; then
  for a in "$@"; do
    shift
    case "$a" in
      *:*) a="$ORIGIN_DIR" ;;
    esac
    set -- "$@" "$a"
  done
fi
exec git "$@"
SHIM
    chmod +x "$d/git"
  fi
  printf '%s' "$d"
}

run_crf() {
  GIT_CONFIG_COUNT=2 \
    GIT_CONFIG_KEY_0="url.https://github.com/acme/widgets.git.pushInsteadOf" \
    GIT_CONFIG_VALUE_0="$BATS_TEST_TMPDIR/origin.git" \
    GIT_CONFIG_KEY_1="url.https://github.com/acme/widgets.git.pushInsteadOf" \
    GIT_CONFIG_VALUE_1="$BATS_TEST_TMPDIR/other.git" \
    PATH="$(ls_remote_shim_dir):$PATH" \
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
    PATH="$(ls_remote_shim_dir):$PATH" \
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
  # Fail the scanner's awk calls (-v strict=..., -v host=...) after the first
  # two, which screen the message; everything else runs for real.
  cat >| "${BATS_TEST_TMPDIR}/failbin/awk" <<STUB
#!/bin/sh
case "\$1" in
  -v)
    n=\$(cat "${BATS_TEST_TMPDIR}/awk-calls" 2>/dev/null || echo 0)
    echo \$((n + 1)) >| "${BATS_TEST_TMPDIR}/awk-calls"
    [ "\$n" -ge 2 ] && exit 2
    ;;
esac
exec $(command -v awk) "\$@"
STUB
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
  track_git_hooks pre-commit
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
  printf '#!/bin/sh\nprintf "two\\nfeature\\nhook\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  track_git_hooks pre-commit
  stub_gt_child_branch
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
  export STUB_GT_RESTACK_FAIL=1
  printf '#!/bin/sh\nprintf "two\\nfeature\\nhook\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  track_git_hooks pre-commit
  stub_gt_child_branch
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"retry \`gt restack\`"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "the github provider never runs gt restack when it undoes a commit" {
  printf '#!/bin/sh\nprintf "late\\n" > src/b.txt && git add src/b.txt\n' >| .git/hooks/post-commit
  chmod +x .git/hooks/post-commit
  track_git_hooks post-commit
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 4 ]
  ! grep -q '^gt ' "$STUB_LOG"
}

@test "a hook that adds a credential-shaped line makes the commit undo itself (exit 4)" {
  printf '#!/bin/sh\nprintf "key = \\"AKIAABCDEFGHIJKLMNOP\\"\\n" >> src/a.txt && git add src/a.txt\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  track_git_hooks pre-commit
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
  track_git_hooks post-commit
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
  track_git_hooks post-commit
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
  # run_crf's temporary PATH clears bash's command hash, so a later git call
  # can hash a removed shim; re-search PATH so the shim never execs itself.
  hash -r
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
  track_git_hooks post-commit
  # lgit puts -c options before the subcommand, so match ls-files anywhere.
  git_shim_failing "if [ -e \"$BATS_TEST_TMPDIR/armed\" ]; then case \" \$* \" in *' ls-files '*) exit 128 ;; esac; fi"
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
  track_git_hooks pre-commit
  printf 'one\nfeature\n%s\n' "$approved" >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"credential-shaped"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

# tracked_hook <body>: a pre-commit hook in a tracked in-tree hooks directory,
# the one place commit-resolve-fixes still lets a hook run. HEAD moves, so
# tests compare against $BASE_SHA instead of $FIRST_SHA.
tracked_hook() {
  mkdir -p .hooks
  printf '#!/bin/sh\n%s\n' "$1" >| .hooks/pre-commit
  chmod +x .hooks/pre-commit
  git add .hooks && git commit -q -m "chore: hooks"
  git config core.hooksPath .hooks
  BASE_SHA=$(git rev-parse HEAD)
}

@test "with --allow-credential-shaped, a hook that copies an approved line into another listed file is refused and undone (exit 4)" {
  # The same text in another file is a different occurrence: the approval was
  # for src/a.txt only.
  tracked_hook 'printf "key = \"AKIA%s\"\n" ABCDEFGHIJKLMNOP >> src/b.txt && git add src/b.txt'
  printf 'one\nfeature\nkey = "AKIA%s"\n' "ABCDEFGHIJKLMNOP" >| src/a.txt
  printf 'two\nfeature\nfix\n' >| src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt src/b.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"credential-shaped"* ]]
  [ "$(git rev-parse HEAD)" = "$BASE_SHA" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "with --allow-credential-shaped, a hook that repeats an approved line in the same file is refused and undone (exit 4)" {
  # One approved occurrence does not cover a second identical one.
  tracked_hook 'printf "key = \"AKIA%s\"\n" ABCDEFGHIJKLMNOP >> src/a.txt && git add src/a.txt'
  printf 'one\nfeature\nkey = "AKIA%s"\n' "ABCDEFGHIJKLMNOP" >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"credential-shaped"* ]]
  [ "$(git rev-parse HEAD)" = "$BASE_SHA" ]
  ! grep -q '^gt submit' "$STUB_LOG"
}

@test "with --allow-credential-shaped, approved lines in several files are all allowed" {
  printf 'one\nfeature\nkey = "AKIA%s"\n' "ABCDEFGHIJKLMNOP" >| src/a.txt
  printf 'two\nfeature\nkey = "AKIA%s"\n' "ABCDEFGHIJKLMNOP" >| src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" --allow-credential-shaped -- src/a.txt src/b.txt
  [ "$status" -eq 0 ]
  grep -q '^gt submit' "$STUB_LOG"
}

@test "with --allow-credential-shaped, a hook that changes nothing is still allowed" {
  printf '#!/bin/sh\nexit 0\n' >| .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  track_git_hooks pre-commit
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

@test "the head check reads the validated push URL, not the fetch URL (exit 0)" {
  STALE="$BATS_TEST_TMPDIR/stale.git"
  git init -q --bare -b main "$STALE"
  git push -q "$STALE" main feature 2>/dev/null
  remote_with_push_url fork https://github.com/acme/widgets.git
  git remote set-url fork "$STALE"
  git config branch.feature.pushRemote fork
  export STUB_GT_REMOTE=fork
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
  # The fetch URL's repository never received the commit.
  [ "$(git --git-dir="$STALE" rev-parse refs/heads/feature)" = "$FIRST_SHA" ]
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

# --- A remote with several push URLs: all of them must pass ---

@test "a second push URL naming another repository is refused before committing (exit 3)" {
  remote_with_push_url fork https://github.com/acme/widgets.git
  git config --add remote.fork.pushurl https://github.com/mallory/widgets.git
  git config branch.feature.pushRemote fork
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"remote 'fork' does not push to PR #7's head repository"* ]]
  [[ "$stderr" != *"mallory"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^node ' "$STUB_LOG"
}

@test "a second push URL on another host or port is refused before committing (exit 3)" {
  for url in https://git.example/acme/widgets.git https://github.com:8443/acme/widgets.git; do
    git remote remove fork 2>/dev/null || true
    remote_with_push_url fork https://github.com/acme/widgets.git
    git config --add remote.fork.pushurl "$url"
    git config branch.feature.pushRemote fork
    printf 'one\nfeature\nfix\n' >| src/a.txt
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $url" >&2; return 1; }
    [[ "$stderr" != *"git.example"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  done
}

@test "an unparseable second push URL is refused (exit 3)" {
  remote_with_push_url fork https://github.com/acme/widgets.git
  git config --add remote.fork.pushurl /some/local/path
  git config branch.feature.pushRemote fork
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"cannot tell which repository remote 'fork' pushes to"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "two push URLs of the head repository are accepted and each is verified with ls-remote (exit 0)" {
  remote_with_push_url fork https://github.com/acme/widgets.git
  git config --add remote.fork.pushurl git@github.com:acme/widgets.git
  git config branch.feature.pushRemote fork
  local logdir="$BATS_TEST_TMPDIR/ls-log-shim"
  mkdir -p "$logdir"
  cat >| "$logdir/git" <<'SHIM'
#!/bin/sh
PATH=${PATH#"$(dirname "$0"):"}
[ "$1" = ls-remote ] && printf 'ls-remote\n' >> "$LS_LOG"
exec git "$@"
SHIM
  chmod +x "$logdir/git"
  export LS_LOG="$BATS_TEST_TMPDIR/ls.log"
  : >| "$LS_LOG"
  PATH="$logdir:$PATH"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .status)" = PUSHED ]
  [ "$(wc -l <"$LS_LOG")" -eq 2 ]
}

# --- A pushRemote or pushDefault of "." is not a remote ---

@test "a branch pushRemote of '.' is refused before committing even with one remote (exit 3)" {
  git config branch.feature.pushRemote .
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"is '.' or not a configured remote"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^node ' "$STUB_LOG"
}

@test "remote.pushDefault of '.' is refused before committing, for graphite too (exit 3)" {
  git config remote.pushDefault .
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"is '.' or not a configured remote"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  ! grep -q '^gt modify\|^gt submit' "$STUB_LOG"
}

@test "a pushRemote naming no configured remote is refused before committing (exit 3)" {
  git config branch.feature.pushRemote nonesuch
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"is '.' or not a configured remote"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

# --- The push URL's host and scheme ---

# push_via <url>: make the branch push to a remote reporting <url>, then edit a
# listed file so a run has something to commit.
push_via() {
  remote_with_push_url hostcase "$1"
  git config branch.feature.pushRemote hostcase
  printf 'one\nfeature\nfix\n' >| src/a.txt
}

@test "a push URL with the right owner/repo on another host is refused before committing (exit 3)" {
  for url in https://git.example/acme/widgets.git \
             ssh://git@git.example:2222/acme/widgets.git \
             git@git.example:acme/widgets.git \
             https://github.com.evil.example/acme/widgets.git \
             https://github.com@git.example/acme/widgets.git; do
    git remote remove hostcase 2>/dev/null || true
    push_via "$url"
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $url" >&2; return 1; }
    [[ "$stderr" == *"remote 'hostcase' does not push to the active GitHub host"* ]]
    [[ "$stderr" != *"git.example"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  done
  ! grep -q '^node ' "$STUB_LOG"
}

@test "ssh.github.com and www.github.com count as github.com" {
  n=0
  for url in ssh://git@ssh.github.com:443/acme/widgets.git \
             ssh://git@SSH.GitHub.com:443/acme/widgets \
             https://www.github.com/acme/widgets.git; do
    n=$((n + 1))
    git remote remove hostcase 2>/dev/null || true
    push_via "$url"
    printf 'one\nfeature\nfix%s\n' "$n" >| src/a.txt
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "rejected: $url: $stderr" >&2; return 1; }
  done
}

@test "GH_HOST names the active host, case-insensitively, and wins over the PR URL" {
  export GH_HOST=Git.Example
  push_via https://git.example/acme/widgets.git
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  # github.com is no longer the active host.
  git remote remove hostcase
  push_via https://github.com/acme/widgets.git
  printf 'one\nfeature\nfix2\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"does not push to the active GitHub host"* ]]
}

@test "without GH_HOST the host of the PR's URL is the active host" {
  export STUB_PR_URL=https://git.example/acme/widgets/pull/7
  push_via https://git.example/acme/widgets.git
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  git remote remove hostcase
  push_via https://github.com/acme/widgets.git
  printf 'one\nfeature\nfix2\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"does not push to the active GitHub host"* ]]
}

@test "an undeterminable active host refuses the commit (exit 3)" {
  export STUB_PR_URL=none
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"could not determine the active GitHub host"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "a push URL with a scheme other than https, http, ssh or git is refused (exit 3)" {
  for url in file://github.com/acme/widgets.git \
             ftp://github.com/acme/widgets.git \
             ext::https://github.com/acme/widgets.git \
             git+ssh://git@github.com/acme/widgets.git; do
    git remote remove hostcase 2>/dev/null || true
    push_via "$url"
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $url" >&2; return 1; }
    [[ "$stderr" == *"cannot tell which repository remote 'hostcase' pushes to"* ]]
    [[ "$stderr" != *"github.com/acme"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  done
}

@test "the git:// and http:// schemes are accepted for the right host and repository" {
  n=0
  for url in git://github.com/acme/widgets.git http://github.com/acme/widgets.git; do
    n=$((n + 1))
    git remote remove hostcase 2>/dev/null || true
    push_via "$url"
    printf 'one\nfeature\nfix%s\n' "$n" >| src/a.txt
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "rejected: $url: $stderr" >&2; return 1; }
  done
}

# --- Hooks the commit would run ---

# plant_hook <dir>: an executable pre-commit hook in <dir> that logs its run.
plant_hook() {
  mkdir -p "$1"
  printf '#!/bin/sh\necho ran >> "%s/hook.log"\n' "$BATS_TEST_TMPDIR" >| "$1/pre-commit"
  chmod +x "$1/pre-commit"
}

# track_git_hooks <name>...: move hooks written to .git/hooks into a tracked
# in-tree hooks directory, the one place a hook still runs. HEAD moves, so
# FIRST_SHA follows.
track_git_hooks() {
  local h
  mkdir -p .hooks
  for h in "$@"; do mv ".git/hooks/$h" ".hooks/$h"; done
  git add .hooks && git commit -q -m "chore: hooks"
  git config core.hooksPath .hooks
  FIRST_SHA=$(git rev-parse HEAD)
}

@test "an ignored hooks directory inside the repository is refused before committing (exit 3)" {
  for provider in github graphite; do
    plant_hook .hooks
    printf '.hooks/\n' >> .git/info/exclude
    git config core.hooksPath .hooks
    printf 'one\nfeature\nfix\n' >| src/a.txt
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $provider" >&2; return 1; }
    [[ "$stderr" == *"hooks directory '.hooks' holds untracked or ignored files"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
    [ -z "$(git diff --cached --name-only)" ]
    [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
    # An absolute path to the same directory is the same directory.
    git config core.hooksPath "$(pwd -P)/.hooks"
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ]
    git config --unset core.hooksPath
    rm -rf .hooks
  done
  ! grep -q '^node \|^gt modify\|^gt submit' "$STUB_LOG"
}

@test "an ignored file below a tracked hooks directory is refused too (exit 3)" {
  plant_hook .hooks
  git add .hooks && git commit -q -m "chore: hooks"
  mkdir -p .hooks/lib
  printf 'x=1\n' >| .hooks/lib/helper.sh
  printf '.hooks/lib/\n' >> .git/info/exclude
  git config core.hooksPath .hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"hooks directory '.hooks' holds untracked or ignored files"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
}

@test "a hooks directory whose files are all tracked is allowed and its hook runs" {
  plant_hook .hooks
  git add .hooks && git commit -q -m "chore: hooks"
  git config core.hooksPath .hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ -e "$BATS_TEST_TMPDIR/hook.log" ]
}

@test "a hook in a hooks directory outside the repository is not run: the commit disables hooks" {
  for provider in github graphite; do
    plant_hook "$BATS_TEST_TMPDIR/ext-hooks"
    git config core.hooksPath "$BATS_TEST_TMPDIR/ext-hooks"
    printf 'one\nfeature\nfix-%s\n' "$provider" >| src/a.txt
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $provider: $stderr" >&2; return 1; }
    [[ "$stderr" == *"external hooks directory are not verified"* ]]
    [ ! -e "$BATS_TEST_TMPDIR/hook.log" ] || { echo "hook ran: $provider" >&2; return 1; }
  done
}

@test "a hook in .git/hooks is not run: the commit disables hooks" {
  for provider in github graphite; do
    plant_hook .git/hooks
    printf 'one\nfeature\nfix-%s\n' "$provider" >| src/a.txt
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $provider: $stderr" >&2; return 1; }
    [[ "$stderr" == *"git-dir hooks directory are not verified"* ]]
    [ ! -e "$BATS_TEST_TMPDIR/hook.log" ] || { echo "hook ran: $provider" >&2; return 1; }
  done
}

@test "a .git/hooks holding only .sample files leaves hooks enabled and prints no note" {
  printf '#!/bin/sh\n' >| .git/hooks/pre-commit.sample
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"not verified"* ]]
}

@test "disabling hooks appends to a caller's GIT_CONFIG_COUNT and rejects a non-numeric one" {
  plant_hook .git/hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  GIT_CONFIG_COUNT=zz run --separate-stderr "$SCRIPT" --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -ne 0 ]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
}

# --- The runtime override is a runner file ---

@test "--unattended refuses a listed YELLOW_REVIEW_GITHUB_STACK_RUNTIME inside the repository (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/custom-runtime.js
  git add tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  base=$(git rev-parse HEAD)
  printf '// edited\n' >> tools/custom-runtime.js
  for ov in "$(pwd -P)/tools/custom-runtime.js" tools/custom-runtime.js ./tools/../tools/custom-runtime.js; do
    export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$ov"
    run_crf --provider github --pr 7 --message "$MSG" --unattended -- tools/custom-runtime.js
    [ "$status" -eq 3 ] || { echo "accepted: $ov" >&2; return 1; }
    [[ "$stderr" == *"runner file"* ]]
    [ "$(git rev-parse HEAD)" = "$base" ]
  done
  ! grep -q '^node ' "$STUB_LOG"
}

@test "--unattended refuses an override reached through a symlink to a listed repository file" {
  mkdir -p tools
  printf '// runtime\n' >| tools/custom-runtime.js
  git add tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  printf '// edited\n' >> tools/custom-runtime.js
  ln -s "$(pwd -P)/tools/custom-runtime.js" "$BATS_TEST_TMPDIR/linked-runtime.js"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/linked-runtime.js"
  run_crf --provider github --pr 7 --message "$MSG" --unattended -- tools/custom-runtime.js
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"runner file"* ]]
}

@test "an override outside the repository does not make listed files runners" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" --unattended -- src/a.txt
  [ "$status" -eq 0 ]
}

# --- DEVIN_ORG_ID is a prohibited credential name ---

@test "a literal DEVIN_ORG_ID assignment is refused with and without --unattended (exit 3)" {
  for flag in "" --unattended; do
    printf 'one\nfeature\nDEVIN_ORG_ID=org-1234567890\n' >| src/a.txt
    # shellcheck disable=SC2086
    run_crf --provider graphite --pr 7 --message "$MSG" $flag -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted (flag='$flag')" >&2; return 1; }
    [[ "$stderr" == *"credential-shaped"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
    [ -z "$(git diff --cached --name-only)" ]
  done
  printf 'one\nfeature\nexport DEVIN_ORG_ID="org-1234567890"\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
}

@test "_ID references and ordinary _ID assignments stay clean" {
  printf 'one\nfeature\nconst ORG_ID = process.env.ORG_ID;\nDEVIN_ORG_ID = process.env.DEVIN_ORG_ID\nUSER_ID=12345678\nDEVIN_ORG_ID="${DEVIN_ORG_ID:-}"\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

# --- A hooks path through a symlink inside the working tree ---

@test "a relative hooks path that is a symlink to an external directory is refused (exit 3)" {
  plant_hook "$BATS_TEST_TMPDIR/ext-hooks"
  ln -s "$BATS_TEST_TMPDIR/ext-hooks" .hooks
  printf '.hooks\n' >> .git/info/exclude
  git config core.hooksPath .hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  for provider in github graphite; do
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $provider" >&2; return 1; }
    [[ "$stderr" == *"hooks path goes through the symlink '.hooks'"* ]]
    [[ "$stderr" != *"ext-hooks"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
    [ -z "$(git diff --cached --name-only)" ]
    [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
  done
  ! grep -q '^node \|^gt modify\|^gt submit' "$STUB_LOG"
}

@test "an absolute in-tree hooks path through a symlinked parent is refused (exit 3)" {
  mkdir "$BATS_TEST_TMPDIR/ext-parent"
  plant_hook "$BATS_TEST_TMPDIR/ext-parent/hooks"
  ln -s "$BATS_TEST_TMPDIR/ext-parent" parent
  printf 'parent\n' >> .git/info/exclude
  git config core.hooksPath "$(pwd -P)/parent/hooks"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"hooks path goes through the symlink 'parent'"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
}

@test "a .git/hooks that is a symlink is refused (exit 3)" {
  plant_hook "$BATS_TEST_TMPDIR/ext-hooks"
  rm -rf .git/hooks
  ln -s "$BATS_TEST_TMPDIR/ext-hooks" .git/hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"hooks path goes through the symlink '.git/hooks'"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
}

@test "a plain in-tree untracked hooks directory is still refused and a tracked one allowed" {
  plant_hook .hooks
  printf '.hooks/\n' >> .git/info/exclude
  git config core.hooksPath .hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"hooks directory '.hooks' holds untracked or ignored files"* ]]
  git add -f .hooks && git commit -q -m "chore: hooks"
  git push -q origin feature 2>/dev/null
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ -e "$BATS_TEST_TMPDIR/hook.log" ]
}

# --- Credential-bearing network diagnostics ---

# A credential-shaped value assembled from pieces, so no source line holds it.
cred_value() { printf '%s' "Zq9x""Lm4v""Pw7k""Rt2b""Nc8d""Hy5f"; }

# gh_stub_failing_view <stderr-line>: gh pr view <PR> --json headRefOid prints
# the line to stderr and fails; every other call goes to the real stub.
gh_stub_failing_view() {
  mv "$STUB_BIN/gh" "$STUB_BIN/gh.real"
  cat >| "$STUB_BIN/gh" <<STUB
#!/bin/sh
case "\$*" in
  "pr view "*headRefOid*)
    echo '$1' >&2
    exit 1
    ;;
esac
exec "\$(dirname "\$0")/gh.real" "\$@"
STUB
  chmod +x "$STUB_BIN/gh"
}

@test "a token assignment or bearer header in a gh pr view diagnostic never reaches stderr or the JSON output" {
  v=$(cred_value)
  for line in "error: credential helper said token=$v" "Authorization: Bearer $v"; do
    gh_stub_failing_view "$line"
    printf 'one\nfeature\nfix\n' >| src/a.txt
    run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 6 ] || { echo "status $status for: ${line%%$v*}" >&2; return 1; }
    [[ "$stderr" == *"head not verified"* ]]
    [[ "$stderr" != *"$v"* ]]
    [[ "$output" != *"$v"* ]]
    # Back to a clean tree and the real stub for the next form.
    git reset -q --hard "$FIRST_SHA"
    mv "$STUB_BIN/gh.real" "$STUB_BIN/gh"
  done
}

@test "a gh pr view diagnostic is never written to a temp file while the call runs" {
  v=$(cred_value)
  scratch="$BATS_TEST_TMPDIR/tmpdir"
  mkdir -p "$scratch"
  mv "$STUB_BIN/gh" "$STUB_BIN/gh.real"
  cat >| "$STUB_BIN/gh" <<STUB
#!/bin/sh
case "\$*" in
  "pr view "*headRefOid*)
    echo 'error: helper said token=$v' >&2
    # Report a leak to stdout-independent file the test can read.
    if grep -rqF '$v' '$scratch'; then : >| '$scratch/../leaked'; fi
    exit 1
    ;;
esac
exec "\$(dirname "\$0")/gh.real" "\$@"
STUB
  chmod +x "$STUB_BIN/gh"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  TMPDIR="$scratch" run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [ ! -e "$BATS_TEST_TMPDIR/leaked" ]
  [[ "$stderr" != *"$v"* ]]
}

@test "a token assignment or bearer header in a git ls-remote diagnostic never reaches stderr or the JSON output" {
  v=$(cred_value)
  for line in "fatal: helper printed token=$v" "Authorization: Bearer $v"; do
    git_shim_failing "if [ \"\$1\" = ls-remote ]; then echo '$line' >&2; exit 1; fi"
    printf 'one\nfeature\nfix\n' >| src/a.txt
    run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 6 ] || { echo "status $status for: ${line%%$v*}" >&2; return 1; }
    [[ "$stderr" == *"head not verified"* ]]
    [[ "$stderr" != *"$v"* ]]
    [[ "$output" != *"$v"* ]]
    git reset -q --hard "$FIRST_SHA"
    rm -f "$STUB_BIN/git"
  done
}

@test "a diagnostic keeps its non-secret text and the URL userinfo mask once redacted" {
  v=$(cred_value)
  gh_stub_failing_view "fatal: unable to access https://user:$v@example.com/o/r: connection reset"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"connection reset"* ]]
  [[ "$stderr" == *"https://***@example.com"* ]]
  [[ "$stderr" != *"$v"* ]]
}

@test "a diagnostic is capped to 200 characters after redaction" {
  gh_stub_failing_view "fatal: $(printf 'x%.0s' $(seq 1 400))"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [ "$(printf '%s' "$stderr" | grep -o 'x' | wc -l)" -le 200 ]
}

@test "with no credential redactor the diagnostic is withheld, never printed raw (exit 6)" {
  v=$(cred_value)
  # A copy of the plugin with no yellow-core sibling: the redactor cannot load.
  copy="$BATS_TEST_TMPDIR/isolated/yellow-review"
  mkdir -p "$copy/skills/pr-review-workflow"
  cp -R "$RESOLVE_SCRIPTS/../../../lib" "$copy/lib"
  cp -R "$RESOLVE_SCRIPTS" "$copy/skills/pr-review-workflow/scripts"
  gh_stub_failing_view "error: helper said token=$v"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  SCRIPT="$copy/skills/pr-review-workflow/scripts/commit-resolve-fixes"
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"diagnostic withheld: credential redaction unavailable"* ]]
  [[ "$stderr" != *"$v"* ]]
  [[ "$output" != *"$v"* ]]
}

# --- A symlinked ancestor of the runtime override is a runner path ---

@test "--unattended refuses a listed repointing of a symlinked directory in the override path (exit 3)" {
  mkdir -p real-tools evil
  printf '// runtime\n' >| real-tools/rt.js
  printf '// evil\n' >| evil/rt.js
  ln -s real-tools tools
  git add real-tools tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  base=$(git rev-parse HEAD)
  ln -sfn evil tools
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  run_crf --provider github --pr 7 --message "$MSG" --unattended -- tools
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"runner file"* ]]
  [ "$(git rev-parse HEAD)" = "$base" ]
  ! grep -q '^node ' "$STUB_LOG"
}

@test "--unattended refuses the target directory's file behind a symlinked override ancestor (exit 3)" {
  mkdir -p real-tools
  printf '// runtime\n' >| real-tools/rt.js
  ln -s real-tools tools
  git add real-tools tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  base=$(git rev-parse HEAD)
  printf '// edited\n' >> real-tools/rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$(pwd -P)/tools/rt.js"
  run_crf --provider github --pr 7 --message "$MSG" --unattended -- real-tools/rt.js
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"runner file"* ]]
  [ "$(git rev-parse HEAD)" = "$base" ]
  ! grep -q '^node ' "$STUB_LOG"
}

# --- An in-repository runtime override must be tracked and unmodified ---
# rp_tree_changes omits ignored files, so a resolver can rewrite an ignored
# override unseen; the override itself is judged before it can run.

node_calls() { grep -c '^node ' "$STUB_LOG" || true; }

@test "an ignored in-repository runtime override is refused before committing, naming the path (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  printf 'tools/\n' >> .git/info/exclude
  base=$(git rev-parse HEAD)
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"github-stack-runtime override 'tools/rt.js'"* ]]
  [[ "$stderr" != *"// runtime"* ]]
  [ "$(git rev-parse HEAD)" = "$base" ]
  [ "$(node_calls)" = 0 ]
}

@test "an ignored in-repository runtime override is refused whatever form its path takes" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  printf 'tools/\n' >> .git/info/exclude
  printf 'one\nfeature\nfix\n' >| src/a.txt
  for ov in "$(pwd -P)/tools/rt.js" ./tools/../tools/rt.js; do
    export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$ov"
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $ov" >&2; return 1; }
    [[ "$stderr" == *"override 'tools/rt.js'"* ]]
  done
  [ "$(node_calls)" = 0 ]
}

@test "an ignored in-repository symlink to an outside runtime is refused (exit 3)" {
  printf '// runtime\n' >| "$BATS_TEST_TMPDIR/outside-rt.js"
  ln -s "$BATS_TEST_TMPDIR/outside-rt.js" rt-link.js
  printf 'rt-link.js\n' >> .git/info/exclude
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="rt-link.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"override 'rt-link.js'"* ]]
  [ "$(node_calls)" = 0 ]
}

@test "an untracked in-repository runtime override is refused (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  base=$(git rev-parse HEAD)
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [ "$(git rev-parse HEAD)" = "$base" ]
  [ "$(node_calls)" = 0 ]
}

@test "a listed untracked in-repository runtime override is refused by the override check (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  run_crf --provider github --pr 7 --message "$MSG" -- tools/rt.js
  [ "$status" -eq 3 ]
  [ "$(node_calls)" = 0 ]
}

@test "a modified tracked in-repository runtime override is refused (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  git add tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  base=$(git rev-parse HEAD)
  printf '// edited\n' >> tools/rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  run_crf --provider github --pr 7 --message "$MSG" -- tools/rt.js
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"github-stack-runtime override 'tools/rt.js'"* ]]
  [ "$(git rev-parse HEAD)" = "$base" ]
  [ "$(node_calls)" = 0 ]
}

@test "a staged edit to a tracked in-repository runtime override is refused (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  git add tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  printf '// edited\n' >> tools/rt.js
  git add tools/rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [ "$(node_calls)" = 0 ]
}

@test "a tracked override hidden from status by assume-unchanged is refused (exit 3)" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  git add tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  printf '// edited\n' >> tools/rt.js
  git update-index --assume-unchanged tools/rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"override 'tools/rt.js'"* ]]
  [ "$(node_calls)" = 0 ]
}

@test "a clean tracked in-repository runtime override is allowed" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  git add tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(node_calls)" = 1 ]
}

@test "a clean tracked override behind a tracked in-repository symlink is allowed" {
  mkdir -p real-tools
  printf '// runtime\n' >| real-tools/rt.js
  ln -s real-tools tools
  git add real-tools tools && git commit -q -m "feat: runtime" && git push -q origin feature 2>/dev/null
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(node_calls)" = 1 ]
}

@test "a runtime override outside the repository is not judged" {
  printf '// runtime\n' >| "$BATS_TEST_TMPDIR/outside-rt.js"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/outside-rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(node_calls)" = 1 ]
}

@test "a default sibling runtime outside the repository is not judged when no override is set" {
  unset YELLOW_REVIEW_GITHUB_STACK_RUNTIME
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(node_calls)" = 1 ]
}

# The plugin checked into the fixture repository, so find_runtime selects an
# in-repository default runtime (plugins/github-workflow/lib/...).
in_repo_plugin_init() {
  unset YELLOW_REVIEW_GITHUB_STACK_RUNTIME
  mkdir -p plugins/yellow-review/skills/pr-review-workflow plugins/github-workflow/lib
  cp -R "$RESOLVE_SCRIPTS/../../../lib" plugins/yellow-review/lib
  cp -R "$RESOLVE_SCRIPTS" plugins/yellow-review/skills/pr-review-workflow/scripts
  printf '// runtime\n' >| plugins/github-workflow/lib/github-stack-runtime.js
  git add plugins && git commit -q -m "feat: plugins" && git push -q origin feature 2>/dev/null
  SCRIPT="$REPO/plugins/yellow-review/skills/pr-review-workflow/scripts/commit-resolve-fixes"
}

@test "a clean tracked in-repository default runtime is allowed" {
  in_repo_plugin_init
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(node_calls)" = 1 ]
}

@test "a default runtime marked assume-unchanged and modified is refused (exit 3)" {
  in_repo_plugin_init
  base=$(git rev-parse HEAD)
  printf '// edited\n' >> plugins/github-workflow/lib/github-stack-runtime.js
  git update-index --assume-unchanged plugins/github-workflow/lib/github-stack-runtime.js
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"default github-stack-runtime 'plugins/github-workflow/lib/github-stack-runtime.js'"* ]]
  [[ "$stderr" != *"// edited"* ]]
  [ "$(git rev-parse HEAD)" = "$base" ]
  [ "$(node_calls)" = 0 ]
}

@test "a default runtime marked skip-worktree and modified is refused (exit 3)" {
  in_repo_plugin_init
  printf '// edited\n' >> plugins/github-workflow/lib/github-stack-runtime.js
  git update-index --skip-worktree plugins/github-workflow/lib/github-stack-runtime.js
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [ "$(node_calls)" = 0 ]
}

@test "a modified in-repository default runtime is refused (exit 3)" {
  in_repo_plugin_init
  printf '// edited\n' >> plugins/github-workflow/lib/github-stack-runtime.js
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [ "$(node_calls)" = 0 ]
}

@test "the graphite provider ignores the override check" {
  mkdir -p tools
  printf '// runtime\n' >| tools/rt.js
  printf 'tools/\n' >> .git/info/exclude
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

@test "a core.fsmonitor command set in the local git config is not run" {
  marker="$BATS_TEST_TMPDIR/fsmonitor-ran"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$marker" >| "$BATS_TEST_TMPDIR/fsm.sh"
  chmod +x "$BATS_TEST_TMPDIR/fsm.sh"
  git config core.fsmonitor "$BATS_TEST_TMPDIR/fsm.sh"
  # A change outside the expected set stops the run after the early status
  # and tree-listing inspections, before anything is staged.
  printf 'one\nfeature\nfix\n' >| src/a.txt
  printf 'two\nextra\n' >| src/b.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"change outside the expected set"* ]]
  [ ! -e "$marker" ]
}

@test "a core.fsmonitor command is not run by the commit or the stack tools either" {
  marker="$BATS_TEST_TMPDIR/fsmonitor-ran"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$marker" >| "$BATS_TEST_TMPDIR/fsm.sh"
  chmod +x "$BATS_TEST_TMPDIR/fsm.sh"
  git config core.fsmonitor "$BATS_TEST_TMPDIR/fsm.sh"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(git rev-parse HEAD)" != "$FIRST_SHA" ]
  [ ! -e "$marker" ]
}

@test "a pushRemote URL with a query-string credential is not printed (exit 3)" {
  git remote add odd "$ORIGIN"
  git config remote.odd.pushurl 'https://github.com'
  git config branch.feature.pushRemote 'https://github.com/acme/widgets.git?access_token=SECRETVALUE123'
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" != *"SECRETVALUE123"* ]]
  [[ "$stderr" != *"access_token"* ]]
}

# --- The push URL's port ---

@test "a push URL on a different explicit port than the active endpoint is refused before committing (exit 3)" {
  for url in https://github.com:8443/acme/widgets.git \
             ssh://git@github.com:2222/acme/widgets.git \
             http://github.com:8080/acme/widgets.git \
             ssh://git@ssh.github.com:2222/acme/widgets.git; do
    git remote remove hostcase 2>/dev/null || true
    push_via "$url"
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 3 ] || { echo "accepted: $url" >&2; return 1; }
    [[ "$stderr" == *"pushes to a different port than the active GitHub host"* ]]
    [[ "$stderr" != *"8443"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  done
  ! grep -q '^node ' "$STUB_LOG"
}

@test "a port other than the active host's explicit port is refused, the same port accepted" {
  export GH_HOST=git.example:8443
  push_via https://git.example:9443/acme/widgets.git
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"pushes to a different port than the active GitHub host"* ]]
  git remote remove hostcase
  push_via https://git.example:8443/acme/widgets.git
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

@test "a spelled-out scheme default port equals an absent one" {
  n=0
  for url in https://github.com:443/acme/widgets.git \
             ssh://git@github.com:22/acme/widgets.git \
             http://github.com:80/acme/widgets.git; do
    n=$((n + 1))
    git remote remove hostcase 2>/dev/null || true
    push_via "$url"
    printf 'one\nfeature\nfix%s\n' "$n" >| src/a.txt
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "rejected: $url: $stderr" >&2; return 1; }
  done
}

@test "the ssh.github.com:443 alias is accepted for github.com" {
  push_via ssh://git@ssh.github.com:443/acme/widgets.git
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ] || { echo "$stderr" >&2; return 1; }
}

# --- Hardening against hidden or planted resolver changes ---

@test "a clean tracked in-repository plugin lib directory is sourced and the commit goes through" {
  in_repo_plugin_init
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

# lib_tamper <lib>: the lib gets a line that would run when sourced.
lib_tamper() {
  printf 'touch "%s/lib-ran"\n' "$BATS_TEST_TMPDIR" >> "plugins/yellow-review/lib/$1"
}

@test "a modified in-repository lib file is refused before it is sourced (exit 3)" {
  in_repo_plugin_init
  base=$(git rev-parse HEAD)
  lib_tamper resolve-text.sh
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"plugins/yellow-review/lib/resolve-text.sh is not tracked and unmodified"* ]]
  [[ "$stderr" != *"lib-ran"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/lib-ran" ]
  [ "$(git rev-parse HEAD)" = "$base" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "an in-repository lib file marked assume-unchanged and modified is refused (exit 3)" {
  in_repo_plugin_init
  base=$(git rev-parse HEAD)
  lib_tamper resolve-paths.sh
  git update-index --assume-unchanged plugins/yellow-review/lib/resolve-paths.sh
  [ -z "$(git status --porcelain)" ]
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"plugins/yellow-review/lib/resolve-paths.sh is not tracked and unmodified"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/lib-ran" ]
  [ "$(git rev-parse HEAD)" = "$base" ]
}

@test "an in-repository lib file marked skip-worktree and modified is refused (exit 3)" {
  in_repo_plugin_init
  base=$(git rev-parse HEAD)
  lib_tamper verify-run.sh
  git update-index --skip-worktree plugins/yellow-review/lib/verify-run.sh
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"plugins/yellow-review/lib/verify-run.sh is not tracked and unmodified"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/lib-ran" ]
  [ "$(git rev-parse HEAD)" = "$base" ]
}

@test "an in-repository lib file that is no longer tracked is refused (exit 3)" {
  in_repo_plugin_init
  git rm -q --cached plugins/yellow-review/lib/sibling-plugin.sh
  git commit -q -m "chore: untrack"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"plugins/yellow-review/lib/sibling-plugin.sh is not tracked and unmodified"* ]]
}

@test "a plugin lib directory outside the repository is not judged" {
  copy="$BATS_TEST_TMPDIR/outside/yellow-review"
  mkdir -p "$copy/skills/pr-review-workflow"
  cp -R "$RESOLVE_SCRIPTS/../../../lib" "$copy/lib"
  cp -R "$RESOLVE_SCRIPTS" "$copy/skills/pr-review-workflow/scripts"
  printf '# edited\n' >> "$copy/lib/resolve-text.sh"
  SCRIPT="$copy/skills/pr-review-workflow/scripts/commit-resolve-fixes"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

@test "a tracked in-tree hook marked assume-unchanged and edited is not run: the commit disables hooks" {
  for flag in --assume-unchanged --skip-worktree; do
    plant_hook .hooks
    git add .hooks && git commit -q -m "chore: hooks"
    git config core.hooksPath .hooks
    git update-index "$flag" .hooks/pre-commit
    printf 'echo edited >> "%s/hook.log"\n' "$BATS_TEST_TMPDIR" >> .hooks/pre-commit
    [ -z "$(git status --porcelain)" ]
    printf 'one\nfeature\nfix%s\n' "$flag" >| src/a.txt
    run_crf --provider github --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $flag: $stderr" >&2; return 1; }
    [[ "$stderr" == *"git hooks in the .hooks hooks directory are not verified"* ]]
    [ ! -e "$BATS_TEST_TMPDIR/hook.log" ] || { echo "hook ran: $flag" >&2; return 1; }
    git update-index "--no-${flag#--}" .hooks/pre-commit
    git reset -q --hard HEAD
    git config --unset core.hooksPath
    git rm -q -r .hooks && git commit -q -m "chore: drop hooks"
  done
}

@test "a repository-local gpg.program is not run: the commit is made unsigned with a note" {
  marker="$BATS_TEST_TMPDIR/gpg-ran"
  printf '#!/bin/sh\ntouch "%s"\nexit 1\n' "$marker" >| "$BATS_TEST_TMPDIR/evil-gpg"
  chmod +x "$BATS_TEST_TMPDIR/evil-gpg"
  git config commit.gpgsign true
  n=0
  for key in gpg.program gpg.openpgp.program gpg.x509.program gpg.ssh.program; do
    for provider in graphite github; do
      n=$((n + 1))
      git config "$key" "$BATS_TEST_TMPDIR/evil-gpg"
      printf 'one\nfeature\nfix%s\n' "$n" >| src/a.txt
      run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
      [ "$status" -eq 0 ] || { echo "refused: $key $provider: $stderr" >&2; return 1; }
      [[ "$stderr" == *"the commit is made unsigned"* ]]
      [ ! -e "$marker" ] || { echo "program ran: $key $provider" >&2; return 1; }
      ! git cat-file -p HEAD | grep -q '^gpgsig'
    done
    git config --unset "$key"
  done
}

@test "push.gpgSign and log.showSignature are forced off too, so the submit's git never runs a local gpg.program" {
  printf '#!/bin/sh\nexit 1\n' >| "$BATS_TEST_TMPDIR/evil-gpg"
  chmod +x "$BATS_TEST_TMPDIR/evil-gpg"
  git config gpg.program "$BATS_TEST_TMPDIR/evil-gpg"
  git config push.gpgsign true
  git config log.showsignature true
  export STUB_SUBMIT_CONFIG_LOG="$BATS_TEST_TMPDIR/submit-config"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ "$(cat "$STUB_SUBMIT_CONFIG_LOG")" = $'commit.gpgsign=false\npush.gpgsign=false\nlog.showsignature=false' ]
}

@test "a local commit.gpgsign=false is no signing config, a local gpgsign=true beside a global gpg.program is overridden" {
  marker="$BATS_TEST_TMPDIR/gpg-ran"
  printf '#!/bin/sh\ntouch "%s"\nexit 1\n' "$marker" >| "$BATS_TEST_TMPDIR/evil-gpg"
  chmod +x "$BATS_TEST_TMPDIR/evil-gpg"
  # The fixture sets commit.gpgsign=false locally: no signing config, no note.
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [[ "$stderr" != *"made unsigned"* ]]
  # A global gpg.program with a local gpgsign=true is the same attack.
  printf '[gpg]\n\tprogram = %s\n' "$BATS_TEST_TMPDIR/evil-gpg" >| "$BATS_TEST_TMPDIR/global.cfg"
  git config commit.gpgsign true
  printf 'one\nfeature\nfix2\n' >| src/a.txt
  GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global.cfg" run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"the commit is made unsigned"* ]]
  [ ! -e "$marker" ]
}

@test "a signing config that comes only from the global config is left untouched" {
  marker="$BATS_TEST_TMPDIR/gpg-ran"
  # A signer that behaves like gpg for git: a status line on stderr, a signature on stdout.
  cat >| "$BATS_TEST_TMPDIR/user-gpg" <<STUB
#!/bin/sh
touch "$marker"
cat >/dev/null
echo '[GNUPG:] SIG_CREATED ' >&2
printf -- '-----BEGIN PGP SIGNATURE-----\n\nfake\n-----END PGP SIGNATURE-----\n'
STUB
  chmod +x "$BATS_TEST_TMPDIR/user-gpg"
  printf '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = %s\n' "$BATS_TEST_TMPDIR/user-gpg" >| "$BATS_TEST_TMPDIR/global.cfg"
  git config --unset commit.gpgsign
  for provider in graphite github; do
    rm -f "$marker"
    printf 'one\nfeature\nfix-%s\n' "$provider" >| src/a.txt
    GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global.cfg" run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $provider: $stderr" >&2; return 1; }
    [[ "$stderr" != *"made unsigned"* ]]
    [ -e "$marker" ]
    git cat-file -p HEAD | grep -q '^gpgsig'
  done
}

# --- Transport commands in the repository config ---

# refused_untouched <provider>: the run exits 3 and nothing is staged or committed.
crf_refuses_untouched() {
  local head
  head=$(git rev-parse HEAD)
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider "$1" --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 3 ] || { echo "status $status: $stderr" >&2; return 1; }
  [ "$(git rev-parse HEAD)" = "$head" ]
  [ -z "$(git diff --cached --name-only)" ]
  run ! grep -q . "$STUB_LOG"
}

@test "a repository-local transport command is refused, naming the key and never the value" {
  for provider in graphite github; do
    for entry in "core.sshCommand" "core.askPass" "core.gitProxy" "credential.helper" "credential.https://example.com.helper"; do
      git config "$entry" "/bin/echo SECRETVALUE"
      crf_refuses_untouched "$provider" || { echo "not refused: $entry $provider" >&2; return 1; }
      [[ "$stderr" == *"repository config sets"* ]]
      [[ "$stderr" != *SECRETVALUE* ]]
      [[ "$stderr" != *example.com* ]]
      git config --unset "$entry"
    done
  done
}

@test "a repository-local filter command is refused, but the stock git-lfs filters are allowed" {
  for provider in graphite github; do
    for entry in filter.evil.clean filter.evil.smudge filter.evil.process filter.lfs.clean; do
      git config "$entry" "touch $BATS_TEST_TMPDIR/filter-ran; git-lfs clean -- %f"
      crf_refuses_untouched "$provider" || { echo "not refused: $entry $provider" >&2; return 1; }
      [[ "$stderr" == *"repository config sets filter.<driver>."* ]]
      [[ "$stderr" != *filter-ran* ]]
      git config --unset "$entry"
    done
  done
  [ ! -e "$BATS_TEST_TMPDIR/filter-ran" ]
  git config filter.lfs.clean "git-lfs clean -- %f"
  git config filter.lfs.smudge "git-lfs smudge -- %f"
  git config filter.lfs.process "git-lfs filter-process"
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
}

@test "a transport command in a worktree-scope config or an included file is refused too" {
  git config extensions.worktreeConfig true
  git config --worktree core.sshCommand "/bin/echo x"
  crf_refuses_untouched graphite
  [[ "$stderr" == *"core.sshcommand"* ]]
  git config --worktree --unset core.sshCommand
  printf '[credential]\n\thelper = /bin/echo x\n' >| "$BATS_TEST_TMPDIR/inc.cfg"
  git config include.path "$BATS_TEST_TMPDIR/inc.cfg"
  crf_refuses_untouched github
  [[ "$stderr" == *"credential.helper"* ]]
}

@test "a credential.helper from the global config alone is not refused" {
  printf '[credential]\n\thelper = /bin/true\n[core]\n\tsshCommand = /bin/true\n' >| "$BATS_TEST_TMPDIR/global.cfg"
  for provider in graphite github; do
    printf 'one\nfeature\nfix-%s\n' "$provider" >| src/a.txt
    GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global.cfg" run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $provider: $stderr" >&2; return 1; }
  done
}

# --- Tools inside the repository ---

# The tool's stub (or the real binary, for jq) copied into an ignored directory
# of the repository that comes first on PATH.
@test "gt, gh, jq or node found inside the repository is refused, naming the tool" {
  old_path="$PATH"
  printf 'node_modules/\n' >> .git/info/exclude
  for entry in "graphite gt" "graphite gh" "graphite jq" "github node" "github gh"; do
    set -- $entry
    mkdir -p node_modules/.bin
    cp "$(command -v "$2")" "node_modules/.bin/$2"
    PATH="$REPO/node_modules/.bin:$old_path"
    crf_refuses_untouched "$1" || { PATH="$old_path"; echo "not refused: $entry" >&2; return 1; }
    PATH="$old_path"
    [[ "$stderr" == *"$2 resolves to"* ]]
    [[ "$stderr" == *"inside the repository"* ]]
    rm -rf node_modules
  done
}

@test "tools outside the repository still work" {
  for provider in graphite github; do
    printf 'one\nfeature\nfix-%s\n' "$provider" >| src/a.txt
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $provider: $stderr" >&2; return 1; }
  done
}

# gt_stub_submit <stderr-line> <exit>: gt submit prints the line to stderr and
# exits with <exit> (0 publishes as the real stub does); every other gt call
# goes to the real stub.
gt_stub_submit() {
  mv "$STUB_BIN/gt" "$STUB_BIN/gt.real"
  cat >| "$STUB_BIN/gt" <<STUB
#!/bin/sh
case "\$1" in
  submit)
    echo '$1' >&2
    $( [ "$2" = 0 ] && printf 'exec "$(dirname "$0")/gt.real" "$@"' || printf 'exit %s' "$2" )
    ;;
esac
exec "\$(dirname "\$0")/gt.real" "\$@"
STUB
  chmod +x "$STUB_BIN/gt"
}

@test "a credential in a failed gt submit's output never reaches stderr or the JSON output (exit 5)" {
  v=$(cred_value)
  for line in "error: credential helper said token=$v" "Authorization: Bearer $v" "remote: https://user:$v@example.com/o/r.git rejected"; do
    gt_stub_submit "$line" 1
    printf 'one\nfeature\nfix\n' >| src/a.txt
    run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 5 ] || { echo "status $status for: ${line%%$v*}" >&2; return 1; }
    [[ "$stderr" == *"gt submit failed"* ]]
    [[ "$stderr" != *"$v"* ]]
    [[ "$output" != *"$v"* ]]
    git reset -q --hard "$FIRST_SHA"
    mv "$STUB_BIN/gt.real" "$STUB_BIN/gt"
  done
}

@test "gt submit output is shown redacted, and a credential in a successful submit's output is not leaked" {
  v=$(cred_value)
  gt_stub_submit "Pushed feature, helper said token=$v" 0
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"Pushed feature"* ]]
  [[ "$stderr" != *"$v"* ]]
}

@test "with no credential redactor the gt submit output is withheld, never printed raw (exit 5)" {
  v=$(cred_value)
  copy="$BATS_TEST_TMPDIR/isolated/yellow-review"
  mkdir -p "$copy/skills/pr-review-workflow"
  cp -R "$RESOLVE_SCRIPTS/../../../lib" "$copy/lib"
  cp -R "$RESOLVE_SCRIPTS" "$copy/skills/pr-review-workflow/scripts"
  gt_stub_submit "error: helper said token=$v" 1
  printf 'one\nfeature\nfix\n' >| src/a.txt
  SCRIPT="$copy/skills/pr-review-workflow/scripts/commit-resolve-fixes"
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"submit output withheld: credential redaction unavailable"* ]]
  [[ "$stderr" != *"$v"* ]]
}

@test "a credential-shaped commit message is refused before anything is staged (exit 2)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  for provider in graphite github; do
    run_crf --provider "$provider" --pr 7 --message "fix: rotate config password: hunter22x" -- src/a.txt
    [ "$status" -eq 2 ] || { echo "accepted: $provider" >&2; return 1; }
    [[ "$stderr" == *"resolve-text: refused rule="* ]]
    [[ "$stderr" != *"hunter22x"* ]]
    [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
    [ -z "$(git diff --cached --name-only)" ]
  done
  ! grep -q '^node \|^gt modify\|^gt submit' "$STUB_LOG"
}

@test "a message with a mention, an image or a foreign URL is refused, the override does not excuse it (exit 2)" {
  printf 'one\nfeature\nfix\n' >| src/a.txt
  for msg in "fix: thanks @someone for the report" "fix: see ![x](https://github.com/a.png)" "fix: per https://evil.example.com/page"; do
    run_crf --provider graphite --pr 7 --message "$msg" --allow-credential-shaped -- src/a.txt
    [ "$status" -eq 2 ] || { echo "accepted: $msg" >&2; return 1; }
    [[ "$stderr" == *"resolve-text: refused rule="* ]]
  done
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
}

@test "ordinary generated messages pass the message screen" {
  n=0
  for msg in "fix: resolve PR #7 review comments (2 files)" "fix(src/a.txt): resolve PR #7 review comments (1 file)" "fix!: resolve PR #7 review comments"; do
    n=$((n + 1))
    printf 'one\nfeature\nfix%s\n' "$n" >| src/a.txt
    run_crf --provider graphite --pr 7 --message "$msg" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "refused: $msg: $stderr" >&2; return 1; }
  done
}

@test "a scanner failure on the message refuses the commit before anything is staged (exit 2)" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\ncase "$1" in -v) exit 2 ;; esac\nexec %s "$@"\n' "$(command -v awk)" >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  printf 'one\nfeature changed\n' >| src/a.txt
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"resolve-text: scan failed"* ]]
  [ "$(git rev-parse HEAD)" = "$FIRST_SHA" ]
  [ -z "$(git diff --cached --name-only)" ]
}

@test "by default git hooks are disabled, even a tracked hook equal to HEAD, with a note" {
  unset YELLOW_REVIEW_COMMIT_HOOKS
  marker="$BATS_TEST_TMPDIR/hook-ran"
  mkdir -p .hooks
  printf '#!/bin/sh\ntouch "%s"\n' "$marker" >| .hooks/pre-commit
  chmod +x .hooks/pre-commit
  git add .hooks && git commit -q -m "chore: tracked hook" && git push -q origin feature 2>/dev/null
  git config core.hooksPath .hooks
  for provider in graphite github; do
    printf 'one\nfeature\nfix-%s\n' "$provider" >| src/a.txt
    run_crf --provider "$provider" --pr 7 --message "$MSG" -- src/a.txt
    [ "$status" -eq 0 ] || { echo "$provider: $stderr" >&2; return 1; }
    [[ "$stderr" == *"git hooks are disabled for the commit and the submit"* ]]
    [ ! -e "$marker" ] || { echo "hook ran: $provider" >&2; return 1; }
  done
}

@test "YELLOW_REVIEW_COMMIT_HOOKS=1 runs a verified tracked in-tree hook" {
  marker="$BATS_TEST_TMPDIR/hook-ran"
  mkdir -p .hooks
  printf '#!/bin/sh\ntouch "%s"\n' "$marker" >| .hooks/pre-commit
  chmod +x .hooks/pre-commit
  git add .hooks && git commit -q -m "chore: tracked hook" && git push -q origin feature 2>/dev/null
  git config core.hooksPath .hooks
  printf 'one\nfeature\nfix\n' >| src/a.txt
  run_crf --provider graphite --pr 7 --message "$MSG" -- src/a.txt
  [ "$status" -eq 0 ]
  [ -e "$marker" ]
  [[ "$stderr" != *"git hooks are disabled for the commit and the submit"* ]]
}
