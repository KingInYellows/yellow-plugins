#!/usr/bin/env bats
# Parity gate for the Node SessionStart runtime (hooks/scripts/entrypoint-*.js)
# against the pre-port bash session-start.sh. Each golden in fixtures/hooks/ was
# captured by running the ORIGINAL bash hook (deleted once this gate is green)
# under a named environment scenario (tests/lib/hook-scenario.bash). Unlike
# gt-workflow's pure envelope->decision hooks, yellow-ci's SessionStart is
# I/O-driven, so a "fixture" is an environment scenario (cwd, routing cache, gh
# mock, result cache), not just a stdin payload — the .stdin envelope is
# constant and (as in the bash hook) not consumed by the SessionStart logic.
#
# STDOUT is compared JSON-semantically (jq -S -c) because the bash hook emitted
# jq's pretty multi-line JSON while the Node port emits compact JSON — the
# decision is what must match, not the byte formatting. STDERR and EXIT_CODE are
# compared exactly. Both entrypoints are checked: SessionStart output is
# identical on both hosts (R36), so they must produce byte-identical results.

bats_require_minimum_version 1.5.0

FIXTURE_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/fixtures/hooks" && pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../hooks/scripts" && pwd)"

setup() {
  load lib/hook-scenario.bash
}

golden_exit_code() { awk -F= '/^EXIT_CODE=/{print $2; exit}' "$1"; }

golden_section() {
  awk -v want="--- $2 ---" '
    $0 == want { grabbing = 1; next }
    /^--- .* ---$/ { grabbing = 0 }
    grabbing { print }
  ' "$1"
}

assert_stdout_matches_golden() {
  local actual="$1" expected="$2"
  if [ -z "$actual" ] && [ -z "$expected" ]; then return 0; fi
  if printf '%s' "$actual" | jq -e . >/dev/null 2>&1 && printf '%s' "$expected" | jq -e . >/dev/null 2>&1; then
    diff <(printf '%s' "$actual" | jq -S -c .) <(printf '%s' "$expected" | jq -S -c .)
    return $?
  fi
  [ "$actual" = "$expected" ]
}

# Run one scenario through one entrypoint and assert stdout/stderr/exit parity.
assert_parity() {
  local case="$1" entrypoint="$2"
  local golden="$FIXTURE_ROOT/$case.golden.txt"
  local sandbox; sandbox="$(mktemp -d "$BATS_TEST_TMPDIR/$case-XXXXXX")"

  hook_scenario_setup "$case" "$sandbox"
  cd "$HOOK_SCENARIO_WORKDIR"

  run --separate-stderr node "$SCRIPTS_DIR/$entrypoint" <"$FIXTURE_ROOT/$case.stdin"

  [ "$status" -eq "$(golden_exit_code "$golden")" ]
  assert_stdout_matches_golden "$output" "$(golden_section "$golden" STDOUT)"
  [ "$stderr" = "$(golden_section "$golden" STDERR)" ]
}

assert_parity_both() {
  assert_parity "$1" entrypoint-claude.js
  assert_parity "$1" entrypoint-codex.js
}

@test "SessionStart parity: no-workflows (early exit)" { assert_parity_both no-workflows; }
@test "SessionStart parity: routing-summary-present" { assert_parity_both routing-summary-present; }
@test "SessionStart parity: routing-summary-absent" { assert_parity_both routing-summary-absent; }
@test "SessionStart parity: gh-missing (routing only)" { assert_parity_both gh-missing; }
@test "SessionStart parity: gh-unauthed (routing only)" { assert_parity_both gh-unauthed; }
@test "SessionStart parity: cache-hit (via legacy read fallback)" { assert_parity_both cache-hit; }
@test "SessionStart parity: cache-miss-failures (routing + failure line)" { assert_parity_both cache-miss-failures; }
@test "SessionStart parity: malformed-gh-json (routing only + stderr warning)" { assert_parity_both malformed-gh-json; }
@test "SessionStart parity: rate-limited-gh (routing only)" { assert_parity_both rate-limited-gh; }
