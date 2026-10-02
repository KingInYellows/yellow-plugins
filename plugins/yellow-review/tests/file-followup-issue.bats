#!/usr/bin/env bats
# Tests for file-followup-issue (marker dedupe, author check, create)

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/file-followup-issue"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  unset MOCK_GH_VIEWER MOCK_GH_ISSUE_CREATE_FAIL MOCK_GH_ISSUE_LIST_FULL MOCK_GH_ISSUE_LIST_COUNT \
    MOCK_GH_ISSUE_LIST_FAIL MOCK_GH_VIEWER_FAIL MOCK_GH_THREAD_FAIL MOCK_GH_THREAD_URL GH_HOST \
    MOCK_GH_RESCAN MOCK_GH_ISSUE_CLOSE_FAIL
  TITLE="${BATS_TEST_TMPDIR}/title.txt"
  BODY="${BATS_TEST_TMPDIR}/body.txt"
  printf 'Follow-up from PR #7: src/a.ts\n' >| "$TITLE"
  printf 'Retry policy belongs in the client module.\n' >| "$BODY"
  CREATES="${BATS_TEST_TMPDIR}/mock_gh_count_issue_create"
  rm -f "$CREATES" "${BATS_TEST_TMPDIR}/mock_gh_issue_title" "${BATS_TEST_TMPDIR}/mock_gh_issue_body"
}

@test "rejects missing arguments with exit 2" {
  run "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "rejects an invalid thread ID" {
  run "$SCRIPT" test/repo 7 'PRRT_x y' "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
}

@test "rejects an empty title" {
  printf '   \n' >| "$TITLE"
  run "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
}

@test "dedupe hit on the viewer's own issue returns it without creating" {
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_dup "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$output" = '{"number":41,"url":"https://github.com/test/repo/issues/41","created":false}' ]
  [ ! -f "$CREATES" ]
}

@test "a thread ID that is a prefix of another marker is not a dedupe hit" {
  # The viewer's issues carry PRRT_issue_dup and PRRT_issue_dupX markers;
  # neither may match PRRT_issue_du.
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_du "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.created')" = "true" ]
}

@test "a marker in an issue authored by someone else is ignored" {
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_spoof "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.number, .created]')" = '[77,true]' ]
  [ "$(cat "$CREATES")" = 1 ]
}

@test "an app viewer matches its app/<name> issue author" {
  export MOCK_GH_VIEWER='resolver-app[bot]'
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_app "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.number, .created]')" = '[44,false]' ]
  grep -q -- '--app resolver-app' "${BATS_TEST_TMPDIR}/mock_gh_issue_list_args"
}

@test "dedupe lists only the viewer's issues" {
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_dup "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  grep -q -- '--author me' "${BATS_TEST_TMPDIR}/mock_gh_issue_list_args"
}

@test "creates an issue with the marker and a thread link" {
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$output" = '{"number":77,"url":"https://github.com/test/repo/issues/77","created":true}' ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_issue_title")" = "Follow-up from PR #7: src/a.ts" ]
  body="${BATS_TEST_TMPDIR}/mock_gh_issue_body"
  [ "$(head -n 1 "$body")" = "Retry policy belongs in the client module." ]
  grep -qF 'https://github.com/test/repo/pull/7#discussion_r1' "$body"
  [ "$(tail -n 1 "$body")" = "<!-- yellow-review:resolve v1 thread=PRRT_issue_new disposition=oos -->" ]
}

@test "a thread URL on a host other than GH_HOST is a mismatch and exits 2" {
  export GH_HOST=ghe.example.com
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"does not belong to"* ]]
  [ ! -e "$CREATES" ]
}

@test "a thread whose first comment is on another pull request exits 2 and files nothing" {
  export MOCK_GH_THREAD_URL=https://github.com/test/repo/pull/8#discussion_r9
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"does not belong to test/repo#7"* ]]
  [ ! -e "$CREATES" ]
}

@test "a failed thread lookup links the PR and says so on stderr" {
  export MOCK_GH_THREAD_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"thread link lookup failed"* ]]
  body="${BATS_TEST_TMPDIR}/mock_gh_issue_body"
  grep -qF 'pull/7' "$body"
  ! grep -qF 'discussion_r1' "$body"
}

@test "a thread lookup with no URL links the PR and says so on stderr" {
  export MOCK_GH_THREAD_URL=
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [[ "$stderr" == *"no thread URL returned"* ]]
  ! grep -qF 'discussion_r1' "${BATS_TEST_TMPDIR}/mock_gh_issue_body"
}

@test "a rate-limited thread lookup exits 4 and files nothing" {
  export MOCK_GH_THREAD_FAIL=ratelimit
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"thread link lookup"* ]]
  [ ! -e "$CREATES" ]
}

@test "a rate-limited viewer lookup exits 4" {
  export MOCK_GH_VIEWER_FAIL=ratelimit
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"viewer lookup"* ]]
  [ ! -e "$CREATES" ]
}

@test "a failed viewer lookup exits 1" {
  export MOCK_GH_VIEWER_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"viewer lookup failed"* ]]
}

