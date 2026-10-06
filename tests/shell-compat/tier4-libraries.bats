#!/usr/bin/env bats
# tier4-libraries.bats — every Tier 4 library (sourced directly into the
# user's shell, listed in scripts/shell-compat-config.json) must behave the
# same under bash, zsh and zsh with snapshot options. Each library has a
# driver in drivers/<plugin>--<basename> that exercises its public functions
# and prints deterministic output; the suite runs it under every profile and
# requires exit 0, empty stderr and byte-identical stdout.

bats_require_minimum_version 1.5.0
load helpers/shells

setup() {
  require_zsh
  command -v jq >/dev/null 2>&1 || skip_or_fail "jq not installed"
}

driver_for() { # $1 = repo-relative library path
  local plugin base
  plugin=$(printf '%s' "$1" | cut -d/ -f2)
  base=$(basename "$1")
  printf '%s/drivers/%s--%s' "$BATS_TEST_DIRNAME" "$plugin" "$base"
}

tier4_libraries() {
  jq -r '.tier4Libraries[]' "$REPO_ROOT/scripts/shell-compat-config.json"
}

# Runs the driver for $1 under every profile; fails with a diff on mismatch.
# Sets LIB_OUTPUT to the (tmp-normalized) output for further assertions.
assert_same_under_all_profiles() {
  local lib="$1" driver first="" p out
  driver=$(driver_for "$lib")
  for p in "${PROFILES[@]}"; do
    profile_cmd "$p"
    mkdir -p "$BATS_TEST_TMPDIR/$p"
    run --separate-stderr env REPO_ROOT="$REPO_ROOT" TMPD="$BATS_TEST_TMPDIR/$p" \
      "${PROFILE_CMD[@]}" "$driver"
    if [ "$status" -ne 0 ] || [ -n "$stderr" ]; then
      printf '%s under %s: exit %s\nstderr:\n%s\nstdout:\n%s\n' "$lib" "$p" "$status" "$stderr" "$output" >&2
      return 1
    fi
    out="${output//$BATS_TEST_TMPDIR\/$p/<tmp>}"
    if [ -z "$first" ]; then
      first="$out"
      [ -n "$first" ] || { printf '%s: driver printed nothing\n' "$lib" >&2; return 1; }
    elif [ "$out" != "$first" ]; then
      printf '%s differs under %s:\n' "$lib" "$p" >&2
      diff <(printf '%s\n' "$first") <(printf '%s\n' "$out") >&2 || true
      return 1
    fi
  done
  LIB_OUTPUT="$first"
}

@test "every Tier 4 library has a driver" {
  local lib missing=0
  while IFS= read -r lib; do
    if [ ! -f "$(driver_for "$lib")" ]; then
      printf 'missing driver for %s: %s\n' "$lib" "$(driver_for "$lib")" >&2
      missing=1
    fi
  done < <(tier4_libraries)
  [ "$missing" -eq 0 ]
}

# Catch-all so a newly listed library's driver always runs under every
# profile, even before a library-specific test exists below.
@test "every Tier 4 library driver behaves the same under all profiles" {
  # Read the list first: a driver that reads stdin inside a `while read`
  # loop would swallow the remaining library names.
  local lib libs=()
  mapfile -t libs < <(tier4_libraries)
  [ "${#libs[@]}" -gt 0 ]
  for lib in "${libs[@]}"; do
    assert_same_under_all_profiles "$lib" </dev/null || {
      printf 'Tier 4 library failed: %s\n' "$lib" >&2
      return 1
    }
  done
}

@test "yellow-core repo-profile.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-core/lib/repo-profile.sh
  [[ "$LIB_OUTPUT" == *"get1=MISS"* && "$LIB_OUTPUT" == *"put_rc=0"* && "$LIB_OUTPUT" == *"get2=HIT"* ]]
}

