#!/usr/bin/env bats
# Parity gate for the Node hook runtime (hooks/scripts/entrypoint-claude.js)
# against plugins/gt-workflow/hooks/check-git-push.sh and
# check-commit-message.sh's pre-rewrite behavior. Each golden file was
# captured by running the ORIGINAL bash script (now deleted, see git
# history) against its matching fixture; this harness proves the Node port
# reproduces the same decisions rather than keeping two live
# implementations (before/after-golden pattern, mirrors
# plugins/yellow-core/tests/plan-status-parity.bats).
#
# Golden files use a 3-section EXIT_CODE / STDOUT / STDERR format (not the
# plan-status precedent's stdout-only shape) because these hooks encode
# their decision in exit code (git-push) and/or stderr (git-push's block
# message), not stdout alone.
#
# STDOUT comparison is JSON-semantic (jq -S -c, sorted/compact), not raw
# byte diff: the original check-commit-message.sh mixed a hardcoded
# `{"continue": true}` literal (silent-allow path) with jq -n's
# pretty-printed multi-line output (warn path) — an inconsistency in the
# bash script itself, not a contract worth reproducing byte-for-byte. STDERR
# and EXIT_CODE are compared exactly, since git-push's block message is
# plain text, not JSON.
#
# check-git-push/missing-jq is intentionally excluded: Node's entrypoint has
# no jq dependency, so there is no equivalent failure mode to test against —
# the fixture+golden are retained only as bash-behavior documentation.
# check-git-push/malformed-json's STDERR is excluded from comparison: the
# golden's stderr line is jq's own parse-error diagnostic text, an
# implementation detail the Node port (which uses JSON.parse, not jq) has no
# equivalent for; EXIT_CODE and STDOUT (both empty) still prove the
# fail-open decision matches.
#
# null-envelope (both hooks) is NOT a bash-parity fixture — it is a
# regression test for a Node-only crash a code review caught (PR #661):
# JSON.parse('null') succeeds without throwing, so a bare `null` stdin
# payload skipped the parse-failure catch block and crashed on
# `null.command`/`null.toolInput` inside the policy function. Its golden
# reflects run-hook.js's actual fixed output directly (there is no deleted
# bash script to have captured a "true" answer from for this case).
#
# check-git-push's fixtures are NOT bash-parity captures since 2026-09-16.
# The deleted bash script read `.command` at the envelope root — a field no
# host sends — so its goldens proved parity with a shape that never fires.
# The *.stdin files now carry the real nested `tool_input.command` shape
# and their goldens are the Node contract for it; only
# root-level-command-ignored still represents the deleted script's shape,
# pinned as non-blocking. Do not re-capture these goldens from the bash
# script: it would invert them. See
# docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md.

bats_require_minimum_version 1.5.0

FIXTURE_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/fixtures/hooks" && pwd)"
ENTRYPOINT="$BATS_TEST_DIRNAME/../hooks/scripts/entrypoint-claude.js"
CODEX_ENTRYPOINT="$BATS_TEST_DIRNAME/../hooks/scripts/entrypoint-codex.js"

run_entrypoint() {
  local hook="$1" stdin_file="$2"
  node "$ENTRYPOINT" --hook "$hook" < "$stdin_file"
}

golden_exit_code() {
  awk -F= '/^EXIT_CODE=/{print $2; exit}' "$1"
}

# Extracts the body of one "--- SECTION ---"-delimited block from a golden
# file (SECTION is STDOUT or STDERR).
golden_section() {
  local golden_file="$1" section="$2"
  awk -v want="--- $section ---" '
    $0 == want { grabbing=1; next }
    /^--- .* ---$/ { grabbing=0 }
    grabbing { print }
  ' "$golden_file"
}

# Both empty -> pass. Both parse as JSON -> compare canonicalized. Anything
# else -> raw string compare (defensive; no current fixture exercises this).
assert_stdout_matches_golden() {
  local actual="$1" expected="$2"
  if [ -z "$actual" ] && [ -z "$expected" ]; then
    return 0
  fi
  if printf '%s' "$actual" | jq -e . >/dev/null 2>&1 && printf '%s' "$expected" | jq -e . >/dev/null 2>&1; then
    diff <(printf '%s' "$actual" | jq -S -c .) <(printf '%s' "$expected" | jq -S -c .)
    return $?
  fi
  [ "$actual" = "$expected" ]
}

assert_parity() {
  local hook="$1" case="$2" fixdir="$FIXTURE_ROOT/$1"
  local golden="$fixdir/$case.golden.txt"

  run --separate-stderr run_entrypoint "$hook" "$fixdir/$case.stdin"

  [ "$status" -eq "$(golden_exit_code "$golden")" ]
  assert_stdout_matches_golden "$output" "$(golden_section "$golden" STDOUT)"
  [ "$stderr" = "$(golden_section "$golden" STDERR)" ]
}