@test "a rate-limited issue list exits 4" {
  export MOCK_GH_ISSUE_LIST_FAIL=ratelimit
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"issue list"* ]]
  [ ! -e "$CREATES" ]
}

@test "a failed issue list exits 1 and creates nothing" {
  export MOCK_GH_ISSUE_LIST_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"issue list failed"* ]]
  [ ! -e "$CREATES" ]
}

@test "the dedupe list covers closed issues too" {
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_dup "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  grep -q -- '--state all' "${BATS_TEST_TMPDIR}/mock_gh_issue_list_args"
}

@test "refuses issue text that looks like a credential" {
  printf 'Move DB_PASSWORD=hunter22 into the vault.\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [ ! -f "$CREATES" ]
}

@test "a create that prints no issue URL warns that an issue may exist" {
  export MOCK_GH_ISSUE_CREATE_FAIL=nourl
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"no issue URL"* ]]
  [[ "$stderr" == *"may already exist"* ]]
  [[ "$stderr" == *"thread marker"* ]]
}

@test "a create failure exits 1" {
  export MOCK_GH_ISSUE_CREATE_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"issue create failed"* ]]
}

@test "a rate-limited create exits 4" {
  export MOCK_GH_ISSUE_CREATE_FAIL=ratelimit
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"rate limit"* ]]
}

@test "a full dedupe window with no marker fails closed with its own exit code and creates nothing" {
  export MOCK_GH_ISSUE_LIST_FULL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"refusing to file a possible duplicate"* ]]
  [ ! -e "$CREATES" ]
}

@test "a scanner failure refuses to file instead of passing the text through" {
  mkdir -p "${BATS_TEST_TMPDIR}/failbin"
  printf '#!/bin/sh\nexit 2\n' >| "${BATS_TEST_TMPDIR}/failbin/awk"
  chmod +x "${BATS_TEST_TMPDIR}/failbin/awk"
  PATH="${BATS_TEST_TMPDIR}/failbin:${PATH}" run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"could not be scanned"* ]]
  [ ! -e "$CREATES" ]
}

@test "a window one short of full with no marker still creates" {
  export MOCK_GH_ISSUE_LIST_COUNT=199
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.created')" = "true" ]
}

@test "a window of exactly 200 with no marker refuses" {
  export MOCK_GH_ISSUE_LIST_COUNT=200
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"refusing to file a possible duplicate"* ]]
  [ ! -e "$CREATES" ]
}

@test "rejects a malformed repo" {
  for repo in noslash a/b/c /repo owner/; do
    run "$SCRIPT" "$repo" 7 PRRT_issue_new "$TITLE" "$BODY"
    [ "$status" -eq 2 ] || { echo "accepted repo: $repo"; false; }
  done
}

@test "rejects a non-numeric or empty PR number" {
  for pr in abc 7a -1 ''; do
    run "$SCRIPT" test/repo "$pr" PRRT_issue_new "$TITLE" "$BODY"
    [ "$status" -eq 2 ] || { echo "accepted PR: $pr"; false; }
  done
}

@test "rejects a thread ID without the PRRT_ prefix or with nothing after it" {
  for id in issue_new PRRT_ 'PRRT_a/b'; do
    run "$SCRIPT" test/repo 7 "$id" "$TITLE" "$BODY"
    [ "$status" -eq 2 ] || { echo "accepted thread: $id"; false; }
  done
}

@test "rejects an unreadable title or body file" {
  run "$SCRIPT" test/repo 7 PRRT_issue_new "${BATS_TEST_TMPDIR}/nope" "$BODY"
  [ "$status" -eq 2 ]
  run "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "${BATS_TEST_TMPDIR}/nope"
  [ "$status" -eq 2 ]
}

@test "rejects an empty body" {
  printf '  \n\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"Body file is empty"* ]]
}

@test "a title of exactly 256 characters is accepted and 257 is rejected" {
  head -c 256 /dev/zero | tr '\0' 'a' >| "$TITLE"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  head -c 257 /dev/zero | tr '\0' 'a' >| "$TITLE"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"exceeds 256"* ]]
}

@test "only the first line of the title file is used" {
  printf 'First line\nsecond line\n' >| "$TITLE"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(cat "${BATS_TEST_TMPDIR}/mock_gh_issue_title")" = "First line" ]
}

@test "--find reports an existing marker issue without filing" {
  run --separate-stderr "$SCRIPT" --find test/repo PRRT_issue_dup
  [ "$status" -eq 0 ]
  [ "$output" = '{"exists":true,"number":41,"url":"https://github.com/test/repo/issues/41"}' ]
  [ ! -e "$CREATES" ]
}

@test "--find reports exists:false when the window holds no marker, and files nothing" {
  run --separate-stderr "$SCRIPT" --find test/repo PRRT_issue_new
  [ "$status" -eq 0 ]
  [ "$output" = '{"exists":false}' ]
  [ ! -e "$CREATES" ]
}

