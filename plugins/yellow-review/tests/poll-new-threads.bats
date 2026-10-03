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

# --- Fake get-pr-comments: the script runs the sibling next to itself, so
# these tests copy it beside a stub that replays FAKE_RESULTS, one per call
# (the last repeats): "ok:<id,id>", "fail", "badjson".
fake_setup() {
  FAKE_DIR="${BATS_TEST_TMPDIR}/fake"
  mkdir -p "$FAKE_DIR"
  cp "$SCRIPT" "$FAKE_DIR/poll-new-threads"
  cat >"$FAKE_DIR/get-pr-comments" <<'EOS'
#!/bin/bash
n=$(( $(cat "$FAKE_STATE" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$n" >"$FAKE_STATE"
IFS='|' read -ra results <<<"$FAKE_RESULTS"
r="${results[$((n - 1))]:-${results[$((${#results[@]} - 1))]}}"
case "$r" in
  ok:*) printf '%s' "${r#ok:}" | jq -Rc 'split(",") | map(select(. != "") | {threadId: .})' ;;
  partial:*) printf '%s' "${r#partial:}" | jq -Rc 'split(",") | map(select(. != "") | {threadId: .})'
             echo "get-pr-comments: deadline reached" >&2; exit 3 ;;
  notfound) echo "Error: Pull request not found" >&2; exit 1 ;;
  badjson) printf 'not json' ;;
  *) echo "boom" >&2; exit 1 ;;
esac
EOS
  chmod +x "$FAKE_DIR/get-pr-comments"
  export FAKE_STATE="${BATS_TEST_TMPDIR}/fake_state"
  rm -f "$FAKE_STATE"
}

@test "rejects a non-numeric or missing --wait and unknown options" {
  : >"$ROUND1"
  run "$SCRIPT" --wait abc "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --wait "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --wait 0 --interval 5 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 2 ]
}

@test "an oversized or out-of-range --wait exits 2 instead of spinning" {
  : >"$ROUND1"
  run "$SCRIPT" --wait 99999999999999999999 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --wait 481 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -eq 2 ]
  run "$SCRIPT" --wait 480 "o/r" 123 "$ROUND1" "$OUT"
  [ "$status" -ne 2 ]
}

@test "a get-pr-comments exit 3 partial array is never read as a complete fetch" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  FAKE_RESULTS="partial:PRRT_a,PRRT_b" run "$FAKE_DIR/poll-new-threads" --wait 40 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [ ! -e "$OUT" ]
}

@test "a not-found failure stops the loop after one wait" {
  fake_setup
  : >"$ROUND1"
  FAKE_RESULTS="notfound" run "$FAKE_DIR/poll-new-threads" --wait 100 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [ "$(wc -l <"$SLEEP_LOG")" -eq 1 ]
}

@test "an unreadable round-1 file exits 2" {
  run "$SCRIPT" --wait 0 "o/r" 123 "${BATS_TEST_TMPDIR}/missing" "$OUT"
  [ "$status" -eq 2 ]
}

@test "unparseable fetch output is inconclusive, never no-new-threads" {
  fake_setup
  : >"$ROUND1"
  FAKE_RESULTS="badjson" run "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [ ! -e "$OUT" ]
}

@test "mixed outcomes: a failed fetch and bad JSON are skipped, then a later fetch finds the new thread" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  FAKE_RESULTS="fail|badjson|ok:PRRT_a,PRRT_b" run "$FAKE_DIR/poll-new-threads" --wait 100 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"poll t=60 new=1"* ]]
  [[ "$output" == *"repass fetched=1 found=1"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20,20,20" ]
}

@test "a failure after a success keeps fetched=1 with the earlier output" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  FAKE_RESULTS="ok:PRRT_a|fail" run "$FAKE_DIR/poll-new-threads" --wait 40 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ "$(jq -r '.[0].threadId' "$OUT")" = "PRRT_a" ]
}

@test "blank and CRLF round-1 lines do not hide a new thread or fake one" {
  fake_setup
  printf 'PRRT_a\r\n\r\n\nPRRT_b\r\n' >"$ROUND1"
  FAKE_RESULTS="ok:PRRT_a,PRRT_b" run "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  FAKE_RESULTS="ok:PRRT_a,PRRT_c" run "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=1"* ]]
}

@test "a failed copy to the out file resets fetched" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  FAKE_RESULTS="ok:PRRT_a,PRRT_b" run "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "${BATS_TEST_TMPDIR}/no-such-dir/out.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
}

