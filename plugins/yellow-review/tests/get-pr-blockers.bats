#!/usr/bin/env bats
# Tests for get-pr-blockers (reviews + conversation-resolution enforcement)

bats_require_minimum_version 1.5.0

SCRIPT_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts"
SCRIPT="${SCRIPT_DIR}/get-pr-blockers"

setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  export BATS_FIXTURE_DIR="${BATS_TEST_DIRNAME}/fixtures"
  unset MOCK_GH_PROTECTION MOCK_GH_RULES MOCK_GH_BLOCKERS_FAIL
}

@test "rejects missing arguments with exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Usage:"* ]]
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
  [ "$(printf '%s' "$output" | jq -c '[.changesRequested, .reviewDecision, .conversationResolution]')" = '[null,null,"unknown"]' ]
  [[ "$stderr" == *"review lookup failed"* ]]
}
