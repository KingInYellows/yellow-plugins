---
name: debt:setup
description: "Validate debt audit prerequisites and optional Linear integration. Use when first installing the plugin or when debt commands fail before scanning begins."
argument-hint: ''
allowed-tools:
  - Bash
---

# Set Up yellow-debt

Validate the required local tooling, repository layout, and optional
yellow-linear dependency used by the debt workflows. This command does not
write any files.

## Workflow

### Step 1: Check Local Prerequisites

Run a single Bash call:

```bash
printf '=== Prerequisites ===\n'
for cmd in git jq yq realpath flock gt; do
  command -v "$cmd" >/dev/null 2>&1 && printf '%-12s ok\n' "${cmd}:" || printf '%-12s NOT FOUND\n' "${cmd}:"
done

printf '\n=== Repository ===\n'
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && printf 'git_repo:     ok\n' || printf 'git_repo:     NOT A GIT REPOSITORY\n'

printf '\n=== Working Paths ===\n'
[ -d .debt ] && printf '.debt/:       present\n' || printf '.debt/:       missing (created by /debt:audit)\n'
[ -d docs/audits ] && printf 'docs/audits/: present\n' || printf 'docs/audits/: missing (created by /debt:audit)\n'
[ -d todos/debt ] && printf 'todos/debt/:  present\n' || printf 'todos/debt/:  missing (created by /debt:audit)\n'
[ -w . ] && printf 'repo_root:    writable\n' || printf 'repo_root:    NOT WRITABLE\n'

printf '\n=== Optional Integration ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
linear_installed=0
if [ -d "$plugin_cache" ]; then
  if command -v python3 >/dev/null 2>&1; then
    find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | while IFS= read -r -d '' pj; do
          python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('name',''))" "$pj" 2>/dev/null || true
        done | grep -Fxq 'yellow-linear' && linear_installed=1
  elif command -v jq >/dev/null 2>&1; then
    find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | while IFS= read -r -d '' pj; do
          jq -r '.name // empty' "$pj" 2>/dev/null || true
        done | grep -Fxq 'yellow-linear' && linear_installed=1
  fi
fi
[ "$linear_installed" = "1" ] && printf 'yellow_linear: installed\n' || printf 'yellow_linear: NOT INSTALLED\n'
```

### Step 2: Interpret Results

Stop after reporting all required failures:

- Any missing command in `git`, `jq`, `yq`, `realpath`, `flock`, or `gt`
  blocks setup. Report all missing commands together.
- `git_repo` not ok: "yellow-debt must run inside a git repository."
- `repo_root` not writable: "The repository root is not writable, so debt
  workflows cannot create `.debt/`, `docs/audits/`, or `todos/debt/`."

Missing `.debt/`, `docs/audits/`, or `todos/debt/` is informational only:
`/debt:audit` creates them as needed.

If `yellow_linear` is not installed, warn but continue:

- "yellow-linear is optional. Debt audit, triage, fix, and status still work;
  only `/debt:sync` is degraded."

### Step 3: Report

Show:

```text
yellow-debt Setup Results
─────────────────────────
Required tools:  ready
Repository:      writable git repo
Working paths:   present / will be created on first audit
yellow-linear:   installed / optional-missing

Setup complete. Run `/debt:status` or `/debt:audit` to verify the workflow.
```
