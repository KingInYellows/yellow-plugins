#!/usr/bin/env bats
# Exercises the yellow-core root lookup shared by commands/stack/status.md
# and skills/stack-provider-router/SKILL.md. The lookup is generated from
# scripts/snippets/yellow-core-root.sh (a shell helper cannot be sourced
# before the library path is known). Run from the plugin directory:
# `bats tests/stack-provider-root.bats`

setup() {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  STATUS_MD="$PLUGIN_DIR/commands/stack/status.md"
  ROUTER_MD="$PLUGIN_DIR/skills/stack-provider-router/SKILL.md"
  TMP="$(mktemp -d)"
  unset CLAUDE_PLUGIN_ROOT plugin_json repo_root
  # shellcheck disable=SC1090
  eval "$(root_block "$STATUS_MD")"
}

teardown() {
  unset CLAUDE_PLUGIN_ROOT plugin_json repo_root
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf "$TMP"
  return 0
}

make_root() {
  mkdir -p "$1/lib"
  printf 'file\n' >"$1/lib/stack-provider-state.js"
  printf 'file\n' >"$1/lib/stack-tooling-probe.js"
}

root_block() {
  awk '/# >>> generated: yellow-core-root /,/# <<< generated: yellow-core-root <<</' "$1"
}

@test "both surfaces embed the generated root lookup" {
  grep -F 'scripts/snippets/yellow-core-root.sh' "$STATUS_MD"
  grep -F 'scripts/snippets/yellow-core-root.sh' "$ROUTER_MD"
  grep -F 'resolve_yellow_core_root' "$STATUS_MD"
  grep -F 'resolve_yellow_core_root' "$ROUTER_MD"
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

@test "CLAUDE_PLUGIN_ROOT wins over installPath" {
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

@test "installPath is used when CLAUDE_PLUGIN_ROOT is unset" {
  make_root "$TMP/install"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/install" ]
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

@test "an install path missing a library is not rescued by the checkout" {
  mkdir -p "$TMP/install"
  make_root "$TMP/repo/plugins/yellow-core"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ -z "$output" ]
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

@test "a symlinked plugin root is not a root" {
  make_root "$TMP/real"
  ln -s "$TMP/real" "$TMP/linked"
  make_root "$TMP/install"
  export CLAUDE_PLUGIN_ROOT="$TMP/linked//"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/install" ]
}

@test "a symlinked root reached through a dot component is not a root" {
  make_root "$TMP/real"
  ln -s "$TMP/real" "$TMP/linked"
  make_root "$TMP/install"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/install\"}]"
  repo_root=""
  for root in "$TMP/linked/." "$TMP/linked/lib/.." "$TMP/install/../linked"; do
    export CLAUDE_PLUGIN_ROOT="$root"
    run resolve_yellow_core_root
    [ "$status" -eq 0 ]
    [ "$output" = "$TMP/install" ]
  done
}

@test "a relative root is not a root" {
  make_root "$TMP/rel"
  cd "$TMP"
  export CLAUDE_PLUGIN_ROOT="rel"
  plugin_json="[]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "an install with a symlinked lib directory is skipped" {
  make_root "$TMP/real"
  mkdir -p "$TMP/linked"
  ln -s "$TMP/real/lib" "$TMP/linked/lib"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/linked\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ -z "$output" ]
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

@test "a local install missing a library falls through to a valid user install" {
  mkdir -p "$TMP/local" "$TMP/repo"
  make_root "$TMP/user"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"local\",\"projectPath\":\"$TMP/repo\",\"installPath\":\"$TMP/local\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/user" ]
}

@test "a local install with a symlinked library falls through to a valid user install" {
  make_root "$TMP/real"
  mkdir -p "$TMP/local/lib" "$TMP/repo"
  ln -s "$TMP/real/lib/stack-provider-state.js" "$TMP/local/lib/stack-provider-state.js"
  ln -s "$TMP/real/lib/stack-tooling-probe.js" "$TMP/local/lib/stack-tooling-probe.js"
  make_root "$TMP/user"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"local\",\"projectPath\":\"$TMP/repo\",\"installPath\":\"$TMP/local\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/user" ]
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

@test "an installPath with an unrecognized scope is ignored" {
  make_root "$TMP/odd"
  make_root "$TMP/user"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"weird\",\"installPath\":\"$TMP/odd\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"installPath\":\"$TMP/odd\"},{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":true,\"scope\":\"user\",\"installPath\":\"$TMP/user\"}]"
  repo_root=""
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TMP/user" ]
}

@test "a disabled installPath is ignored and the checkout is not used" {
  make_root "$TMP/disabled"
  make_root "$TMP/repo/plugins/yellow-core"
  plugin_json="[{\"id\":\"yellow-core@yellow-plugins\",\"enabled\":false,\"scope\":\"user\",\"installPath\":\"$TMP/disabled\"}]"
  repo_root="$TMP/repo"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no root at all prints an empty path" {
  plugin_json="[]"
  repo_root="$TMP/empty"
  run resolve_yellow_core_root
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
