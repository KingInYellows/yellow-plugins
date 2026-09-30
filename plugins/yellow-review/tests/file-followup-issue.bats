#!/usr/bin/env bats
# Tests for file-followup-issue (marker dedupe, author check, create)

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/file-followup-issue"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  unset MOCK_GH_VIEWER MOCK_GH_ISSUE_CREATE_FAIL
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
}

@test "dedupe lists only the viewer's issues" {
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_dup "$TITLE" "$BODY"
  [ "$status" -eq 0 ]
  grep -q -- '--author @me' "${BATS_TEST_TMPDIR}/mock_gh_issue_list_args"
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

@test "refuses issue text that looks like a credential" {
  printf 'Move DB_PASSWORD=hunter22 into the vault.\n' >| "$BODY"
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 2 ]
  [ ! -f "$CREATES" ]
}

@test "a create failure exits 1" {
  export MOCK_GH_ISSUE_CREATE_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7 PRRT_issue_new "$TITLE" "$BODY"
  [ "$status" -eq 1 ]
  [[ "$stderr" == *"issue create failed"* ]]
}