@test "a secondary rate limit (HTTP 403) from the fetch exits 4" {
  : >"$ROUND1"
  run "$SCRIPT" --wait 0 "o/r" 403 "$ROUND1" "$OUT"
  [ "$status" -eq 4 ]
  [[ "$output" == *"poll rate-limited"* ]]
}

# --- Wall-clock bound: a fake clock (FAKE_NOW) that both sleep and the
# get-pr-comments stub advance, so slow fetches eat into the --wait budget.
clock_setup() {
  fake_setup
  export FAKE_NOW="${BATS_TEST_TMPDIR}/now"
  printf '1000' >"$FAKE_NOW"
  cat >"$FAKE_DIR/get-pr-comments" <<'EOS'
#!/bin/bash
echo $(( $(cat "$FAKE_NOW") + FETCH_COST )) >|"$FAKE_NOW"
echo '[{"threadId":"PRRT_a"}]'
EOS
  printf '#!/bin/sh\ncat "$FAKE_NOW"\n' >"${BATS_TEST_TMPDIR}/stubs/date"
  printf '#!/bin/sh\nprintf "%%s\\n" "$1" >>"$SLEEP_LOG"\necho $(( $(cat "$FAKE_NOW") + $1 )) >"$FAKE_NOW"\n' >"${BATS_TEST_TMPDIR}/stubs/sleep"
  chmod +x "$FAKE_DIR/get-pr-comments" "${BATS_TEST_TMPDIR}/stubs/date" "${BATS_TEST_TMPDIR}/stubs/sleep"
}

@test "a slow fetch that passes the deadline ends polling without another round" {
  clock_setup
  printf 'PRRT_a\n' >"$ROUND1"
  FETCH_COST=40 run "$FAKE_DIR/poll-new-threads" --wait 50 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20" ]
  [ "$(cat "$FAKE_NOW")" -eq 1060 ]
}

@test "fetch time shrinks the next sleep to the remaining wait" {
  clock_setup
  printf 'PRRT_a\n' >"$ROUND1"
  FETCH_COST=15 run "$FAKE_DIR/poll-new-threads" --wait 50 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20,15" ]
}

# --- Failed-fetch diagnostics and permanent failures ---

