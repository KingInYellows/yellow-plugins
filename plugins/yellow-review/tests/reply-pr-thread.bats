#!/usr/bin/env bats
# Tests for reply-pr-thread (marker, idempotency, size cap, rate-limit retry)

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/reply-pr-thread"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  export YELLOW_REVIEW_PACE_SECONDS=0
  export YELLOW_REVIEW_RATE_LIMIT_WAIT=0
  BODY="${BATS_TEST_TMPDIR}/body.txt"
  printf 'Fixed in abc1234.\n' >| "$BODY"
  POSTED="${BATS_TEST_TMPDIR}/mock_gh_reply_body"
  CALLS="${BATS_TEST_TMPDIR}/mock_gh_count_reply"
  rm -f "$POSTED" "$CALLS"
}

# --- Usage ---

@test "rejects missing arguments with exit 2" {
  run "$SCRIPT" PRRT_reply_new fixed
  [ "$status" -eq 2 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "rejects a thread ID without the PRRT_ prefix" {
  run "$SCRIPT" PRR_abc fixed "$BODY"
  [ "$status" -eq 2 ]
}

@test "rejects a thread ID with marker-breaking characters" {
  run "$SCRIPT" 'PRRT_a-->x' fixed "$BODY"
  [ "$status" -eq 2 ]
}

@test "rejects an unknown disposition" {
  run "$SCRIPT" PRRT_reply_new done "$BODY"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Unknown disposition"* ]]
}

@test "rejects a missing body file" {
  run "$SCRIPT" PRRT_reply_new fixed "${BATS_TEST_TMPDIR}/nope"
  [ "$status" -eq 2 ]
}

@test "rejects an empty body" {
  printf '  \n' >| "$BODY"
  run "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 2 ]
}

@test "rejects a body over 1000 characters and makes no API call" {
  head -c 1001 /dev/zero | tr '\0' 'a' >| "$BODY"
  run "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 2 ]
  [[ "$output" == *"limit is 1000"* ]]
  [ ! -f "$CALLS" ]
}

@test "counts characters, not bytes, for the size cap" {
  # 1000 two-byte characters are within the cap.
  printf 'é%.0s' $(seq 1 1000) >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
}

# --- Posting ---

@test "appends the marker to the posted body" {
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .commentId, .threadId]')" = '[true,"PRRC_new","PRRT_reply_new"]' ]
  [ "$(head -n 1 "$POSTED")" = "Fixed in abc1234." ]
  [ "$(tail -n 1 "$POSTED")" = "<!-- yellow-review:resolve v1 thread=PRRT_reply_new disposition=fixed -->" ]
}

@test "skips when our marker is already the last comment" {
  run --separate-stderr "$SCRIPT" PRRT_reply_done fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped]')" = '[false,"already-replied"]' ]
  [ ! -f "$CALLS" ]
}

@test "posts again when our last marker has a different disposition" {
  run --separate-stderr "$SCRIPT" PRRT_reply_done unclear "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
}

@test "a marker quoted in a reviewer comment does not cause a skip" {
  run --separate-stderr "$SCRIPT" PRRT_reply_spoof fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  [ "$(cat "$CALLS")" = 1 ]
}

@test "a missing thread exits 3" {
  run --separate-stderr "$SCRIPT" PRRT_reply_gone fixed "$BODY"
  [ "$status" -eq 3 ]
}

@test "a permission error on the reply exits 3" {
  run --separate-stderr "$SCRIPT" PRRT_reply_forbidden fixed "$BODY"
  [ "$status" -eq 3 ]
}

@test "refuses a body that looks like a credential, before any API call" {
  printf 'Fixed. Token was ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"credential"* ]]
  [ ! -f "$CALLS" ]
}

# --- Rate limits ---

@test "retries once after a 429 with Retry-After" {
  run --separate-stderr "$SCRIPT" PRRT_reply_rl fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS")" = 2 ]
  [[ "$stderr" == *"retrying in 0s"* ]]
}

@test "retries once after a GraphQL rate-limit error returned with HTTP 200" {
  run --separate-stderr "$SCRIPT" PRRT_reply_gqlrl fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS")" = 2 ]
}

@test "the single retry is shared by the pre-check and the reply" {
  rm -f "${BATS_TEST_TMPDIR}/mock_gh_count_precheck_rlboth"
  run --separate-stderr "$SCRIPT" PRRT_reply_rlboth fixed "$BODY"
  [ "$status" -eq 4 ]
  # Pre-check limited then retried; the reply's first limit is not retried.
  [ "$(cat "$CALLS")" = 1 ]
}

@test "a second rate limit exits 4 after exactly one retry" {
  run --separate-stderr "$SCRIPT" PRRT_reply_rl2 fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "$CALLS")" = 2 ]
}
