#!/usr/bin/env bats
# setup-all-installed-plugins.bats — the Installed Plugins rows and the gt
# probe in commands/setup/all.md, extracted at run time between their
# setup-all-installed-plugins and setup-all-gt-probe markers (CLAUDE-398).

bats_require_minimum_version 1.5.0

setup() {
  ALL="$BATS_TEST_DIRNAME/../commands/setup/all.md"
  BLOCK="$BATS_TEST_TMPDIR/installed.sh"
  sed -n '/# setup-all-installed-plugins:start/,/# setup-all-installed-plugins:end/p' \
    "$ALL" > "$BLOCK"
  [ -s "$BLOCK" ]
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
}

# cache_copy <name> — leave a copy of <name> in the plugin cache.
cache_copy() {
  local dir="$HOME/.claude/plugins/cache/yellow-plugins/$1/1.0.0/.claude-plugin"
  mkdir -p "$dir"
  printf '{"name":"%s"}\n' "$1" > "$dir/plugin.json"
}

# installed <list-ok 0|1> <plugin list JSON>
installed() {
  run bash -c '_plugin_list_ok="$1"; _plugin_list_json="$2"; repo_top="$3"; . "$4"' \
    _ "$1" "$2" "$REPO" "$BLOCK"
}

row() { # row <name> <scope> <enabled> [projectPath]
  printf '{"id":"%s@yellow-plugins","scope":"%s","enabled":%s%s}' "$1" "$2" "$3" \
    "${4:+,\"projectPath\":\"$4\"}"
}

@test "the plugin list decides: enabled, disabled and absent plugins" {
  installed 1 "[$(row yellow-ci user true),$(row yellow-debt user false)]"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugin_source: claude plugin list --json"* ]]
  [[ "$output" == *"yellow-ci:             installed"* ]]
  [[ "$output" == *"yellow-debt:           NOT ENABLED (installed, disabled for this repository)"* ]]
  [[ "$output" == *"yellow-docs:           NOT INSTALLED"$'\n'* ]]
}

@test "a cached copy the list does not know is a stale copy, not installed" {
  cache_copy yellow-docs
  installed 1 "[$(row yellow-ci user true)]"
  [[ "$output" == *"yellow-docs:           NOT INSTALLED (stale copy in plugin cache only)"* ]]
}

@test "a project install for another repository has its own status" {
  cache_copy yellow-docs
  installed 1 "[$(row yellow-docs project true /elsewhere)]"
  [[ "$output" == *"yellow-docs:           NOT INSTALLED (installed for another project)"* ]]
  [[ "$output" != *"stale copy"* ]]
}

@test "a project install for this repository counts" {
  installed 1 "[$(row yellow-docs project true "$REPO"),$(row yellow-ci local false "$REPO")]"
  [[ "$output" == *"yellow-docs:           installed"* ]]
  [[ "$output" == *"yellow-ci:             NOT ENABLED"* ]]
}

@test "without the plugin list, the cache is the fallback and says so" {
  cache_copy yellow-docs
  installed 0 ""
  [[ "$output" == *"plugin_source: plugin cache"* ]]
  [[ "$output" == *"yellow-docs:           installed"* ]]
  [[ "$output" == *"yellow-ci:             NOT INSTALLED"* ]]
}

@test "with neither the list nor a cache, nothing is reported as not installed" {
  installed 0 ""
  [[ "$output" == *"plugin_cache: NOT FOUND"* ]]
  [[ "$output" != *"NOT INSTALLED"* ]]
}

@test "github as the stack provider skips the gt probe" {
  local gblock="$BATS_TEST_TMPDIR/gt.sh" stubs="$BATS_TEST_TMPDIR/stubs"
  sed -n '/# setup-all-gt-probe:start/,/# setup-all-gt-probe:end/p' "$ALL" > "$gblock"
  [ -s "$gblock" ]
  mkdir -p "$stubs"
  printf '#!/bin/sh\necho called >> "%s/gt.log"\necho 1.7.0\n' "$BATS_TEST_TMPDIR" > "$stubs/gt"
  chmod +x "$stubs/gt"
  run bash -c '_gt="$1/gt"; _stack_target=github; . "$2"' _ "$stubs" "$gblock"
  [[ "$output" == *"gt:                 SKIPPED (stack provider is github)"* ]]
  [[ "$output" == *"gt_mcp_check:       SKIPPED (stack provider is github)"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/gt.log" ]
  run bash -c '_gt="$1/gt"; _stack_target=graphite; . "$2"' _ "$stubs" "$gblock"
  [[ "$output" == *"gt:                 OK (1.7.0)"* ]]
  [[ "$output" == *"gt_mcp_check:       ok"* ]]
}
