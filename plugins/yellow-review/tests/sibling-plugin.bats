#!/usr/bin/env bats
# Unit tests for lib/sibling-plugin.sh (the sibling-plugin lookup shared by
# review-ledger.sh and resolve-paths.sh)

bats_require_minimum_version 1.5.0

LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/sibling-plugin.sh"

setup() {
  # shellcheck source=../lib/sibling-plugin.sh
  . "$LIB"
  export CLAUDE_CONFIG_DIR="$BATS_TEST_TMPDIR/config"
}

# installed KEY JSON-ENTRIES: write installed_plugins.json with one key.
installed() {
  mkdir -p "$CLAUDE_CONFIG_DIR/plugins"
  printf '{"version":2,"plugins":{"%s":%s}}\n' "$1" "$2" >|"$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
}

# two_versions: cache/mkt with other 1.9.0 and 1.10.0 (both with lib/x.sh).
two_versions() {
  c="$BATS_TEST_TMPDIR/cache/mkt"
  mkdir -p "$c/me/1.0.0" "$c/other/1.9.0/lib" "$c/other/1.10.0/lib"
  : >| "$c/other/1.9.0/lib/x.sh"
  : >| "$c/other/1.10.0/lib/x.sh"
}

@test "sp_sibling_file prefers the source tree sibling" {
  mkdir -p "$BATS_TEST_TMPDIR/plugins/me" "$BATS_TEST_TMPDIR/plugins/other/lib"
  : >| "$BATS_TEST_TMPDIR/plugins/other/lib/x.sh"
  run sp_sibling_file "$BATS_TEST_TMPDIR/plugins/me" other lib/x.sh
  [ "$status" -eq 0 ]
  [ "$output" = "$BATS_TEST_TMPDIR/plugins/me/../other/lib/x.sh" ]
}

@test "sp_sibling_file falls back to the newest numeric version in the cache layout" {
  c="$BATS_TEST_TMPDIR/cache/mkt"
  mkdir -p "$c/me/1.0.0" "$c/other/1.9.0/lib" "$c/other/1.10.0/lib" "$c/other/2.0.0-rc/lib" "$c/other/latest/lib"
  for v in 1.9.0 1.10.0 latest; do : >| "$c/other/$v/lib/x.sh"; done
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$status" -eq 0 ]
  [ "$output" = "$c/me/1.0.0/../../other/1.10.0/lib/x.sh" ]
}

@test "sp_sibling_file prefers the active install over a newer orphaned version" {
  command -v jq >/dev/null || skip "jq is required"
  two_versions
  installed other@mkt "[{\"scope\":\"user\",\"installPath\":\"$c/other/1.9.0\"}]"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$status" -eq 0 ]
  [ "$output" = "$c/me/1.0.0/../../other/1.9.0/lib/x.sh" ]
}

@test "sp_sibling_file lets a project-scoped install for the cwd beat the user-scoped one" {
  command -v jq >/dev/null || skip "jq is required"
  two_versions
  mkdir -p "$c/other/1.8.0/lib" "$BATS_TEST_TMPDIR/proj/sub" "$BATS_TEST_TMPDIR/elsewhere"
  : >| "$c/other/1.8.0/lib/x.sh"
  installed other@mkt "[{\"installPath\":\"$c/other/1.9.0\"},{\"scope\":\"project\",\"projectPath\":\"$BATS_TEST_TMPDIR/proj\",\"installPath\":\"$c/other/1.8.0\"}]"
  cd "$BATS_TEST_TMPDIR/proj/sub"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$output" = "$c/me/1.0.0/../../other/1.8.0/lib/x.sh" ]
  cd "$BATS_TEST_TMPDIR/elsewhere"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$output" = "$c/me/1.0.0/../../other/1.9.0/lib/x.sh" ]
}

@test "sp_sibling_file falls back to the newest version when the active entry is unusable" {
  command -v jq >/dev/null || skip "jq is required"
  two_versions
  # An installPath outside the plugin's cache directory.
  mkdir -p "$BATS_TEST_TMPDIR/outside/1.0.0/lib"
  : >| "$BATS_TEST_TMPDIR/outside/1.0.0/lib/x.sh"
  installed other@mkt "[{\"installPath\":\"$BATS_TEST_TMPDIR/outside/1.0.0\"}]"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$output" = "$c/me/1.0.0/../../other/1.10.0/lib/x.sh" ]
  # A recorded version without the file.
  mkdir -p "$c/other/1.5.0"
  installed other@mkt "[{\"installPath\":\"$c/other/1.5.0\"}]"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$output" = "$c/me/1.0.0/../../other/1.10.0/lib/x.sh" ]
  # Another marketplace's entry, then malformed JSON.
  installed other@elsewhere "[{\"installPath\":\"$c/other/1.9.0\"}]"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$output" = "$c/me/1.0.0/../../other/1.10.0/lib/x.sh" ]
  printf '{not json' >|"$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
  run sp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$status" -eq 0 ]
  [ "$output" = "$c/me/1.0.0/../../other/1.10.0/lib/x.sh" ]
}

@test "sp_sibling_file fails when no sibling has the file" {
  mkdir -p "$BATS_TEST_TMPDIR/plugins/me"
  run sp_sibling_file "$BATS_TEST_TMPDIR/plugins/me" other lib/x.sh
  [ "$status" -eq 1 ]
}

@test "resolve-paths.sh and review-ledger.sh both load the shared helper" {
  for f in resolve-paths.sh review-ledger.sh; do
    run bash -c '. "$1"; declare -F sp_sibling_file' bash "$(dirname "$LIB")/$f"
    [ "$status" -eq 0 ] || { echo "$f does not define sp_sibling_file: $output"; false; }
  done
}

@test "the old per-library copy is gone" {
  run bash -c '. "$1"; declare -F rp_sibling_file' bash "$(dirname "$LIB")/resolve-paths.sh"
  [ "$status" -ne 0 ]
}
