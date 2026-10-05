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
  unset MOCK_GH_COMMENTS_FIXTURE
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

# --- --include-outdated and additive fields ---

@test "default output keeps the original fields first and in order" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]

  keys=$(printf '%s' "$output" | jq -c '.[0] | keys_unsorted[0:5]')
  [ "$keys" = '["threadId","path","line","startLine","comments"]' ]
  ckeys=$(printf '%s' "$output" | jq -c '.[0].comments[0] | keys_unsorted[0:2]')
  [ "$ckeys" = '["author","body"]' ]
}

@test "--include-outdated includes unresolved outdated threads" {
  run "$SCRIPT" --include-outdated "test/repo" "123"
  [ "$status" -eq 0 ]

  ids=$(printf '%s' "$output" | jq -r '.[].threadId')
  [[ "$ids" == *"PRRT_thread1"* ]]
  [[ "$ids" == *"PRRT_thread3"* ]]
  [[ "$ids" == *"PRRT_thread4"* ]]
  # Resolved threads stay excluded
  [[ "$ids" != *"PRRT_thread2"* ]]
  outdated=$(printf '%s' "$output" | jq -r '.[] | select(.threadId == "PRRT_thread3") | .isOutdated')
  [ "$outdated" = "true" ]
}

@test "an outdated thread carries originalLine, originalStartLine and the first comment's diffHunk" {
  run "$SCRIPT" --include-outdated "test/repo" "123"
  [ "$status" -eq 0 ]
  t=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_thread3") | [.originalLine, .originalStartLine, .diffHunk]')
  [ "$t" = '[9,7,"@@ -7,3 +7,3 @@\n-old line\n+new line"]' ]
}

@test "a thread that is not outdated carries its anchor and its capped diffHunk too" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]
  t=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_thread1") | [.originalLine, .originalStartLine, .diffHunk]')
  [ "$t" = '[42,null,"@@ -40,3 +40,3 @@\n context"]' ]
}

@test "threads carry originalLine and a capped diffHunk, appended after the existing fields" {
  export MOCK_GH_COMMENTS_FIXTURE=outdated-anchor-response.json
  run "$SCRIPT" --include-outdated "test/repo" "500"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.[0].line')" = "null" ]
  [ "$(printf '%s' "$output" | jq -r '.[0].originalLine')" = "42" ]
  [ "$(printf '%s' "$output" | jq -r '.[0].diffHunk | length')" = "2000" ]
  [[ "$(printf '%s' "$output" | jq -r '.[0].diffHunk')" == "@@ -40,3 +40,4 @@"* ]]
  # A thread whose first comment has no hunk gets null, not an error.
  [ "$(printf '%s' "$output" | jq -r '.[1].diffHunk')" = "null" ]
  [ "$(printf '%s' "$output" | jq -c '.[0] | keys_unsorted[-3:]')" = '["originalLine","originalStartLine","diffHunk"]' ]
}

@test "--include-outdated is accepted after the positional arguments" {
  run "$SCRIPT" "test/repo" "123" --include-outdated
  [ "$status" -eq 0 ]
  count=$(printf '%s' "$output" | jq 'length')
  [ "$count" -eq 3 ]
}

@test "rejects an unknown flag" {
  run "$SCRIPT" --bogus "test/repo" "123"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Unknown flag"* ]]
}

@test "emits thread permission fields and comment identity fields" {
  run "$SCRIPT" --include-outdated "test/repo" "123"
  [ "$status" -eq 0 ]

  t1=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_thread1") | [.isOutdated, .viewerCanResolve, .viewerCanReply]')
  [ "$t1" = '[false,true,true]' ]
  t3=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_thread3") | .viewerCanResolve')
  [ "$t3" = 'false' ]

  c1=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_thread1") | .comments[0] | [.id, .createdAt, .viewerDidAuthor, .authorType]')
  [ "$c1" = '["PRRC_c1","2026-09-30T10:00:00Z",false,"User"]' ]
  c3=$(printf '%s' "$output" | jq -r '.[] | select(.threadId == "PRRT_thread3") | .comments[0].authorType')
  [ "$c3" = "Bot" ]
}

