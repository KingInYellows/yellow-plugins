#!/usr/bin/env bats
# Direct behavior tests for the Node hook runtime
# (hooks/scripts/entrypoint-claude.js). Unlike gt-workflow's
# hook-parity.bats, this is NOT a bash-golden parity harness — there is no
# deleted bash predecessor for github-workflow's hooks to prove parity
# against, since they were authored directly in Node. Cases mirror
# gt-workflow's parity suite's category coverage (plain block, metachar
# forms, allowed-non-push, malformed/null envelope fail-open,
# conventional/non-conventional commit messages, exit-code gating) so the
# two plugins' safety nets stay behaviorally aligned even though this file
# asserts directly rather than against golden fixtures.

bats_require_minimum_version 1.5.0

ENTRYPOINT="$BATS_TEST_DIRNAME/../hooks/scripts/entrypoint-claude.js"

run_entrypoint() {
  local hook="$1" stdin="$2"
  printf '%s' "$stdin" | node "$ENTRYPOINT" --hook "$hook"
}

# --- check-git-push ---

@test "check-git-push: plain git push is allowed" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git push origin main"}}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -z "$stderr" ]
}

@test "check-git-push: git push -u origin <branch> is allowed" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git add -A && git commit -m \"fix: x\" && git push -u origin feat/x"}}'
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
}

@test "check-git-push: force push is blocked with the stack-safety message" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git push --force origin main"}}'
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"can rewrite or delete a remote branch"* ]]
  [[ "$stderr" == *"/github-stack:sync"* ]]
}

@test "check-git-push: every force, mirror and delete form is blocked" {
  local c
  for c in 'git push -f' 'git push -uf origin x' 'git push --force-with-lease' \
    'git push --force-with-lease=main:abc origin main' 'git push --force-if-includes' \
    'git push --forc' 'git push origin +main' 'git push origin +HEAD:main' \
    'git push --mirror' 'git push --delete origin x' 'git push -d origin x' \
    'git push --prune origin' 'git push origin :old' 'git push origin -- +main' \
    'git push && git push -f' 'timeout 60 git push --force'; do
    run --separate-stderr run_entrypoint check-git-push "{\"tool_input\":{\"command\":\"$c\"}}"
    [ "$status" -eq 2 ] || { echo "not blocked: $c"; return 1; }
    [[ "$stderr" == *"can rewrite or delete a remote branch"* ]] || { echo "wrong message: $c"; return 1; }
  done
}

@test "check-git-push: options that only look destructive are allowed" {
  local c
  for c in 'git push --no-force-with-lease origin x' 'git push -o ci.skip origin x' \
    'git push --push-option=force origin x' 'git push --follow-tags origin x' \
    'git push origin feat:feat' 'git push --all origin' 'git push --dry-run origin x'; do
    run --separate-stderr run_entrypoint check-git-push "{\"tool_input\":{\"command\":\"$c\"}}"
    [ "$status" -eq 0 ] || { echo "blocked: $c"; return 1; }
  done
}

@test "check-git-push: a push the hook cannot read in full is blocked" {
  local c
  for c in 'git push origin $BRANCH' 'git push origin $(git branch --show-current)' \
    'git -c remote.origin.mirror=true push' 'git subtree push --prefix x origin y' \
    'git send-pack origin main' 'echo -f | xargs git push' \
    'git push -o $OPTS origin main' 'git push --push-option $OPTS origin main' \
    'git push --repo $R' 'git push -uo $OPTS origin main' \
    'git push --receive-pack=git-receive-pack origin main' 'git push --exec x origin main' \
    'git push --receive origin main' \
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.mirror GIT_CONFIG_VALUE_0=true git push origin' \
    'env GIT_CONFIG_PARAMETERS=x git push origin main' 'export GIT_CONFIG_GLOBAL=/tmp/c; git push' \
    'git push -o <(printf x) --force origin main' \
    "git push \$'--\\\\u0066orce' origin main" "git push \$'--\\\\U00000066orce' origin main"; do
    run --separate-stderr run_entrypoint check-git-push "{\"tool_input\":{\"command\":\"$c\"}}"
    [ "$status" -eq 2 ] || { echo "not blocked: $c"; return 1; }
    [[ "$stderr" == *"cannot check this"* ]] || { echo "wrong message: $c $stderr"; return 1; }
  done
}

@test "check-git-push: a pager that pushes does not hide the outer force push" {
  run --separate-stderr run_entrypoint check-git-push "$(cat <<'JSON'
{"tool_input":{"command":"env PAGER='git push' git push --force"}}
JSON
)"
  [ "$status" -eq 2 ]
}

