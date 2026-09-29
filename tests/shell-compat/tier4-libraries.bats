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
