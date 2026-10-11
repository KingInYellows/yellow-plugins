#!/usr/bin/env bats
# Tests for reply-pr-thread (marker, idempotency, size cap, rate-limit retry)

bats_require_minimum_version 1.5.0

load helpers/timeout-stub

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

# Put a sleep stub first on PATH that logs its argument instead of waiting.
stub_sleep() {
  mkdir -p "${BATS_TEST_TMPDIR}/sleepbin"
  printf '#!/bin/sh\nprintf "%%s\\n" "$1" >> "%s/sleep_log"\n' "$BATS_TEST_TMPDIR" >| "${BATS_TEST_TMPDIR}/sleepbin/sleep"
  chmod +x "${BATS_TEST_TMPDIR}/sleepbin/sleep"
  export PATH="${BATS_TEST_TMPDIR}/sleepbin:${PATH}"
  SLEEP_LOG="${BATS_TEST_TMPDIR}/sleep_log"
  rm -f "$SLEEP_LOG"
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
  # The mock logs every gh invocation, so this proves gh never ran at all.
  [ ! -f "${BATS_TEST_TMPDIR}/mock_gh_any_call" ]
}

@test "counts characters, not bytes, for the size cap" {
  # 1000 two-byte characters are within the cap.
  printf 'é%.0s' $(seq 1 1000) >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
}

@test "a body of exactly 1000 ASCII characters is accepted" {
  head -c 1000 /dev/zero | tr '\0' 'a' >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
}

@test "1001 multibyte characters are rejected with exit 2" {
  printf 'é%.0s' $(seq 1 1001) >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"limit is 1000"* ]]
  [ ! -f "${BATS_TEST_TMPDIR}/mock_gh_any_call" ]
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

@test "skips when our last marker has a different disposition and reports it" {
  run --separate-stderr "$SCRIPT" PRRT_reply_done unclear "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","fixed"]' ]
  [ ! -f "$CALLS" ]
}

@test "a prior unclear marker does not block a fixed reply" {
  run --separate-stderr "$SCRIPT" PRRT_reply_priorunclear fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .threadId]')" = '[true,"PRRT_reply_priorunclear"]' ]
  [ "$(tail -n 1 "$POSTED")" = "<!-- yellow-review:resolve v1 thread=PRRT_reply_priorunclear disposition=fixed -->" ]
}

@test "a prior disagree marker does not block an addressed or oos reply" {
  for d in addressed oos; do
    rm -f "$POSTED" "$CALLS"
    run --separate-stderr "$SCRIPT" PRRT_reply_priordisagree "$d" "$BODY"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
    [ "$(tail -n 1 "$POSTED")" = "<!-- yellow-review:resolve v1 thread=PRRT_reply_priordisagree disposition=$d -->" ]
  done
}

@test "a prior oos marker does not block a fixed or addressed reply" {
  for d in fixed addressed; do
    rm -f "$POSTED" "$CALLS"
    run --separate-stderr "$SCRIPT" PRRT_reply_prioroos "$d" "$BODY"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
    [ "$(tail -n 1 "$POSTED")" = "<!-- yellow-review:resolve v1 thread=PRRT_reply_prioroos disposition=$d -->" ]
  done
}

@test "a prior oos marker still skips a disagree or unclear reply" {
  for d in disagree unclear; do
    rm -f "$POSTED" "$CALLS"
    run --separate-stderr "$SCRIPT" PRRT_reply_prioroos "$d" "$BODY"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","oos"]' ]
    [ ! -f "$CALLS" ]
  done
}

@test "a prior oos marker still skips an oos reply" {
  run --separate-stderr "$SCRIPT" PRRT_reply_prioroos oos "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","oos"]' ]
  [ ! -f "$CALLS" ]
}

@test "a prior unclear marker still skips an unclear or disagree reply" {
  for d in unclear disagree; do
    rm -f "$POSTED" "$CALLS"
    run --separate-stderr "$SCRIPT" PRRT_reply_priorunclear "$d" "$BODY"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","unclear"]' ]
    [ ! -f "$CALLS" ]
  done
}

@test "a viewer marker with trailing newline, CRLF or spaces is still a skip, extra prose after it is not" {
  for suffix in '\n' '\r\n' '   ' ' \n\n'; do
    rm -f "$POSTED" "$CALLS"
    export MOCK_REPLY_SUFFIX="$suffix"
    run --separate-stderr "$SCRIPT" PRRT_reply_suffix fixed "$BODY"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped]')" = '[false,"already-replied"]' ]
    [ ! -f "$CALLS" ]
  done
  rm -f "$POSTED" "$CALLS"
  export MOCK_REPLY_SUFFIX=' trailing prose'
  run --separate-stderr "$SCRIPT" PRRT_reply_suffix fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  unset MOCK_REPLY_SUFFIX
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

