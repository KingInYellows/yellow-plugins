# shellcheck shell=bash
# Library path only. Enablement still comes solely from
# `claude plugin list --json`. A missed path is an error, not a provider guess.
# There is no fallback to plugins/yellow-core in the open repository: that
# tree is repository-controlled, and these libraries are executed.
# Canonical source: scripts/snippets/yellow-core-root.sh — edit there, then
# run `pnpm generate:snippets`. CI (`pnpm validate:snippets`) fails on drift.
core_libs_ok() {
  local root="$1"
  # Strip every trailing slash: `[ -L dir/ ]` follows the link.
  while [ "${root%/}" != "$root" ]; do root="${root%/}"; done
  [ -n "$root" ] || return 1
  # A symlinked root or lib/ could point back into the checkout. Ancestors
  # are not checked: a symlinked $HOME or /home is common and harmless.
  [ -L "$root" ] && return 1
  [ -L "$root/lib" ] && return 1
  [ -f "$root/lib/stack-provider-state.js" ] || return 1
  [ -f "$root/lib/stack-tooling-probe.js" ] || return 1
  [ -L "$root/lib/stack-provider-state.js" ] && return 1
  [ -L "$root/lib/stack-tooling-probe.js" ] && return 1
  return 0
}

resolve_yellow_core_root() {
  local candidate install_roots
  candidate="${CLAUDE_PLUGIN_ROOT:-}"
  if core_libs_ok "$candidate"; then
    printf '%s' "$candidate"
    return 0
  fi
  # Same ranking as _enabled_install_path in commands/setup/all.md: local,
  # then project, then user, then managed. Any other scope is dropped, since
  # the path feeds node. Project and local rows count only when realpath of
  # projectPath is this repository. Every ranked path is printed, one per
  # line; the shell takes the first with a complete library, so a stale
  # higher-ranked install does not hide a valid lower-ranked one.
  install_roots=$(printf '%s' "${plugin_json:-}" | PROJECT_PATH="${repo_root:-}" node -e '
    const fs = require("fs");
    let rows;
    try { rows = JSON.parse(fs.readFileSync(0, "utf8")); } catch { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    const projectPath = process.env.PROJECT_PATH || "";
    const scopeRank = { local: 0, project: 1, user: 2, managed: 3 };
    const sameDir = (a, b) => {
      try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
    };
    const candidates = rows
      .filter((row) =>
        row && typeof row === "object" &&
        row.id === "yellow-core@yellow-plugins" &&
        row.enabled === true &&
        Object.prototype.hasOwnProperty.call(scopeRank, row.scope) &&
        typeof row.installPath === "string" && row.installPath.length > 0 &&
        !row.installPath.includes("\n") && !row.installPath.includes("\0") &&
        ((row.scope !== "project" && row.scope !== "local") ||
          (projectPath.length > 0 &&
            typeof row.projectPath === "string" && row.projectPath.length > 0 &&
            sameDir(row.projectPath, projectPath)))
      )
      .sort((a, b) => scopeRank[a.scope] - scopeRank[b.scope]);
    process.stdout.write(candidates.map((c) => c.installPath).join("\n"));
  ' 2>/dev/null)
  # A pipe, not a heredoc: the paths come from CLI output (AGENTS.md).
  candidate=$(printf '%s\n' "$install_roots" | while IFS= read -r root; do
    if core_libs_ok "$root"; then
      printf '%s' "$root"
      break
    fi
  done)
  if [ -n "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi
  printf ''
}
