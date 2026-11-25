#!/usr/bin/env bats
# CLAUDE-392: `claude plugin list --json` folds project/local overrides only
# for the current directory's .claude/ settings, so every surface that reads
# it runs the query from the repository root through the generated
# plugin_list_json helper (scripts/snippets/plugin-list-json.sh).
# Run from the plugin directory: `bats tests/plugin-list-json.bats`

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  SURFACES=(
    "$PLUGIN_DIR/commands/stack/status.md"
    "$PLUGIN_DIR/skills/stack-provider-router/SKILL.md"
    "$PLUGIN_DIR/skills/stack-provider-guard/SKILL.md"
    "$PLUGIN_DIR/commands/setup/all.md"
    "$PLUGIN_DIR/commands/statusline/setup.md"
    "$PLUGIN_DIR/../yellow-claudemod/commands/claudemod/setup.md"
  )
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

@test "every surface embeds the helper and has no direct list call" {
  for f in "${SURFACES[@]}"; do
    grep -Fq 'scripts/snippets/plugin-list-json.sh' "$f"
    grep -Eq 'plugin_list_json "\$repo_(root|top)"' "$f"
    # Outside the generated helper, nothing calls the CLI directly.
    run bash -c "awk '/# >>> generated: plugin-list-json /,/# <<< generated: plugin-list-json <<</{next} {print}' '$f' \
      | grep -E '\\\$\\(claude plugin list --json|\\| *claude plugin list --json|^ *claude plugin list --json'"
    [ "$status" -eq 1 ] || { echo "$f: $output"; return 1; }
  done
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
