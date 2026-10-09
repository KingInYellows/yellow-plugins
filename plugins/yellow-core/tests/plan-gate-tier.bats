#!/usr/bin/env bats
# Tests for pgp_tier_run (lib/plan-gate-provenance.sh), the Gate C file-provenance
# tier that /plan:complete Phase 4 runs: lookup gating, stale-evidence clearing,
# evidence re-validation and the decision lines. A real temp repo with a bare
# origin; gh is a PATH stub driven by TIER_* env that records every call.

LIB="$BATS_TEST_DIRNAME/../lib/plan-gate-provenance.sh"

setup() {
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  T="$BATS_TEST_TMPDIR"
  CALLS="$T/gh.calls"
  : >|"$CALLS"
  git init -q --bare "$T/origin.git"
  git init -q -b main "$T/work"
  cd "$T/work" || return 1
  git remote add origin "$T/origin.git"
  mkdir plans src
  printf 'demo plan\n' >plans/demo.md
  printf 'code\n' >src/a.txt
  git add .
  git commit -q -m 'feat: deliver demo (#42)'
  git push -q origin main
  SHA=$(git rev-parse HEAD)
  export TIER_BLOB TIER_OBLOB
  TIER_BLOB=$(git rev-parse "HEAD:plans/demo.md")
  TIER_OBLOB=$(git rev-parse "HEAD:src/a.txt")
  PROV="$(git rev-parse --git-path tmp)/plan-complete.provenance"
  mkdir -p "$T/bin"
  cat >|"$T/bin/gh" <<'GH_EOF'
#!/bin/sh
printf '%s\n' "$*" >>"$TIER_CALLS"
case "$*" in
  "repo view"*)
    case "${TIER_REPO:-ok}" in
      rate) echo 'gh: API rate limit exceeded (HTTP 403)' >&2; exit 1 ;;
      timeout) exit 124 ;;
      fail) echo 'gh: some other error' >&2; exit 1 ;;
      *) echo 'o/r' ;;
    esac ;;
  *"/commits/"*"/pulls"*)
    case "${TIER_PULLS:-empty}" in
      rate) echo 'gh: API rate limit exceeded (HTTP 403)' >&2; exit 1 ;;
      garbled) echo 'not json' ;;
      one) echo '[{"number":7,"title":"t","url":"https://example.invalid/7"}]' ;;
      two) echo '[{"number":7,"title":"a","url":"u"},{"number":8,"title":"b","url":"u"}]' ;;
      *) echo '[]' ;;
    esac ;;
  *"/pulls/42/files"*)
    printf '[{"filename":"plans/demo.md","status":"added","sha":"%s"},{"filename":"src/a.txt","status":"added","sha":"%s"}]\n' "$TIER_BLOB" "$TIER_OBLOB" ;;
  *"/pulls/42"*) echo "${TIER_PRSTATE:-closed}" ;;
  *) echo 'unexpected gh call' >&2; exit 2 ;;
esac
GH_EOF
  chmod +x "$T/bin/gh"
  export TIER_CALLS="$CALLS"
  export PATH="$T/bin:$PATH"
}

tier() { # [plan name]
  run bash -c '. "$1"; pgp_tier_run "$2" main' _ "$LIB" "${1:-demo.md}"
}

decision_lines() { printf '%s\n' "$output" | grep -E '^\[plan:complete\] GATE_C_(PROVENANCE|REASON)=' | tr '\n' ' '; }

@test "a unique associated closed PR passes and writes one valid evidence line" {
  TIER_PULLS=one tier
  [ "$status" -eq 0 ]
  [ "$(decision_lines)" = "[plan:complete] GATE_C_PROVENANCE=PASS [plan:complete] GATE_C_REASON=none GATE_C_RETRYABLE=0 " ]
  [ "$(cat "$PROV")" = "pr=#7 sha=$SHA" ]
  [[ $output == *"1 closed PR(s) associated"*"(lookup: ok)"* ]]
  [[ $output == *"begin PR titles (reference only)"* ]]
  ! grep -q '/pulls/42' "$CALLS"
}

@test "a failed lookup never reaches the commit-subject path, is retryable when transient, and reports lookup: failed" {
  TIER_PULLS=rate tier
  [ "$status" -eq 0 ]
  [ "$(decision_lines)" = "[plan:complete] GATE_C_PROVENANCE=FALLTHROUGH [plan:complete] GATE_C_REASON=rate-limited GATE_C_RETRYABLE=1 " ]
  [[ $output == *"0 closed PR(s) associated"*"(lookup: failed)"* ]]
  [ ! -e "$PROV" ]
  ! grep -q '/pulls/42' "$CALLS"
}

@test "a garbled lookup result is a failed lookup, not an empty one" {
  TIER_PULLS=garbled tier
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=lookup-failed GATE_C_RETRYABLE=0"* ]]
  [[ $output == *"(lookup: failed)"* ]]
  [ ! -e "$PROV" ]
  ! grep -q '/pulls/42' "$CALLS"
}

