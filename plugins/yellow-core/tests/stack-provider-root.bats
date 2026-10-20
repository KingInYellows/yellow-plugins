#!/usr/bin/env bats
# Pins and exercises the yellow-core root lookup shared by
# commands/stack/status.md and skills/stack-provider-router/SKILL.md.
# The lookup is inlined in both files (a shell helper cannot be found
# before the library path is known). Run from the plugin directory:
# `bats tests/stack-provider-root.bats`

setup() {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  STATUS_MD="$PLUGIN_DIR/commands/stack/status.md"
  ROUTER_MD="$PLUGIN_DIR/skills/stack-provider-router/SKILL.md"
  TMP="$(mktemp -d)"
  unset CLAUDE_PLUGIN_ROOT GROK_PLUGIN_ROOT plugin_json repo_root
  # shellcheck disable=SC1090
  eval "$(awk '/# yellow-core-root:start/,/# yellow-core-root:end/' "$STATUS_MD")"
}

teardown() {
  unset CLAUDE_PLUGIN_ROOT GROK_PLUGIN_ROOT plugin_json repo_root
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf "$TMP"
  return 0
}

make_root() {
  mkdir -p "$1/lib"
  printf 'file\n' >"$1/lib/stack-provider-state.js"
  printf 'file\n' >"$1/lib/stack-tooling-probe.js"
}

root_block() {
  awk '/# yellow-core-root:start/,/# yellow-core-root:end/' "$1"
}

@test "status and router ship the same root lookup" {
  diff -u <(root_block "$STATUS_MD") <(root_block "$ROUTER_MD")
}

@test "both surfaces name GROK_PLUGIN_ROOT and installPath" {
  grep -F 'GROK_PLUGIN_ROOT' "$STATUS_MD"
  grep -F 'installPath' "$STATUS_MD"
  grep -F 'GROK_PLUGIN_ROOT' "$ROUTER_MD"
  grep -F 'installPath' "$ROUTER_MD"
}

@test "a missed root is still stack_provider_error" {
  grep -F 'stack_provider_error: state library not found' "$STATUS_MD"
  grep -F 'stack_provider_error: router library not found' "$ROUTER_MD"
}

@test "the lookup does not walk a sibling plugin path" {
  run grep -F '../yellow-core' "$STATUS_MD"
  [ "$status" -eq 1 ]
  run grep -F '../yellow-core' "$ROUTER_MD"
  [ "$status" -eq 1 ]
  run grep -F '../github-workflow' "$STATUS_MD"
  [ "$status" -eq 1 ]
  run grep -F '../github-workflow' "$ROUTER_MD"
  [ "$status" -eq 1 ]
}

@test "CLAUDE_PLUGIN_ROOT wins over installPath and the checkout" {
  make_root "$TMP/claude"
  make_root "$TMP/install"
  make_root "$TMP/repo/plugins/yellow-core"
  export CLAUDE_PLUGIN_ROOT="$TMP/claude"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/claude" ]
}

@test "GROK_PLUGIN_ROOT is used when CLAUDE_PLUGIN_ROOT is unset" {
  make_root "$TMP/grok"
  make_root "$TMP/install"
  export GROK_PLUGIN_ROOT="$TMP/grok"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/grok" ]
}

@test "an env root missing a library falls through to installPath" {
  mkdir -p "$TMP/claude/lib"
  printf 'file\n' >"$TMP/claude/lib/stack-provider-state.js"
  make_root "$TMP/install"
  export CLAUDE_PLUGIN_ROOT="$TMP/claude"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/install" ]
}

@test "a symlinked library is not a root" {
  make_root "$TMP/real"
  mkdir -p "$TMP/linked/lib"
  ln -s "$TMP/real/lib/stack-provider-state.js" "$TMP/linked/lib/stack-provider-state.js"
  ln -s "$TMP/real/lib/stack-tooling-probe.js" "$TMP/linked/lib/stack-tooling-probe.js"
  make_root "$TMP/install"
  export CLAUDE_PLUGIN_ROOT="$TMP/linked"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/install" ]
}

@test "local installPath beats a user installPath" {
  make_root "$TMP/user"
  make_root "$TMP/local"
  mkdir -p "$TMP/repo"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"local\",\"projectPath\":\"$TMP/repo\",\"installPath\":\"$TMP/local\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/local" ]
}

@test "an empty toplevel drops project and local installs" {
  make_root "$TMP/local"
  make_root "$TMP/user"
  make_root "$TMP/repo/plugins/yellow-core"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"local\",\"projectPath\":\"$TMP/repo\",\"installPath\":\"$TMP/local\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/user" ]
}

@test "a project install matches the toplevel through a symlink" {
  make_root "$TMP/project"
  make_root "$TMP/user"
  mkdir -p "$TMP/real-repo"
  ln -s "$TMP/real-repo" "$TMP/link-repo"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"project\",\"projectPath\":\"$TMP/real-repo\",\"installPath\":\"$TMP/project\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"}]"
  repo_root="$TMP/link-repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/project" ]
}

@test "a plugin-list failure is reported before root resolution and the probe" {
  local file fail_line root_line probe_line
  for file in "$STATUS_MD" "$ROUTER_MD"; do
    fail_line=$(grep -n 'claude plugin list --json` failed' "$file" | head -1 | cut -d: -f1)
    root_line=$(grep -n 'ROOT=$(resolve_yellow_core_root)' "$file" | head -1 | cut -d: -f1)
    probe_line=$(grep -n 'node "$PROBE"' "$file" | head -1 | cut -d: -f1)
    [ -n "$fail_line" ]
    [ -n "$root_line" ]
    [ -n "$probe_line" ]
    [ "$fail_line" -lt "$root_line" ]
    [ "$fail_line" -lt "$probe_line" ]
  done
}

@test "a project installPath for another repository is ignored" {
  make_root "$TMP/other"
  make_root "$TMP/user"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"project\",\"projectPath\":\"$TMP/other-repo\",\"installPath\":\"$TMP/other\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/user" ]
}

@test "a disabled installPath is ignored and the checkout is used" {
  make_root "$TMP/disabled"
  make_root "$TMP/repo/plugins/yellow-core"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":false,\"scope\":\"user\",\"installPath\":\"$TMP/disabled\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/repo/plugins/yellow-core" ]
}

@test "no root at all prints an empty path" {
  plugin_json="[]"
  repo_root="$TMP/empty"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