# --- check-git-push ---

@test "check-git-push: plain-block matches golden" {
  assert_parity check-git-push plain-block
}

@test "check-git-push: metachar-semicolon matches golden" {
  assert_parity check-git-push metachar-semicolon
}

@test "check-git-push: metachar-and matches golden" {
  assert_parity check-git-push metachar-and
}

@test "check-git-push: metachar-subshell matches golden" {
  assert_parity check-git-push metachar-subshell
}

@test "check-git-push: allowed-non-push matches golden" {
  assert_parity check-git-push allowed-non-push
}

@test "check-git-push: malformed-json matches golden (exit code + stdout only)" {
  local fixdir="$FIXTURE_ROOT/check-git-push"
  local golden="$fixdir/malformed-json.golden.txt"

  run --separate-stderr run_entrypoint check-git-push "$fixdir/malformed-json.stdin"

  [ "$status" -eq "$(golden_exit_code "$golden")" ]
  assert_stdout_matches_golden "$output" "$(golden_section "$golden" STDOUT)"
  # STDERR intentionally not compared — see file header.
}

@test "check-git-push: missing-jq is excluded from Node parity (no jq dependency to fail)" {
  skip "Node's entrypoint has no jq dependency; this fixture documents prior bash-only behavior only"
}

@test "check-git-push: null-envelope does not crash (regression, PR #661)" {
  assert_parity check-git-push null-envelope
}

@test "check-git-push: root-level command (the deleted bash script's shape) is ignored, not blocked" {
  # Pins the deleted script's flat shape as non-blocking so the field path
  # cannot silently regress — see the header for the 2026-09-16 history.
  assert_parity check-git-push root-level-command-ignored
}

@test "check-git-push: real host PreToolUse envelope blocks a raw git push (exit 2)" {
  # Full envelope as Claude Code and Codex both send it (session_id,
  # hook_event_name, tool_name, nested tool_input.command).
  assert_parity check-git-push real-host-envelope
}

@test "check-git-push: real host PreToolUse envelope on the Codex entrypoint emits hookSpecificOutput deny" {
  # The Codex formatter emits a JSON decision on stdout with exit 0 instead
  # of exit 2 + stderr; same policy, same fixture, different output contract.
  run --separate-stderr node "$CODEX_ENTRYPOINT" --hook check-git-push < "$FIXTURE_ROOT/check-git-push/real-host-envelope.stdin"
  [ "$status" -eq 0 ]
  [ -z "$stderr" ]
  [ "$(printf '%s' "$output" | jq -r '.hookSpecificOutput.permissionDecision')" = "deny" ]
  [ "$(printf '%s' "$output" | jq -r '.hookSpecificOutput.hookEventName')" = "PreToolUse" ]
  printf '%s' "$output" | jq -e '.hookSpecificOutput.permissionDecisionReason | test("Raw `git push` is not allowed")' >/dev/null
}

@test "check-git-push: present-but-non-string tool_input.command fails closed (exit 2)" {
  # A shape no host sends for Bash; the policy cannot verify it, so it
  # denies like run-hook.js's truncation path instead of coercing it to ''.
  assert_parity check-git-push non-string-command
}

# --- check-git-push: tokenised detector (2026-09-17) ---
# These fixtures are Node-contract goldens for hooks/scripts/lib/
# git-push-detector.js, which replaced the substring regex. Deny cases are
# the evasions the regex missed; allow cases are the quoted/heredoc
# literals the regex over-blocked. tests/integration/
# git-push-detector-parity.test.ts runs the same *.stdin corpus through
# both plugins' detector copies.

@test "check-git-push: path-qualified /usr/bin/git push is blocked" {
  assert_parity check-git-push path-qualified-git
}

@test "check-git-push: git -C dir push is blocked" {
  assert_parity check-git-push global-option-C
}

@test "check-git-push: git -c k=v push is blocked" {
  assert_parity check-git-push global-option-c
}

@test "check-git-push: git --git-dir=x push is blocked" {
  assert_parity check-git-push global-option-git-dir
}

@test "check-git-push: bash -c \"git push\" is blocked" {
  assert_parity check-git-push bash-c-string
}

@test "check-git-push: sh -c 'cd x && git push' is blocked" {
  assert_parity check-git-push sh-c-chain
}

@test "check-git-push: shell nested two deep is blocked" {
  assert_parity check-git-push nested-shell-depth-2
}

@test "check-git-push: shell nested past the depth cap is blocked even without a push" {
  # Depth > 3 denies unconditionally — the detector will not vouch for a
  # command it has to unwrap four shells to read.
  assert_parity check-git-push nested-shell-depth-4-cap
}

@test "check-git-push: quoted literal echo \"git push\" is allowed" {
  assert_parity check-git-push quoted-literal
}

@test "check-git-push: heredoc body containing git push is allowed" {
  assert_parity check-git-push heredoc-literal
}

