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

@test "check-git-push: plain git push is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git push origin main"}}'
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"Raw \`git push\` is not allowed"* ]]
  [[ "$stderr" == *"github-stack-submit"* ]]
}

@test "check-git-push: git push after a semicolon is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"echo hi; git push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git push inside a subshell is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"$(git push)"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: absolute-path git is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"/usr/bin/git push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: relative-path git is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"./bin/git push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git with -C global option is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git -C repo push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git with --git-dir global option is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir=/x/.git push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git with space-separated --git-dir value is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir /repo push origin main"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git with space-separated --work-tree value is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --work-tree /repo push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git with space-separated --namespace value is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --namespace ns push"}}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: attached --git-dir=value form still blocked (regression)" {
  run --separate-stderr run_entrypoint check-git-push '{"tool_input":{"command":"git --git-dir=/repo push"}}'
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
  [[ "$stderr" == *"Raw \`git push\` is not allowed"* ]]
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
{"tool_input":{"command":"git -C \"$(pwd)\" push"}}
JSON
)"
}

@test "check-git-push: git 2>&1 push is blocked (redirection before the subcommand)" {
  assert_push_blocked '{"tool_input":{"command":"git 2>&1 push"}}'
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
  assert_push_blocked '{"tool_input":{"command":"{ git push; }"}}'
}

@test "check-git-push: git \$'push' is blocked (ANSI-C quoting)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"git $'push'"}}
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
  assert_push_blocked '{"tool_input":{"command":"git -- push"}}'
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

@test "check-git-push: diff <(git status) <(git log) is allowed (process substitution of non-push commands)" {
  assert_push_allowed '{"tool_input":{"command":"diff <(git status) <(git log)"}}'
}

@test "check-git-push: cat <<EOF with \$(git push) in the body is blocked (expanding heredoc)" {
  assert_push_blocked "$(cat <<'JSON'
{"tool_input":{"command":"cat <<EOF\n$(git push)\nEOF"}}
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
