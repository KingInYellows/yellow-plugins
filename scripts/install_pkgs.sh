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

# Detected package manager: pnpm. --ignore-scripts keeps dependency (and
# branch-edited) lifecycle scripts from running before anyone has reviewed the
# checkout; the toolchain works without them.
# Install output goes to stderr so it stays out of the session context; only a
# failure is printed on stdout, which SessionStart adds to Claude's context.
pnpm install --frozen-lockfile --ignore-scripts >&2
INSTALL_RC=$?
if [ "$INSTALL_RC" -ne 0 ]; then
  printf '[install_pkgs] Warning: pnpm install --frozen-lockfile exited %d; dependencies may be missing. Run pnpm install before testing.\n' \
    "$INSTALL_RC"
fi

exit 0
