#!/usr/bin/env bats
# Tests for resolve-pr-thread GraphQL script

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/resolve-pr-thread"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  export YELLOW_REVIEW_PACE_SECONDS=0
  export YELLOW_REVIEW_RATE_LIMIT_WAIT=0
  rm -f "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl" "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_gqlrl"
}

# --- Input validation ---

@test "rejects missing arguments" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "rejects invalid thread ID prefix" {
  run "$SCRIPT" "INVALID_thread1"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Invalid thread ID format"* ]]
}

@test "rejects empty thread ID" {
  run "$SCRIPT" ""
  [ "$status" -eq 2 ]
}

# --- Successful resolution ---

@test "resolves thread and returns JSON" {
  run "$SCRIPT" "PRRT_valid"
  [ "$status" -eq 0 ]

  resolved=$(printf '%s' "$output" | jq -r '.resolved')
  [ "$resolved" = "true" ]

  thread_id=$(printf '%s' "$output" | jq -r '.threadId')
  [ "$thread_id" = "PRRT_valid" ]
}

# --- Idempotent resolution ---

@test "treats already-resolved thread as success" {
  run "$SCRIPT" "PRRT_resolved"
  [ "$status" -eq 0 ]

  resolved=$(printf '%s' "$output" | jq -r '.resolved')
  [ "$resolved" = "true" ]
}

# --- Error handling ---

@test "handles thread not found with exit 3" {
  run "$SCRIPT" "PRRT_notfound"
  [ "$status" -eq 3 ]
}

@test "a permission error exits 3" {
  run "$SCRIPT" "PRRT_forbidden"
  [ "$status" -eq 3 ]
}

@test "a rate limit is retried once, then exits 4" {
  run "$SCRIPT" "PRRT_ratelimited"
  [ "$status" -eq 4 ]
  [[ "$output" == *"rate limit"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl")" = 2 ]
}

@test "a single rate limit succeeds on the retry" {
  run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .resolved)" = true ]
}

@test "a GraphQL-level rate limit is retried once, then exits 4" {
  run "$SCRIPT" "PRRT_gqlratelimit"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_gqlrl")" = 2 ]
}

@test "a GraphQL NOT_FOUND error exits 3" {
  run "$SCRIPT" "PRRT_gqlnotfound"
  [ "$status" -eq 3 ]
}

@test "a GraphQL FORBIDDEN error exits 3" {
  run "$SCRIPT" "PRRT_gqlforbidden"
  [ "$status" -eq 3 ]
}
