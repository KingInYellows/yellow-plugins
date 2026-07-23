---
name: ci-setup-runner-targets
description: Configure runner pool targets, routing rules, and semantic metadata for CI workflow optimization (wizard, YAML import, or GitHub API discovery). Use when setting up runner-aware CI optimization or after changing your runner fleet.
---

## What It Does

Configures runner pool definitions, routing rules, and semantic metadata so the
assistant knows which self-hosted runners exist and how to route CI jobs — even
when JIT ephemeral runners are invisible to the GitHub API. Writes the
runner-targets config (after a preview-and-confirm gate) and regenerates the
plugin's merged routing cache.

## When to Use

- Use when setting up runner-aware CI optimization or after changing your runner
  fleet.

## Usage

Takes no arguments; the argument text after the skill name (if any) is available
as context.

**Config locations.** The primary config is the **global** file at
`${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/runner-targets.yaml` (org-wide
defaults, works on any host). A host may also support an optional
**per-repository override** — the invoking command supplies its concrete path
for the current host. The per-repo file overrides the global per runner `name`;
its `routing_rules` replace the global rules wholesale.

### Step 1: Check Prerequisites and Existing Config

`gh` is only needed for the API-seeded template path (a warning, not a blocker).
Check whether the global config (and any per-repo override) already exists; if
so, read it, summarize the configured runners, and ask via `AskUserQuestion`:
"Runner targets config already exists. Reconfigure?" — **No** shows the summary
and stops; **Yes** continues.

### Step 2: Choose Target Location

Ask via `AskUserQuestion`: "Where should the runner targets config be saved?"

- **Global** (`${XDG_CONFIG_HOME:-$HOME/.config}/yellow-ci/`) — applies to all
  repos; recommended for org-wide pools.
- **This repo only** — a per-repository override (path resolved by the invoking
  command for this host). Use when this repo needs different routing than the
  global defaults.

Create the target directory if needed.

### Step 3: Choose Input Path

Ask via `AskUserQuestion`: "How would you like to configure runner targets?"

- **Interactive wizard** — walk through each target one at a time.
- **Import from YAML** — paste a YAML block or provide a file path.
- **Discover from GitHub API** — query the API for registered runners, seed a
  template, then fill in semantic fields (JIT ephemeral runners will not appear
  — you will be prompted to add them).

#### Step 3a: Interactive Wizard

For each runner target (loop until done), collect and validate:

1. **Name** — must match `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` (2-64, DNS-safe).
2. **Type** — one of `pool`, `static-family`, `static-host`.
3. **Mode** — one of `jit_ephemeral`, `persistent`.
4. **Preferred selector** — comma-separated `runs-on` labels; validate each
   against `^[a-zA-Z0-9][a-zA-Z0-9._:-]*$` (max 10 labels).
5. **Best for** — comma-separated workload tags (free text).
6. **Avoid for** — comma-separated tags (optional, free text).
7. **Notes** — operational notes (optional, free text).

After all targets, collect routing rules (one per line, empty line to finish).
Enforce a maximum of 20 targets and 20 rules. Show a summary and confirm before
proceeding.

#### Step 3b: Import from YAML

Accept a pasted YAML block or a file path (expand `~`, read the file). Validate
the content against the runner-targets schema: `schema: 1`; each target has a
DNS-safe `name`, a `type` of `pool`/`static-family`/`static-host`, a `mode` of
`jit_ephemeral`/`persistent`, `preferred_selector` labels matching
`^[a-zA-Z0-9][a-zA-Z0-9._:-]*$`, and at most 20 targets / 20 rules. Config files
must use canonical format (2-space indent, block sequences only — no flow
syntax `[a, b]`, no multi-line scalars, no tabs). On failure, report the
specific error and re-prompt; on success, show a parsed summary.

#### Step 3c: API-Seeded Template

Check `gh auth status`; if unauthenticated, fall back to wizard/import. Derive
`OWNER/REPO` from `git remote get-url origin`, then fetch repo- and org-level
runners:

```bash
timeout 15 gh api "repos/${OWNER}/${REPO}/actions/runners" \
  --jq '.runners[] | {name, labels: [.labels[].name], status, os}' 2>&1
```

Prompt for additional invisible (JIT ephemeral) pools, then fill in `type`,
`mode`, `best_for`, `avoid_for`, `notes` for each runner (discovered runners get
their labels pre-populated as `preferred_selector`).

### Step 4: Preview and Confirm, Then Write and Regenerate Cache

**Preview first (R32).** Render the exact canonical YAML and show it. Then ask
via `AskUserQuestion`: "Save this configuration? [Save / Edit / Cancel]". Only
write after explicit confirmation; on a host without `AskUserQuestion`, obtain an
equivalent explicit user confirmation first — never write config without one.

Canonical format (2-space indent, block sequences only):

```yaml
# Runner targets configuration for yellow-ci
# Generated on [ISO-8601-UTC]. Edit directly or re-run to reconfigure.
schema: 1
runner_targets:
  - name: [name]
    type: [type]
    mode: [mode]
    preferred_selector:
      - [label1]
    best_for:
      - [workload1]
    avoid_for:
      - [workload1]
    notes:
      - [note1]
routing_rules:
  - [rule1]
```

Omit `best_for`/`avoid_for`/`notes` entirely when empty (never write empty
arrays). Obtain the timestamp with `date -u +%Y-%m-%dT%H:%M:%SZ`.

After writing, **regenerate the plugin's merged routing cache** (the
routing-summary the session-start hook reads, plus the merged-config JSON). On
Claude Code the invoking command runs this via the plugin's runner-targets
resolution library; on other hosts it is produced from the global config. The
cache location is host-resolved by the plugin — do not hard-code it here.

### Step 5: Validate and Report

Re-read the written file and verify `schema: 1` is present, the runner count
matches, and each name appears verbatim; on mismatch, report and stop. Confirm
the routing cache was regenerated (warn but continue if cache generation
failed — the config is saved, the routing summary just will not be available
until the next run). Report the location, target/rule counts, and cache status.

### Error Handling

- Invalid runner name / selector label / type / mode → report the rule and
  re-prompt.
- Import validation failure or file-not-found → report the specific error and
  re-prompt.
- Directory not creatable, or write/validation failure → report a permissions
  hint and stop.
- More than 20 targets or 20 rules → re-prompt.

### Success Criteria

- The config is previewed and confirmed before any write, validated after, and
  the merged routing cache is regenerated (or a clear warning explains why not).