@test "an authentication failure is reported and stops polling early" {
  : >"$ROUND1"
  run --separate-stderr "$SCRIPT" --wait 100 "o/r" 401 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [[ "$stderr" == *"poll fetch-failed: Error: Authentication failed"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20" ]
}

@test "a permission failure stops polling early" {
  : >"$ROUND1"
  run --separate-stderr "$SCRIPT" --wait 100 "o/r" 431 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [[ "$stderr" == *"Insufficient permissions"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20" ]
}

@test "a transient server error is reported but polling continues" {
  : >"$ROUND1"
  run --separate-stderr "$SCRIPT" --wait 40 "o/r" 502 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [[ "$stderr" == *"GitHub server error"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20,20" ]
}

@test "the forwarded fetch error is capped at 300 bytes" {
  fake_setup
  : >"$ROUND1"
  cat >"$FAKE_DIR/get-pr-comments" <<'EOS'
#!/bin/bash
printf 'x%.0s' $(seq 1 1000) >&2
exit 1
EOS
  run --separate-stderr "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [ "${#stderr}" -le 330 ]
  [[ "$stderr" == "poll fetch-failed: xxx"* ]]
}

# --- Per-fetch time limit ---

# bin_setup <dir-name> <tool...>: a PATH directory holding only the named
# tools (symlinks) so a real timeout(1) on the host cannot leak in.
bin_setup() {
  BIN_DIR="${BATS_TEST_TMPDIR}/$1"
  shift
  mkdir -p "$BIN_DIR"
  local t
  for t in "$@"; do
    ln -s "$(command -v "$t")" "$BIN_DIR/$t"
  done
}

BASE_TOOLS="bash dirname mktemp tr grep rm date jq head cp cat"

# A fake time-limit binary: records its duration argument and exits 124
# without running get-pr-comments, as the real one does on expiry.
make_expiring_timeout() {
  printf '#!/bin/sh\nprintf "%%s\\n" "$1" >>"$TIMEOUT_LOG"\nexit 124\n' >"${BIN_DIR}/$1"
  chmod +x "${BIN_DIR}/$1"
}

@test "a timed-out fetch stops polling and still prints the final status" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  export TIMEOUT_LOG="${BATS_TEST_TMPDIR}/timeout.log"
  : >"$TIMEOUT_LOG"
  bin_setup bin-timeout $BASE_TOOLS
  make_expiring_timeout timeout
  PATH="${BIN_DIR}:${BATS_TEST_TMPDIR}/stubs" FAKE_RESULTS="ok:PRRT_a" \
    run --separate-stderr "$FAKE_DIR/poll-new-threads" --wait 100 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [[ "$stderr" == *"poll fetch-failed: get-pr-comments timed out after 60s"* ]]
  [ "$(paste -sd, "$SLEEP_LOG")" = "20" ]
  [ "$(cat "$TIMEOUT_LOG")" = "60" ]
  [ ! -e "$OUT" ]
}

@test "the fetch hard cap is 60 s whatever YELLOW_REVIEW_GH_TIMEOUT says" {
  fake_setup
  : >"$ROUND1"
  export TIMEOUT_LOG="${BATS_TEST_TMPDIR}/timeout.log"
  bin_setup bin-timeout $BASE_TOOLS
  make_expiring_timeout timeout
  local v
  for v in 7 0 9999; do
    : >"$TIMEOUT_LOG"
    PATH="${BIN_DIR}:${BATS_TEST_TMPDIR}/stubs" YELLOW_REVIEW_GH_TIMEOUT=$v \
      run "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
    [ "$status" -eq 0 ]
    [ "$(cat "$TIMEOUT_LOG")" = "60" ]
  done
}

@test "get-pr-comments gets its own 55 s pagination deadline, overriding the caller's env" {
  fake_setup
  : >"$ROUND1"
  # Record the deadline the child sees, then behave as a normal fetch.
  sed -i '2a printf "%s\\n" "${YELLOW_REVIEW_FETCH_DEADLINE:-unset}" >>"$DEADLINE_LOG"' "$FAKE_DIR/get-pr-comments"
  export DEADLINE_LOG="${BATS_TEST_TMPDIR}/deadline.log"
  : >"$DEADLINE_LOG"
  YELLOW_REVIEW_FETCH_DEADLINE=270 FAKE_RESULTS="ok:PRRT_a" \
    run "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [ "$(cat "$DEADLINE_LOG")" = "55" ]
}

@test "a timeout after a successful fetch keeps fetched=1 with the earlier output" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  bin_setup bin-timeout $BASE_TOOLS
  # Run the command on the first call, expire on later ones.
  cat >"${BIN_DIR}/timeout" <<'EOS'
#!/bin/sh
n=$(( $(cat "$TIMEOUT_STATE" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$n" >"$TIMEOUT_STATE"
shift
[ "$n" -eq 1 ] && exec "$@"
exit 124
EOS
  chmod +x "${BIN_DIR}/timeout"
  export TIMEOUT_STATE="${BATS_TEST_TMPDIR}/timeout_state"
  rm -f "$TIMEOUT_STATE"
  PATH="${BIN_DIR}:${BATS_TEST_TMPDIR}/stubs" FAKE_RESULTS="ok:PRRT_a" \
    run "$FAKE_DIR/poll-new-threads" --wait 100 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ "$(jq -r '.[0].threadId' "$OUT")" = "PRRT_a" ]
}

@test "gtimeout alone bounds the fetch" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  export TIMEOUT_LOG="${BATS_TEST_TMPDIR}/timeout.log"
  : >"$TIMEOUT_LOG"
  bin_setup bin-gtimeout $BASE_TOOLS
  make_expiring_timeout gtimeout
  PATH="${BIN_DIR}:${BATS_TEST_TMPDIR}/stubs" FAKE_RESULTS="ok:PRRT_a" \
    run --separate-stderr "$FAKE_DIR/poll-new-threads" --wait 0 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=0 found=0"* ]]
  [[ "$stderr" == *"timed out after 60s"* ]]
  [ "$(cat "$TIMEOUT_LOG")" = "60" ]
}

@test "without timeout or gtimeout the fetch runs unbounded with one stderr note" {
  fake_setup
  printf 'PRRT_a\n' >"$ROUND1"
  bin_setup bin-none $BASE_TOOLS
  PATH="${BIN_DIR}:${BATS_TEST_TMPDIR}/stubs" FAKE_RESULTS="ok:PRRT_a" \
    run --separate-stderr "$FAKE_DIR/poll-new-threads" --wait 40 "o/r" 1 "$ROUND1" "$OUT"
  [ "$status" -eq 0 ]
  [[ "$output" == *"repass fetched=1 found=0"* ]]
  [ "$(grep -c 'neither timeout nor gtimeout' <<<"$stderr")" -eq 1 ]
}
