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
  run --separate-stderr run_entrypoint check-git-push '{"command":"git push origin main"}'
  [ "$status" -eq 2 ]
  [ -z "$output" ]
  [[ "$stderr" == *"Raw \`git push\` is not allowed"* ]]
  [[ "$stderr" == *"github-stack-submit"* ]]
}

@test "check-git-push: git push after a semicolon is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"command":"echo hi; git push"}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: git push inside a subshell is blocked" {
  run --separate-stderr run_entrypoint check-git-push '{"command":"$(git push)"}'
  [ "$status" -eq 2 ]
}

@test "check-git-push: non-push git commands are allowed" {
  run --separate-stderr run_entrypoint check-git-push '{"command":"git status"}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -z "$stderr" ]
}

@test "check-git-push: adapter submit command is allowed (not raw push)" {
  run --separate-stderr run_entrypoint check-git-push \
    '{"command":"node lib/github-stack-runtime.js submit"}'
  [ "$status" -eq 0 ]
}

@test "check-git-push: malformed JSON fails open (no crash, exit 0)" {
  run --separate-stderr run_entrypoint check-git-push 'not json'
  [ "$status" -eq 0 ]
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
