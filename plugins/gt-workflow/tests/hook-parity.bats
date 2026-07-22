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

bats_require_minimum_version 1.5.0

FIXTURE_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/fixtures/hooks" && pwd)"
ENTRYPOINT="$BATS_TEST_DIRNAME/../hooks/scripts/entrypoint-claude.js"

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
  local hook="$1" case="$2" fixdir="$FIXTURE_ROOT/$3"
  local golden="$fixdir/$case.golden.txt"

  run --separate-stderr run_entrypoint "$hook" "$fixdir/$case.stdin"

  [ "$status" -eq "$(golden_exit_code "$golden")" ]
  assert_stdout_matches_golden "$output" "$(golden_section "$golden" STDOUT)"
  [ "$stderr" = "$(golden_section "$golden" STDERR)" ]
}

# --- check-git-push ---

@test "check-git-push: plain-block matches golden" {
  assert_parity check-git-push plain-block check-git-push
}

@test "check-git-push: metachar-semicolon matches golden" {
  assert_parity check-git-push metachar-semicolon check-git-push
}

@test "check-git-push: metachar-and matches golden" {
  assert_parity check-git-push metachar-and check-git-push
}

@test "check-git-push: metachar-subshell matches golden" {
  assert_parity check-git-push metachar-subshell check-git-push
}

@test "check-git-push: allowed-non-push matches golden" {
  assert_parity check-git-push allowed-non-push check-git-push
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
  assert_parity check-git-push null-envelope check-git-push
}

# --- check-commit-message ---

@test "check-commit-message: conventional-allow-silent matches golden" {
  assert_parity check-commit-message conventional-allow-silent check-commit-message
}

@test "check-commit-message: non-conventional-warn matches golden" {
  assert_parity check-commit-message non-conventional-warn check-commit-message
}

@test "check-commit-message: multi-m-first-only matches golden" {
  assert_parity check-commit-message multi-m-first-only check-commit-message
}

@test "check-commit-message: double-quoted-m matches golden" {
  assert_parity check-commit-message double-quoted-m check-commit-message
}

@test "check-commit-message: single-quoted-m matches golden" {
  assert_parity check-commit-message single-quoted-m check-commit-message
}

@test "check-commit-message: nonzero-exit-skip matches golden" {
  assert_parity check-commit-message nonzero-exit-skip check-commit-message
}

@test "check-commit-message: missing-exit-code-validates matches golden" {
  assert_parity check-commit-message missing-exit-code-validates check-commit-message
}

@test "check-commit-message: null-envelope does not crash (regression, PR #661)" {
  assert_parity check-commit-message null-envelope check-commit-message
}
