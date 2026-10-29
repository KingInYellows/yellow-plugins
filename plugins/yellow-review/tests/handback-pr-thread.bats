#!/usr/bin/env bats
# Tests for handback-pr-thread: posts "@coderabbitai resolve" in CodeRabbit
# threads only, once.

bats_require_minimum_version 1.5.0

load helpers/timeout-stub

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/handback-pr-thread"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export YELLOW_REVIEW_PACE_SECONDS=0
  export YELLOW_REVIEW_RATE_LIMIT_WAIT=0
  unset YELLOW_REVIEW_CODERABBIT_HANDBACK
}

count() {
  cat "${BATS_TEST_TMPDIR}/mock_gh_count_handback_$1" 2>/dev/null || printf 0
}

@test "rejects a missing or malformed thread ID" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" "INVALID_1"
  [ "$status" -eq 2 ]
  run "$SCRIPT" 'PRRT_a b'
  [ "$status" -eq 2 ]
}

@test "posts the bare command in a CodeRabbit thread" {
  run --separate-stderr "$SCRIPT" PRRT_hb_cr
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c .)" = '{"handedBack":true,"commentId":"PRRC_hb","threadId":"PRRT_hb_cr"}' ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_handback_body")" = "@coderabbitai resolve" ]
  [ "$(count reply)" = 1 ]
}

@test "skips threads CodeRabbit did not open" {
  local tid
  for tid in PRRT_hb_human PRRT_hb_otherbot PRRT_hb_ghost; do
    run --separate-stderr "$SCRIPT" "$tid"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r .skipped)" = "not-coderabbit" ]
  done
  [ "$(count reply)" = 0 ]
}

@test "skips a resolved thread" {
  run --separate-stderr "$SCRIPT" PRRT_hb_resolved
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .skipped)" = "resolved" ]
  [ "$(count reply)" = 0 ]
}

@test "skips when the viewer already posted the command" {
  run --separate-stderr "$SCRIPT" PRRT_hb_done
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .skipped)" = "already-handed-back" ]
  [ "$(count reply)" = 0 ]
}

@test "the command quoted by someone else or inside prose is not a prior hand-back" {
  run --separate-stderr "$SCRIPT" PRRT_hb_quoted
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .handedBack)" = "true" ]
}

@test "YELLOW_REVIEW_CODERABBIT_HANDBACK=0 skips without calling gh" {
  YELLOW_REVIEW_CODERABBIT_HANDBACK=0 run --separate-stderr "$SCRIPT" PRRT_hb_cr
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r .skipped)" = "disabled" ]
  [ ! -e "${BATS_TEST_TMPDIR}/mock_gh_any_call" ]
}

@test "a missing thread exits 3 with reason=not-found" {
  run --separate-stderr "$SCRIPT" PRRT_hb_missing
  [ "$status" -eq 3 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=not-found'
}

@test "a forbidden reply exits 3 with reason=permission" {
  run --separate-stderr "$SCRIPT" PRRT_hb_forbidden
  [ "$status" -eq 3 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=permission'
}

@test "a rate limit is retried once, then exits 4" {
  run --separate-stderr "$SCRIPT" PRRT_hb_rl
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  [ "$(count precheck)" = 2 ]
}

@test "a gh timeout exits 4 with reason=timeout" {
  stub_timeout_logging
  run --separate-stderr "$SCRIPT" PRRT_hb_cr
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=timeout'
}
