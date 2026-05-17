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

@test "resolve_mcp_key: userConfig value is exported to the MCP child process" {
  # Regression for the wrapper contract: the var must be EXPORTED, not just
  # assigned, so the spawned MCP child inherits it. A regression that
  # changes `export "${var}=..."` to a plain `${var}=...` would still pass
  # the shell-variable assertion in the test above but break the MCP child.
  # Spawn a child bash via env -i, then re-import the var, to prove it's
  # in the exported environment (env -i would have stripped it otherwise).
  EXA_API_KEY_USERCONFIG="exported-value"
  resolve_mcp_key EXA_API_KEY
  child_view=$(env | grep '^EXA_API_KEY=' | head -1 | cut -d= -f2-)
  [ "$child_view" = "exported-value" ]
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
