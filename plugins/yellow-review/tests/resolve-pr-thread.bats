#!/usr/bin/env bats
# Tests for resolve-pr-thread GraphQL script

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/resolve-pr-thread"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  export YELLOW_REVIEW_PACE_SECONDS=0
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

@test "a rate limit exits 4" {
  run "$SCRIPT" "PRRT_ratelimited"
  [ "$status" -eq 4 ]
  [[ "$output" == *"rate limit"* ]]
}
