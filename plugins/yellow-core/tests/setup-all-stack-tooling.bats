#!/usr/bin/env bats
# setup-all-stack-tooling.bats — the stacked-PR tooling probe in
# commands/setup/all.md (extracted at run time between the
# setup-all-stack-tooling markers): the gh-stack version gate and the git
# 2.36 row that github-workflow's READY depends on; and the
# setup-all-stack-provider block that decides which provider's CLI runs.

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

@test "graphite as the stack provider skips the gh-stack probe" {
  ext v0.3.0
  run bash -c 'PATH="$1:$PATH"; _gh="$1/gh"; _stack_target=graphite; . "$2"' _ "$STUBS" "$BLOCK"
  [[ "$output" == *"gh_stack_ext: SKIPPED (stack provider is graphite)"* ]]
  [[ "$output" == *"gh_stack_git: SKIPPED (stack provider is graphite)"* ]]
  [[ "$output" != *"gh_stack_ext: OK"* ]]
}

# The setup-all-stack-provider block picks which provider's CLI Step 1 probes.
provider_target() {
  local repo="$BATS_TEST_TMPDIR/repo" pblock="$BATS_TEST_TMPDIR/provider.sh"
  sed -n '/setup-all-stack-provider:start/,/setup-all-stack-provider:end/p' \
    "$BATS_TEST_DIRNAME/../commands/setup/all.md" > "$pblock"
  [ -s "$pblock" ]
  rm -rf "$repo"; mkdir -p "$repo"
  command git -C "$repo" init -q
  [ -n "${1:-}" ] && printf 'provider: %s\n' "$1" > "$repo/.yellow-stack.yml"
  # Only `claude` is stubbed here: the block needs the real git for the
  # repository root.
  local cstubs="$BATS_TEST_TMPDIR/claude-stub"
  mkdir -p "$cstubs"
  cat > "$cstubs/claude" <<'CLAUDE'
#!/bin/sh
[ -n "$FAKE_CLAUDE_FAIL" ] && exit 1
printf '%s' "$FAKE_PLUGIN_LIST"
CLAUDE
  chmod +x "$cstubs/claude"
  local core; core=$(cd "$BATS_TEST_DIRNAME/.." && pwd)
  export FAKE_PLUGIN_LIST="[{\"id\":\"yellow-core@yellow-plugins\",\"scope\":\"user\",\"enabled\":true,\"installPath\":\"$core\"}${2:-}]"
  run bash -c 'cd "$1" && PATH="$2:$PATH" && . "$3"' _ "$repo" "$cstubs" "$pblock"
}

@test "a .yellow-stack.yml intent decides the probe target" {
  provider_target github
  [[ "$output" == *"stack_probe_target: github"* ]]
  provider_target graphite
  [[ "$output" == *"stack_probe_target: graphite"* ]]
}

@test "without an intent the single enabled provider decides, else both" {
  provider_target '' ',{"id":"github-workflow@yellow-plugins","scope":"user","enabled":true,"installPath":"/x"}'
  [[ "$output" == *"stack_probe_target: github"* ]]
  provider_target '' ',{"id":"gt-workflow@yellow-plugins","scope":"user","enabled":false,"installPath":"/x"}'
  [[ "$output" == *"stack_probe_target: both"* ]]
}

@test "an unreadable plugin list probes both providers" {
  FAKE_CLAUDE_FAIL=1 provider_target github
  [[ "$output" == *"stack_probe_target: both"* ]]
}

@test "a stale higher-ranked yellow-core does not hide a current one" {
  local repo="$BATS_TEST_TMPDIR/repo"
  provider_target github ",{\"id\":\"yellow-core@yellow-plugins\",\"scope\":\"local\",\"projectPath\":\"$repo\",\"enabled\":true,\"installPath\":\"$BATS_TEST_TMPDIR\"}"
  [[ "$output" == *"stack_probe_target: github"* ]]
}