@test "a 502 with a non-JSON body exits 1 and shows the response" {
  run --separate-stderr "$SCRIPT" PRRT_reply_502 fixed "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"HTTP 502"* ]]
}

@test "a GraphQL internal error with no stderr exits 1 and shows the response" {
  run --separate-stderr "$SCRIPT" PRRT_reply_500 fixed "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"Something went wrong"* ]]
  [ "$(cat "$CALLS")" = 1 ]
}

@test "a mutation that returns no comment exits 1" {
  run --separate-stderr "$SCRIPT" PRRT_reply_nocomment fixed "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"returned no comment"* ]]
}

@test "a gh call that times out exits 4 without retrying" {
  mkdir -p "${BATS_TEST_TMPDIR}/tobin"
  printf '#!/bin/sh\nexit 124\n' >| "${BATS_TEST_TMPDIR}/tobin/timeout"
  chmod +x "${BATS_TEST_TMPDIR}/tobin/timeout"
  PATH="${BATS_TEST_TMPDIR}/tobin:${PATH}" run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"timed out"* ]]
}

@test "YELLOW_REVIEW_GH_TIMEOUT=0 falls back to the 30 s default, not no limit" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=0 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 30 ]
}

@test "a non-numeric YELLOW_REVIEW_GH_TIMEOUT falls back to the 30 s default" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=abc run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 30 ]
}

@test "a valid YELLOW_REVIEW_GH_TIMEOUT is passed to timeout" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=7 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 7 ]
}

@test "refuses a body that looks like a credential, before any API call" {
  printf 'Fixed. Token was ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"credential"* ]]
  [ ! -f "$CALLS" ]
}

@test "a scanner failure refuses to post, before any API call" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\nexit 2\n' >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"could not be scanned"* ]]
  [ ! -f "$CALLS" ]
}

# --- Rate limits ---

@test "retries once after a 429 and honours Retry-After over the env default" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=45 run --separate-stderr "$SCRIPT" PRRT_reply_rl fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS")" = 2 ]
  [[ "$stderr" == *"retrying in 7s"* ]]
  grep -qx 7 "$SLEEP_LOG"
}

@test "waits exactly Retry-After: 90, the cap" {
  stub_sleep
  run --separate-stderr "$SCRIPT" PRRT_reply_ra90 fixed "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying in 90s"* ]]
  grep -qx 90 "$SLEEP_LOG"
}

@test "Retry-After: 120 is over the cap: exit 4, no retry, message names the wait" {
  stub_sleep
  run --separate-stderr "$SCRIPT" PRRT_reply_ra120 fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "$CALLS")" = 1 ]
  [[ "$stderr" == *"120s wait is over the 90s cap"* ]]
  [ ! -f "$SLEEP_LOG" ]
}

@test "uses x-ratelimit-reset when no requests remain and no Retry-After" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=45 run --separate-stderr "$SCRIPT" PRRT_reply_reset fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(cat "$CALLS")" = 2 ]
  _w=$(sed -n 's/.*retrying in \([0-9]*\)s.*/\1/p' <<<"$stderr")
  [ "$_w" -ge 25 ] && [ "$_w" -le 30 ]
}

@test "a reset time in the past waits 0 s, not the env default" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=45 run --separate-stderr "$SCRIPT" PRRT_reply_resetpast fixed "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying in 0s"* ]]
  grep -qx 0 "$SLEEP_LOG"
}

@test "a reset time over the cap exits 4" {
  stub_sleep
  run --separate-stderr "$SCRIPT" PRRT_reply_resetfar fixed "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"over the 90s cap"* ]]
  [ ! -f "$SLEEP_LOG" ]
}

@test "falls back to YELLOW_REVIEW_RATE_LIMIT_WAIT when no header says" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=5 run --separate-stderr "$SCRIPT" PRRT_reply_dflt fixed "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying in 5s"* ]]
  grep -qx 5 "$SLEEP_LOG"
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
  [[ "$stderr" == *"retry is already spent"* ]]
}

@test "a credential refusal prints the resolve-text token; an over-long body does not" {
  printf 'Fixed. Token was ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 6 ]
  [[ "$stderr" == *"resolve-text: refused rule=token-prefix line=1"* ]]
  head -c 1001 /dev/zero | tr '\0' 'a' >| "$BODY"
  run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" != *"resolve-text:"* ]]
}

