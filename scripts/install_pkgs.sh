#!/bin/bash
# Note: -e omitted intentionally — hook must exit 0 on the gate path.
set -uo pipefail

# Gate: only run full installs in cloud sessions.
# Use ${VAR:-} default expansion so set -u does not abort when
# CLAUDE_CODE_REMOTE is unset (the common local-session case).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Project root with safe fallback
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$PROJECT_DIR" || exit 1

# Detected package manager: pnpm
pnpm install --frozen-lockfile
INSTALL_RC=$?
if [ "$INSTALL_RC" -ne 0 ]; then
  printf '[install_pkgs] Warning: pnpm install exited %d — cloud session may be missing dependencies\n' \
    "$INSTALL_RC" >&2
fi

exit 0
