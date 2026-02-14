#!/usr/bin/env bats
# Tests for get-pr-comments GraphQL script

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/get-pr-comments"

setup() {
  # Put mock gh on PATH before real gh
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  export BATS_TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
}

teardown() {
  # Clean up pagination state files
  rm -f "${BATS_TEST_TMPDIR}/mock_gh_pr300_page" 2>/dev/null || true
}

# --- Input validation ---

@test "rejects missing arguments" {
  run "$SCRIPT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "rejects invalid repo format (no slash)" {
  run "$SCRIPT" "noslash" "123"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid repo format"* ]]
}

@test "rejects empty owner" {
  run "$SCRIPT" "/repo" "123"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Invalid repo format"* ]]
}

@test "rejects non-numeric PR number" {
  run "$SCRIPT" "owner/repo" "abc"
  [ "$status" -eq 1 ]
  [[ "$output" == *"PR number must be numeric"* ]]
}

# --- Successful responses ---

@test "filters to unresolved non-outdated threads only" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]

  # Should include thread1 (unresolved, not outdated) and thread4
  thread_count=$(printf '%s' "$output" | jq 'length')
  [ "$thread_count" -eq 2 ]

  # Verify thread IDs
  ids=$(printf '%s' "$output" | jq -r '.[].threadId')
  [[ "$ids" == *"PRRT_thread1"* ]]
  [[ "$ids" == *"PRRT_thread4"* ]]
}

@test "excludes resolved threads" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]

  # thread2 is resolved — should not appear
  ids=$(printf '%s' "$output" | jq -r '.[].threadId')
  [[ "$ids" != *"PRRT_thread2"* ]]
}

@test "excludes outdated threads" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]

  # thread3 is outdated — should not appear
  ids=$(printf '%s' "$output" | jq -r '.[].threadId')
  [[ "$ids" != *"PRRT_thread3"* ]]
}

@test "handles null author gracefully" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]

  # thread4 has a null author comment — should fall back to "ghost"
  ghost=$(printf '%s' "$output" | jq -r '.[] | select(.threadId == "PRRT_thread4") | .comments[] | select(.author == "ghost") | .author')
  [ "$ghost" = "ghost" ]
}

@test "returns empty array for no threads" {
  run "$SCRIPT" "test/repo" "200"
  [ "$status" -eq 0 ]

  count=$(printf '%s' "$output" | jq 'length')
  [ "$count" -eq 0 ]
}

@test "includes path and line info in output" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]

  path=$(printf '%s' "$output" | jq -r '.[0].path')
  line=$(printf '%s' "$output" | jq '.[0].line')
  [ "$path" = "src/main.ts" ]
  [ "$line" -eq 42 ]
}

# --- Error handling ---

@test "handles authentication failure" {
  run "$SCRIPT" "test/repo" "401"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Authentication failed"* ]]
}

@test "handles not-found error" {
  run "$SCRIPT" "test/repo" "999"
  [ "$status" -eq 1 ]
}

# --- Pagination ---

@test "accumulates threads across multiple pages" {
  run "$SCRIPT" "test/repo" "300"
  [ "$status" -eq 0 ]

  # Page 1: thread1 (unresolved, not outdated) + thread2 (resolved — filtered)
  # Page 2: thread3 (unresolved, not outdated) + thread4 (outdated — filtered)
  # Expected: 2 unresolved non-outdated threads total
  thread_count=$(printf '%s' "$output" | jq 'length')
  [ "$thread_count" -eq 2 ]

  # Verify threads from both pages are present
  ids=$(printf '%s' "$output" | jq -r '.[].threadId')
  [[ "$ids" == *"PRRT_mp_thread1"* ]]
  [[ "$ids" == *"PRRT_mp_thread3"* ]]
}

@test "warns on null cursor with hasNextPage true" {
  # Capture stderr separately to check for warning
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_350"
  run bash -c "'$SCRIPT' test/repo 350 2>'$stderr_file'"
  [ "$status" -eq 0 ]

  # Should still return the available threads
  thread_count=$(printf '%s' "$output" | jq 'length')
  [ "$thread_count" -eq 1 ]

  # Should warn about truncation on stderr
  [[ "$(cat "$stderr_file")" == *"pagination truncated"* ]]
}