@test "check-git-push: a plain push inside bash -c is blocked as unreadable" {
  run --separate-stderr run_entrypoint check-git-push "$(cat <<'JSON'
{"tool_input":{"command":"bash -c \"git push\""}}
JSON
)"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"cannot check this"* ]]
}

# Builds a repo whose gh-stack catalog lists feat/a and feat/b, on feat/a.
make_stack_repo() {
  STACK_REPO="$BATS_TEST_TMPDIR/repo"
  git init -q -b feat/a "$STACK_REPO"
  printf '%s' '{"schemaVersion":1,"stacks":[{"trunk":{"branch":"main"},"branches":[{"branch":"feat/a"},{"branch":"feat/b"}]}]}' \
    >"$STACK_REPO/.git/gh-stack"
  mkdir -p "$STACK_REPO/sub"
}

push_in() {
  run --separate-stderr run_entrypoint check-git-push "{\"tool_input\":{\"command\":\"$1\"},\"cwd\":\"$2\"}"
}

@test "check-git-push: a plain push of a stacked branch is allowed with a sync reminder" {
  make_stack_repo
  push_in 'git push' "$STACK_REPO/sub"
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
  [[ "$output" == *'"hookEventName":"PreToolUse"'* ]]
  [[ "$output" == *'feat/a is part of a gh-stack stack'* ]]
  [[ "$output" == *'/github-stack:sync'* ]]
  [[ "$output" != *'permissionDecision'* ]]

  push_in 'git push -u origin refs/heads/feat/b' "$STACK_REPO"
  [ "$status" -eq 0 ]
  [[ "$output" == *'feat/b is part of a gh-stack stack'* ]]
}

@test "check-git-push: a push of a branch outside any stack gets no reminder" {
  make_stack_repo
  push_in 'git push -u origin feat/other' "$STACK_REPO"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -z "$stderr" ]
}

@test "check-git-push: an unreadable gh-stack catalog allows the push without a reminder" {
  make_stack_repo
  printf 'not json' >"$STACK_REPO/.git/gh-stack"
  push_in 'git push' "$STACK_REPO"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "check-git-push: a linked worktree reads the catalog from the common dir" {
  make_stack_repo
  git -C "$STACK_REPO" -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m init
  git -C "$STACK_REPO" worktree add -q -b feat/b-wt "$BATS_TEST_TMPDIR/wt"
  push_in 'git push origin feat/b' "$BATS_TEST_TMPDIR/wt"
  [ "$status" -eq 0 ]
  [[ "$output" == *'feat/b is part of a gh-stack stack'* ]]
}

@test "check-git-push: force push after a semicolon is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"echo hi; git push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push inside a subshell is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"$(git push)"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via absolute-path git is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"/usr/bin/git push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via relative-path git is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"./bin/git push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via git with -C global option is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git -C repo push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via git with --git-dir global option is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir=/x/.git push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via git with space-separated --git-dir value is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir /repo push --force origin main"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via git with space-separated --work-tree value is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --work-tree /repo push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via git with space-separated --namespace value is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --namespace ns push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: force push via attached --git-dir=value form still blocked (regression)" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir=/repo push --force"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: space-separated --git-dir with a non-push subcommand is allowed" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir /repo status"}}'
  [ "$status" -eq 0 ]
}

@test "check-git-push: git with -c config override is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git -c user.name=x push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: an unrelated command containing the word push is allowed" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"grep push file.txt"}}'
  [ "$status" -eq 0 ]
}

@test "check-git-push: non-push git commands are allowed" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git status"}}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -z "$stderr" ]
}

@test "check-git-push: adapter submit command is allowed (not raw push)" {
  run --separate-stderr run_entrypoint check-git-push \
    '{"tool_input":{"command":"node lib/github-stack-runtime.js submit"}}'
  [ "$status" -eq 0 ]
}

# --- check-git-push: tokenised detector (2026-09-17) ---
# Mirrors gt-workflow's tests/fixtures/hooks/check-git-push/ corpus for the
# shared hooks/scripts/lib/git-push-detector.js (byte-identical copy; the
# root tests/integration/git-push-detector-parity.test.ts enforces that).
# Payloads with nested quotes are written as quoted heredocs so no
# backslash pyramid has to be audited by eye.