@test "commentCount is the thread total, even past the 50 fetched" {
  run "$SCRIPT" --include-outdated "test/repo" "123"
  [ "$status" -eq 0 ]
  counts=$(printf '%s' "$output" | jq -c '[.[] | {(.threadId): .commentCount}] | add')
  # thread1 has totalCount 1; thread4 reports 55 with 2 fetched; thread3
  # has no totalCount and falls back to the fetched length.
  [ "$counts" = '{"PRRT_thread1":1,"PRRT_thread3":1,"PRRT_thread4":55}' ]
}

@test "missing author type is null, so callers treat the author as human" {
  run "$SCRIPT" "test/repo" "123"
  [ "$status" -eq 0 ]
  t=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_thread4") | [.comments[].authorType]')
  [ "$t" = '[null,null]' ]
}

@test "viewer fields keep true values and default to false when absent" {
  run "$SCRIPT" "test/repo" "500"
  [ "$status" -eq 0 ]
  v1=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_v1") | [.viewerCanResolve, .viewerCanReply, .comments[0].viewerDidAuthor]')
  [ "$v1" = '[true,false,true]' ]
  v2=$(printf '%s' "$output" | jq -c '.[] | select(.threadId == "PRRT_v2") | [.isOutdated, .viewerCanResolve, .viewerCanReply, .comments[0].viewerDidAuthor]')
  [ "$v2" = '[false,false,false,false]' ]
}

@test "commentsTruncated is true only when the thread has more comments than fetched" {
  run "$SCRIPT" "test/repo" "500"
  [ "$status" -eq 0 ]
  t=$(printf '%s' "$output" | jq -c '[.[] | {(.threadId): .commentsTruncated}] | add')
  [ "$t" = '{"PRRT_v1":false,"PRRT_v2":false,"PRRT_v3":true}' ]
  fetched=$(printf '%s' "$output" | jq '.[] | select(.threadId == "PRRT_v3") | [(.comments | length), .commentCount] | @csv' -r)
  [ "$fetched" = "50,51" ]
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
  [[ "$output" == *"Repository or PR not found"* ]]
}

@test "a secondary rate limit reported as HTTP 403 is a rate limit, not a permissions error" {
  run "$SCRIPT" "test/repo" "420"
  [ "$status" -eq 1 ]
  [[ "$output" == *"rate limit exceeded"* ]]
  [[ "$output" != *"Insufficient permissions"* ]]
}

@test "HTTP 429 is a rate limit" {
  run "$SCRIPT" "test/repo" "429"
  [ "$status" -eq 1 ]
  [[ "$output" == *"rate limit exceeded"* ]]
}

@test "HTTP 403 is insufficient permissions" {
  run "$SCRIPT" "test/repo" "431"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Insufficient permissions"* ]]
}

@test "HTTP 502 is a server error" {
  run "$SCRIPT" "test/repo" "502"
  [ "$status" -eq 1 ]
  [[ "$output" == *"GitHub server error"* ]]
}

