#!/usr/bin/env bats
# Tests for bin/start-composio.sh — verifies fail-fast on missing/invalid creds.

WRAPPER="$BATS_TEST_DIRNAME/../bin/start-composio.sh"

# Replace `exec node ...` with `exec env` so we can capture the resolved env
# without actually starting the proxy or needing node available.
prep_wrapper() {
  local tmp_wrapper="$BATS_TMPDIR/start-composio-test.sh"
  sed 's|exec node ".*composio-proxy.mjs"|exec env|' "$WRAPPER" >"$tmp_wrapper"
  chmod +x "$tmp_wrapper"
  printf '%s' "$tmp_wrapper"
}

@test "userConfig URL wins over shell env URL" {
  test_wrapper=$(prep_wrapper)
  output=$(CLAUDE_PLUGIN_ROOT="/tmp/test" \
    COMPOSIO_MCP_URL_USERCONFIG="https://userconfig.example/mcp" \
    COMPOSIO_MCP_URL="https://shellenv.example/mcp" \
    COMPOSIO_API_KEY_USERCONFIG="key_uc" \
    COMPOSIO_API_KEY="key_se" \
    "$test_wrapper" 2>&1 | grep '^COMPOSIO_MCP_URL=')
  [ "$output" = "COMPOSIO_MCP_URL=https://userconfig.example/mcp" ]
}

@test "shell env URL is used when userConfig URL is empty" {
  test_wrapper=$(prep_wrapper)
  output=$(CLAUDE_PLUGIN_ROOT="/tmp/test" \
    COMPOSIO_MCP_URL_USERCONFIG="" \
    COMPOSIO_MCP_URL="https://shellenv.example/mcp" \
    COMPOSIO_API_KEY_USERCONFIG="" \
    COMPOSIO_API_KEY="key_se" \
    "$test_wrapper" 2>&1 | grep '^COMPOSIO_MCP_URL=')
  [ "$output" = "COMPOSIO_MCP_URL=https://shellenv.example/mcp" ]
}

@test "exits non-zero when URL is empty (no cascade)" {
  test_wrapper=$(prep_wrapper)
  run env -i CLAUDE_PLUGIN_ROOT="/tmp/test" "$test_wrapper"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "COMPOSIO_MCP_URL is not set" ]]
}

@test "exits non-zero when API key is empty" {
  test_wrapper=$(prep_wrapper)
  run env -i CLAUDE_PLUGIN_ROOT="/tmp/test" \
    COMPOSIO_MCP_URL="https://shellenv.example/mcp" \
    "$test_wrapper"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "COMPOSIO_API_KEY is not set" ]]
}

@test "rejects non-HTTPS URL (prevents cleartext key leak)" {
  test_wrapper=$(prep_wrapper)
  run env -i CLAUDE_PLUGIN_ROOT="/tmp/test" \
    COMPOSIO_MCP_URL="http://insecure.example/mcp" \
    COMPOSIO_API_KEY="key_se" \
    "$test_wrapper"
  [ "$status" -ne 0 ]
  [[ "$output" =~ "must be https://" ]]
}

@test "regression guard: empty userConfig does not break shell env path" {
  # This is the multi-host fleet use case the wrapper enables.
  test_wrapper=$(prep_wrapper)
  output=$(CLAUDE_PLUGIN_ROOT="/tmp/test" \
    COMPOSIO_MCP_URL_USERCONFIG="" \
    COMPOSIO_API_KEY_USERCONFIG="" \
    COMPOSIO_MCP_URL="https://fleet.example/mcp" \
    COMPOSIO_API_KEY="fleet_key" \
    "$test_wrapper" 2>&1 | grep '^COMPOSIO_MCP_URL=')
  [ "$output" = "COMPOSIO_MCP_URL=https://fleet.example/mcp" ]
}
