#!/usr/bin/env bats
# setup-all-stack-tooling.bats — the stacked-PR tooling probe in
# commands/setup/all.md (extracted at run time between the
# setup-all-stack-tooling markers): the gh-stack version gate and the git
# 2.36 row that github-workflow's READY depends on.

bats_require_minimum_version 1.5.0

setup() {
  STUBS="$BATS_TEST_TMPDIR/stubs"
  mkdir -p "$STUBS"
  cat > "$STUBS/gh" <<'GH'
#!/bin/sh
[ "$1 $2" = "extension list" ] || exit 2
[ -n "$FAKE_EXT_FAIL" ] && exit 1
printf '%b' "$FAKE_EXT_LIST"
GH
  cat > "$STUBS/git" <<'GIT'
#!/bin/sh
[ "$1" = "--version" ] || exit 2
[ -n "$FAKE_GIT_FAIL" ] && exit 1
printf '%s\n' "$FAKE_GIT_VERSION"
GIT
  chmod +x "$STUBS/gh" "$STUBS/git"
  BLOCK="$BATS_TEST_TMPDIR/probe.sh"
  sed -n '/setup-all-stack-tooling:start/,/setup-all-stack-tooling:end/p' \
    "$BATS_TEST_DIRNAME/../commands/setup/all.md" > "$BLOCK"
  [ -s "$BLOCK" ]
  export FAKE_GIT_VERSION='git version 2.43.0'
}

probe() {
  run bash -c 'PATH="$1:$PATH"; _gh="$1/gh"; . "$2"' _ "$STUBS" "$BLOCK"
}

ext() { export FAKE_EXT_LIST="gh stack\tgithub/gh-stack\t$1\n"; }

@test "the tested version and newer ones are OK" {
  ext v0.3.0; probe
  [[ "$output" == *"gh_stack_ext: OK (github/gh-stack 0.3.0)"* ]]
  ext v0.10.1; probe
  [[ "$output" == *"gh_stack_ext: OK (github/gh-stack 0.10.1)"* ]]
}

@test "an older release is OUTDATED" {
  ext v0.2.9; probe
  [[ "$output" == *"gh_stack_ext: OUTDATED (github/gh-stack 0.2.9, needs 0.3.0+)"* ]]
}

@test "a prerelease of the tested version is OUTDATED, a prerelease of a newer one is OK" {
  ext v0.3.0-rc1; probe
  [[ "$output" == *"gh_stack_ext: OUTDATED"* ]]
  ext v0.4.0-rc1; probe
  [[ "$output" == *"gh_stack_ext: OK (github/gh-stack 0.4.0-rc1)"* ]]
}

@test "build metadata never makes a release a prerelease" {
  ext v0.3.0+build-1; probe
  [[ "$output" == *"gh_stack_ext: OK (github/gh-stack 0.3.0+build-1)"* ]]
}

@test "an official row with no version is UNAVAILABLE" {
  export FAKE_EXT_LIST='gh stack\tgithub/gh-stack\t\n'; probe
  [[ "$output" == *"gh_stack_ext: UNAVAILABLE (github/gh-stack version not reported)"* ]]
}

@test "a lookalike is WRONG_OWNER and a failed listing is UNAVAILABLE" {
  export FAKE_EXT_LIST='gh stack\tsomeone/gh-stack\tv9.0.0\n'; probe
  [[ "$output" == *"gh_stack_ext: WRONG_OWNER"* ]]
  export FAKE_EXT_FAIL=1; probe
  [[ "$output" == *"gh_stack_ext: UNAVAILABLE (could not query extensions)"* ]]
}

@test "git 2.36 and newer are OK, including vendor suffixes" {
  ext v0.3.0
  FAKE_GIT_VERSION='git version 2.36.0' probe
  [[ "$output" == *"gh_stack_git: OK (git 2.36.0)"* ]]
  FAKE_GIT_VERSION='git version 2.55.0.windows.3' probe
  [[ "$output" == *"gh_stack_git: OK (git 2.55.0)"* ]]
  FAKE_GIT_VERSION='git version 2.39.5 (Apple Git-154)' probe
  [[ "$output" == *"gh_stack_git: OK (git 2.39.5)"* ]]
}

@test "git older than 2.36 is OUTDATED" {
  ext v0.3.0
  FAKE_GIT_VERSION='git version 2.35.9' probe
  [[ "$output" == *"gh_stack_git: OUTDATED (git 2.35.9, gh-stack needs 2.36+)"* ]]
  FAKE_GIT_VERSION='git version 2.9' probe
  [[ "$output" == *"gh_stack_git: OUTDATED (git 2.9.0"* ]]
}

@test "an unreadable git version is UNAVAILABLE, never OK" {
  ext v0.3.0
  FAKE_GIT_FAIL=1 probe
  [[ "$output" == *"gh_stack_git: UNAVAILABLE"* ]]
  FAKE_GIT_VERSION='garbage' probe
  [[ "$output" == *"gh_stack_git: UNAVAILABLE"* ]]
}