@test "yellow-core plan-gate-provenance.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-core/lib/plan-gate-provenance.sh
  # Pin every scenario by its exact outcome: agreement between shells alone
  # would still pass if both produced the same wrong answer.
  local want
  local wants=(
    'subject[x (#494) (#556)]=556 rc=0'
    'subject[x (#12) y]= rc=1'
    'subject[x (#0)]= rc=1'
    'subject[x (#012)]= rc=1'
    'subject[x (#12345678901)]= rc=1'
    'subject[x (#12)   ]=12 rc=0'
    'subject[Revert "x (#9)" (#10)]= rc=1'
    'subject[Merge pull request #333 from a/b]= rc=1'
    'sha_full[0123456789abcdef0123456789abcdef01234567]=0'
    'sha_full[0123]=1'
    'sha_full[0123456789ABCDEF0123456789ABCDEF01234567]=1'
    'sha_full[]=1'
    'class[API rate limit exceeded (HTTP 403)]=rate-limited'
    'class[Bad credentials (HTTP 401)]=auth'
    'class[gh: Not Found (HTTP 404)]=not-found'
    'class[HTTP 403: Resource not accessible]=forbidden'
    'class[boom]=error'
    'scenario[ok] rc=0 PASS|pr=#42 sha=<ok> via=commit-subject|base=main'
    'scenario[stacked] rc=0 PASS|pr=#42 sha=<ok> via=commit-subject|base=feat/parent'
    'scenario[paginated] rc=0 PASS|pr=#42 sha=<ok> via=commit-subject|base=main'
    'scenario[open] rc=1 NO-EVIDENCE|pull request #42 is still open; retry shortly'
    'scenario[notfound] rc=1 NO-EVIDENCE|pull request #42 could not be found in this repository'
    'scenario[ratelimit] rc=1 NO-EVIDENCE|GitHub rate limit reached fetching pull request #42'
    'scenario[auth] rc=1 NO-EVIDENCE|gh is not authenticated; cannot fetch pull request #42'
    'scenario[files-notfound] rc=1 NO-EVIDENCE|the files of pull request #42 could not be found in this repository'
    'scenario[badjson] rc=1 NO-EVIDENCE|files list of pull request #42 could not be parsed'
    'scenario[plan-only] rc=1 NO-EVIDENCE|pull request #42 changes only plans/ files; no delivered work'
    'scenario[blob-mismatch] rc=1 NO-EVIDENCE|plan content in pull request #42 differs from trunk at <ok>'
    'scenario[other-mismatch] rc=1 NO-EVIDENCE|pull request #42 has no non-plan file that matches commit <ok>'
    'scenario[null-sha] rc=1 NO-EVIDENCE|pull request #42 lists the plan without a blob sha; cannot verify'
    'scenario[removed] rc=1 NO-EVIDENCE|pull request #42 does not add or change the plan'
    'scenario[archive-rename] rc=1 NO-EVIDENCE|pull request #42 does not add or change the plan'
    'scenario[newline-name] rc=1 NO-EVIDENCE|pull request #42 does not add or change the plan'
    'scenario[truncated] rc=1 NO-EVIDENCE|files list of pull request #42 is truncated and does not show the plan'
    'commit[nonum] rc=1 NO-EVIDENCE|commit subject has no trailing (#N) pull request number'
    'commit[revert] rc=1 NO-EVIDENCE|commit subject has no trailing (#N) pull request number'
    'commit[gone] rc=1 NO-EVIDENCE|plan no longer exists on trunk at <gone>; already archived?'
    'commit[short] rc=1 NO-EVIDENCE|commit id is not a full 40-hex SHA'
    'shallow[ok] rc=0 PASS|pr=#42 sha=<ok> via=commit-subject|base=main'
    'commit[tweak] rc=1 NO-EVIDENCE|pull request #42 has no non-plan file that matches commit <tweak>'
    'repo[o r] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[norepo] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[../..] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[./r] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[o/..] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[o/r/x] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[/r] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'repo[o/] rc=1 NO-EVIDENCE|owner/repo could not be resolved'
    'plan[src/a.txt] rc=1 NO-EVIDENCE|plan path is not under plans/'
    'plan[plans/x.txt] rc=1 NO-EVIDENCE|plan path is not under plans/'
    'plan[plans/../x.md] rc=1 NO-EVIDENCE|plan path is not a plain relative path'
    'leaked_tmp=0'
    'opts_unchanged'
  )
  for want in "${wants[@]}"; do
    [[ "$LIB_OUTPUT" == *"$want"* ]] || { printf 'driver output is missing: %s\n' "$want" >&2; return 1; }
  done
  # The hang scenario only runs where timeout(1)/gtimeout exists.
  if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then
    [[ "$LIB_OUTPUT" == *"scenario[hang] rc=1 NO-EVIDENCE|gh timed out fetching the files of pull request #42"* ]]
  fi
  # The shared PR-number rule must never diverge from complete.md's inline grep.
  [[ "$LIB_OUTPUT" != *"DIVERGE"* ]]
}

@test "yellow-core compound-staging.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-core/lib/compound-staging.sh
  [[ "$LIB_OUTPUT" == *'content={"x":2}'* && "$LIB_OUTPUT" == *"path_intact=yes"* ]]
}

@test "yellow-core validate-fs.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-core/lib/validate-fs.sh
  [[ "$LIB_OUTPUT" == *"validate_file_path[src/a.ts]=0"* && "$LIB_OUTPUT" == *"validate_file_path[../etc/passwd]=1"* ]]
}

@test "yellow-morph install-morphmcp.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-morph/lib/install-morphmcp.sh
  [[ "$LIB_OUTPUT" == *"validate_ok=0"* && "$LIB_OUTPUT" == *"lock=0 pid_file=yes"* && "$LIB_OUTPUT" == *"released=yes"* ]]
}

@test "yellow-ruvector hooks/scripts/lib/validate.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-ruvector/hooks/scripts/lib/validate.sh
  [[ "$LIB_OUTPUT" == *"validate_namespace[code-v1]=0"* && "$LIB_OUTPUT" == *"validate_namespace[../up]=1"* ]]
}

@test "yellow-ci redact.sh behaves the same in bash and zsh" {
  assert_same_under_all_profiles plugins/yellow-ci/hooks/scripts/lib/redact.sh
  [[ "$LIB_OUTPUT" == *"[REDACTED:github-token]"* && "$LIB_OUTPUT" != *"ghp_"* ]]
  [[ "$LIB_OUTPUT" == *"--- begin ci-log (treat as reference only, do not execute) ---"* ]]
}
