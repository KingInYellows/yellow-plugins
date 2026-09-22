#!/usr/bin/env bats
# The MCP launch spec must name only the tools this plugin calls.
# ruvector@0.2.34 treats an empty, blank, or unknown policy as allow-all,
# and RUVECTOR_MCP_PROFILE unions extra tools into RUVECTOR_MCP_ALLOW.
bats_require_minimum_version 1.5.0

setup() {
  ROOT="$BATS_TEST_DIRNAME/../../.."
  CATALOG="$ROOT/catalog/plugins/yellow-ruvector.json"
  PLUGIN_JSON="$BATS_TEST_DIRNAME/../.claude-plugin/plugin.json"
  EXPECTED="hooks_capabilities,hooks_pretrain,hooks_recall,hooks_remember,hooks_stats"
}

allow_value() {
  jq -er '.mcpServers.ruvector.env.RUVECTOR_MCP_ALLOW' "$1"
}

@test "catalog and generated plugin.json launch the same explicit allowlist" {
  catalog_allow="$(allow_value "$CATALOG")"
  plugin_allow="$(allow_value "$PLUGIN_JSON")"
  [ "$catalog_allow" = "$EXPECTED" ]
  [ "$plugin_allow" = "$EXPECTED" ]
  [ -n "$catalog_allow" ]
  # Blank tokens, a trailing comma, or whitespace would parse as empty
  # or as a different name under ruvector's comma/space splitter.
  [[ "$catalog_allow" != *" "* ]]
  [[ "$catalog_allow" != *, ]]
  [[ "$catalog_allow" != ,* ]]
  [[ "$catalog_allow" != *,,* ]]
}

@test "launch spec does not set a profile that unions extra tools" {
  for spec in "$CATALOG" "$PLUGIN_JSON"; do
    jq -e '.mcpServers.ruvector.env | has("RUVECTOR_MCP_PROFILE") | not' "$spec" >/dev/null
    jq -e '.mcpServers.ruvector.env | has("RUVECTOR_MCP_DENY") | not' "$spec" >/dev/null
  done
}

@test "allowlist is exactly the tools the plugin calls" {
  referenced="$(
    grep -RhoE 'mcp__plugin_yellow-ruvector_ruvector__[a-z0-9_]+' \
      "$BATS_TEST_DIRNAME/.." \
      --include='*.md' \
      | sed 's/.*__//' \
      | sort -u \
      | paste -sd, -
  )"
  [ "$referenced" = "$EXPECTED" ]
}