@test "--find over a full window with no marker exits 5 instead of reporting exists:false" {
  export MOCK_GH_ISSUE_LIST_FULL=1
  run --separate-stderr "$SCRIPT" --find test/repo PRRT_issue_new
  [ "$status" -eq 5 ]
  [[ "$stderr" == *"cannot confirm"* ]]
  [ -z "$output" ]
}

@test "--find rejects a wrong argument count, a malformed repo and a bad thread ID with exit 2" {
  run "$SCRIPT" --find test/repo
  [ "$status" -eq 2 ]
  run "$SCRIPT" --find test/repo PRRT_issue_new extra
  [ "$status" -eq 2 ]
  run "$SCRIPT" --find norepo PRRT_issue_new
  [ "$status" -eq 2 ]
  run "$SCRIPT" --find test/repo 'PRRT_x y'
  [ "$status" -eq 2 ]
}

# A stand-in timeout(1) that kills (exit 124) any gh call whose arguments
# contain $MOCK_TIMEOUT_ON and runs every other call normally.
fake_timeout() {
  mkdir -p "${BATS_TEST_TMPDIR}/tbin"
  cat >| "${BATS_TEST_TMPDIR}/tbin/timeout" <<'SH'
#!/bin/sh
shift
case " $* " in *" $MOCK_TIMEOUT_ON "*) exit 124 ;; esac
exec "$@"
SH
  chmod +x "${BATS_TEST_TMPDIR}/tbin/timeout"
  export PATH="${BATS_TEST_TMPDIR}/tbin:${PATH}"
}

@test "a gh call that times out on the issue list exits 4 and creates nothing" {
  fake_timeout
  export MOCK_TIMEOUT_ON=list
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"timed out"* ]]
  [ ! -e "$CREATES" ]
}

@test "a gh call that times out on the create exits 4" {
  fake_timeout
  export MOCK_TIMEOUT_ON=create
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"timed out"* ]]
}

@test "a gh call that times out on the thread link lookup exits 4 instead of falling back" {
  fake_timeout
  # Only the thread query carries a threadId argument; the viewer lookup runs.
  export MOCK_TIMEOUT_ON=threadId=PRRT_issue_new
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"timed out"* ]]
  [ ! -e "$CREATES" ]
}

@test "--find also exits 4 when a gh call times out" {
  fake_timeout
  export MOCK_TIMEOUT_ON=list
  run --separate-stderr "$SCRIPT" --find test/repo PRRT_issue_new
  [ "$status" -eq 4 ]
}

@test "a thread URL with different owner/repo casing still links the thread" {
  export MOCK_GH_THREAD_URL=https://github.com/Test/Repo/pull/7#discussion_r1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.created')" = "true" ]
  grep -qF 'https://github.com/Test/Repo/pull/7#discussion_r1' "${BATS_TEST_TMPDIR}/mock_gh_issue_body"
}

@test "a concurrent winner with a lower number is reported and our issue is closed as a duplicate" {
  export MOCK_GH_RESCAN=winner
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$output" = '{"number":70,"url":"https://github.com/test/repo/issues/70","created":false}' ]
  closed="${BATS_TEST_TMPDIR}/mock_gh_issue_close_args"
  grep -qF 'https://github.com/test/repo/issues/77' "$closed"
  grep -qF 'not planned' "$closed"
  grep -qF 'Duplicate of #70' "$closed"
}

@test "our issue is kept and nothing is closed when it has the lowest number" {
  export MOCK_GH_RESCAN=own
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$output" = '{"number":77,"url":"https://github.com/test/repo/issues/77","created":true}' ]
  [ ! -e "${BATS_TEST_TMPDIR}/mock_gh_issue_close_args" ]
}

@test "a failed duplicate close is best effort and still reports the winner" {
  export MOCK_GH_RESCAN=winner MOCK_GH_ISSUE_CLOSE_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.number, .created]')" = '[70,false]' ]
}

@test "a failed post-create rescan still reports the issue that was created" {
  export MOCK_GH_RESCAN=fail
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.number, .created]')" = '[77,true]' ]
  [ ! -e "${BATS_TEST_TMPDIR}/mock_gh_issue_close_args" ]
}

@test "a rate-limited post-create rescan exits 4 after the issue was created" {
  export MOCK_GH_RESCAN=ratelimit
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 4 ]
  [[ "$stderr" == *"post-create issue list"* ]]
  [ "$(cat "$CREATES")" = 1 ]
}

@test "a credential refusal labels the file in the resolve-text token; a wrong-PR thread has none" {
  printf 'Token was ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"resolve-text: refused rule=token-prefix line=1 in=body"* ]]
  [ ! -e "$CREATES" ]
  printf 'Token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345\n' >| "$TITLE"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" == *"in=title"* ]]
  printf 'Follow-up from PR #7: src/a.ts\n' >| "$TITLE"
  printf 'Retry policy belongs in the client module.\n' >| "$BODY"
  export MOCK_GH_THREAD_URL=https://github.com/test/repo/pull/8#discussion_r9
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [[ "$stderr" != *"resolve-text:"* ]]
}
