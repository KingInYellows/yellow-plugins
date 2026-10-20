# Library path only. Enablement still comes solely from
# `claude plugin list --json`. A missed path is an error, not a provider guess.
# Canonical source: scripts/snippets/yellow-core-root.sh — edit there, then
# run `pnpm generate:snippets`. CI (`pnpm validate:snippets`) fails on drift.
core_libs_ok() {
  local root="$1"
  [ -n "$root" ] || return 1
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
  # then project, then user, then managed. Project and local rows count only
  # when realpath of projectPath is this repository. Every ranked path is
  # printed, one per line; the shell takes the first with a complete library,
  # so a stale higher-ranked install does not hide a valid lower-ranked one.
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
        typeof row.installPath === "string" && row.installPath.length > 0 &&
        !row.installPath.includes("\n") && !row.installPath.includes("\0") &&
        ((row.scope !== "project" && row.scope !== "local") ||
          (projectPath.length > 0 &&
            typeof row.projectPath === "string" && row.projectPath.length > 0 &&
            sameDir(row.projectPath, projectPath)))
      )
      .sort((a, b) => (scopeRank[a.scope] ?? 9) - (scopeRank[b.scope] ?? 9));
    process.stdout.write(candidates.map((c) => c.installPath).join("\n"));
  ' 2>/dev/null)
  if [ -n "$install_roots" ]; then
    while IFS= read -r candidate; do
      if core_libs_ok "$candidate"; then
        printf '%s' "$candidate"
        return 0
      fi
    done <<EOF_ROOTS
$install_roots
EOF_ROOTS
  fi
  if [ -n "${repo_root:-}" ] && core_libs_ok "${repo_root}/plugins/yellow-core"; then
    printf '%s' "${repo_root}/plugins/yellow-core"
    return 0
  fi
  printf ''
}