# $1 = raw JSON envelope; runs check-git-push and asserts the deny exit.
assert_push_blocked() {
  run --separate-stderr run_entrypoint check-git-push "$1"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"⛔"* ]]
}

assert_push_allowed() {
  run --separate-stderr run_entrypoint check-git-push "$1"
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
}

assert_push_unverifiable() {
  run --separate-stderr run_entrypoint check-git-push "$1"
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"Hook could not verify this Bash command"* ]]
}

@test "check-git-push: bash -c \"git push\" is blocked" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"bash -c \"git push\""}}
JSON
)"
}

@test "check-git-push: sh -c 'cd x && git push' is blocked" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"sh -c 'cd x && git push'"}}
JSON
)"
}

@test "check-git-push: shell nested two deep is blocked" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"bash -c \"sh -c 'git push'\""}}
JSON
)"
}

@test "check-git-push: shell nested past the depth cap is blocked even without a push" {
  # Depth > 3 denies unconditionally — the detector will not vouch for a
  # command it has to unwrap four shells to read.
  assert_push_unverifiable "$(cat <<'JSON'
{"tool_input":{"command":"bash -c \"bash -c 'bash -c \\\"bash -c \\\\\\\"echo hi\\\\\\\"\\\"'\""}}
JSON
)"
}

@test "check-git-push: quoted literal echo \"git push\" is allowed" {
  assert_push_allowed "$(cat <<'JSON'
{"tool_input":{"command":"echo \"git push\""}}
JSON
)"
}

@test "check-git-push: heredoc body containing git push is allowed" {
  assert_push_allowed "$(cat <<'JSON'
{"tool_input":{"command":"cat <<'EOF'\ngit push\nEOF"}}
JSON
)"
}

@test "check-git-push: multi-line non-push git commands are allowed" {
  assert_push_allowed '{"tool_input":{"command":"git status\ngit log"}}'
}

# Review-found evasions (2026-09-18), one per lexer feature.

@test "check-git-push: git -C \"\$(pwd)\" push is blocked (substitution inside the outer command)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"git -C \"$(pwd)\" push -f"}}
JSON
)"
}

@test "check-git-push: git 2>&1 push is blocked (redirection before the subcommand)" {
  assert_push_blocked '{"tool_input":{"command":"git 2>&1 push -f"}}'
}

@test "check-git-push: bash <<EOF | tee is blocked (heredoc bound to the declaring segment)" {
  assert_push_blocked '{"tool_input":{"command":"bash <<EOF | tee log\ngit push\nEOF"}}'
}

@test "check-git-push: echo 'git push' | bash is blocked (shell fed by a literal pipe)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"echo 'git push' | bash"}}
JSON
)"
}

@test "check-git-push: { git push; } is blocked (reserved words peeled)" {
  assert_push_blocked '{"tool_input":{"command":"{ git push -f; }"}}'
}

@test "check-git-push: git \$'push' is blocked (ANSI-C quoting)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"git $'push' -f"}}
JSON
)"
}

@test "check-git-push: sudo -s 'git push' is blocked (shell-string wrapper)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"sudo -s 'git push'"}}
JSON
)"
}

@test "check-git-push: git -- push is blocked (git treats -- as end of options)" {
  assert_push_blocked '{"tool_input":{"command":"git -- push -f"}}'
}

@test "check-git-push: bash <(echo git push) is blocked (process substitution as the script)" {
  assert_push_blocked '{"tool_input":{"command":"bash <(echo git push)"}}'
}

@test "check-git-push: echo 'git push' | cat | bash is blocked (cat passes its stdin through)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"echo 'git push' | cat | bash"}}
JSON
)"
}

@test "check-git-push: git {push,origin,main} is blocked (brace expansion decided at runtime)" {
  assert_push_unverifiable '{"tool_input":{"command":"git {push,origin,main}"}}'
}

@test "check-git-push: git -c core.pager='git push' log is blocked (git runs the config value)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"git -c core.pager='git push' log"}}
JSON
)"
}

@test "check-git-push: exec 3<<X … then bash /dev/fd/3 is blocked (script descriptor has no source on the reader)" {
  assert_push_unverifiable "$(cat <<'JSON'
{"tool_input":{"command":"exec 3<<'X'\ngit push origin HEAD\nX\nbash /dev/fd/3"}}
JSON
)"
}

@test "check-git-push: git -c alias.x='!bash /dev/fd/3' x 3<<T keeps the heredoc (a push in it is blocked)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"git -c alias.x='!bash /dev/fd/3' x 3<<'T'\ngit push\nT"}}
JSON
)"
}

