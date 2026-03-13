---
name: ci:setup-runner-targets
description: 'Configure runner pool targets, routing rules, and semantic metadata for CI workflow optimization. Supports interactive wizard, YAML import, and GitHub API discovery. Use when setting up runner-aware CI optimization or after changing your runner fleet.'
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
model: sonnet
---

<!--
Usage: /ci:setup-runner-targets
       No arguments — operates on global or per-repo config.
Requires: gh CLI authenticated (for API-seeded template path)
Optional: Existing runner targets config (for reconfigure flow)
-->

# Set Up Runner Targets

Configure runner pool definitions, routing rules, and semantic metadata so that
Claude knows which self-hosted runners are available and how to route CI jobs —
even when JIT ephemeral runners are invisible to the GitHub API.

**Reference:** Follow conventions in the `ci-conventions` skill.

## Step 1: Check Prerequisites

Run prerequisite checks:

```bash
printf '=== Prerequisites ===\n'
command -v gh >/dev/null 2>&1 && printf 'gh:  ok\n' || printf 'gh:  NOT FOUND (needed for API-seeded template)\n'
```

`gh` missing is a warning only — it blocks the API-seeded template path but not
the interactive wizard or import paths.

Check for existing configs:

```bash
GLOBAL_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/runner-targets.yaml"
LOCAL_PATH=".claude/yellow-ci-runner-targets.yaml"

printf '\n=== Existing Configuration ===\n'
if [ -f "$GLOBAL_PATH" ]; then
  printf 'Global: %s (exists)\n' "$GLOBAL_PATH"
  runner_count=$(grep -cE '^[[:space:]]*-[[:space:]]+name:' "$GLOBAL_PATH" || echo 0)
  printf '  Runners: %s target(s)\n' "$runner_count"
else
  printf 'Global: %s (not found)\n' "$GLOBAL_PATH"
fi

if [ -f "$LOCAL_PATH" ]; then
  printf 'Local:  %s (exists)\n' "$LOCAL_PATH"
  runner_count=$(grep -cE '^[[:space:]]*-[[:space:]]+name:' "$LOCAL_PATH" || echo 0)
  printf '  Runners: %s target(s)\n' "$runner_count"
else
  printf 'Local:  %s (not found)\n' "$LOCAL_PATH"
fi
```

If either config exists: Read the existing file(s) with the Read tool, display a
summary of configured runners, and ask via AskUserQuestion:
"Runner targets config already exists. Reconfigure?"

- **No** → show current config summary and stop
- **Yes** → continue to Step 2

If neither exists: continue to Step 2.

## Step 2: Choose Target Location

Ask via AskUserQuestion: "Where should the runner targets config be saved?"

- **Global** (`~/.config/yellow-ci/`) — applies to all repos. Recommended for
  org-wide runner pools.
- **This repo only** (`.claude/yellow-ci-runner-targets.yaml`) — per-repo
  override. Use when this repo needs different runner routing than global
  defaults.

Create the target directory if needed:

```bash
# For global:
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci" || {
  printf '[yellow-ci] Error: Cannot create config directory\n' >&2
  exit 1
}

# For local:
mkdir -p .claude || {
  printf '[yellow-ci] Error: Cannot create .claude/ directory\n' >&2
  exit 1
}
```

Store the chosen target path for Step 4.

## Step 3: Choose Input Path

Ask via AskUserQuestion: "How would you like to configure runner targets?"

- **Interactive wizard** — walk through each pool/target one at a time. Best for
  first-time setup.
- **Import from YAML** — paste a YAML config block or provide a file path. Best
  when you already have your config ready.
- **Discover from GitHub API** — query API for registered runners, generate a
  template, then fill in semantic fields. Best for initial discovery (note: JIT
  ephemeral runners will not appear — you will be prompted to add them).

### Step 3a: Interactive Wizard

For each runner target (loop until user says "done"):

1. **Name** — Ask: "Runner target name (DNS-safe, e.g., `ares`):"
   Validate: `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` (2-64 chars). Re-prompt on
   failure.

