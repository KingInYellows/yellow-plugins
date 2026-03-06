---
name: linear:setup
description: "Validate Linear MCP availability and first-use OAuth readiness. Use when first installing the plugin, after clearing auth, or when Linear tools stop working."
argument-hint: ''
allowed-tools:
  - Bash
  - AskUserQuestion
  - ToolSearch
  - mcp__plugin_yellow-linear_linear__list_teams
---

# Set Up yellow-linear

Validate Graphite CLI availability, confirm the Linear MCP tools are visible in
the current session, and probe a lightweight Linear read call. This command
does not write any files.

## Workflow

### Step 1: Check Local Prerequisites

Run a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v gt >/dev/null 2>&1 && printf 'gt:         ok (%s)\n' "$(gt --version 2>/dev/null | head -n1)" || printf 'gt:         NOT FOUND\n'
command -v git >/dev/null 2>&1 && printf 'git:        ok\n' || printf 'git:        NOT FOUND\n'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && printf 'git_repo:   ok\n' || printf 'git_repo:   NOT A GIT REPOSITORY\n'
```

`gt` missing is a degraded state, not a hard stop — the MCP server still works,
but branch-driven workflows like `/linear:work` and `/linear:sync` lose their
preferred Graphite path.

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
- **Call throws, times out, or returns an error:** report
  "[yellow-linear] Linear auth or connectivity check failed. If this is first
  use, complete the browser OAuth flow. Otherwise clear auth from `/mcp` and
  retry."

If the first probe fails and the user completed browser auth, ask via
AskUserQuestion: "Retry the Linear MCP probe now?" Options: "Retry" / "Stop".
On "Retry", invoke `mcp__plugin_yellow-linear_linear__list_teams` once more.

### Step 4: Report

Show a concise summary:

```text
yellow-linear Setup Results
───────────────────────────
Linear MCP:   visible in current session
OAuth:        active
Graphite CLI: ready / missing (degraded)

If Graphite is missing, Linear MCP features still work, but branch-aware flows
degrade. Install Graphite and re-run `/linear:setup` for full readiness.
```
