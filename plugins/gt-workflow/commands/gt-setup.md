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
printf '=== Prerequisites ===\n'
command -v gt >/dev/null 2>&1 && printf 'gt:            ok (%s)\n' "$(gt --version 2>/dev/null | head -n1)" || printf 'gt:            NOT FOUND\n'
command -v jq >/dev/null 2>&1 && printf 'jq:            ok\n' || printf 'jq:            NOT FOUND\n'

printf '\n=== Repository ===\n'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && printf 'git_repo:       ok\n' || printf 'git_repo:       NOT A GIT REPOSITORY\n'
[ -f .git/.graphite_repo_config ] && printf 'repo_config:    present\n' || printf 'repo_config:    missing\n'

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
  "${XDG_CONFIG_HOME:-$HOME/.config}/graphite" \
  "$HOME/.config/graphite"; do
  if [ -e "$path" ]; then
    auth_ok=1
    printf 'auth_config:    present (%s)\n' "$path"
    break
  fi
done
[ "$auth_ok" -eq 1 ] || printf 'auth_config:    missing\n'
```

### Step 2: Interpret Results

Stop after reporting all failures that apply:

- `gt` missing: "Graphite CLI is required. Install it from https://graphite.dev/docs/cli and re-run `/gt-setup`."
- `jq` missing: "jq is required for gt-workflow hooks. Install it from https://jqlang.github.io/jq/download/."
- `git_repo` not ok: "gt-workflow must be run inside a git repository."
- `auth_config` missing: "Graphite auth was not detected. Run `gt auth` or sign in through the Graphite CLI, then re-run `/gt-setup`."
- `repo_config` missing OR `gt_trunk` unavailable: "This repository is not initialized for Graphite. Run `gt init`, confirm `gt trunk` works, then re-run `/gt-setup`."

### Step 3: Report

If all checks pass, show:

```text
gt-workflow Setup Results
─────────────────────────
Graphite CLI:  ready
jq:            ready
Auth:          detected
Repository:    initialized (trunk: <branch>)

Setup complete. Run `/gt-sync` or `/smart-submit` to verify your workflow.
```
