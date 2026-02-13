#!/bin/bash
set -euo pipefail

# install-agent-browser.sh — Install agent-browser CLI and Chromium

# Check if already installed
if command -v agent-browser >/dev/null 2>&1; then
  printf '[browser-test] agent-browser already installed: %s\n' \
    "$(agent-browser --version 2>/dev/null || printf '%s' 'unknown version')"
  exit 0
fi

# Check npm is available
if ! command -v npm >/dev/null 2>&1; then
  printf '[browser-test] Error: npm not found. Install Node.js from https://nodejs.org/\n' >&2
  exit 1
fi

# Install via npm
printf '[browser-test] Installing agent-browser...\n'
if ! npm install -g agent-browser; then
  printf '[browser-test] Error: npm install failed. Try: sudo npm install -g agent-browser\n' >&2
  exit 1
fi

# Install Chromium
printf '[browser-test] Installing Chromium browser...\n'
if ! agent-browser install; then
  printf '[browser-test] Error: Chromium install failed. Try: agent-browser install\n' >&2
  exit 1
fi

printf '[browser-test] Setup complete.\n'