@test "check-git-push: the fd-3 wrapper with a harmless body is allowed" {
  assert_push_allowed "$(cat <<'JSON'
{"tool_input":{"command":"bash /dev/fd/3 3<<'T'\necho hi\nT"}}
JSON
)"
}

@test "check-git-push: a glob case pattern (*)) is allowed (patterns are matched, not run)" {
  assert_push_allowed '{"tool_input":{"command":"case \"$1\" in R*|C*) echo a ;; *) echo b ;; esac"}}'
}

@test "check-git-push: diff <(git status) <(git log) is allowed (process substitution of non-push commands)" {
  assert_push_allowed '{"tool_input":{"command":"diff <(git status) <(git log)"}}'
}

@test "check-git-push: cat <<EOF with \$(git push) in the body is blocked (expanding heredoc)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"cat <<EOF\n$(git push -f)\nEOF"}}
JSON
)"
}

@test "check-git-push: git rebase --exec 'git push' is blocked (git runs the operand)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"git rebase -i --exec 'git push' HEAD~3"}}
JSON
)"
}

@test "check-git-push: { echo 'git push'; echo done; } | bash is blocked (pipe from a whole group is opaque)" {
  assert_push_unverifiable "$(cat <<'JSON'
{"tool_input":{"command":"{ echo 'git push'; echo done; } | bash"}}
JSON
)"
}

@test "check-git-push: git submodule foreach 'git status' is allowed (operand does not push)" {
  assert_push_allowed "$(cat <<'JSON'
{"tool_input":{"command":"git submodule foreach 'git status'"}}
JSON
)"
}

@test "check-git-push: envelope missing tool_input fails open (defensive; real envelopes always have it)" {
  run --separate-stderr run_entrypoint check-git-push '{"command":"git push origin main"}'
  [ "$status" -eq 0 ]
}

@test "check-git-push: malformed JSON fails open (no crash, exit 0)" {
  run --separate-stderr run_entrypoint check-git-push 'not json'
  [ "$status" -eq 0 ]
}

@test "check-git-push: present-but-non-string tool_input.command fails closed (exit 2)" {
  # Distinct from the two fail-open cases above: the field is PRESENT but
  # a shape the policy cannot verify, so it denies (mirrors gt-workflow)
  # instead of the pre-2026-09-17 coercion to '' that allowed it.
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":{"nested":"git push"}}}'
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"non-string tool_input.command"* ]]
}

@test "check-git-push: null envelope does not crash" {
  run --separate-stderr run_entrypoint check-git-push 'null'
  [ "$status" -eq 0 ]
}

# --- check-commit-message ---

@test "check-commit-message: conventional message is silently allowed" {
  run --separate-stderr run_entrypoint check-commit-message \
    '{"tool_input":{"command":"git commit -m \"feat: add thing\""},"tool_result":{"exit_code":0}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue":true'* ]]
  [[ "$output" != *"systemMessage"* ]]
}

@test "check-commit-message: non-conventional message warns" {
  run --separate-stderr run_entrypoint check-commit-message \
    '{"tool_input":{"command":"git commit -m \"did stuff\""},"tool_result":{"exit_code":0}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"systemMessage"* ]]
  [[ "$output" == *"conventional commits"* ]]
}

@test "check-commit-message: nonzero exit code skips validation" {
  run --separate-stderr run_entrypoint check-commit-message \
    '{"tool_input":{"command":"git commit -m \"did stuff\""},"tool_result":{"exit_code":1}}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"systemMessage"* ]]
}

@test "check-commit-message: missing exit code defaults to validating (fail-closed)" {
  run --separate-stderr run_entrypoint check-commit-message \
    '{"tool_input":{"command":"git commit -m \"did stuff\""}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"systemMessage"* ]]
}

@test "check-commit-message: non-commit git command is silently allowed" {
  run --separate-stderr run_entrypoint check-commit-message \
    '{"tool_input":{"command":"git status"},"tool_result":{"exit_code":0}}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"systemMessage"* ]]
}

@test "check-commit-message: codex tool_response exit code is honored" {
  run --separate-stderr run_entrypoint check-commit-message \
    '{"tool_input":{"command":"git commit -m \"did stuff\""},"tool_response":{"exit_code":1}}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"systemMessage"* ]]
}

@test "check-commit-message: null envelope does not crash" {
  run --separate-stderr run_entrypoint check-commit-message 'null'
  [ "$status" -eq 0 ]
  [[ "$output" == *'"continue":true'* ]]
}
