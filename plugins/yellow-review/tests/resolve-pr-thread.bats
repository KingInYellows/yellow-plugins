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
  rm -f "${BATS_TEST_TMPDIR}"/mock_gh_count_resolve_*
}

# Put a sleep stub first on PATH; it appends each requested duration to
# $SLEEP_LOG instead of waiting.
stub_sleep() {
  mkdir -p "${BATS_TEST_TMPDIR}/stubs"
  export SLEEP_LOG="${BATS_TEST_TMPDIR}/sleep.log"
  : >"$SLEEP_LOG"
  printf '#!/bin/sh\nprintf "%%s\\n" "$1" >>"$SLEEP_LOG"\n' >"${BATS_TEST_TMPDIR}/stubs/sleep"
  chmod +x "${BATS_TEST_TMPDIR}/stubs/sleep"
  export PATH="${BATS_TEST_TMPDIR}/stubs:${PATH}"
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

@test "--help prints exit codes and env vars and exits 0" {
  run --separate-stderr "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Exit codes:"* ]]
  [[ "$output" == *"reason=permission"* ]]
  [[ "$output" == *"YELLOW_REVIEW_PACE_SECONDS"* ]]
  [[ "$output" == *"YELLOW_REVIEW_RATE_LIMIT_WAIT"* ]]
}

@test "thread not found exits 3 with reason=not-found" {
  run --separate-stderr "$SCRIPT" "PRRT_notfound"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"Thread not found: PRRT_notfound"* ]]
  [[ "$stderr" == *$'\nreason=not-found'* ]]
}

@test "a permission error exits 3 with reason=permission" {
  run --separate-stderr "$SCRIPT" "PRRT_forbidden"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"Not permitted to resolve thread: PRRT_forbidden"* ]]
  [[ "$stderr" == *$'\nreason=permission'* ]]
}

@test "a plain 403 exits 3 with reason=permission" {
  run --separate-stderr "$SCRIPT" "PRRT_plain403"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"reason=permission"* ]]
}

@test "a 403 whose text mentions not found is a permission error" {
  run --separate-stderr "$SCRIPT" "PRRT_403notfoundtext"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"reason=permission"* ]]
}

@test "an authentication failure exits 1 with a login hint" {
  run --separate-stderr "$SCRIPT" "PRRT_auth401"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"gh auth login"* ]]
}

@test "a generic failure exits 1 with gh's message" {
  run --separate-stderr "$SCRIPT" "PRRT_generic500"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"GraphQL mutation failed"* ]]
  [[ "$stderr" == *"HTTP 500"* ]]
}

@test "a bare HTTP 429 is retried once, then exits 4" {
  run --separate-stderr "$SCRIPT" "PRRT_bare429"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_429")" = 2 ]
}

@test "a rate limit is retried once, then exits 4" {
  run "$SCRIPT" "PRRT_ratelimited"
  [ "$status" -eq 4 ]
  [[ "$output" == *"rate limit"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl")" = 2 ]
}

@test "a single rate limit succeeds on the retry after one notice" {
  run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .resolved)" = true ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl_once")" = 2 ]
  [[ "$stderr" == *"Rate limited; retrying once in 0s"* ]]
}

@test "a GraphQL-level rate limit is retried once, then exits 4" {
  run "$SCRIPT" "PRRT_gqlratelimit"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_gqlrl")" = 2 ]
}

@test "a GraphQL rate limit with gh exit 0 is retried once, then exits 4" {
  run "$SCRIPT" "PRRT_gqlrl_exit0"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_gqlrl_exit0")" = 2 ]
}

@test "a Retry-After within 90 s is honoured over the default wait" {
  run --separate-stderr "$SCRIPT" "PRRT_rl_header"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying once in 1s"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl_header")" = 2 ]
}

@test "a Retry-After over 90 s exits 4 without retrying" {
  run --separate-stderr "$SCRIPT" "PRRT_rl_long"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"exceeds 90s"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl_long")" = 1 ]
}

# --- x-ratelimit-reset wait source ---

@test "a reset time in the future sets the wait to the seconds remaining" {
  stub_sleep
  run --separate-stderr "$SCRIPT" "PRRT_rl_reset"
  [ "$status" -eq 0 ]
  [[ "$stderr" =~ retrying\ once\ in\ (29|30)s ]]
  grep -qE '^(29|30)$' "$SLEEP_LOG"
}

@test "a reset time in the past retries after 0 s" {
  stub_sleep
  run --separate-stderr "$SCRIPT" "PRRT_rl_resetpast"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying once in 0s"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_PRRT_rl_resetpast")" = 2 ]
  # Every recorded sleep (rate-limit wait and pacing) must be 0.
  [ -s "$SLEEP_LOG" ]
  ! grep -qvx 0 "$SLEEP_LOG"
}

