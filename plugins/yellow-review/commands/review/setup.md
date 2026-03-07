---
name: review:setup
description: "Validate review command prerequisites and optional yellow-core integration. Use when first installing the plugin or when review commands fail before analysis begins."
argument-hint: ''
allowed-tools:
  - Bash
---

# Set Up yellow-review

Validate the GitHub, Graphite, and yellow-core prerequisites used by the review
commands. This command does not write any files.

## Workflow

### Step 1: Check Review Prerequisites

Run a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v gh >/dev/null 2>&1 && printf 'gh:            ok\n' || printf 'gh:            NOT FOUND\n'
command -v jq >/dev/null 2>&1 && printf 'jq:            ok\n' || printf 'jq:            NOT FOUND\n'
command -v gt >/dev/null 2>&1 && printf 'gt:            ok\n' || printf 'gt:            NOT FOUND\n'

printf '\n=== GitHub Auth ===\n'
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && printf 'gh_auth:       ok\n' || printf 'gh_auth:       NOT AUTHENTICATED\n'
else
  printf 'gh_auth:       SKIPPED\n'
fi

printf '\n=== Optional Integration ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
core_installed=0
plugin_names=''
if [ -d "$plugin_cache" ]; then
  if command -v python3 >/dev/null 2>&1; then
    plugin_names=$(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | while IFS= read -r -d '' pj; do
          python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('name',''))" "$pj" 2>/dev/null || true
        done | sed '/^$/d' | LC_ALL=C sort -u)
  elif command -v jq >/dev/null 2>&1; then
    plugin_names=$(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | while IFS= read -r -d '' pj; do
          jq -r '.name // empty' "$pj" 2>/dev/null || true
        done | sed '/^$/d' | LC_ALL=C sort -u)
  fi
  printf '%s\n' "$plugin_names" | grep -Fxq 'yellow-core' && core_installed=1
fi
[ "$core_installed" = "1" ] && printf 'yellow_core:   installed\n' || printf 'yellow_core:   NOT INSTALLED\n'
```

### Step 2: Interpret Results

Stop after reporting all required failures:

- `gh` missing: "GitHub CLI is required. Install it from https://cli.github.com/ and run `gh auth login`."
- `jq` missing: "jq is required for review GraphQL helpers. Install it from https://jqlang.github.io/jq/download/."
- `gt` missing: "Graphite CLI is required for review submission flows. Install it from https://graphite.dev/docs/cli."
- `gh_auth` not authenticated: "GitHub CLI is not authenticated. Run `gh auth login` and re-run `/review:setup`."

If `yellow_core` is not installed, warn but continue:

- "yellow-core is not installed. Base review works, but cross-plugin review
  agents degrade gracefully."

### Step 3: Report

Show:

```text
yellow-review Setup Results
───────────────────────────
GitHub CLI:    ready
GitHub auth:   active
Graphite CLI:  ready
yellow-core:   installed / optional-missing

Setup complete. Run `/review:pr` on a small PR to smoke-test the review path.
```
