#!/usr/bin/env bash
# Shared MCP API-key resolver for the yellow-research start-<server>.sh
# wrappers (debt findings 011/012/013 — the three wrappers had a
# byte-identical resolution block). Sourced, not executed: must not set
# shell options or call exit.
#
# resolve_mcp_key VAR:
#   1. If <VAR>_USERCONFIG is set, export VAR from it (userConfig wins over
#      a pre-existing shell env value).
#   2. Always unset <VAR>_USERCONFIG so the transient userConfig var never
#      leaks into the MCP child process environment.
#   3. If VAR ends up empty (neither userConfig nor shell env supplied a
#      value), unset it so the MCP package sees "absent", not "explicitly
#      empty".
resolve_mcp_key() {
  local var="$1"
  local uc_var="${var}_USERCONFIG"
  if [ -n "${!uc_var:-}" ]; then
    export "${var}=${!uc_var}"
  fi
  unset "$uc_var"
  if [ -z "${!var:-}" ]; then
    unset "$var"
  fi
}
