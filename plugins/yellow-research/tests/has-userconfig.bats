#!/usr/bin/env bats
# Tests for the has_userconfig() helper embedded in the research, devin and
# semgrep setup commands: every copy must be identical, and the helper must
# find userConfig values in both the credentials store and settings.json.

REPO_ROOT="$BATS_TEST_DIRNAME/../../.."
COMMANDS=(
  "$REPO_ROOT/plugins/yellow-research/commands/research/setup.md"
  "$REPO_ROOT/plugins/yellow-devin/commands/devin/setup.md"
  "$REPO_ROOT/plugins/yellow-semgrep/commands/semgrep/setup.md"
)

# Print every has_userconfig() body in the given files, NUL-separated.
extract_copies() {
  awk '/^has_userconfig\(\) \{/ { f = 1; b = "" }
       f { b = b $0 "\n" }
       f && /^\}/ { f = 0; printf "%s%c", b, 0 }' "$@"
}

setup() {
  export CLAUDE_CONFIG_DIR="$BATS_TEST_TMPDIR/cfg"
  mkdir -p "$CLAUDE_CONFIG_DIR"
  eval "$(extract_copies "${COMMANDS[0]}" | tr '\0' '\n' | awk '/^\}/ { print; exit } { print }')"
}

@test "all has_userconfig copies are identical" {
  local count unique
  count=$(extract_copies "${COMMANDS[@]}" | tr -cd '\0' | wc -c)
  unique=$(extract_copies "${COMMANDS[@]}" | sort -zu | tr -cd '\0' | wc -c)
  [ "$count" -eq 9 ]
  [ "$unique" -eq 1 ]
}

@test "finds a sensitive value under pluginSecrets with a marketplace id" {
  printf '{"pluginSecrets":{"yellow-research@yellow-plugins":{"exa_api_key":"x"}}}' \
    >| "$CLAUDE_CONFIG_DIR/.credentials.json"
  run has_userconfig yellow-research exa_api_key
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "finds a non-sensitive value under settings.json pluginConfigs" {
  printf '{"pluginConfigs":{"yellow-devin":{"options":{"devin_org_id":"x"}}}}' \
    >| "$CLAUDE_CONFIG_DIR/settings.json"
  run has_userconfig yellow-devin devin_org_id
  [ "$status" -eq 0 ]
}

@test "absent key is quiet: jq exit 1 and 4 are not parse errors" {
  printf '{"claudeAiOauth":{}}' >| "$CLAUDE_CONFIG_DIR/.credentials.json"
  : >| "$CLAUDE_CONFIG_DIR/settings.json"
  run has_userconfig yellow-research exa_api_key
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "empty value and look-alike plugin ids do not count" {
  printf '{"pluginSecrets":{"yellow-research@m":{"exa_api_key":""},"yellow-research-x@m":{"tavily_api_key":"x"}}}' \
    >| "$CLAUDE_CONFIG_DIR/.credentials.json"
  run has_userconfig yellow-research exa_api_key
  [ "$status" -eq 1 ]
  run has_userconfig yellow-research tavily_api_key
  [ "$status" -eq 1 ]
}

@test "malformed file warns and still checks the next file" {
  printf '{bad' >| "$CLAUDE_CONFIG_DIR/.credentials.json"
  printf '{"pluginConfigs":{"yellow-research":{"options":{"exa_api_key":"x"}}}}' \
    >| "$CLAUDE_CONFIG_DIR/settings.json"
  run has_userconfig yellow-research exa_api_key
  [ "$status" -eq 0 ]
  [[ "$output" == *"could not parse"* ]]
}