@test "digits that are not an HTTP status do not classify the error" {
  run "$SCRIPT" "test/repo" "778"
  [ "$status" -eq 1 ]
  [[ "$output" == *"GraphQL query failed"* ]]
  [[ "$output" != *"Authentication failed"* ]]
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

@test "--include-outdated accumulates threads across pages" {
  run "$SCRIPT" --include-outdated "test/repo" "300"
  [ "$status" -eq 0 ]
  ids=$(printf '%s' "$output" | jq -r '.[].threadId' | sort | tr '\n' ' ')
  # Resolved PRRT_mp_thread2 stays out; the outdated page-2 thread comes in.
  [ "$ids" = "PRRT_mp_thread1 PRRT_mp_thread3 PRRT_mp_thread4 " ]
}

@test "a null cursor with hasNextPage true exits 3 with the threads fetched so far" {
  # Capture stderr separately to check for the truncation message
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_350"
  run bash -c "'$SCRIPT' test/repo 350 2>'$stderr_file'"
  [ "$status" -eq 3 ]

  # Stdout is still the plain array of what was fetched
  thread_count=$(printf '%s' "$output" | jq 'length')
  [ "$thread_count" -eq 1 ]

  [[ "$(cat "$stderr_file")" == *"pagination truncated"* ]]
}

@test "hitting the page cap exits 3 with an array on stdout" {
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_360"
  run bash -c "'$SCRIPT' test/repo 360 2>'$stderr_file'"
  [ "$status" -eq 3 ]
  [ "$(printf '%s' "$output" | jq -c '.')" = '[]' ]
  [[ "$(cat "$stderr_file")" == *"pagination limit"* ]]
}

@test "a complete multi-page fetch still exits 0" {
  run "$SCRIPT" "test/repo" "300"
  [ "$status" -eq 0 ]
}

@test "a secondary rate limit (HTTP 403) is reported as a rate limit, not permissions" {
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_403"
  run bash -c "'$SCRIPT' test/repo 403 2>'$stderr_file'"
  [ "$status" -eq 1 ]
  [[ "$(cat "$stderr_file")" == *"rate limit"* ]]
  [[ "$(cat "$stderr_file")" != *"Insufficient permissions"* ]]
}

# --- Time bounds ---

@test "a gh call killed by timeout is a clean failure, not a partial list" {
  mkdir -p "${BATS_TEST_TMPDIR}/killer"
  printf '#!/bin/sh\nexit 124\n' >"${BATS_TEST_TMPDIR}/killer/timeout"
  printf '#!/bin/sh\nexit 124\n' >"${BATS_TEST_TMPDIR}/killer/gtimeout"
  chmod +x "${BATS_TEST_TMPDIR}/killer/timeout" "${BATS_TEST_TMPDIR}/killer/gtimeout"
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_kill"
  PATH="${BATS_TEST_TMPDIR}/killer:${PATH}" run bash -c "'$SCRIPT' test/repo 123 2>'$stderr_file'"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
  [[ "$(cat "$stderr_file")" == *"gh timed out after 30s"* ]]
}

@test "YELLOW_REVIEW_GH_TIMEOUT is clamped to 60 s per gh call" {
  mkdir -p "${BATS_TEST_TMPDIR}/killer"
  printf '#!/bin/sh\nexit 124\n' >"${BATS_TEST_TMPDIR}/killer/timeout"
  chmod +x "${BATS_TEST_TMPDIR}/killer/timeout"
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_clamp"
  YELLOW_REVIEW_GH_TIMEOUT=9999 PATH="${BATS_TEST_TMPDIR}/killer:${PATH}" \
    run bash -c "'$SCRIPT' test/repo 123 2>'$stderr_file'"
  [ "$status" -eq 1 ]
  [[ "$(cat "$stderr_file")" == *"gh timed out after 60s"* ]]
}

@test "an expired deadline stops paginating and exits 3 with the partial array" {
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_deadline"
  rm -f "${BATS_TEST_TMPDIR}/mock_gh_count_pr370"
  MOCK_GH_SLEEP=2 YELLOW_REVIEW_FETCH_DEADLINE=1 run bash -c "'$SCRIPT' test/repo 370 2>'$stderr_file'"
  [ "$status" -eq 3 ]
  # Exactly one page was fetched before the deadline check ran.
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_pr370")" = 1 ]
  [ "$(printf '%s' "$output" | jq -r '.[].threadId')" = "PRRT_slow1" ]
  [[ "$(cat "$stderr_file")" == *"get-pr-comments: deadline reached"* ]]
  [[ "$(cat "$stderr_file")" != *"pagination limit"* ]]
}