2. **Type** — Ask: "Runner type?" Options:
   - `pool` — autoscaling pool (e.g., JIT ephemeral runners)
   - `static-family` — group of persistent hosts (e.g., gh-vm-01..03)
   - `static-host` — single persistent host

3. **Mode** — Ask: "Runner mode?" Options:
   - `jit_ephemeral` — spun up on demand, invisible to API when idle
   - `persistent` — always registered and visible

4. **Preferred selector** — Ask: "Preferred `runs-on` labels (comma-separated,
   e.g., `self-hosted, pool:ares, tier:cpu, size:m`):"
   Split on commas, trim whitespace, validate each label against
   `^[a-zA-Z0-9][a-zA-Z0-9._:-]*$`. Re-prompt on failure.

5. **Best for** — Ask: "What workloads is this runner best for?
   (comma-separated, e.g., `heavy CI, Terraform plan/validate/test`):"
   Split on commas, trim whitespace. Free text, no validation.

6. **Avoid for** — Ask: "What workloads should avoid this runner?
   (comma-separated, or press Enter to skip):"
   Split on commas, trim whitespace. Free text, optional.

7. **Notes** — Ask: "Any operational notes? (comma-separated, or Enter to skip):"
   Free text, optional.

After each runner: Ask "Add another runner target?" Options: "Yes" / "No, done".

After all targets: Ask "Enter routing rules, one per line (e.g.,
`prefer pool:ares for heavy CI`). Enter an empty line when done:"

Collect all rules until empty input.

Show a summary of all collected data and ask via AskUserQuestion:
"Configuration summary looks correct? Save it?"

- **Yes** → proceed to Step 4
- **No, edit** → re-prompt from the beginning
- **Cancel** → stop with "No changes made."

### Step 3b: Import from YAML

Ask via AskUserQuestion: "Paste your YAML config below, or provide a file path:"

If the response looks like a file path (starts with `/`, `~`, or `./`):
- Expand `~` to `$HOME`
- Read the file
- If file not found: report error, re-prompt

If the response contains YAML content (has `runner_targets:` or `schema:`):
- Use the content directly

Validate the YAML:

```bash
# Write to temp file for validation
TEMP_FILE=$(mktemp /tmp/yellow-ci-import-XXXXXX.yaml)
# ... write content to TEMP_FILE ...

# Source validation library and check
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/hooks/scripts"
. "${SCRIPT_DIR}/lib/validate.sh"

validate_runner_targets_file "$TEMP_FILE"
rm -f "$TEMP_FILE"
```

Note: Since this is a Claude Code command (not a shell script), validation should
be performed via Bash tool calls using the validate functions. Read the imported
content, write it to a temp file, run `validate_runner_targets_file` against it.

On validation failure: report the specific error from stderr, re-prompt.

On success: show parsed summary (runner names, types, modes, rule count), ask
"Save this configuration?"

### Step 3c: API-Seeded Template

Check `gh` auth:

```bash
gh auth status 2>&1 | head -n 3
```

If not authenticated: "GitHub CLI not authenticated. Use the Interactive Wizard
or Import path instead." Fall back to Step 3 choice.

Derive OWNER/REPO:

```bash
git remote get-url origin 2>&1
```

Fetch runners:

```bash
# Repo-level runners
REPO_RUNNERS=$(timeout 15 gh api "repos/${OWNER}/${REPO}/actions/runners" \
  --jq '.runners[] | {name, labels: [.labels[].name], status, os}' 2>&1) || REPO_RUNNERS=""

# Org-level runners (graceful fallback)
ORG_RUNNERS=$(timeout 15 gh api "orgs/${OWNER}/actions/runners" \
  --jq '.runners[] | {name, labels: [.labels[].name], status, os}' 2>&1) || ORG_RUNNERS=""
```

Display discovered runners. Then ask via AskUserQuestion:

"Found N runner(s) from the API. Do you have additional runner pools not
visible in the API (e.g., JIT ephemeral pools like ares/atlas)? These pools
are invisible when idle but can be targeted in workflow `runs-on`."

- **Yes, add invisible pools** → enter wizard mode for additional runners
- **No, this is all of them** → continue