@test "a reset time over the 90 s cap exits 4 without retrying" {
  stub_sleep
  run --separate-stderr "$SCRIPT" "PRRT_rl_resetfar"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"exceeds 90s"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_PRRT_rl_resetfar")" = 1 ]
  # No sleep of any duration happened before the exit.
  [ ! -s "$SLEEP_LOG" ]
}

# --- Rate-limit wait fallback and cap ---

@test "the rate-limit wait defaults to 60 s" {
  stub_sleep
  unset YELLOW_REVIEW_RATE_LIMIT_WAIT
  run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying once in 60s"* ]]
  grep -qx 60 "$SLEEP_LOG"
}

@test "an invalid rate-limit wait falls back to 60 s" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=soon run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 0 ]
  grep -qx 60 "$SLEEP_LOG"
}

@test "YELLOW_REVIEW_RATE_LIMIT_WAIT sets the wait (3 s)" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=3 run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 0 ]
  grep -qx 3 "$SLEEP_LOG"
}

@test "a rate-limit wait of exactly 90 s is allowed" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=90 run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 0 ]
  grep -qx 90 "$SLEEP_LOG"
}

@test "a rate-limit wait over 90 s exits 4 without retrying or sleeping" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=91 run --separate-stderr "$SCRIPT" "PRRT_ratelimit_once"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"exceeds 90s"* ]]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_rl_once")" = 1 ]
  ! grep -qx 91 "$SLEEP_LOG"
}

# --- Pacing ---

@test "YELLOW_REVIEW_PACE_SECONDS sets the pacing sleep" {
  stub_sleep
  YELLOW_REVIEW_PACE_SECONDS=3 run "$SCRIPT" "PRRT_valid"
  [ "$status" -eq 0 ]
  [ "$(cat "$SLEEP_LOG")" = 3 ]
}

@test "pacing defaults to 1 s" {
  stub_sleep
  unset YELLOW_REVIEW_PACE_SECONDS
  run "$SCRIPT" "PRRT_valid"
  [ "$status" -eq 0 ]
  [ "$(cat "$SLEEP_LOG")" = 1 ]
}

@test "an invalid pacing value falls back to 1 s and the call still succeeds" {
  stub_sleep
  YELLOW_REVIEW_PACE_SECONDS=-2 run "$SCRIPT" "PRRT_valid"
  [ "$status" -eq 0 ]
  [ "$(cat "$SLEEP_LOG")" = 1 ]
}

@test "a huge pacing value is capped at 10 s" {
  stub_sleep
  YELLOW_REVIEW_PACE_SECONDS=999999999999 run "$SCRIPT" "PRRT_valid"
  [ "$status" -eq 0 ]
  [ "$(cat "$SLEEP_LOG")" = 10 ]
}

# --- Typed GraphQL errors ---

@test "a GraphQL NOT_FOUND error (gh exit 1) exits 3 with reason=not-found" {
  run --separate-stderr "$SCRIPT" "PRRT_gqlnotfound"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"reason=not-found"* ]]
}

@test "a GraphQL FORBIDDEN error (gh exit 1) exits 3 with reason=permission" {
  run --separate-stderr "$SCRIPT" "PRRT_gqlforbidden"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"reason=permission"* ]]
}

@test "a GraphQL NOT_FOUND error with gh exit 0 exits 3 with reason=not-found" {
  run --separate-stderr "$SCRIPT" "PRRT_gqlnf_exit0"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"reason=not-found"* ]]
}

@test "a GraphQL FORBIDDEN error with gh exit 0 exits 3 with reason=permission" {
  run --separate-stderr "$SCRIPT" "PRRT_gqlfb_exit0"
  [ "$status" -eq 3 ]
  [[ "$stderr" == *"reason=permission"* ]]
}

@test "a gh call that times out exits 4 without retrying" {
  mkdir -p "${BATS_TEST_TMPDIR}/tobin"
  printf '#!/bin/sh\nexit 124\n' >| "${BATS_TEST_TMPDIR}/tobin/timeout"
  chmod +x "${BATS_TEST_TMPDIR}/tobin/timeout"
  PATH="${BATS_TEST_TMPDIR}/tobin:${PATH}" run --separate-stderr "$SCRIPT" "PRRT_ok"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"timed out"* ]]
  [ ! -f "${BATS_TEST_TMPDIR}/mock_gh_count_resolve_ok" ]
}
