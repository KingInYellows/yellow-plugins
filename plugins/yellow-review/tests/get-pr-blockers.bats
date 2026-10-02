#!/usr/bin/env bats
# Tests for get-pr-blockers (reviews + conversation-resolution enforcement)

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/get-pr-blockers"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  unset MOCK_GH_PROTECTION MOCK_GH_RULES MOCK_GH_BLOCKERS_FAIL MOCK_GH_BLOCKERS_FIXTURE
}

@test "rejects missing arguments with exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "rejects malformed repo values with exit 2" {
  for bad in noslash a/b/c /repo owner/; do
    run "$SCRIPT" "$bad" "610"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Invalid repo format"* ]]
  done
}

@test "rejects a non-numeric PR number with exit 2" {
  run "$SCRIPT" "test/repo" "abc"
  [ "$status" -eq 2 ]
}

@test "lists CHANGES_REQUESTED reviewers only, stripping [bot]" {
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  cr=$(printf '%s' "$output" | jq -c '.changesRequested')
  [ "$cr" = '[{"login":"alice","reviewId":"PRR_alice"},{"login":"reviewer-app","reviewId":"PRR_bot"}]' ]
  rd=$(printf '%s' "$output" | jq -r '.reviewDecision')
  [ "$rd" = "CHANGES_REQUESTED" ]
}

@test "classic protection requiring resolution is enforced" {
  export MOCK_GH_PROTECTION=enabled
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "enforced" ]
}

@test "a ruleset requiring thread resolution is enforced even when classic is unreadable" {
  export MOCK_GH_PROTECTION=403 MOCK_GH_RULES=enforced
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "enforced" ]
}

@test "a ruleset requiring thread resolution on page two is enforced" {
  export MOCK_GH_PROTECTION=disabled MOCK_GH_RULES=page2
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "enforced" ]
}

@test "a failing rules page leaves the ruleset source unknown" {
  export MOCK_GH_PROTECTION=disabled MOCK_GH_RULES=page2fail
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "unknown" ]
  [[ "$stderr" == *"Server Error (HTTP 500)"* ]]
}

@test "both sources readable and neither requires it is not_enforced" {
  export MOCK_GH_PROTECTION=disabled MOCK_GH_RULES=none
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "not_enforced" ]
}

@test "an unprotected branch with no ruleset is not_enforced" {
  export MOCK_GH_PROTECTION=notprotected MOCK_GH_RULES=none
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "not_enforced" ]
}

@test "403 on classic protection with no ruleset is unknown" {
  export MOCK_GH_PROTECTION=403 MOCK_GH_RULES=none
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "unknown" ]
  [[ "$stderr" == *"not readable"* ]]
}

@test "review lookup failure exits 0 with null review fields" {
  export MOCK_GH_BLOCKERS_FAIL=1
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .reviewDecision, .conversationResolution, .lookupFailed]')" = '[null,null,"unknown",true]' ]
  [[ "$stderr" == *"review lookup failed"* ]]
}

@test "a successful review lookup reports lookupFailed false" {
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.lookupFailed')" = "false" ]
}

@test "the review query asks for writers only" {
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  grep -q 'writersOnly: true' "${BATS_TEST_TMPDIR}/mock_gh_any_call"
}

@test "missing gh or jq exits 0 with unknown fields" {
  run --separate-stderr env PATH=/nonexistent "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .reviewDecision, .conversationResolution, .lookupFailed]')" = '[null,null,"unknown",true]' ]
  [[ "$stderr" == *"not found"* ]]
}

@test "a null pullRequest reports the GraphQL error message" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-null-pr.json
  run --separate-stderr "$SCRIPT" "test/repo" "999"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .lookupFailed]')" = '[null,true]' ]
  [[ "$stderr" == *"Could not resolve to a PullRequest"* ]]
}