@test "two associated PRs are ambiguous: no pass and no commit-subject path" {
  TIER_PULLS=two tier
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=ambiguous GATE_C_RETRYABLE=0"* ]]
  [ ! -e "$PROV" ]
  ! grep -q '/pulls/42' "$CALLS"
}

@test "an empty successful lookup passes through the commit subject" {
  TIER_PULLS=empty tier
  [ "$status" -eq 0 ]
  [ "$(decision_lines)" = "[plan:complete] GATE_C_PROVENANCE=PASS [plan:complete] GATE_C_REASON=none GATE_C_RETRYABLE=0 " ]
  [ "$(cat "$PROV")" = "pr=#42 sha=$SHA via=commit-subject" ]
  [[ $output == *"Gate C provenance PASS (commit-subject)"* ]]
}

@test "a still-open PR in the commit subject is a retryable no-evidence" {
  TIER_PULLS=empty TIER_PRSTATE=open tier
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=pr-open GATE_C_RETRYABLE=1"* ]]
  [[ $output == *"commit-subject path: no evidence (pull request #42 is still open; retry shortly)"* ]]
  [ ! -e "$PROV" ]
}

@test "a working-tree plan that differs from the plan on trunk skips the whole tier, whichever path would pass" {
  printf 'demo plan, completed on an unlanded branch\n' >plans/demo.md
  for pulls in empty one; do
    TIER_PULLS=$pulls tier
    [ "$status" -eq 0 ]
    [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=wt-differs GATE_C_RETRYABLE=0"* ]] || { echo "pulls=$pulls: $output"; false; }
    [[ $output == *"working-tree plans/demo.md differs from the plan on main"* ]]
    [[ $output == *"(lookup: skipped)"* ]]
    [ ! -e "$PROV" ]
  done
  # Neither the commits lookup nor the PR was even asked for.
  ! grep -q 'commits/' "$CALLS"
  ! grep -q '/pulls/42' "$CALLS"
}

@test "an untracked or missing working-tree plan also skips the tier" {
  rm plans/demo.md
  TIER_PULLS=one tier
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=wt-differs"* ]]
  [ ! -e "$PROV" ]
}

@test "a stale provenance file from an aborted run is cleared and can never pass" {
  mkdir -p "$(dirname "$PROV")"
  printf 'pr=#99 sha=%s\n' "$SHA" >|"$PROV"
  TIER_PULLS=rate tier
  [ "$status" -eq 0 ]
  [ ! -e "$PROV" ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"* ]]
}

@test "a plan trunk no longer has, and a failed fetch, both fall through without a lookup" {
  tier gone.md
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=no-commit"* ]]
  git remote set-url origin "$T/missing.git"
  TIER_PULLS=one tier
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=fetch-failed GATE_C_RETRYABLE=0"* ]]
  [ ! -e "$PROV" ]
  ! grep -q 'commits/' "$CALLS"
}

@test "an archived plan on trunk skips the tier" {
  git rm -q plans/demo.md
  git commit -q -m 'docs: archive demo (#42)'
  git push -q origin main
  TIER_PULLS=one tier
  [ "$status" -eq 0 ]
  [[ $(decision_lines) == *"GATE_C_PROVENANCE=FALLTHROUGH"*"GATE_C_REASON=plan-archived GATE_C_RETRYABLE=0"* ]]
  [[ $output == *"no longer exists on main"*"already archived?"* ]]
  [ ! -e "$PROV" ]
  ! grep -q 'commits/' "$CALLS"
}

@test "the evidence validator accepts only one well-formed line" {
  . "$LIB"
  h=0123456789abcdef0123456789abcdef01234567
  pgp_evidence_line_is_valid "pr=#7 sha=$h"
  pgp_evidence_line_is_valid "pr=#7 sha=$h via=commit-subject"
  for bad in "pr=#0 sha=$h" "pr=#7 sha=${h:0:12}" "pr=#7 sha=$h via=commit-subject extra" "pr=#7 sha=$h via=other" "pr=#7 sha=$h
pr=#8 sha=$h" ""; do
    run pgp_evidence_line_is_valid "$bad"
    [ "$status" -ne 0 ] || { echo "accepted: $bad"; false; }
  done
}

@test "a rate-limited or timed-out repo lookup is a retryable stop; any other failure is no-repo" {
  TIER_REPO=rate tier
  [ "$status" -eq 0 ]
  [ "$(decision_lines)" = "[plan:complete] GATE_C_PROVENANCE=FALLTHROUGH [plan:complete] GATE_C_REASON=rate-limited GATE_C_RETRYABLE=1 " ]
  TIER_REPO=timeout tier
  [ "$(decision_lines)" = "[plan:complete] GATE_C_PROVENANCE=FALLTHROUGH [plan:complete] GATE_C_REASON=gh-timeout GATE_C_RETRYABLE=1 " ]
  TIER_REPO=fail tier
  [ "$(decision_lines)" = "[plan:complete] GATE_C_PROVENANCE=FALLTHROUGH [plan:complete] GATE_C_REASON=no-repo GATE_C_RETRYABLE=0 " ]
  [ ! -e "$PROV" ]
  ! grep -q '/commits/' "$CALLS"
}
