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
  unset MOCK_GH_MR_BODY MOCK_GH_MR_FAIL MOCK_GH_MRA_BODY MOCK_GH_MRA_FAIL \
    MOCK_GH_MR_POLICY MOCK_GH_MR_POLICY_FAIL MOCK_GH_MR_FILES
  ROOT="${BATS_TEST_TMPDIR}/plugin"
  mkdir -p "$ROOT/skills/pr-review-workflow/scripts" "$ROOT/lib"
  cp "$SRC" "$ROOT/skills/pr-review-workflow/scripts/check-merge-ready"
  cp "${PLUGIN_DIR}/lib/resolve-gh.sh" "$ROOT/lib/resolve-gh.sh"
  cp "${PLUGIN_DIR}/skills/pr-review-workflow/scripts/classify-risk" "$ROOT/skills/pr-review-workflow/scripts/classify-risk"
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
: >"${BATS_TEST_TMPDIR}/ledger_called"
printf '%s\n' "${MR_LEDGER:-{\}}"
STUB
  chmod +x "$ROOT"/skills/pr-review-workflow/scripts/* "$ROOT/lib/review-ledger.sh"
  unset MR_THREADS MR_THREADS_RC MR_BLOCKERS MR_LEDGER MR_LEDGER_FAIL
  export MOCK_GH_MR_BODY MOCK_GH_MRA_BODY MOCK_GH_MR_FILES MOCK_GH_MR_POLICY MOCK_GH_MR_DEFAULT_OID
  MOCK_GH_MR_BODY=$(state_body)
  # Approval evidence: a docs-only PR (low) with no reviews, and the risk
  # policy served only for the default branch's tip.
  MOCK_GH_MR_DEFAULT_OID=$DEFAULT_OID
  MOCK_GH_MR_POLICY=$TEST_POLICY
  with_files docs/a.md
  # A checkout of test/repo, so the ledger is read for it.
  CHECKOUT="${BATS_TEST_TMPDIR}/checkout"
  git init -q "$CHECKOUT"
  git -C "$CHECKOUT" remote add origin git@github.com:Test/repo.git
  LEDGER_DIR="$CHECKOUT/.git/yellow-review/findings"
  cd "$CHECKOUT"
}

HEAD_SHA=1111111111111111111111111111111111111111
OLD_SHA=2222222222222222222222222222222222222222
DEFAULT_OID=3333333333333333333333333333333333333333
TEST_POLICY='{"version":1,"default_tier":"medium","rules":[{"tier":"high","why":"hooks","paths":["plugins/*/hooks/*"]},{"tier":"low","why":"docs","paths":["docs/*"]}]}'

# rv <state> <login> <User|Bot> <commit>: one review node.
rv() {
  jq -nc --arg s "$1" --arg l "$2" --arg t "$3" --arg c "$4" \
    '{state:$s, author:{__typename:$t, login:$l}, commit:{oid:$c}}'
}

# with_files <path>...: the PR's file list (ADDED lines each, default 1), and an approval response whose
# changedFiles matches it (reviews from REVIEWS, default none).
with_files() {
  MOCK_GH_MR_FILES=$(printf '%s\n' "$@" | jq -R . \
    | jq -sc --argjson a "${ADDED:-1}" 'map({filename: ., additions: $a, deletions: 0})')
  MOCK_GH_MRA_BODY=$(approval_body "${REVIEWS:-[]}" "$#")
}

# approval_body <reviews-json> <changedFiles> [head]: the head commit was
# committed at HEAD_AT and its first check suite created at SUITE_AT; label
# events come from LABELS (default none).
approval_body() {
  jq -nc --arg h "${3:-$HEAD_SHA}" --arg d "$DEFAULT_OID" --argjson r "$1" --argjson n "$2" \
    --arg ca "${HEAD_AT:-2026-11-02T10:00:00Z}" --arg sa "${SUITE_AT:-2026-11-02T10:01:00Z}" \
    --argjson l "${LABELS:-[]}" \
    '{data:{repository:{defaultBranchRef:{target:{oid:$d}},
      pullRequest:{headRefOid:$h, changedFiles:$n, reviews:{nodes:$r},
        headRefName:"feature",
        commits:{nodes:[{commit:{oid:$h, committedDate:$ca, checkSuites:{nodes:[{createdAt:$sa, branch:{name:"feature"}}]}}}]},
        labels:{nodes:[{name:"graphite-queue"}]},
        timelineItems:{pageInfo:{hasPreviousPage:false}, nodes:$l}}}}}'
}

# lb <login> <User|Bot> <createdAt> [label]: one LabeledEvent node.
lb() {
  jq -nc --arg l "$1" --arg t "$2" --arg c "$3" --arg n "${4:-graphite-queue}" \
    '{createdAt:$c, label:{name:$n}, actor:{__typename:$t, login:$l}}'
}

# config <frontmatter lines>: an untracked yellow-plugins.local.md.
config() {
  { printf -- '---\n'; printf '%s\n' "$@"; printf -- '---\n'; } >"$CHECKOUT/yellow-plugins.local.md"
}

# with_ledger_files: give PR 7 a ledger record so the summary is consulted.
with_ledger_files() {
  mkdir -p "$LEDGER_DIR"
  : >"$LEDGER_DIR/7.jsonl"
}

# state_body [key=json ...]: a green, open, mergeable PR with overrides
# applied to its pullRequest object (rollup=<json> replaces the rollup).
state_body() {
  _pr='{"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","headRefOid":"1111111111111111111111111111111111111111","labels":{"nodes":[]}}'
  _roll='{"state":"SUCCESS","contexts":{"pageInfo":{"hasNextPage":false},"nodes":[{"__typename":"CheckRun","name":"lint","status":"COMPLETED","conclusion":"SUCCESS"},{"__typename":"CheckRun","name":"claude","status":"COMPLETED","conclusion":"SKIPPED"}]}}'
  for _kv in "$@"; do
    _k=${_kv%%=*}; _v=${_kv#*=}
    if [ "$_k" = rollup ]; then _roll=$_v; else _pr=$(printf '%s' "$_pr" | jq -c --arg k "$_k" --argjson v "$_v" '.[$k] = $v'); fi
  done
  jq -nc --argjson p "$_pr" --argjson r "$_roll" '{data:{repository:{pullRequest:($p + {commits:{nodes:[{commit:{oid:"1111111111111111111111111111111111111111",statusCheckRollup:$r}}]}})}}}'
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
  [ "$(jq -r .head <<<"$output")" = "$HEAD_SHA" ]
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

@test "a branch that must be updated first (BEHIND) is unknown, not ready" {
  MOCK_GH_MR_BODY=$(state_body 'mergeStateStatus="BEHIND"')
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
  with_ledger_files
  export MR_LEDGER='{"7":{"pending":3,"attention":0,"merge_blocking":2}}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .ledger <<<"$output")" = '{"status":"read","mergeBlocking":2,"skipped":0}' ]
  [ "$(jq -c .blockers <<<"$output")" = '["ledger_findings"]' ]
}

@test "CLAUDE-190: a ledger with skipped records is partial and unknown, not ready" {
  with_ledger_files
  export MR_LEDGER='{"7":{"pending":0,"attention":0,"merge_blocking":0,"skipped":1}}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .ledger <<<"$output")" = '{"status":"partial","mergeBlocking":0,"skipped":1}' ]
  [ "$(jq -c .unknowns <<<"$output")" = '["ledger"]' ]
  [ "$(jq -r .verdict <<<"$output")" = unknown ]
  [[ "$stderr" == *"1 unreadable records"* ]]
}

@test "CLAUDE-190: skipped records do not hide the read findings' blocker" {
  with_ledger_files
  export MR_LEDGER='{"7":{"pending":2,"attention":0,"merge_blocking":1,"skipped":2}}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["ledger_findings"]' ]
  [ "$(jq -c .unknowns <<<"$output")" = '["ledger"]' ]
}

@test "a PR with no ledger files is none, and the library is not called" {
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .ledger.status <<<"$output")" = none ]
  [ ! -e "${BATS_TEST_TMPDIR}/ledger_called" ]
  [ ! -d "$LEDGER_DIR" ]
}

@test "an unreadable ledger is unknown, not ready" {
  with_ledger_files
  export MR_LEDGER_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -r .ledger.status <<<"$output")" = unavailable ]
  [ "$(jq -c .unknowns <<<"$output")" = '["ledger"]' ]
}

@test "a checkout of another repository does not read its ledger" {
  with_ledger_files
  export MR_LEDGER='{"7":{"pending":3,"attention":0,"merge_blocking":2}}'
  run --separate-stderr "$SCRIPT" other/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .ledger.status <<<"$output")" = other_repo ]
  [ ! -e "${BATS_TEST_TMPDIR}/ledger_called" ]
}

@test "outside a git checkout the ledger is none" {
  mkdir -p "${BATS_TEST_TMPDIR}/plain"
  cd "${BATS_TEST_TMPDIR}/plain"
  GIT_CEILING_DIRECTORIES="${BATS_TEST_TMPDIR}" run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .ledger.status <<<"$output")" = none ]
}

@test "a missing temp directory still prints the full report shape" {
  TMPDIR="${BATS_TEST_TMPDIR}/nonexistent" run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -r .verdict <<<"$output")" = unknown ]
  [ "$(jq -r 'has("ci") and has("ledger") and has("mergeable")' <<<"$output")" = true ]
}

@test "makes no write calls to GitHub" {
  run --separate-stderr "$SCRIPT" test/repo 7
  ! grep -qiE 'mutation|-X (POST|PATCH|PUT|DELETE)|--method' "${BATS_TEST_TMPDIR}/mock_gh_any_call"
}

# --- CLAUDE-234: approval by risk ---

@test "CLAUDE-234: a low-tier PR needs no human and stays ready under enforce" {
  config 'review_approval_gate: enforce'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -c '.approval | {mode, tier, policy, required, missing}' <<<"$output")" = '{"mode":"enforce","tier":"low","policy":"default_branch","required":0,"missing":[]}' ]
  [ "$(jq -c .approval.extras <<<"$output")" = '{"crossLineage":null,"freshReview":null}' ]
}

@test "CLAUDE-234: advisory lists a missing approval without changing the verdict" {
  with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .verdict <<<"$output")" = ready ]
  [ "$(jq -c '.approval | {mode, tier, required, missing}' <<<"$output")" = '{"mode":"advisory","tier":"medium","required":1,"missing":["approval_required"]}' ]
  [ "$(jq -r .approval.humanApproval <<<"$output")" = null ]
}

@test "CLAUDE-234: enforce blocks a medium PR with no human approval" {
  config 'review_approval_gate: enforce'
  with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_required"]' ]
}

@test "CLAUDE-234: a listed human's approval on the head SHA readies a medium PR" {
  config 'review_approval_gate: enforce'
  REVIEWS="[$(rv APPROVED Test User "$HEAD_SHA")]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -c .approval.humanApproval <<<"$output")" = "{\"login\":\"Test\",\"commit\":\"$HEAD_SHA\",\"via\":\"review\"}" ]
  [ "$(jq -c .approval.missing <<<"$output")" = '[]' ]
}

@test "CLAUDE-234: the owner adding graphite-queue after the head arrived approves" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -c .approval.humanApproval <<<"$output")" = "{\"login\":\"Test\",\"commit\":\"$HEAD_SHA\",\"via\":\"label\",\"at\":\"2026-11-02T10:05:00Z\"}" ]
  [ "$(jq -c .approval.missing <<<"$output")" = '[]' ]
}

@test "CLAUDE-234: a label added before the head's push is stale, whatever the commit date" {
  config 'review_approval_gate: enforce'
  # Committed long before, pushed (first check suite) after the label.
  HEAD_AT=2026-11-01T00:00:00Z SUITE_AT=2026-11-02T11:00:00Z \
    LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_stale"]' ]
  [ "$(jq -r .approval.humanApproval <<<"$output")" = null ]
}

@test "CLAUDE-234: other labels, bots and unlisted accounts never approve by label" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z other),$(lb Test Bot 2026-11-02T10:05:00Z),$(lb 'test[bot]' User 2026-11-02T10:05:00Z),$(lb mallory User 2026-11-02T10:05:00Z)]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_required"]' ]
}

@test "CLAUDE-234: a label with no readable head time is unknown, not approval" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  MOCK_GH_MRA_BODY=$(jq -c 'del(.data.repository.pullRequest.commits)' <<<"$MOCK_GH_MRA_BODY")
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .approval.missing <<<"$output")" = '["head_time_unknown"]' ]
  [ "$(jq -c .unknowns <<<"$output")" = '["approval"]' ]
}

@test "CLAUDE-234: a head with no check suite has no arrival time, so a label cannot approve it" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  MOCK_GH_MRA_BODY=$(jq -c '.data.repository.pullRequest.commits.nodes[0].commit.checkSuites.nodes = []' <<<"$MOCK_GH_MRA_BODY")
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .approval.missing <<<"$output")" = '["head_time_unknown"]' ]
}

@test "CLAUDE-234: the files API line counts reach the size rule, so a large low-path change is medium" {
  config 'review_approval_gate: enforce'
  ADDED=1000 with_files docs/a.md
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -r .approval.tier <<<"$output")" = medium ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_required"]' ]
}

@test "CLAUDE-234: a file without line counts makes a low-path change medium" {
  config 'review_approval_gate: enforce'
  with_files docs/a.md
  MOCK_GH_MR_FILES='[{"filename":"docs/a.md"}]'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = medium ]
}

@test "CLAUDE-234: a check suite from another branch is not evidence of this PR's push" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  MOCK_GH_MRA_BODY=$(jq -c '.data.repository.pullRequest.commits.nodes[0].commit.checkSuites.nodes[0].branch.name = "elsewhere"' <<<"$MOCK_GH_MRA_BODY")
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .approval.missing <<<"$output")" = '["head_time_unknown"]' ]
}

@test "CLAUDE-234: a force push to the head after the label makes the label stale" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z),{\"createdAt\":\"2026-11-02T10:30:00Z\",\"afterCommit\":{\"oid\":\"$HEAD_SHA\"}}]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_stale"]' ]
}

@test "CLAUDE-234: removing the label revokes its approval" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  MOCK_GH_MRA_BODY=$(jq -c '.data.repository.pullRequest.labels.nodes = []' <<<"$MOCK_GH_MRA_BODY")
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_required"]' ]
}

@test "CLAUDE-234: a timeline longer than the events read leaves a label's head time unknown" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  MOCK_GH_MRA_BODY=$(jq -c '.data.repository.pullRequest.timelineItems.pageInfo.hasPreviousPage = true' <<<"$MOCK_GH_MRA_BODY")
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .approval.missing <<<"$output")" = '["head_time_unknown"]' ]
}

@test "CLAUDE-234: a head that moves before the check ends leaves the approval unknown" {
  config 'review_approval_gate: enforce'
  LABELS="[$(lb Test User 2026-11-02T10:05:00Z)]" with_files src/a.js
  MOCK_GH_MRH_OID=$OLD_SHA run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -r .approval.tier <<<"$output")" = unknown ]
  [ "$(jq -r .approval.humanApproval <<<"$output")" = null ]
}

@test "CLAUDE-234: a User account named like the cross-lineage bot does not count" {
  config 'review_approval_gate: enforce'
  REVIEWS="[$(rv APPROVED Test User "$HEAD_SHA"),$(rv COMMENTED chatgpt-codex-connector User "$HEAD_SHA")]" with_files plugins/x/hooks/h.sh
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = high ]
  [ "$(jq -r .approval.extras.crossLineage <<<"$output")" = false ]
}

@test "CLAUDE-234: an approval on an older commit is stale" {
  config 'review_approval_gate: enforce'
  REVIEWS="[$(rv APPROVED test User "$OLD_SHA"),$(rv COMMENTED test User "$HEAD_SHA")]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_stale"]' ]
  [ "$(jq -r .approval.humanApproval <<<"$output")" = null ]
}

@test "CLAUDE-234: a bot's or an unlisted account's approval never counts" {
  config 'review_approval_gate: enforce'
  REVIEWS="[$(rv APPROVED test Bot "$HEAD_SHA"),$(rv APPROVED 'test[bot]' User "$HEAD_SHA"),$(rv APPROVED mallory User "$HEAD_SHA")]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_required"]' ]
}

@test "CLAUDE-234: review_approval_humans replaces the owner default" {
  config 'review_approval_gate: enforce' 'review_approval_humans: [alice, "bob"]'
  REVIEWS="[$(rv APPROVED bob User "$HEAD_SHA")]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .approval.humanApproval.login <<<"$output")" = bob ]
  REVIEWS="[$(rv APPROVED test User "$HEAD_SHA")]" with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
}

@test "CLAUDE-234: high with approval and a cross-lineage review on head: fresh review is unknown" {
  REVIEWS="[$(rv APPROVED test User "$HEAD_SHA"),$(rv COMMENTED chatgpt-codex-connector Bot "$HEAD_SHA")]" with_files plugins/x/hooks/a.sh docs/a.md
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -c '.approval | {tier, required, extras, missing}' <<<"$output")" = '{"tier":"high","required":1,"extras":{"crossLineage":true,"freshReview":null},"missing":["fresh_review_unknown"]}' ]
  config 'review_approval_gate: enforce'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .unknowns <<<"$output")" = '["approval"]' ]
  [ "$(jq -c .blockers <<<"$output")" = '[]' ]
}

@test "CLAUDE-234: high without a cross-lineage review on head blocks under enforce" {
  config 'review_approval_gate: enforce'
  REVIEWS="[$(rv APPROVED test User "$HEAD_SHA"),$(rv COMMENTED chatgpt-codex-connector Bot "$OLD_SHA")]" with_files plugins/x/hooks/a.sh
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .blockers <<<"$output")" = '["cross_lineage_missing"]' ]
  [ "$(jq -r .approval.extras.crossLineage <<<"$output")" = false ]
}

@test "CLAUDE-234: high with neither approval nor extras lists every token" {
  config 'review_approval_gate: enforce' 'review_cross_lineage_bots:' '  - "other-reviewer[bot]"'
  REVIEWS="[$(rv COMMENTED chatgpt-codex-connector Bot "$HEAD_SHA")]" with_files plugins/x/hooks/a.sh
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 1 ]
  [ "$(jq -c .approval.missing <<<"$output")" = '["approval_required","cross_lineage_missing","fresh_review_unknown"]' ]
  [ "$(jq -c .blockers <<<"$output")" = '["approval_required","cross_lineage_missing"]' ]
  [ "$(jq -c .unknowns <<<"$output")" = '["approval"]' ]
}

@test "CLAUDE-234: off makes no approval calls" {
  config 'review_approval_gate: off'
  with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -c .approval <<<"$output")" = '{"mode":"off","tier":null,"policy":null,"required":null,"humanApproval":null,"extras":{"crossLineage":null,"freshReview":null},"missing":[]}' ]
  [ ! -e "${BATS_TEST_TMPDIR}/mock_gh_approval_called" ]
  ! grep -q -- '/files\|/contents/' "${BATS_TEST_TMPDIR}/mock_gh_any_call"
}

@test "CLAUDE-234: the policy is read at the default branch tip, never the PR head or base" {
  with_files plugins/x/hooks/a.sh
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = high ]
  grep -q -- "contents/.github/review-risk.json?ref=$DEFAULT_OID" "${BATS_TEST_TMPDIR}/mock_gh_contents_args"
  ! grep -q -- "ref=$HEAD_SHA" "${BATS_TEST_TMPDIR}/mock_gh_contents_args"
}

@test "CLAUDE-234: no policy on the default branch is default medium" {
  export MOCK_GH_MR_POLICY_FAIL=404
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -c '.approval | {tier, policy}' <<<"$output")" = '{"tier":"medium","policy":"none"}' ]
}

@test "CLAUDE-234: an invalid policy fails closed to high" {
  MOCK_GH_MR_POLICY='{"version":2}'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -c '.approval | {tier, policy}' <<<"$output")" = '{"tier":"high","policy":"invalid"}' ]
}

@test "CLAUDE-234: an unreadable policy leaves the tier unknown" {
  export MOCK_GH_MR_POLICY_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -c '.approval | {tier, required, missing}' <<<"$output")" = '{"tier":"unknown","required":null,"missing":["tier_unknown"]}' ]
  config 'review_approval_gate: enforce'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .unknowns <<<"$output")" = '["approval"]' ]
}

@test "CLAUDE-234: a failed approval lookup is unknown under enforce" {
  config 'review_approval_gate: enforce'
  export MOCK_GH_MRA_FAIL=1
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 3 ]
  [ "$(jq -c .approval.missing <<<"$output")" = '["tier_unknown"]' ]
  [[ "$stderr" == *"approval lookup failed"* ]]
}

@test "CLAUDE-234: a head that moved during the check leaves the tier unknown" {
  MOCK_GH_MRA_BODY=$(approval_body '[]' 1 "$OLD_SHA")
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = unknown ]
  [[ "$stderr" == *"head moved"* ]]
}

@test "CLAUDE-234: a file list shorter than changedFiles leaves the tier unknown" {
  MOCK_GH_MRA_BODY=$(approval_body '[]' 5)
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = unknown ]
}

@test "CLAUDE-234: a renamed file's old path and an unsafe name count toward the tier" {
  MOCK_GH_MR_FILES='[{"filename":"docs/a.md","previous_filename":"plugins/x/hooks/a.sh"}]'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = high ]
  MOCK_GH_MR_FILES='[{"filename":"docs/a\nb.md"}]'
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.tier <<<"$output")" = high ]
}

@test "CLAUDE-234: a tracked config file is ignored" {
  config 'review_approval_gate: enforce'
  git -C "$CHECKOUT" add yellow-plugins.local.md
  with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .approval.mode <<<"$output")" = advisory ]
  [[ "$stderr" == *"tracked"* ]]
}

@test "CLAUDE-234: a checkout of another repository does not supply the config" {
  config 'review_approval_gate: enforce'
  with_files src/a.js
  run --separate-stderr "$SCRIPT" other/repo 7
  [ "$status" -eq 0 ]
  [ "$(jq -r .approval.mode <<<"$output")" = advisory ]
}

@test "CLAUDE-234: invalid config values warn and use the defaults" {
  config 'review_approval_gate: strict' 'review_approval_humans: [bad login]'
  with_files src/a.js
  run --separate-stderr "$SCRIPT" test/repo 7
  [ "$(jq -r .approval.mode <<<"$output")" = advisory ]
  [[ "$stderr" == *"review_approval_gate is invalid"* ]]
  [[ "$stderr" == *"review_approval_humans has an invalid login"* ]]
}
