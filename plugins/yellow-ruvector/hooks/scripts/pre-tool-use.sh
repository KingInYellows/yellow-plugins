#!/bin/bash
# pre-tool-use.sh — Pre-edit context, coedit suggestions, and activity tracking
# Receives hook input as JSON on stdin. Dispatches by tool name.
# shellcheck disable=SC2154
set -uo pipefail
# Note: -e omitted intentionally — hook must output {"continue": true} on all paths

# --- json_exit: centralized exit for all early-return paths ---
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[ruvector] %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping pre-tool-use"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Exit silently if ruvector is not initialized
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Resolve ruvector command: prefer direct binary (62ms) over npx (2700ms)
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
elif command -v npx >/dev/null 2>&1; then
  RUVECTOR_CMD=(npx --no ruvector)
else
  json_exit "Warning: neither ruvector nor npx found"
fi

# --- Config check: source shared config library if available ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_JSON='{}'
if [ -f "$SCRIPT_DIR/lib/config.sh" ]; then
  # shellcheck source=lib/config.sh
  . "$SCRIPT_DIR/lib/config.sh" 2>/dev/null || true
  load_config 2>/dev/null || true
fi

# Parse all fields in a single jq invocation
eval "$(printf '%s' "$INPUT" | jq -r '
  @sh "TOOL=\(.tool_name // "")",
  @sh "file_path=\(.tool_input.file_path // "")",
  @sh "command_text=\(.tool_input.command // "" | .[0:200])",
  @sh "pattern=\(.tool_input.pattern // "")",
  @sh "subagent_type=\(.tool_input.subagent_type // "")"
')" 2>/dev/null || json_exit "Warning: jq parse failed; skipping pre-tool-use"

# Sensitive file exclusion list for tracking
is_sensitive_path() {
  case "$1" in
    *.env|*.env.*|*.pem|*.key|*.cert|*.p12|*.pfx|*.keystore)
      return 0 ;;
    *credentials*|*secret*|*id_rsa*|*id_ed25519*)
      return 0 ;;
    *.netrc|*.npmrc|*.pypirc)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

case "$TOOL" in
  Edit|Write|MultiEdit)
    if [ "$(is_enabled '.hooks.pre_edit.enabled')" = "false" ]; then
      json_exit
    fi
    if [ -n "$file_path" ]; then
      "${RUVECTOR_CMD[@]}" hooks pre-edit "$file_path" 2>/dev/null || true
      if [ "$(is_enabled '.hooks.pre_edit.coedit_suggest')" != "false" ]; then
        "${RUVECTOR_CMD[@]}" hooks coedit-suggest --file "$file_path" 2>/dev/null || true
      fi
    fi
    ;;
  Bash)
    if [ -n "$command_text" ]; then
      "${RUVECTOR_CMD[@]}" hooks pre-command "$command_text" 2>/dev/null || true
    fi
    ;;
  Read)
    if [ "$(is_enabled '.hooks.tracking.file_access')" = "false" ]; then
      json_exit
    fi
    if [ -n "$file_path" ] && ! is_sensitive_path "$file_path"; then
      "${RUVECTOR_CMD[@]}" hooks remember "Reading: $file_path" -t file_access 2>/dev/null || true
    fi
    ;;
  Glob|Grep)
    if [ "$(is_enabled '.hooks.tracking.search_patterns')" = "false" ]; then
      json_exit
    fi
    if [ -n "$pattern" ]; then
      "${RUVECTOR_CMD[@]}" hooks remember "Search: $pattern" -t search_pattern 2>/dev/null || true
    fi
    ;;
  Task)
    if [ "$(is_enabled '.hooks.tracking.agent_spawns')" = "false" ]; then
      json_exit
    fi
    if [ -n "$subagent_type" ]; then
      "${RUVECTOR_CMD[@]}" hooks remember "Agent: $subagent_type" -t agent_spawn 2>/dev/null || true
    fi
    ;;
esac

printf '{"continue": true}\n'
