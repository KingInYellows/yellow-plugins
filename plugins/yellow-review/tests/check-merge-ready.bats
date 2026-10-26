#!/usr/bin/env bats
# Tests for check-merge-ready (read-only merge-readiness gate)

bats_require_minimum_version 1.5.0

PLUGIN_DIR="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)"
SRC="${PLUGIN_DIR}/skills/pr-review-workflow/scripts/check-merge-ready"

# Each test runs a copy of the script beside stub siblings, so the thread,
# review and ledger results are driven by MR_* variables while the state
# query goes through the gh mock.
setup() {
  export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"
  unset MOCK_GH_MR_BODY MOCK_GH_MR_FAIL
  ROOT="${BATS_TEST_TMPDIR}/plugin"
  mkdir -p "$ROOT/skills/pr-review-workflow/scripts" "$ROOT/lib"
  cp "$SRC" "$ROOT/skills/pr-review-workflow/scripts/check-merge-ready"
  cp "${PLUGIN_DIR}/lib/resolve-gh.sh" "$ROOT/lib/resolve-gh.sh"
  SCRIPT="$ROOT/skills/pr-review-workflow/scripts/check-merge-ready"
  cat >"$ROOT/skills/pr-review-workflow/scripts/get-pr-comments" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >"${BATS_TEST_TMPDIR}/comments_args"
printf '%s\n' "${MR_THREADS:-[]}"
exit "${MR_THREADS_RC:-0}"
STUB
  cat >"$ROOT/skills/pr-review-workflow/scripts/get-pr-blockers" <<'STUB'
#!/bin/sh
_d='{"changesRequested":[],"reviewDecision":"APPROVED","conversationResolution":"enforced","resolutionLookupReason":null,"lookupFailed":false,"lookupReason":null}'
printf '%s\n' "${MR_BLOCKERS:-$_d}"
STUB
  cat >"$ROOT/lib/review-ledger.sh" <<'STUB'
#!/bin/sh
[ "${MR_LEDGER_FAIL:-0}" = 1 ] && { printf 'not a git repo\n' >&2; exit 1; }
printf '%s\n' "${MR_LEDGER:-{\}}"
STUB
  chmod +x "$ROOT"/skills/pr-review-workflow/scripts/* "$ROOT/lib/review-ledger.sh"
  unset MR_THREADS MR_THREADS_RC MR_BLOCKERS MR_LEDGER MR_LEDGER_FAIL
  export MOCK_GH_MR_BODY
  MOCK_GH_MR_BODY=$(state_body)
}

# state_body [key=json ...]: a green, open, mergeable PR with overrides
# applied to its pullRequest object (rollup=<json> replaces the rollup).
state_body() {
  _pr='{"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefOid":"abc123","labels":{"nodes":[]}}'
  _roll='{"state":"SUCCESS","contexts":{"pageInfo":{"hasNextPage":false},"nodes":[{"__typename":"CheckRun","name":"lint","status":"COMPLETED","conclusion":"SUCCESS"},{"__typename":"CheckRun","name":"claude","status":"COMPLETED","conclusion":"SKIPPED"}]}}'
  for _kv in "$@"; do
    _k=${_kv%%=*}; _v=${_kv#*=}
    if [ "$_k" = rollup ]; then _roll=$_v; else _pr=$(printf '%s' "$_pr" | jq -c --arg k "$_k" --argjson v "$_v" '.[$k] = $v'); fi
  done
  jq -nc --argjson p "$_pr" --argjson r "$_roll" '{data:{repository:{pullRequest:($p + {commits:{nodes:[{commit:{oid:"abc123",statusCheckRollup:$r}}]}})}}}'
}

@test "rejects bad arguments with exit 2" {
  run "$SCRIPT"
  [ "$status" -eq 2 ]
  for bad in noslash a/b/c /repo owner/ 'own er/repo'; do
    run "$SCRIPT" "$bad" 7
    [ "$status" -eq 2 ]
  done
  for bad in abc 07 0 ''; do
    run "$SCRIPT" test/repo "$bad"
    [ "$status" -eq 2 ]
  done
}

@test "a green, resolved, approved PR is ready with exit 0" {
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .verdict <<<"$output")" = ready ]
  [ "$(jq -c .blockers <<<"$output")" = '[]' ]
  [ "$(jq -r .head <<<"$output")" = abc123 ]
  [ "$(jq -r .ci.state <<<"$output")" = SUCCESS ]
  [ "$(jq -c .threads <<<"$output")" = '{"unresolved":0,"outdated":0}' ]
}

@test "threads are fetched with outdated ones included" {
  run --separate-stderr "$SCRIPT" test/repo 7
  grep -q -- '--include-outdated test/repo 7' "${BATS_TEST_TMPDIR}/comments_args"
}

@test "an unresolved outdated thread blocks with exit 1" {
  export MR_THREADS='[{"threadId":"T1","isOutdated":true},{"threadId":"T2","isOutdated":false}]'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .threads <<<"$output")" = '{"unresolved":2,"outdated":1}' ]
  [ "$(jq -c .blockers <<<"$output")" = '["unresolved_threads"]' ]
}

@test "unresolved threads block even when resolution is not enforced" {
  export MR_THREADS='[{"threadId":"T1","isOutdated":true}]'
  export MR_BLOCKERS='{"changesRequested":[],"reviewDecision":null,"conversationResolution":"not_enforced","lookupFailed":false}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -r .conversationResolution <<<"$output")" = not_enforced ]
}

@test "a truncated thread list is unknown, not ready" {
  export MR_THREADS='[]' MR_THREADS_RC=3
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -r .verdict <<<"$output")" = unknown ]
  [ "$(jq -c .unknowns <<<"$output")" = '["threads"]' ]
  [ "$(jq -r .threads <<<"$output")" = null ]
}

@test "CHANGES_REQUESTED reviewers block" {
  export MR_BLOCKERS='{"changesRequested":[{"login":"alice","reviewId":"R1"}],"reviewDecision":"CHANGES_REQUESTED","conversationResolution":"enforced","lookupFailed":false}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .changesRequested <<<"$output")" = '["alice"]' ]
  [ "$(jq -c .blockers <<<"$output")" = '["changes_requested"]' ]
}

@test "a required review that is missing blocks" {
  export MR_BLOCKERS='{"changesRequested":[],"reviewDecision":"REVIEW_REQUIRED","conversationResolution":"enforced","lookupFailed":false}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["review_required"]' ]
}

@test "a failed review lookup is unknown, never no blockers" {
  export MR_BLOCKERS='{"changesRequested":null,"reviewDecision":null,"conversationResolution":"unknown","lookupFailed":true,"lookupReason":"rate_limited"}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .unknowns <<<"$output")" = '["reviews"]' ]
  [ "$(jq -r .changesRequested <<<"$output")" = null ]
  [[ "$stderr" == *"rate_limited"* ]]
}

@test "failing CI blocks and names the failing checks" {
  MOCK_GH_MR_BODY=$(state_body 'rollup={"state":"FAILURE","contexts":{"pageInfo":{"hasNextPage":false},"nodes":[{"__typename":"CheckRun","name":"Unit Tests","status":"COMPLETED","conclusion":"FAILURE"},{"__typename":"StatusContext","context":"ci/legacy","state":"ERROR"},{"__typename":"CheckRun","name":"lint","status":"COMPLETED","conclusion":"SUCCESS"}]}}')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .ci.failing <<<"$output")" = '["Unit Tests","ci/legacy"]' ]
  [ "$(jq -c .blockers <<<"$output")" = '["ci_failing"]' ]
}

@test "running CI blocks as pending" {
  MOCK_GH_MR_BODY=$(state_body 'rollup={"state":"PENDING","contexts":{"pageInfo":{"hasNextPage":true},"nodes":[{"__typename":"CheckRun","name":"Shell Tests","status":"IN_PROGRESS","conclusion":null}]}}')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .ci.pending <<<"$output")" = '["Shell Tests"]' ]
  [ "$(jq -r .ci.truncated <<<"$output")" = true ]
  [ "$(jq -c .blockers <<<"$output")" = '["ci_pending"]' ]
}

@test "a head with no checks reads NONE and does not block" {
  MOCK_GH_MR_BODY=$(state_body 'rollup=null')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .ci.state <<<"$output")" = NONE ]
}

@test "draft, conflicting and closed PRs block" {
  MOCK_GH_MR_BODY=$(state_body 'isDraft=true' 'mergeable="CONFLICTING"' 'state="CLOSED"')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["not_open","draft","conflicts"]' ]
}

@test "mergeability still being computed is unknown" {
  MOCK_GH_MR_BODY=$(state_body 'mergeable="UNKNOWN"')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .unknowns <<<"$output")" = '["mergeable"]' ]
}

@test "a BLOCKED merge state with no visible cause is unknown, not ready" {
  # A required check that never reported leaves the rollup null or SUCCESS
  # while GitHub still blocks the merge.
  MOCK_GH_MR_BODY=$(state_body 'mergeStateStatus="BLOCKED"' 'rollup=null')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .unknowns <<<"$output")" = '["merge_state"]' ]
}

@test "the graphite-queue label is reported as queued" {
  MOCK_GH_MR_BODY=$(state_body 'labels={"nodes":[{"name":"bug"},{"name":"graphite-queue"}]}')
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .queued <<<"$output")" = true ]
}

@test "a failed state lookup leaves PR state and CI unknown" {
  export MOCK_GH_MR_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .unknowns <<<"$output")" = '["pr_state","ci"]' ]
  [[ "$stderr" == *"state lookup failed"* ]]
}

@test "a null pullRequest is a failed state lookup" {
  MOCK_GH_MR_BODY='{"data":{"repository":{"pullRequest":null}}}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -r .state <<<"$output")" = null ]
}

@test "a blocker wins over unknowns" {
  export MOCK_GH_MR_FAIL=1 MR_THREADS='[{"threadId":"T1","isOutdated":false}]'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -r .verdict <<<"$output")" = blocked ]
}

@test "pending P0-P2 ledger findings block" {
  export MR_LEDGER='{"7":{"pending":3,"attention":0,"merge_blocking":2}}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .ledger <<<"$output")" = '{"status":"read","mergeBlocking":2}' ]
  [ "$(jq -c .blockers <<<"$output")" = '["ledger_findings"]' ]
}

@test "no ledger or an unreadable ledger does not block" {
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .ledger.status <<<"$output")" = none ]
  export MR_LEDGER_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .ledger.status <<<"$output")" = unavailable ]
}

@test "makes no write calls to GitHub" {
  run --separate-stderr "$SCRIPT" test/repo 7
  ! grep -qiE 'mutation|-X (POST|PATCH|PUT|DELETE)|--method' "${BATS_TEST_TMPDIR}/mock_gh_any_call"
}
