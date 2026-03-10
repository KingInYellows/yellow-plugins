---
name: gt-setup
description: "Validate Graphite CLI prerequisites for gt-workflow. Use when first installing the plugin, after Graphite auth changes, or when gt commands fail."
argument-hint: ''
allowed-tools:
  - Bash
---

# Set Up gt-workflow

Validate that Graphite CLI is installed, authenticated, and initialized for the
current repository. This command does not write any files.

## Workflow

### Step 1: Check Graphite Prerequisites

Run a single Bash call:

```bash
version_gte() {
  local IFS=.
  local i a=($1) b=($2)
  for ((i=0; i<${#b[@]}; i++)); do
    local av="${a[i]:-0}" bv="${b[i]:-0}"
    if ((av > bv)); then return 0; fi
    if ((av < bv)); then return 1; fi
  done
  return 0
}

printf '=== Prerequisites ===\n'
if command -v gt >/dev/null 2>&1; then
  gt_version_raw=$(gt --version 2>/dev/null | head -n1 || true)
  if [ -n "$gt_version_raw" ]; then
    printf 'gt:            ok (%s)\n' "$gt_version_raw"
    gt_ver=$(printf '%s' "$gt_version_raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [ -z "$gt_ver" ]; then
      printf 'mcp_server:    UNKNOWN (could not parse version from: %s)\n' "$gt_version_raw"
    elif version_gte "$gt_ver" "1.6.7"; then
      printf 'mcp_server:    ok (gt >= 1.6.7)\n'
    else
      printf 'mcp_server:    UPGRADE NEEDED (current: %s, need 1.6.7+)\n' "$gt_ver"
    fi
  else
    printf 'gt:            ok (version unknown)\n'
    printf 'mcp_server:    UNKNOWN (gt --version returned no output)\n'
  fi
else
  printf 'gt:            NOT FOUND\n'
  printf 'mcp_server:    SKIPPED (gt not found)\n'
fi
command -v jq >/dev/null 2>&1 && printf 'jq:            ok\n' || printf 'jq:            NOT FOUND\n'

printf '\n=== Repository ===\n'
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$repo_top" ] && printf 'git_repo:       ok\n' || printf 'git_repo:       NOT A GIT REPOSITORY\n'
graphite_repo_config=$(git rev-parse --git-path .graphite_repo_config 2>/dev/null || true)
[ -n "$graphite_repo_config" ] && [ -f "$graphite_repo_config" ] && printf 'repo_config:    present (%s)\n' "$graphite_repo_config" || printf 'repo_config:    missing\n'

if command -v gt >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  trunk=$(gt trunk 2>/dev/null || true)
  [ -n "$trunk" ] && printf 'gt_trunk:       %s\n' "$trunk" || printf 'gt_trunk:       UNAVAILABLE\n'
else
  printf 'gt_trunk:       SKIPPED\n'
fi

printf '\n=== Graphite Auth ===\n'
auth_ok=0
for path in \
  "$HOME/.graphite_user_config" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/graphite/user_config" \
  "$HOME/.config/graphite/user_config"; do
  if [ -f "$path" ]; then
    auth_ok=1
    printf 'auth_config:    present (%s)\n' "$path"
    break
  fi
done
[ "$auth_ok" -eq 1 ] || printf 'auth_config:    missing\n'
```

### Step 2: Interpret Results

**Failures (hard stop)** — stop after reporting all that apply:

- `gt` missing: "Graphite CLI is required. Install it from https://graphite.dev/docs/cli and re-run `/gt-setup`."
- `jq` missing: "jq is required for gt-workflow hooks. Install it from https://jqlang.github.io/jq/download/."
- `git_repo` not ok: "gt-workflow must be run inside a git repository."
- `auth_config` missing: "Graphite auth was not detected. Run `gt auth` or sign in through the Graphite CLI, then re-run `/gt-setup`."
- `repo_config` missing OR `gt_trunk` unavailable: "This repository is not initialized for Graphite. Run `gt init`, confirm `gt trunk` works, then re-run `/gt-setup`."

**Warnings (do not block setup — CLI commands still work):**

- `mcp_server` UPGRADE NEEDED: "Graphite MCP server requires gt v1.6.7+.
  The `gt mcp` stdio server registered in plugin.json will fail to start and
  Graphite MCP tools will be unavailable until you upgrade.
  Run `npm i -g @withgraphite/graphite-cli@latest` to upgrade, then re-run
  `/gt-setup`. All CLI-based commands (`/smart-submit`, `/gt-sync`, etc.)
  continue to work without MCP."
- `mcp_server` SKIPPED: "The MCP server check was skipped because `gt` is
  missing. The `gt mcp` stdio server registered in plugin.json will fail to
  start. Install Graphite CLI, then re-run `/gt-setup`."
- `mcp_server` UNKNOWN: "MCP server status could not be determined. Run
  `gt --version` to confirm your Graphite CLI version. If the command fails or
  shows an unexpected format, reinstall or upgrade `gt`, then re-run
  `/gt-setup`."

### Step 3: Report

If all checks pass, show:

```text
gt-workflow Setup Results
─────────────────────────
Graphite CLI:  ready
jq:            ready
Auth:          detected
Repository:    initialized (trunk: <branch>)
MCP Server:    available (or: unavailable — gt < 1.6.7)

Setup complete. Run `/gt-sync` or `/smart-submit` to verify your workflow.
```