For each runner (discovered + manually added): ask user to fill in `type`,
`mode`, `best_for`, `avoid_for`, `notes` (discovered runners get pre-populated
labels as `preferred_selector`).

Collect routing rules. Show summary. Confirm before writing.

## Step 4: Write Config

Replace `[ISO-8601-UTC]` with the current UTC timestamp:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

Write the YAML file to the chosen target location using the Write tool.

Format (canonical — 2-space indent, block sequences only, no flow syntax):

```yaml
# Runner targets configuration for yellow-ci
# Generated by /ci:setup-runner-targets on [ISO-8601-UTC]
# Edit directly or re-run /ci:setup-runner-targets to reconfigure.
# Format constraint: block sequences only (no flow syntax [a, b]).
schema: 1
runner_targets:
  - name: [name]
    type: [type]
    mode: [mode]
    preferred_selector:
      - [label1]
      - [label2]
    best_for:
      - [workload1]
      - [workload2]
    avoid_for:
      - [workload1]
    notes:
      - [note1]
routing_rules:
  - [rule1]
  - [rule2]
```

For multiple runner targets, repeat the `- name:` block for each.

Omit `best_for`, `avoid_for`, and `notes` arrays entirely if the user provided
none for that runner (do not write empty arrays).

After writing the config file, generate the cache:

```bash
SCRIPT_DIR="${CLAUDE_PLUGIN_ROOT}/hooks/scripts"
. "${SCRIPT_DIR}/lib/validate.sh"
. "${SCRIPT_DIR}/lib/resolve-runner-targets.sh"
resolve_runner_targets
```

## Step 5: Validate and Report

Read back the written file with the Read tool and verify:

- `schema: 1` is present
- Runner count matches the number collected
- Each runner name appears verbatim

If any mismatch: report the issue and stop.

Check that cache files were generated:

```bash
ls -la "${HOME}/.cache/yellow-ci/routing-summary.txt" 2>/dev/null
ls -la "${HOME}/.cache/yellow-ci/runner-targets-merged.json" 2>/dev/null
```

Display the summary:

```text
Runner Targets Configuration
============================

Location: [path] ([global/local])
Runners:  [N] target(s): [name1, name2, ...]
Rules:    [N] routing rule(s)
Cache:    routing-summary.txt written
          runner-targets-merged.json written

Overall: PASS
```

If the target was per-repo (`.claude/`), add advisory:

"Note: `.claude/` is typically gitignored. If you want to share this runner
targets config with your team, add `!.claude/yellow-ci-runner-targets.yaml`
to your repo's `.gitignore`."

Ask via AskUserQuestion: "What would you like to do next?" Options:

- `/ci:setup-self-hosted` — optimize workflow `runs-on` assignments using this
  config
- `/ci:lint-workflows` — lint workflows for self-hosted runner issues
- `Done`

## Error Handling

| Error | Message | Action |
|---|---|---|
| `gh` not authenticated (API-seeded path) | "GitHub CLI not authenticated." | Suggest wizard/import instead |
| Runner name invalid | "Expected: lowercase alphanumeric/hyphens, 2-64 chars" | Re-prompt |
| Selector label invalid | "Labels must start with alphanumeric, contain only [a-zA-Z0-9._:-]" | Re-prompt |
| Type invalid | "Must be: pool, static-family, or static-host" | Re-prompt |
| Mode invalid | "Must be: jit_ephemeral or persistent" | Re-prompt |
| Import YAML validation failure | "[specific error from validate_runner_targets_file]" | Re-prompt |
| Import file not found | "File not found at [path]" | Re-prompt |
| `mkdir -p` fails | "[yellow-ci] Cannot create directory — check permissions." | Stop |
| Config write fails | "Check directory permissions" | Stop |
| Runner count mismatch after write | "[yellow-ci] Written runner count differs from collected." | Stop |
| Cache generation fails | "[yellow-ci] Warning: Cache generation failed. Config saved but routing summary not available until next run." | Warn, continue |
| Too many runners (>20) | "Maximum 20 runner targets allowed" | Re-prompt |
| Too many rules (>20) | "Maximum 20 routing rules allowed" | Re-prompt |
