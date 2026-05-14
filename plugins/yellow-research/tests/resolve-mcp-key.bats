#!/usr/bin/env bats
# Tests for bin/lib/resolve-mcp-key.sh — the shared API-key resolver for the
# start-<server>.sh MCP wrappers.

setup() {
  . "$BATS_TEST_DIRNAME/../bin/lib/resolve-mcp-key.sh"
  # Start each test from a clean slate.
  unset EXA_API_KEY EXA_API_KEY_USERCONFIG 2>/dev/null || true
}

@test "resolve_mcp_key: userConfig value is exported to the bare var" {
  EXA_API_KEY_USERCONFIG="uc-value"
  resolve_mcp_key EXA_API_KEY
  [ "${EXA_API_KEY:-}" = "uc-value" ]
  # The transient userConfig var must never leak to the MCP child.
  [ -z "${EXA_API_KEY_USERCONFIG+set}" ]
}

@test "resolve_mcp_key: userConfig wins over a pre-existing shell value" {
  EXA_API_KEY="shell-value"
  EXA_API_KEY_USERCONFIG="uc-value"
  resolve_mcp_key EXA_API_KEY
  [ "${EXA_API_KEY:-}" = "uc-value" ]
}

@test "resolve_mcp_key: shell env value is kept when no userConfig" {
  EXA_API_KEY="shell-value"
  resolve_mcp_key EXA_API_KEY
  [ "${EXA_API_KEY:-}" = "shell-value" ]
}

@test "resolve_mcp_key: empty result unsets the var entirely" {
  resolve_mcp_key EXA_API_KEY
  # Must be unset (not set-but-empty) so the MCP package sees "absent".
  [ -z "${EXA_API_KEY+set}" ]
}

@test "resolve_mcp_key: an empty USERCONFIG var does not clobber shell env" {
  EXA_API_KEY="shell-value"
  EXA_API_KEY_USERCONFIG=""
  resolve_mcp_key EXA_API_KEY
  [ "${EXA_API_KEY:-}" = "shell-value" ]
  [ -z "${EXA_API_KEY_USERCONFIG+set}" ]
}
