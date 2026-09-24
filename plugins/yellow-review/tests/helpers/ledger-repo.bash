# Shared fixtures for review-ledger.bats: a throwaway repository with a
# bare "origin", the mock gh on PATH, and a finding-JSON builder.
# shellcheck shell=bash

RL="$(cd "$BATS_TEST_DIRNAME/.." && pwd)/lib/review-ledger.sh"
LEDGER_PR=12

ledger_repo_init() {
  export MOCK_GH_PR_STATE=OPEN
  unset MOCK_GH_FAIL
  mkdir -p "$BATS_TEST_TMPDIR/bin"
  ln -sf "$BATS_TEST_DIRNAME/mocks/gh" "$BATS_TEST_TMPDIR/bin/gh"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
  ORIGIN="$BATS_TEST_TMPDIR/origin.git"
  REPO="$BATS_TEST_TMPDIR/repo"
  git init -q --bare -b main "$ORIGIN"
  git init -q -b main "$REPO"
  cd "$REPO" || return 1
  git config user.email test@test.com
  git config user.name Test
  git config commit.gpgsign false
  git remote add origin "$ORIGIN"
  LEDGER_DIR="$REPO/.git/yellow-review/findings"
}

commit_all() {
  git add -A
  git commit -q -m "$1"
  git rev-parse HEAD
}

# finding <file> <line> [jq-object-overrides]
finding() {
  local o="${3:-}"
  [ -n "$o" ] || o='{}'
  jq -cn --arg f "$1" --argjson l "$2" --argjson o "$o" '{
    title: "possible defect", severity: "P2", category: "correctness",
    rule: "logic-error", scope: "unscoped", file: $f, line: $l, confidence: 75,
    autofix_class: "gated_auto", owner: "downstream-resolver",
    requires_verification: true, pre_existing: false, suggested_fix: null,
    reviewer: "correctness-reviewer"} + $o'
}

# observe <head> <json-array> [extra args]  — base defaults to head
observe() {
  local head="$1" arr="$2"
  shift 2
  printf '%s' "$arr" | "$RL" observe "$LEDGER_PR" --head "$head" --base "${OBS_BASE:-$head}" --step 6 --run-id "run-$RANDOM-$RANDOM" "$@"
}

fold() { "$RL" fold "$LEDGER_PR"; }

# finding ids ordered by file, then line
ids() { fold | jq -r '.findings | sort_by(.obs.file, .obs.line) | .[].finding_id'; }

state_of() { fold | jq -r --arg id "$1" '.findings[] | select(.finding_id == $id) | .state'; }

transition() { "$RL" transition "$LEDGER_PR" "$@"; }
