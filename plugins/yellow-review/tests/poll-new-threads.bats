#!/usr/bin/env bats
# Tests for poll-new-threads

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/poll-new-threads"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  mkdir -p "${BATS_TEST_TMPDIR}/stubs"
  export SLEEP_LOG="${BATS_TEST_TMPDIR}/sleep.log"
  : >"$SLEEP_LOG"
  printf '#!/bin/sh\nprintf "%%s\\n" "$1" >>"$SLEEP_LOG"\n' >"${BATS_TEST_TMPDIR}/stubs/sleep"
  chmod +x "${BATS_TEST_TMPDIR}/stubs/sleep"
  export PATH="${BATS_TEST_TMPDIR}/stubs:${PATH}"
  ROUND1="${BATS_TEST_TMPDIR}/round1"
  OUT="${BATS_TEST_TMPDIR}/out.json"
}

@test "rejects bad usage" {
  run "$SCRIPT" --wait 5 only-three args
  [ "$status" -eq 2 ]
  run "$SCRIPT" "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 2 ]
}

@test "wait 0 fetches exactly once without sleeping" {
  printf 'PRRT_thread1\nPRRT_thread3\nPRRT_thread4\n' >"$ROUND1"
  run "$SCRIPT" --wait 0 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ ! -s "$SLEEP_LOG" ]
  [ -s "$OUT" ]
}

@test "stops at the first fetch that shows a new thread" {
  printf 'PRRT_thread1\n' >"$ROUND1"
  run "$SCRIPT" --wait 60 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"poll t=20 new=1"* ]]
  [[ "$output" == *"repass fetched=1 found=1"* ]]
  [ "$(wc -l <"$SLEEP_LOG")" -eq 1 ]
}

@test "polls until the wait is used up when nothing is new" {
  printf 'PRRT_thread1\nPRRT_thread3\nPRRT_thread4\n' >"$ROUND1"
  run "$SCRIPT" --wait 50 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20,20,10" ]
}

@test "a failed fetch is inconclusive, never no-new-threads" {
  : >"$ROUND1"
  run "$SCRIPT" --wait 0 "o/r" 401 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [ ! -e "$OUT" ]
}

@test "a rate limit exits 4" {
  : >"$ROUND1"
  run "$SCRIPT" --wait 20 "o/r" 429 "$ROUND1" "$OUT"
  [ "$status" -eq 4 ]
  [[ "$output" == *"poll rate-limited"* ]]
}
