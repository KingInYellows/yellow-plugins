#!/usr/bin/env bats
# Offline checks for the yellow-core root lookup inlined in
# commands/stack/status.md and skills/stack-provider-router/SKILL.md.
# The marked Node program is the resolver. These tests never read the
# real installed_plugins.json and never invoke claude.

setup() {
  command -v node >/dev/null 2>&1 || skip "node not installed"
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  STATUS_MD="$REPO_ROOT/plugins/yellow-core/commands/stack/status.md"
  ROUTER_MD="$REPO_ROOT/plugins/yellow-core/skills/stack-provider-router/SKILL.md"
  TMP="$(mktemp -d)"
  PROGRAM="$TMP/resolve.js"
  awk '
    /\/\/ YCR_RESOLVE_START/ { p = 1 }
    p { print }
    /\/\/ YCR_RESOLVE_END/ { exit }
  ' "$STATUS_MD" > "$PROGRAM"
  [ -s "$PROGRAM" ]
}

teardown() {
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf "$TMP"
  return 0
}

make_lib() {
  mkdir -p "$1/lib"
  printf 'module.exports = {};\n' > "$1/lib/stack-provider-state.js"
}

write_installed() {
  local file="$1"
  local body="$2"
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$body" > "$file"
}

@test "marked resolver programs are byte-identical" {
  local router="$TMP/router.js"
  awk '
    /\/\/ YCR_RESOLVE_START/ { p = 1 }
    p { print }
    /\/\/ YCR_RESOLVE_END/ { exit }
  ' "$ROUTER_MD" > "$router"
  cmp -s "$PROGRAM" "$router"
}

@test "CLAUDE_PLUGIN_ROOT wins over checkout and installed cache" {
  make_lib "$TMP/env/yellow-core"
  make_lib "$TMP/checkout/plugins/yellow-core"
  make_lib "$TMP/cache/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/cache/yellow-core"}]}}
JSON
)"
  run node "$PROGRAM" "$TMP/env/yellow-core" "$TMP/checkout" "$TMP/installed.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(realpath "$TMP/env/yellow-core")" ]
}

@test "checkout wins over installed cache when plugin root is unset" {
  make_lib "$TMP/checkout/plugins/yellow-core"
  make_lib "$TMP/cache/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/cache/yellow-core"}]}}
JSON
)"
  run node "$PROGRAM" "" "$TMP/checkout" "$TMP/installed.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(realpath "$TMP/checkout/plugins/yellow-core")" ]
}

@test "one user-scope installPath is used when env and checkout are absent" {
  make_lib "$TMP/cache/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/cache/yellow-core"}]}}
JSON
)"
  run node "$PROGRAM" "" "$TMP/empty-checkout" "$TMP/installed.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(realpath "$TMP/cache/yellow-core")" ]
}

@test "local scope beats user scope" {
  make_lib "$TMP/user/yellow-core"
  make_lib "$TMP/local/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/user/yellow-core"},{"scope":"local","installPath":"$TMP/local/yellow-core","projectPath":"$TMP/repo"}]}}
JSON
)"
  run node "$PROGRAM" "" "$TMP/repo" "$TMP/installed.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(realpath "$TMP/local/yellow-core")" ]
}

@test "a foreign local install does not beat this checkout's user install" {
  make_lib "$TMP/user/yellow-core"
  make_lib "$TMP/foreign/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/user/yellow-core"},{"scope":"local","installPath":"$TMP/foreign/yellow-core","projectPath":"$TMP/other-repo"}]}}
JSON
)"
  run node "$PROGRAM" "" "$TMP/repo" "$TMP/installed.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(realpath "$TMP/user/yellow-core")" ]
}

@test "two foreign local installs do not error when this checkout has a user install" {
  make_lib "$TMP/user/yellow-core"
  make_lib "$TMP/other-a/yellow-core"
  make_lib "$TMP/other-b/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/user/yellow-core"},{"scope":"local","installPath":"$TMP/other-a/yellow-core","projectPath":"$TMP/other-a"},{"scope":"local","installPath":"$TMP/other-b/yellow-core","projectPath":"$TMP/other-b"}]}}
