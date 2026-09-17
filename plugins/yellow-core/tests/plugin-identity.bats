#!/usr/bin/env bats
# Tests for lib/plugin-identity.sh — reports which yellow-core copy is
# executing versus the checkout (T12 in
# docs/testing/session-continuity-acceptance.md; spec R24).

setup() {
  command -v jq >/dev/null 2>&1 || skip "jq not installed"
  . "$BATS_TEST_DIRNAME/../lib/plugin-identity.sh"
  export PATH="$BATS_TEST_DIRNAME/mocks:$PATH"
  export MOCK_FORBIDDEN_LOG="$(mktemp)"
  TMP="$(mktemp -d)"
  # Fake installed cache root and fake checkout.
  mkdir -p "$TMP/cache/.claude-plugin" "$TMP/checkout/plugins/yellow-core"
  printf '{"name":"yellow-core","version":"2.3.1"}\n' > "$TMP/cache/.claude-plugin/plugin.json"
  printf '{"name":"yellow-core","version":"2.3.1"}\n' > "$TMP/checkout/plugins/yellow-core/package.json"
  cat > "$TMP/installed_plugins.json" <<'JSON'
{"version": 2, "plugins": {"yellow-core@yellow-plugins": [{"scope": "user", "installPath": "/x/2.3.1", "version": "2.3.1", "gitCommitSha": "4192ea57947b641a0b4183c742a2227f92dcc018"}]}}
JSON
  export PI_PLUGIN_ROOT="$TMP/cache"
  export PI_INSTALLED_PLUGINS_FILE="$TMP/installed_plugins.json"
  export PI_CHECKOUT_ROOT="$TMP/checkout"
}

teardown() {
  [ -s "${MOCK_FORBIDDEN_LOG:-/dev/null}" ] && { cat "$MOCK_FORBIDDEN_LOG" >&2; return 1; }
  rm -f "$MOCK_FORBIDDEN_LOG"
  [ -n "${TMP:-}" ] && [ -d "$TMP" ] && rm -rf "$TMP"
  return 0
}

@test "equal cache and checkout versions report matches-checkout with the cache commit" {
  run pi_report yellow-core
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.identity == "matches-checkout" and .version == "2.3.1" and .checkout_version == "2.3.1"' >/dev/null
  echo "$output" | jq -e '.cache_commit == "4192ea57947b641a0b4183c742a2227f92dcc018"' >/dev/null
  echo "$output" | jq -e --arg r "$TMP/cache" '.root == $r' >/dev/null
}

@test "older cache than checkout reports cache-lags-checkout" {
  printf '{"version":"2.3.0"}\n' > "$TMP/cache/.claude-plugin/plugin.json"
  run pi_report yellow-core
  echo "$output" | jq -e '.identity == "cache-lags-checkout"' >/dev/null
}

@test "newer cache than checkout reports cache-ahead-of-checkout" {
  printf '{"version":"2.4.0"}\n' > "$TMP/cache/.claude-plugin/plugin.json"
  run pi_report yellow-core
  echo "$output" | jq -e '.identity == "cache-ahead-of-checkout"' >/dev/null
}

@test "missing installed_plugins.json leaves cache_commit unknown without changing identity" {
  export PI_INSTALLED_PLUGINS_FILE="$TMP/nope.json"
  run pi_report yellow-core
  echo "$output" | jq -e '.cache_commit == "unknown" and .identity == "matches-checkout"' >/dev/null
}

@test "no checkout reports no-checkout" {
  export PI_CHECKOUT_ROOT="$TMP/empty"
  mkdir -p "$TMP/empty"
  run pi_report yellow-core
  echo "$output" | jq -e '.identity == "no-checkout" and .checkout_version == "unknown"' >/dev/null
}

@test "unset plugin root reports unknown" {
  unset PI_PLUGIN_ROOT CLAUDE_PLUGIN_ROOT
  run pi_report yellow-core
  echo "$output" | jq -e '.root == "unknown" and .identity == "unknown"' >/dev/null
}

@test "pi_compare_versions is a portable dotted-decimal comparison" {
  [ "$(pi_compare_versions 2.3.1 2.3.1)" = "eq" ]
  [ "$(pi_compare_versions 2.3.0 2.3.1)" = "lt" ]
  [ "$(pi_compare_versions 2.10.0 2.9.9)" = "gt" ]
  [ "$(pi_compare_versions 3.0 2.99.99)" = "gt" ]
  [ "$(pi_compare_versions 2.3.1-rc1 2.3.1)" = "unknown" ]
}

@test "output is always valid JSON and exits 0" {
  run pi_report yellow-core
  [ "$status" -eq 0 ]
  echo "$output" | jq -e 'type == "object"' >/dev/null
}

@test "sourcing twice is idempotent and the lib sets no shell options" {
  . "$BATS_TEST_DIRNAME/../lib/plugin-identity.sh"
  [ "$_PLUGIN_IDENTITY_LOADED" = "1" ]
  ! grep -qE '^set ' "$BATS_TEST_DIRNAME/../lib/plugin-identity.sh"
}