@test "a malformed review payload leaves changesRequested unknown and exits 0" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-malformed.json
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .lookupFailed]')" = '[null,true]' ]
  [[ "$stderr" == *"unreadable"* ]]
}

@test "more than 100 reviewers leaves changesRequested unknown but keeps reviewDecision" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-next-page.json
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .reviewDecision, .lookupFailed]')" = '[null,"CHANGES_REQUESTED",true]' ]
  [[ "$stderr" == *"more than 100"* ]]
}

@test "a ghost reviewer is reported as ghost" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-ghost.json
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '.changesRequested')" = '[{"login":"ghost","reviewId":"PRR_ghost"}]' ]
}

@test "no CHANGES_REQUESTED reviews gives an empty list that is not a failure" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-approved.json
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .reviewDecision, .lookupFailed]')" = '[[],"APPROVED",false]' ]
}

@test "a null reviewDecision with a good lookup is not a failure" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-no-policy.json
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .reviewDecision, .lookupFailed]')" = '[[],null,false]' ]
}

@test "a base branch with a slash and a space is URL-encoded in both endpoints" {
  export MOCK_GH_BLOCKERS_FIXTURE=blockers-slash-branch.json
  export MOCK_GH_PROTECTION=disabled MOCK_GH_RULES=none
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "not_enforced" ]
  grep -q 'repos/test/repo/branches/feature%2Fa%20b/protection' "${BATS_TEST_TMPDIR}/mock_gh_any_call"
  grep -q 'repos/test/repo/rules/branches/feature%2Fa%20b' "${BATS_TEST_TMPDIR}/mock_gh_any_call"
}

# A stand-in timeout(1) that kills (exit 124) any gh call whose arguments
# contain $MOCK_TIMEOUT_ON and runs every other call normally.
fake_timeout() {
  mkdir -p "${BATS_TEST_TMPDIR}/tbin"
  cat >| "${BATS_TEST_TMPDIR}/tbin/timeout" <<'SH'
#!/bin/sh
shift
case "$*" in *"$MOCK_TIMEOUT_ON"*) exit 124 ;; esac
exec "$@"
SH
  chmod +x "${BATS_TEST_TMPDIR}/tbin/timeout"
  export PATH="${BATS_TEST_TMPDIR}/tbin:${PATH}"
}

@test "a timed-out review lookup exits 0 with lookupFailed true and says so" {
  fake_timeout
  export MOCK_TIMEOUT_ON=graphql
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -c '[.lookupFailed, .changesRequested]')" = '[true,null]' ]
  [[ "$stderr" == *"timed out"* ]]
}

@test "a timed-out classic protection lookup leaves conversationResolution unknown" {
  fake_timeout
  export MOCK_TIMEOUT_ON=/protection MOCK_GH_RULES=none
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "unknown" ]
  [ "$(printf '%s' "$output" | jq -r '.lookupFailed')" = "false" ]
  [[ "$stderr" == *"timed out"* ]]
}

@test "a timed-out rules lookup leaves conversationResolution unknown" {
  fake_timeout
  export MOCK_TIMEOUT_ON=/rules/branches/ MOCK_GH_PROTECTION=disabled
  run --separate-stderr "$SCRIPT" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.conversationResolution')" = "unknown" ]
  [[ "$stderr" == *"timed out"* ]]
}

@test "a missing resolve-gh library exits 0 with unknown fields" {
  tmp="${BATS_TEST_TMPDIR}/copy"
  mkdir -p "$tmp/skills/pr-review-workflow/scripts" "$tmp/lib"
  cp "$SCRIPT" "$tmp/skills/pr-review-workflow/scripts/get-pr-blockers"
  run --separate-stderr "$tmp/skills/pr-review-workflow/scripts/get-pr-blockers" "test/repo" "610"
  [ "$status" -eq 0 ]
  [ "$(printf '%s' "$output" | jq -r '.lookupFailed')" = "true" ]
  [[ "$stderr" == *"resolve-gh.sh not readable"* ]]
}