JSON
)"
  run node "$PROGRAM" "" "$TMP/repo" "$TMP/installed.json"
  [ "$status" -eq 0 ]
  [ "$output" = "$(realpath "$TMP/user/yellow-core")" ]
}

@test "two user-scope install paths are an error and print no path" {
  make_lib "$TMP/a/yellow-core"
  make_lib "$TMP/b/yellow-core"
  write_installed "$TMP/installed.json" "$(cat <<JSON
{"plugins":{"yellow-core@yellow-plugins":[{"scope":"user","installPath":"$TMP/a/yellow-core"},{"scope":"user","installPath":"$TMP/b/yellow-core"}]}}
JSON
)"
  run node "$PROGRAM" "" "" "$TMP/installed.json"
  [ "$status" -eq 1 ]
  [[ "$output" == stack_provider_error:*same\ scope* ]]
  [[ "$output" != *"$TMP/a/yellow-core"* ]]
  [[ "$output" != *"$TMP/b/yellow-core"* ]]
}

@test "a symlink library is rejected" {
  make_lib "$TMP/real/yellow-core"
  mkdir -p "$TMP/link/yellow-core/lib"
  ln -s "$TMP/real/yellow-core/lib/stack-provider-state.js" \
    "$TMP/link/yellow-core/lib/stack-provider-state.js"
  run node "$PROGRAM" "$TMP/link/yellow-core" "" "$TMP/missing.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *'yellow-core library not found'* ]]
}

@test "a relative plugin root is rejected" {
  run node "$PROGRAM" "yellow-core" "" "$TMP/missing.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *'yellow-core library not found'* ]]
}

@test "a plugin root containing a newline is rejected" {
  run node "$PROGRAM" $'/tmp/yellow-core\n/evil' "" "$TMP/missing.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *'yellow-core library not found'* ]]
}

@test "a directory whose real path is not yellow-core is rejected" {
  mkdir -p "$TMP/not-core/lib"
  printf 'module.exports = {};\n' > "$TMP/not-core/lib/stack-provider-state.js"
  run node "$PROGRAM" "$TMP/not-core" "" "$TMP/missing.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *'yellow-core library not found'* ]]
}

@test "no env, no checkout library, and no install record stops without a path" {
  run node "$PROGRAM" "" "$TMP/empty-checkout" "$TMP/missing.json"
  [ "$status" -eq 1 ]
  [[ "$output" == *'yellow-core library not found'* ]]
}

@test "status command does not call claude when the library cannot be resolved" {
  local bindir="$TMP/bin"
  local log="$TMP/claude.log"
  local script="$TMP/status.sh"
  mkdir -p "$bindir" "$TMP/empty-repo" "$TMP/config"
  cat > "$bindir/git" <<'SH'
#!/bin/sh
if [ "$1" = "rev-parse" ]; then
  printf '%s\n' "$FAKE_GIT_ROOT"
  exit 0
fi
exit 1
SH
  cat > "$bindir/claude" <<'SH'
#!/bin/sh
printf 'called\n' >> "$CLAUDE_LOG"
exit 0
SH
  chmod +x "$bindir/git" "$bindir/claude"
  awk '
    /^```bash$/ { n++; if (n == 1) { p = 1; next } }
    p && /^```$/ { exit }
    p { print }
  ' "$STATUS_MD" > "$script"
  run env -u CLAUDE_PLUGIN_ROOT \
    FAKE_GIT_ROOT="$TMP/empty-repo" \
    CLAUDE_LOG="$log" \
    CLAUDE_CONFIG_DIR="$TMP/config" \
    PATH="$bindir:$PATH" \
    bash "$script"
  [ "$status" -eq 0 ]
  [[ "$output" == *'yellow-core library not found'* ]]
  [[ "$output" != *'=== classification ==='* ]]
  [ ! -s "$log" ]
}
