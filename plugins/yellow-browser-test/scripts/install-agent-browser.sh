#!/bin/bash
set -euo pipefail

# install-agent-browser.sh — Install agent-browser CLI and Chromium

required_node_version='22.22.0'

version_lt() {
  local left="$1"
  local right="$2"
  local left_major left_minor left_patch
  local right_major right_minor right_patch

  IFS='.' read -r left_major left_minor left_patch <<EOF
$left
EOF
  IFS='.' read -r right_major right_minor right_patch <<EOF
$right
EOF

  left_minor=${left_minor:-0}
  left_patch=${left_patch:-0}
  right_minor=${right_minor:-0}
  right_patch=${right_patch:-0}

  if [ "$left_major" -lt "$right_major" ]; then
    return 0
  fi
  if [ "$left_major" -gt "$right_major" ]; then
    return 1
  fi
  if [ "$left_minor" -lt "$right_minor" ]; then
    return 0
  fi
  if [ "$left_minor" -gt "$right_minor" ]; then
    return 1
  fi
  if [ "$left_patch" -lt "$right_patch" ]; then
    return 0
  fi

  return 1
}

# Check if already installed
if command -v agent-browser >/dev/null 2>&1; then
  printf '[browser-test] agent-browser already installed: %s\n' \
    "$(agent-browser --version 2>/dev/null || printf '%s' 'unknown version')"
else
  # Check npm is available
  if ! command -v npm >/dev/null 2>&1; then
    printf '[browser-test] Error: npm not found. Install Node.js from https://nodejs.org/\n' >&2
    exit 1
  fi

  # Check Node.js version (requires 22.22.0 or later)
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//')
    if [ -z "$NODE_VERSION" ] || ! printf '%s' "$NODE_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      printf '[browser-test] Warning: Could not parse Node.js version. Requires %s or later.\n' "$required_node_version" >&2
    elif version_lt "$NODE_VERSION" "$required_node_version"; then
      printf '[browser-test] Error: Node.js %s or later required (found v%s). Update at https://nodejs.org/\n' "$required_node_version" "$NODE_VERSION" >&2
      exit 1
    fi
  else
    printf '[browser-test] Warning: Could not verify Node.js version. Requires %s or later.\n' "$required_node_version" >&2
  fi

  # Install via npm (pinned version)
  printf '[browser-test] Installing agent-browser@0.10.0...\n'
  # TODO: Update version pin when testing against newer releases
  NPM_EXIT=0
  NPM_ERRLOG=$(mktemp)
  npm install -g agent-browser@0.10.0 2>"$NPM_ERRLOG" || NPM_EXIT=$?
  if [ "$NPM_EXIT" -ne 0 ]; then
    printf '[browser-test] Error: npm install failed (exit %s)\n' "$NPM_EXIT" >&2
    cat "$NPM_ERRLOG" >&2
    printf '[browser-test] Common causes:\n' >&2
    printf '[browser-test]   - EACCES (permissions): try sudo npm install -g agent-browser@0.10.0\n' >&2
    printf '[browser-test]   - ETIMEDOUT (network): check internet connection or npm registry\n' >&2
    printf '[browser-test]   - ENOSPC (disk space): free up disk space\n' >&2
    printf '[browser-test]   - Proxy/firewall: configure npm proxy settings\n' >&2
    rm -f "$NPM_ERRLOG"
    exit 1
  fi
  rm -f "$NPM_ERRLOG"
fi

# Ensure Chromium is installed (agent-browser install is idempotent)
printf '[browser-test] Ensuring Chromium browser is installed...\n'
CHROMIUM_EXIT=0
CHROMIUM_ERRLOG=$(mktemp)
agent-browser install 2>"$CHROMIUM_ERRLOG" || CHROMIUM_EXIT=$?
if [ "$CHROMIUM_EXIT" -ne 0 ]; then
  printf '[browser-test] Error: Chromium install failed (exit %s)\n' "$CHROMIUM_EXIT" >&2
  cat "$CHROMIUM_ERRLOG" >&2
  printf '[browser-test] Common causes:\n' >&2
  printf '[browser-test]   - Insufficient disk space (Chromium ~300MB)\n' >&2
  printf '[browser-test]   - Network timeout downloading Chromium\n' >&2
  printf '[browser-test]   - Permission denied writing to ~/.cache or ~/.local\n' >&2
  printf '[browser-test]   - Missing system deps (check agent-browser docs)\n' >&2
  printf '[browser-test] Try running: agent-browser install\n' >&2
  rm -f "$CHROMIUM_ERRLOG"
  exit 1
fi
rm -f "$CHROMIUM_ERRLOG"

printf '[browser-test] Setup complete.\n'