# A timeout stub that lets page 1 through and kills every later call (exit 124),
# logging the limit each later call was given. TIMEOUT_STUB_SLEEP delays the kill.
stub_timeout_after_page1() {
  mkdir -p "${BATS_TEST_TMPDIR}/tobin"
  cat >| "${BATS_TEST_TMPDIR}/tobin/timeout" <<'EOS'
#!/bin/sh
n=$(( $(cat "$TIMEOUT_STUB_STATE" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$n" >| "$TIMEOUT_STUB_STATE"
if [ "$n" -eq 1 ]; then shift; exec "$@"; fi
printf '%s\n' "$1" >> "$TIMEOUT_STUB_LIMITS"
sleep "${TIMEOUT_STUB_SLEEP:-0}"
exit 124
EOS
  chmod +x "${BATS_TEST_TMPDIR}/tobin/timeout"
  export PATH="${BATS_TEST_TMPDIR}/tobin:${PATH}"
  export TIMEOUT_STUB_STATE="${BATS_TEST_TMPDIR}/timeout_state" TIMEOUT_STUB_LIMITS="${BATS_TEST_TMPDIR}/timeout_limits"
  rm -f "$TIMEOUT_STUB_STATE" "$TIMEOUT_STUB_LIMITS" "${BATS_TEST_TMPDIR}/mock_gh_count_pr370"
}

@test "a gh call killed on page 2 before the deadline exits 1 with a timeout message" {
  stub_timeout_after_page1
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_p2kill"
  run bash -c "'$SCRIPT' test/repo 370 2>'$stderr_file'"
  [ "$status" -eq 1 ]
  [[ "$(cat "$stderr_file")" == *"gh timed out after"*"(page 2)"* ]]
  [[ "$(cat "$stderr_file")" != *"deadline reached"* ]]
}

@test "a gh call killed on page 2 after the deadline passed is the deadline: exit 3 with the partial array" {
  stub_timeout_after_page1
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_p2deadline"
  TIMEOUT_STUB_SLEEP=2 YELLOW_REVIEW_FETCH_DEADLINE=1 run bash -c "'$SCRIPT' test/repo 370 2>'$stderr_file'"
  # With a 1 s deadline the loop stops before page 2 unless the first page was fast;
  # either way the outcome is the deadline, never a timeout error.
  [ "$status" -eq 3 ]
  [[ "$(cat "$stderr_file")" == *"deadline reached"* ]]
  [ "$(printf '%s' "$output" | jq -r '.[0].threadId')" = "PRRT_slow1" ]
}

@test "from page 2 the per-call limit shrinks to the time the deadline has left" {
  stub_timeout_after_page1
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_shrink"
  MOCK_GH_SLEEP=2 YELLOW_REVIEW_FETCH_DEADLINE=4 run bash -c "'$SCRIPT' test/repo 370 2>'$stderr_file'"
  [ "$status" -eq 1 ]
  lim=$(head -n 1 "$TIMEOUT_STUB_LIMITS")
  [ "$lim" -ge 1 ] && [ "$lim" -le 2 ]
}

@test "an invalid or oversized deadline falls back to the 270 s default" {
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_baddeadline"
  local v
  for v in 0 abc 99999 -5 ""; do
    rm -f "${BATS_TEST_TMPDIR}/mock_gh_count_pr370"
    MOCK_GH_SLEEP=0 YELLOW_REVIEW_FETCH_DEADLINE="$v" run bash -c "'$SCRIPT' test/repo 370 2>'$stderr_file'"
    # The slow mock never ends, so the page cap, not a 1 s deadline, stops it.
    [ "$status" -eq 3 ]
    [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_count_pr370")" = 10 ]
    [[ "$(cat "$stderr_file")" == *"pagination limit"* ]]
  done
}

@test "a zero-padded deadline is read as decimal, not octal" {
  local stderr_file="${BATS_TEST_TMPDIR}/stderr_paddeadline"
  local v
  # "08" is invalid octal and "010" would be 8 s; both must run as decimal.
  for v in 08 010 0270; do
    rm -f "${BATS_TEST_TMPDIR}/mock_gh_pr300_page"
    YELLOW_REVIEW_FETCH_DEADLINE="$v" run bash -c "'$SCRIPT' test/repo 300 2>'$stderr_file'"
    [ "$status" -eq 0 ]
    [ "$(printf '%s' "$output" | jq 'length')" -eq 2 ]
    [[ "$(cat "$stderr_file")" != *"value too great"* ]]
  done
}

@test "the default deadline leaves a normal multi-page fetch unchanged" {
  rm -f "${BATS_TEST_TMPDIR}/mock_gh_pr300_page"
  run "$SCRIPT" "test/repo" "300"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq 'length')" -eq 2 ]
}
