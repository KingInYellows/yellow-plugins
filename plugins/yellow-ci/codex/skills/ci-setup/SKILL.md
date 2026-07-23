---
name: ci-setup
description: Check CI prerequisites and configure the self-hosted runner SSH config. Use when first installing the plugin, after adding runners, or when CI commands fail with auth or connectivity errors.
---

## What It Does

Verifies the CI prerequisites (`gh`, `jq`, `ssh`) and GitHub CLI authentication,
then optionally walks a wizard to configure the plugin's runner SSH config —
previewing the config and confirming before any write.

## When to Use

- First installing the plugin, after adding runners, or when CI commands fail
  with auth or connectivity errors.

## Usage

This skill is wizard-driven and takes no arguments; the argument text after the
skill name (if any) is available as context.

**Config location.** This skill operates on *the plugin's runner SSH config
file*. Its concrete path is host-resolved — the invoking command supplies the
path for the current host (on Claude Code, the repo-local plugin config). Never
hard-code a host-specific config directory into this body.

**Runner scope.** yellow-ci targets **Linux** self-hosted runners. Windows/macOS
runners are not probed by the health/cleanup workflows; note this if a
non-Linux runner is configured.

### Step 1: Check Prerequisites

Run all prerequisite checks in a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v gh  >/dev/null 2>&1 && printf 'gh:  ok\n' || printf 'gh:  NOT FOUND\n'
command -v jq  >/dev/null 2>&1 && printf 'jq:  ok\n' || printf 'jq:  NOT FOUND\n'
command -v ssh >/dev/null 2>&1 && printf 'ssh: ok\n' || printf 'ssh: NOT FOUND (needed for runner health/cleanup)\n'
```

Collect **all** missing-tool failures before stopping — report them together.

Stop conditions (after reporting all failures):

- `gh` not found: "GitHub CLI is required. Install from https://cli.github.com/
  then run `gh auth login`."
- `jq` not found: "jq is required. Install from
  https://jqlang.github.io/jq/download/".

`ssh` missing is a warning only — it affects the runner health, cleanup, and
self-hosted-optimization workflows. Diagnosis and linting are unaffected.

### Step 2: Check GitHub CLI Auth

```bash
gh auth status 2>&1
```

- **Non-zero exit:** if the output says "not logged in", report "GitHub CLI is
  not authenticated. Run: `gh auth login`" and stop; if it looks like a network
  error, report "Could not reach GitHub API — check connectivity." and stop.
- **Zero exit:** record PASS; parse the logged-in account and the
  `Active token scopes:` line. Warn (do not stop) if `repo` or `workflow` are
  absent, pointing at `gh auth login --scopes repo,workflow,read:org`.

### Step 3: Check Existing Config

Check whether the runner SSH config file already exists and its YAML front
matter (after the opening `---` delimiter) contains a `schema: 1` line. If it
does, read it, count runners
(`awk '/^[[:space:]]*- name:/{c++} END{print c+0}'` — always emits one integer),
list the runner names, and ask via `AskUserQuestion`: "Runner config already
exists (N runner(s): …). Reconfigure?"

- **No** → show the current config summary and stop.
- **Yes** → continue to Step 4.

If absent, continue to Step 4.

### Step 4: SSH Config Wizard (Optional)

Ask via `AskUserQuestion`: "Do you use self-hosted GitHub Actions runners?
(Required for runner health and cleanup)".

- **No** → prepare a minimal config (no runners block); skip to Step 5.
- **Yes** → collect runner details below, looping until the user says done.

For each runner, collect and **validate** (reject and re-prompt on failure —
never warn-and-continue):

- **Runner name** — must match `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` (length 2-64,
  DNS-safe).
- **SSH host** — accept only a private IPv4 (`10.x`, `127.x`, `172.16-31.x`,
  `192.168.x`) or an internal FQDN ending in `.internal`, `.local`, `.lan`,
  `.corp`, `.home`, `.intra`, or `.private`. Public IPs and public-TLD hostnames
  are rejected — private network only.
- **SSH user** — must match `^[a-z_][a-z0-9_-]{0,31}$`.
- **SSH key path** (optional) — if provided, must start with `~` or `/`, contain
  only safe characters, and contain no `..` or shell metacharacters.

Security: pass every collected value through a **quoted heredoc** — never inline
user input into a command line (input containing quotes, `$`, or `;` must not
reach the shell unquoted). Validate each field before accepting it.

### Step 5: Preview and Confirm, Then Write Config

**Preview first (R32).** Render the exact config content (schema header, each
`- name:` runner block with `host`/`user`/optional `ssh_key`, and the `defaults`
block) and show it to the user. Then ask via `AskUserQuestion`: "Write this
runner config? [Write / Edit / Cancel]". Only write after explicit
confirmation; on a host without `AskUserQuestion`, obtain an equivalent explicit
user confirmation first — never write config without one.

Config shape (with runners):

```yaml
---
schema: 1
runners:
  - name: [name]
    host: [host]
    user: [user]
    ssh_key: ~/.ssh/runner-key   # only when the user provided a key path
defaults:
  ssh_timeout: 3
  max_parallel_ssh: 5
  cache_dirs:
    - /home/runner/.cache
  log_retention_days: 14
  docker_prune_age: 168h
---

## Runner Notes

Configured on [ISO-8601-UTC timestamp]. Edit this file directly to add runners
or change defaults, or re-run setup to reconfigure interactively.
```

With no runners (user declined), write the same shape with a commented-out
`# runners: []` placeholder and the `defaults` block. Create the parent config
directory first if it does not exist. Obtain the timestamp with
`date -u +%Y-%m-%dT%H:%M:%SZ`.

### Step 6: Validate the Written Config

Confirm the written file's YAML front matter (after the opening `---`
delimiter) contains `schema: 1`. Then re-read it and verify: the runner count
matches the number collected in Step 4, and each runner name entered appears
verbatim. On any mismatch, report it and stop.

### Step 7: Report

Report prerequisites, GitHub CLI account/scopes, and the runner config summary
(where it was written, runner count, names), then advise: the config contains
runner hostnames — if this is a shared repository, add the config to
`.gitignore` to avoid committing host details.

### Error Handling

- Missing `gh`/`jq` → collect and stop with install links; missing `ssh` →
  warn and continue.
- `gh` not authenticated → "Run: `gh auth login`"; network error → "Could not
  reach GitHub API".
- Invalid runner name / SSH host / SSH user / SSH key path → report the specific
  rule and re-prompt.
- Config directory not creatable, or write/validation failure → report a
  permissions hint and stop.

### Success Criteria

- Prerequisites and auth are reported accurately.
- The runner config is previewed and confirmed before any write, validated
  after writing, and the written runner names/count match what was collected.
