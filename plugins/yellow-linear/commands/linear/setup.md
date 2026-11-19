---
name: linear:setup
# prettier-ignore
description: "Validate Linear MCP availability and first-use OAuth readiness. Use when first installing the plugin, after clearing auth, or when Linear tools stop working."
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-linear_linear__list_teams
---

# Set Up yellow-linear

Check the stack tooling for the active stacked-PR provider, confirm the Linear
MCP tools are visible in the current session, and probe a lightweight Linear
read call. This command does not write any files.

## Workflow

### Step 1: Check Local Prerequisites

Run a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v git >/dev/null 2>&1 && printf 'git:        ok\n' || printf 'git:        NOT FOUND\n'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && printf 'git_repo:   ok\n' || printf 'git_repo:   NOT A GIT REPOSITORY\n'
command -v gt >/dev/null 2>&1 && printf 'gt:         ok (%s)\n' "$(gt --version 2>/dev/null | head -n1)" || printf 'gt:         NOT FOUND\n'
if ! command -v gh >/dev/null 2>&1; then
  printf 'gh_stack:   NOT FOUND (gh missing)\n'
elif gh extension list 2>/dev/null | grep -qE '(^|[[:space:]])github/gh-stack([[:space:]]|$)'; then
  printf 'gh_stack:   ok\n'
else
  printf 'gh_stack:   NOT FOUND (or gh extension list failed)\n'
fi
printf '=== Stacked-PR provider (enabled plugins) ===\n'
repo_root=$(git rev-parse --show-toplevel 2>/dev/null || printf '')
claude plugin list --json 2>/dev/null | PROJECT_PATH="$repo_root" node -e '
  const fs = require("fs");
  let rows;
  try { rows = JSON.parse(fs.readFileSync(0, "utf8")); } catch { rows = null; }
  if (!Array.isArray(rows)) { console.log("provider:   UNKNOWN (claude plugin list failed)"); process.exit(0); }
  const projectPath = process.env.PROJECT_PATH || "";
  const sameDir = (a, b) => {
    try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
  };
  // project/local rows count only for this repository; user/managed are global.
  const applies = (r) =>
    (r.scope !== "project" && r.scope !== "local") ||
    (projectPath.length > 0 && typeof r.projectPath === "string" && sameDir(r.projectPath, projectPath));
  const on = (id) => rows.some((r) => r && r.id === id && r.enabled === true && applies(r));
  const found = [];
  if (on("gt-workflow@yellow-plugins")) found.push("graphite");
  if (on("github-workflow@yellow-plugins")) found.push("github");
  console.log("provider:   " + (found.length ? found.join(" + ") : "NONE ENABLED"));
' 2>/dev/null || printf 'provider:   UNKNOWN\n'
```

This is a quick read for the report, not a provider check; `/stack:status` is
the authority. Judge the stack tool against the active provider:

- `graphite`: `gt` is the stack tool. `gt` missing is degraded.
- `github`: `gh_stack` (the `github/gh-stack` extension) is the stack tool; `gt`
  is not needed, so do not report it missing.
- `NONE ENABLED`, `UNKNOWN`, or both: report the stack tool as unresolved and
  point to `/stack:status`.

None of these is a hard stop — the MCP server still works, but branch-driven
workflows like `/linear:work` and `/linear:sync` lose their stack path.

### Step 2: Verify MCP Visibility

Call `ToolSearch` with the query `list_teams`.

- If the exact tool `mcp__plugin_yellow-linear_linear__list_teams` is absent:
  report "[yellow-linear] Linear MCP is not visible in this session. Ensure the
  plugin is installed and restart Claude Code if you just installed it." Stop.

### Step 3: Probe OAuth / API Reachability

Invoke `mcp__plugin_yellow-linear_linear__list_teams` with its default
parameters.

- **Structured list result:** Treat as success, even if the list is empty.
- **Auth popup appears:** Tell the user to complete the browser flow, then retry
  this step once.
- **Call throws, times out, or returns an error:** report "[yellow-linear]
  Linear auth or connectivity check failed. If this is first use, complete the
  browser OAuth flow. Otherwise clear auth from `/mcp` and retry."

If the first probe fails and the user completed browser auth, ask via
AskUserQuestion: "Retry the Linear MCP probe now?" Options: "Retry" / "Stop". On
"Retry", invoke `mcp__plugin_yellow-linear_linear__list_teams` once more.

### Step 4: Report

Show a concise summary:

```text
yellow-linear Setup Results
───────────────────────────
Linear MCP:   visible in current session
OAuth:        active
Stack tool:   gt ready / gh ready / missing (degraded) / unresolved (<provider>)

If the active provider's stack tool is missing, Linear MCP features still work,
but branch-aware flows degrade. Install it (`gt` for Graphite, the `gh-stack`
extension for GitHub) and re-run `/linear:setup`; run `/stack:status` when the
provider is unresolved.
```