@test "a non-numeric Retry-After (an HTTP date) falls back to the env default wait" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=5 run --separate-stderr "$SCRIPT" PRRT_reply_radate fixed "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"retrying in 5s"* ]]
  grep -qx 5 "$SLEEP_LOG"
}

@test "a comment the prior-marker check cannot read exits 1 and posts nothing" {
  run --separate-stderr "$SCRIPT" PRRT_reply_badbody fixed "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"could not read the recent comments"* ]]
  [ ! -f "$CALLS" ]
}

@test "a non-numeric pacing value does not fail a reply that already posted" {
  YELLOW_REVIEW_PACE_SECONDS=abc run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  [ "$(cat "$CALLS")" = 1 ]
}

# A PATH of symlinks to the tools the script needs, minus timeout.
path_without_timeout() {
  _bin="${BATS_TEST_TMPDIR}/notimeout"
  mkdir -p "$_bin"
  for _t in sh bash jq awk tr head grep sed date sleep mktemp rm cat dirname env printf; do
    _p=$(command -v "$_t" 2>/dev/null) && [ -x "$_p" ] && ln -sf "$_p" "$_bin/$_t"
  done
  ln -sf "${BATS_TEST_DIRNAME}/mocks/gh" "$_bin/gh"
}

@test "gtimeout is used when timeout is not installed" {
  path_without_timeout
  printf '#!/bin/sh\nprintf x >> "%s/gtimeout_used"\nshift\nexec "$@"\n' "$BATS_TEST_TMPDIR" >| "${BATS_TEST_TMPDIR}/notimeout/gtimeout"
  chmod +x "${BATS_TEST_TMPDIR}/notimeout/gtimeout"
  PATH="${BATS_TEST_TMPDIR}/notimeout" run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
  [ -s "${BATS_TEST_TMPDIR}/gtimeout_used" ]
  [[ "$stderr" != *"neither timeout"* ]]
}

@test "with neither timeout nor gtimeout the script says so and still runs" {
  path_without_timeout
  PATH="${BATS_TEST_TMPDIR}/notimeout" run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"neither timeout nor gtimeout is installed"* ]]
}

# --- Refusal (6) and auth failure (7) ---

@test "a body with an image, a mention or a foreign URL exits 6 before any API call" {
  for t in 'Fixed. ![x](https://github.com/o/r/raw/x.png)' 'Fixed, cc @octocat' 'Fixed, see https://evil.example/x'; do
    printf '%s\n' "$t" >| "$BODY"
    run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
    [ "$status" -eq 6 ] || { echo "not refused: $t"; false; }
    [[ "$stderr" == *"resolve-text: refused rule="* ]]
    [ ! -f "$CALLS" ]
  done
}

@test "an HTTP 401 exits 7 without a retry and prints reason=auth" {
  run --separate-stderr "$SCRIPT" PRRT_reply_auth fixed "$BODY"
  [ "$status" -eq 7 ]
  [[ "$stderr" == *"rejected the credentials"* ]]
  printf '%s\n' "$stderr" | grep -qx 'reason=auth'
  [ ! -f "$CALLS" ]
}

@test "a jq that fails while measuring the body exits 1 with a message, not jq's status" {
  mkdir -p "${BATS_TEST_TMPDIR}/jqbin"
  printf '#!/bin/sh\nexit 5\n' >| "${BATS_TEST_TMPDIR}/jqbin/jq"
  chmod +x "${BATS_TEST_TMPDIR}/jqbin/jq"
  PATH="${BATS_TEST_TMPDIR}/jqbin:${PATH}" run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"could not measure the body file"* ]]
  [ ! -f "$CALLS" ]
}

# --- Recovery window: comments(last: 10), Bot acknowledgements ignored ---

@test "skips when only Bot comments follow our marker and reports its disposition" {
  run --separate-stderr "$SCRIPT" PRRT_reply_botafter unclear "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","fixed"]' ]
  [ ! -f "$CALLS" ]
}

@test "posts when a human comment follows our marker" {
  run --separate-stderr "$SCRIPT" PRRT_reply_humanafter fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  [ "$(cat "$CALLS")" = 1 ]
}

@test "posts when a comment with an unreadable author follows our marker" {
  run --separate-stderr "$SCRIPT" PRRT_reply_ghostafter fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  [ "$(cat "$CALLS")" = 1 ]
}

@test "posts when our latest comment has no marker for this thread" {
  run --separate-stderr "$SCRIPT" PRRT_reply_nomarker fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  [ "$(cat "$CALLS")" = 1 ]
}

@test "posts when our marker has fallen out of the 10-comment window behind Bot replies" {
  run --separate-stderr "$SCRIPT" PRRT_reply_outwindow fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = "true" ]
  [ "$(cat "$CALLS")" = 1 ]
}

