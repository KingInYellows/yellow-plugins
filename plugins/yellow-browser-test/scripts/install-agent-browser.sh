#!/bin/bash
set -euo pipefail

# install-agent-browser.sh — Install agent-browser CLI and Chromium

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

  # Check Node.js version (requires 18+)
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
      printf '[browser-test] Error: Node.js 18+ required (found v%s). Update at https://nodejs.org/\n' "$NODE_VERSION" >&2
      exit 1
    fi
  else
    printf '[browser-test] Warning: Could not verify Node.js version. Requires 18+.\n' >&2
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

# Install Chromium
printf '[browser-test] Installing Chromium browser...\n'
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
