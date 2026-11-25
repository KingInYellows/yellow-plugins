# shellcheck shell=bash
# `claude plugin list --json` folds project/local enable and disable
# overrides into each row's `enabled` value only for the settings under the
# CURRENT directory's .claude/. From a subdirectory, a project-scope disable
# of a user-scope plugin still reads as enabled. Run it from the repository
# root; an unreachable root is a failed read, never a read from elsewhere.
# Canonical source: scripts/snippets/plugin-list-json.sh — edit there, then
# run `pnpm generate:snippets`. CI (`pnpm validate:snippets`) fails on drift.
plugin_list_json() {
  if [ -n "${1:-}" ]; then
    (cd -- "$1" >/dev/null 2>&1 && claude plugin list --json)
  else
    claude plugin list --json
  fi
}