# --- structured exit-4 reason (rate-limit vs timeout) ---

@test "exit 4 from a gh timeout prints reason=timeout and no other reason" {
  mkdir -p "${BATS_TEST_TMPDIR}/tobin"
  printf '#!/bin/sh\nexit 124\n' >| "${BATS_TEST_TMPDIR}/tobin/timeout"
  chmod +x "${BATS_TEST_TMPDIR}/tobin/timeout"
  PATH="${BATS_TEST_TMPDIR}/tobin:${PATH}" run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=timeout'
  [ "$(printf '%s\n' "$stderr" | grep -c '^reason=')" = 1 ]
}

@test "exit 4 from a wait over the cap prints reason=rate-limit" {
  stub_sleep
  run --separate-stderr "$SCRIPT" PRRT_reply_ra120 fixed "$BODY"
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  [ "$(printf '%s\n' "$stderr" | grep -c '^reason=')" = 1 ]
}

@test "exit 4 from a second rate limit prints reason=rate-limit" {
  run --separate-stderr "$SCRIPT" PRRT_reply_rl2 fixed "$BODY"
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  [ "$(printf '%s\n' "$stderr" | grep -c '^reason=')" = 1 ]
}

# --- Oversized numeric values (past the shell's integer range) ---

@test "an oversized YELLOW_REVIEW_RATE_LIMIT_WAIT falls back to 60 s and never sleeps the huge value" {
  stub_sleep
  YELLOW_REVIEW_RATE_LIMIT_WAIT=99999999999999999999 run --separate-stderr "$SCRIPT" PRRT_reply_envhuge fixed "$BODY"
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  [[ "$stderr" != *"integer expression"* ]]
  [ "$(cat "$SLEEP_LOG")" = 60 ]
}

@test "a Retry-After past the integer range exits 4 with reason=rate-limit and does not sleep" {
  stub_sleep
  run --separate-stderr "$SCRIPT" PRRT_reply_rahuge fixed "$BODY"
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  [[ "$stderr" != *"integer expression"* ]]
  [ "$(cat "$CALLS")" = 1 ]
  [ ! -f "$SLEEP_LOG" ]
}

@test "an x-ratelimit-reset past the integer range exits 4 with reason=rate-limit and does not sleep" {
  stub_sleep
  run --separate-stderr "$SCRIPT" PRRT_reply_resethuge fixed "$BODY"
  [ "$status" -eq 4 ]
  printf '%s\n' "$stderr" | grep -qx 'reason=rate-limit'
  [[ "$stderr" != *"integer expression"* ]]
  [ "$(cat "$CALLS")" = 1 ]
  [ ! -f "$SLEEP_LOG" ]
}

@test "an oversized YELLOW_REVIEW_GH_TIMEOUT falls back to the 30 s default" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=99999999999999999999 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 30 ]
}

@test "a 5-digit YELLOW_REVIEW_GH_TIMEOUT falls back to the 30 s default" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=10000 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 30 ]
}

@test "a YELLOW_REVIEW_GH_TIMEOUT over 60 is clamped to 60, not reset to the default" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=9999 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$status" -eq 4 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 60 ]
  [[ "$stderr" == *"timed out after 60s"* ]]
}

@test "YELLOW_REVIEW_GH_TIMEOUT=61 is clamped to 60 and 60 passes through" {
  stub_timeout_logging
  YELLOW_REVIEW_GH_TIMEOUT=61 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 60 ]
  YELLOW_REVIEW_GH_TIMEOUT=60 run --separate-stderr "$SCRIPT" PRRT_reply_new fixed "$BODY"
  [ "$(cat "${BATS_TEST_TMPDIR}/timeout_arg")" = 60 ]
}

# --- Marker-filtered pre-check: a bot-account viewer, and our own human account ---

@test "a bot-account viewer's own unmarked acknowledgement after our marker still skips" {
  run --separate-stderr "$SCRIPT" PRRT_reply_botself fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","fixed"]' ]
  [ ! -f "$CALLS" ]
}

@test "a marker authored by a Bot viewer is still recognised" {
  run --separate-stderr "$SCRIPT" PRRT_reply_botmarker fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.replied, .skipped, .disposition]')" = '[false,"already-replied","fixed"]' ]
  [ ! -f "$CALLS" ]
}

@test "a later unmarked comment from our own human account sends the thread back through the resolver" {
  run --separate-stderr "$SCRIPT" PRRT_reply_ownafter fixed "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.replied')" = true ]
  [ "$(cat "$CALLS")" = 1 ]
}
