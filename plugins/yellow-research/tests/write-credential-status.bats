#!/usr/bin/env bats
# Tests for hooks/write-credential-status.sh locating yellow-core's
# credential-status.sh in both the repository and the installed cache layout.

REPO_ROOT="$BATS_TEST_DIRNAME/../../.."

setup() {
  # Copy only the hook and manifest: the real plugin root may carry other
  # SessionStart work (e.g. network prewarm) this test must not trigger.
  export CLAUDE_PLUGIN_DATA="$BATS_TEST_TMPDIR/data"
  mkdir -p "$CLAUDE_PLUGIN_DATA"
  export CLAUDE_PLUGIN_OPTION_EXA_API_KEY="uc-value"
}

make_plugin() {
  mkdir -p "$1/hooks" "$1/.claude-plugin"
  cp "$BATS_TEST_DIRNAME/../hooks/write-credential-status.sh" "$1/hooks/"
  cp "$BATS_TEST_DIRNAME/../.claude-plugin/plugin.json" "$1/.claude-plugin/"
}

make_core() {
  mkdir -p "$1/lib"
  cp "$REPO_ROOT/plugins/yellow-core/lib/credential-status.sh" "$1/lib/"
}

run_hook() {
  CLAUDE_PLUGIN_ROOT="$1" run bash "$1/hooks/write-credential-status.sh"
  [ "$status" -eq 0 ]
  [ "$output" = '{"continue": true}' ]
}

@test "cache layout: resolves the newest numeric yellow-core version" {
  local cache="$BATS_TEST_TMPDIR/cache/yellow-plugins"
  make_plugin "$cache/yellow-research/1.0.0"
  make_core "$cache/yellow-core/10.0.0"
  # 9.0.0 sorts after 10.0.0 lexically; its lib must not be picked.
  mkdir -p "$cache/yellow-core/9.0.0/lib"
  printf '%s\n' 'credential_hook_scaffold() { : >| "$CLAUDE_PLUGIN_DATA/decoy"; printf "{\"continue\": true}\n"; exit 0; }' \
    >| "$cache/yellow-core/9.0.0/lib/credential-status.sh"
  run_hook "$cache/yellow-research/1.0.0"
  [ ! -e "$CLAUDE_PLUGIN_DATA/decoy" ]
  run jq -r '.plugin + " " + (.credentials[] | select(.field == "exa_api_key") | .source)' \
    "$CLAUDE_PLUGIN_DATA/credential-status.json"
  [ "$output" = "yellow-research userConfig" ]
}

@test "repository layout: resolves the sibling yellow-core" {
  local plugins="$BATS_TEST_TMPDIR/repo/plugins"
  make_plugin "$plugins/yellow-research"
  make_core "$plugins/yellow-core"
  run_hook "$plugins/yellow-research"
  [ -f "$CLAUDE_PLUGIN_DATA/credential-status.json" ]
}

@test "no yellow-core installed: continues without writing a status file" {
  make_plugin "$BATS_TEST_TMPDIR/cache/yellow-plugins/yellow-research/1.0.0"
  run_hook "$BATS_TEST_TMPDIR/cache/yellow-plugins/yellow-research/1.0.0"
  [ ! -e "$CLAUDE_PLUGIN_DATA/credential-status.json" ]
}
