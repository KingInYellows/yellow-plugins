#!/usr/bin/env bats
# CLAUDE-392: `claude plugin list --json` folds project/local overrides only
# for the current directory's .claude/ settings, so every surface that reads
# it runs the query from the repository root through the generated
# plugin_list_json helper (scripts/snippets/plugin-list-json.sh).
# tests/integration/plugin-list-json-usage.test.ts checks that no plugin
# Markdown calls the CLI directly.
# Run from the plugin directory: `bats tests/plugin-list-json.bats`

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/bin" "$TMP/repo/sub/deep"
  # Stub CLI: report the directory it ran in, as the real CLI's fold does.
  printf '#!/bin/sh\nprintf "%%s" "$PWD"\n' >"$TMP/bin/claude"
  chmod +x "$TMP/bin/claude"
  BLOCK="$TMP/block.sh"
  awk '/# >>> generated: plugin-list-json /,/# <<< generated: plugin-list-json <<</' \
    "$PLUGIN_DIR/commands/stack/status.md" >"$BLOCK"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || true
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf "$TMP"
  return 0
}

@test "the helper queries from the repository root, not the subdirectory" {
  cd "$TMP/repo/sub/deep"
  run env PATH="$TMP/bin:$PATH" bash -c ". '$BLOCK'; plugin_list_json '$TMP/repo'"
  [ "$status" -eq 0 ]
  [ "$output" = "$(cd "$TMP/repo" && pwd)" ]
}

@test "an unreachable root fails instead of reading from the current directory" {
  cd "$TMP/repo/sub"
  run env PATH="$TMP/bin:$PATH" bash -c ". '$BLOCK'; plugin_list_json '$TMP/missing'"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "outside a repository the helper queries the current directory" {
  cd "$TMP/repo/sub"
  run env PATH="$TMP/bin:$PATH" bash -c ". '$BLOCK'; plugin_list_json ''"
  [ "$status" -eq 0 ]
  [ "$output" = "$(pwd)" ]
}

@test "the helper behaves the same under zsh" {
  command -v zsh >/dev/null 2>&1 || skip "zsh not installed"
  cd "$TMP/repo/sub/deep"
  run env PATH="$TMP/bin:$PATH" zsh -c "setopt noclobber; . '$BLOCK'; plugin_list_json '$TMP/repo'"
  [ "$status" -eq 0 ]
  [ "$output" = "$(cd "$TMP/repo" && pwd)" ]
}