@test "check-git-push: multi-line non-push git commands are allowed" {
  assert_parity check-git-push multi-line-non-push
}

@test "check-git-push: gt submit is allowed" {
  assert_parity check-git-push gt-submit
}

@test "check-git-push: git -C dir status is allowed" {
  assert_parity check-git-push global-option-C-status
}

# Review-found evasions (2026-09-18): one fixture per lexer feature the
# first tokeniser lacked. The vitest parity corpus holds the full list.

@test "check-git-push: git -C \"\$(pwd)\" push is blocked (substitution inside the outer command)" {
  assert_parity check-git-push substitution-in-option-value
}

@test "check-git-push: git 2>&1 push is blocked (redirection before the subcommand)" {
  assert_parity check-git-push redirection-before-subcommand
}

@test "check-git-push: bash <<EOF | tee is blocked (heredoc bound to the declaring segment)" {
  assert_parity check-git-push heredoc-shell-piped
}

@test "check-git-push: echo 'git push' | bash is blocked (shell fed by a literal pipe)" {
  assert_parity check-git-push piped-literal-script
}

@test "check-git-push: { git push; } is blocked (reserved words peeled)" {
  assert_parity check-git-push reserved-word-group
}

@test "check-git-push: git \$'push' is blocked (ANSI-C quoting)" {
  assert_parity check-git-push ansi-c-quoted-subcommand
}

@test "check-git-push: sudo -s 'git push' is blocked (shell-string wrapper)" {
  assert_parity check-git-push sudo-shell-string
}

@test "check-git-push: cat <<EOF with \$(git push) in the body is blocked (expanding heredoc)" {
  assert_parity check-git-push heredoc-expanding-substitution
}

@test "check-git-push: cat <<'EOF' with \$(git push) in the body is allowed (quoted delimiter, no expansion)" {
  assert_parity check-git-push heredoc-quoted-delimiter-substitution
}

@test "check-git-push: git rebase --exec 'git push' is blocked (git runs the operand)" {
  assert_parity check-git-push git-rebase-exec
}

@test "check-git-push: git submodule foreach 'git push' is blocked (git runs the operand)" {
  assert_parity check-git-push git-submodule-foreach
}

@test "check-git-push: git subtree push is blocked (a push under another name)" {
  assert_parity check-git-push git-subtree-push
}

@test "check-git-push: { echo 'git push'; echo done; } | bash is blocked (pipe from a whole group is opaque)" {
  assert_parity check-git-push group-piped-into-shell
}

@test "check-git-push: echo 'git push' | bash -c 'bash -c sh' is blocked (stdin inherited two shells down)" {
  assert_parity check-git-push stdin-inherited-two-shells-down
}

@test "check-git-push: git -- push is blocked (git treats -- as end of options and runs push)" {
  assert_parity check-git-push end-of-options-then-push
}

@test "check-git-push: bash <(echo git push) is blocked (process substitution as the script)" {
  assert_parity check-git-push process-substitution-script
}

@test "check-git-push: echo 'git push' | cat | bash is blocked (cat passes its stdin through)" {
  assert_parity check-git-push cat-passthrough-pipe
}

@test "check-git-push: git {push,origin,main} is blocked (brace expansion decided at runtime)" {
  assert_parity check-git-push brace-expansion-subcommand
}

@test "check-git-push: git -c core.pager='git push' log is blocked (git runs the config value)" {
  assert_parity check-git-push git-config-pager-value
}

# --- check-commit-message ---

@test "check-commit-message: conventional-allow-silent matches golden" {
  assert_parity check-commit-message conventional-allow-silent
}

@test "check-commit-message: non-conventional-warn matches golden" {
  assert_parity check-commit-message non-conventional-warn
}

@test "check-commit-message: multi-m-first-only matches golden" {
  assert_parity check-commit-message multi-m-first-only
}

@test "check-commit-message: double-quoted-m matches golden" {
  assert_parity check-commit-message double-quoted-m
}

@test "check-commit-message: single-quoted-m matches golden" {
  assert_parity check-commit-message single-quoted-m
}

@test "check-commit-message: nonzero-exit-skip matches golden" {
  assert_parity check-commit-message nonzero-exit-skip
}

@test "check-commit-message: missing-exit-code-validates matches golden" {
  assert_parity check-commit-message missing-exit-code-validates
}

@test "check-commit-message: null-envelope does not crash (regression, PR #661)" {
  assert_parity check-commit-message null-envelope
}

@test "check-commit-message: codex-tool-response-nonzero-exit-skip matches golden (regression, PR #661)" {
  # Codex's documented hook stdin uses tool_response (not Claude's
  # tool_result) for the result envelope. Not a bash-parity fixture — no
  # deleted bash script ever read this field; it proves the Node policy
  # honors Codex's exit_code shape instead of always defaulting to 0.
  assert_parity check-commit-message codex-tool-response-nonzero-exit-skip
}
