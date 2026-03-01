---
name: ci:setup
description: "Check CI prerequisites and configure self-hosted runner SSH config. Use when first installing the plugin, after adding runners, or when ci commands fail with auth or connectivity errors."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
  - AskUserQuestion
---

# Set Up yellow-ci

Verify `gh` and `jq` are installed and authenticated, then optionally configure
the self-hosted runner SSH config at `.claude/yellow-ci.local.md`.

## Workflow

### Step 1: Check Prerequisites

Run all prerequisite checks in a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v gh  >/dev/null 2>&1 && printf 'gh:  ok\n' || printf 'gh:  NOT FOUND\n'
command -v jq  >/dev/null 2>&1 && printf 'jq:  ok\n' || printf 'jq:  NOT FOUND\n'
command -v ssh >/dev/null 2>&1 && printf 'ssh: ok\n' || printf 'ssh: NOT FOUND (needed for runner health/cleanup commands)\n'
```

Collect **all** missing tool failures before stopping — report them together.

Stop conditions (after reporting all failures):

- `gh` not found: "GitHub CLI is required. Install from https://cli.github.com/ then run `gh auth login`."
- `jq` not found: "jq is required. Install from https://jqlang.github.io/jq/download/"

`ssh` missing is a warning only — it only affects `/ci:runner-health` and
`/ci:runner-cleanup`, not diagnosis or linting commands.

### Step 2: Check GitHub CLI Auth

```bash
gh auth status 2>&1
```

- **Non-zero exit:** Check if output contains "not logged in" (auth failure) or
  network/connectivity language (API unreachable). Report accordingly:
  - Auth failure: "GitHub CLI is not authenticated. Run: `gh auth login`". Stop.
  - Network error: "Could not reach GitHub API — check connectivity." Stop.
- **Zero exit (authenticated):** Record PASS. Parse the output to extract:
  - Logged-in account: look for the line containing `account` — extract the
    token after "account " and prepend `@` for display (e.g., `@username`)
  - Active token scopes from the `Active token scopes:` line

Check required scopes. Warn (do not stop) if `repo` or `workflow` are absent:

```
[yellow-ci] Warning: Missing scope(s): repo, workflow
These scopes are needed for /ci:diagnose and /ci:status.
Re-authenticate with: gh auth login --scopes repo,workflow,read:org
```

### Step 3: Check Existing Config

```bash
if [ -f .claude/yellow-ci.local.md ] && \
   grep -qE '^schema:' .claude/yellow-ci.local.md; then
  echo "config_exists"
fi
```

If `config_exists`:

- Read `.claude/yellow-ci.local.md` with the Read tool
- Count runners: `grep -cE '^[[:space:]]*- name:' .claude/yellow-ci.local.md || echo 0`
  (exits 1 on zero matches — `|| echo 0` prevents false failure)
- Extract runner names and display them
- Ask via AskUserQuestion: "Runner config already exists (N runner(s) configured:
  runner-01, runner-02). Reconfigure?"
  - **No** → show current config summary (prerequisites + existing runner details) and stop. Do not proceed to Steps 4–7.
  - **Yes** → continue to Step 4.

If absent: continue to Step 4.

### Step 4: SSH Config Wizard (Optional)

Ask via AskUserQuestion: "Do you use self-hosted GitHub Actions runners?
(Required for /ci:runner-health and /ci:runner-cleanup)"

- **No** → write minimal config (no runners block), skip to Step 5.
- **Yes** → collect runner details below.

**For each runner** (loop until user says "done"):

Ask via AskUserQuestion for runner details in a single prompt:
- Runner name (e.g., `runner-01`) — validate `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
- SSH host (private IPv4 like `192.168.1.50` or internal FQDN) — validate using
  `validate_ssh_host` from `hooks/scripts/lib/validate.sh` (accepts private IPv4
  ranges 10.x, 127.x, 172.16-31.x, 192.168.x and FQDNs ending with `.internal`,
  `.local`, `.lan`, `.corp`, `.home`, `.intra`, or `.private`).
  Public IPs and hostnames that do not match must be **rejected and re-prompted**
  — do not warn-and-continue. Policy: private network only.
- SSH user — validate `^[a-z_][a-z0-9_-]{0,31}$`
- SSH key path (optional — press Enter to use default SSH key) — validate using
  `validate_ssh_key_path` from `hooks/scripts/lib/validate.sh` (must start with
  `~` or `/`, safe characters only, no `..` or shell metacharacters).

Validate each field before accepting. On validation failure: report the specific
issue and ask again.

After each runner: Ask "Add another runner?" Options: "Yes" / "No, done".
Collect all runners before proceeding to Step 5.

### Step 5: Write Config

Create `.claude/` directory if it does not exist:

```bash
mkdir -p .claude || {
  printf '[yellow-ci] Cannot create .claude/ directory — check permissions.\n'
  exit 1
}
```

Replace `[ISO-8601-UTC]` with the current UTC timestamp in ISO 8601 format
(run `date -u +%Y-%m-%dT%H:%M:%SZ` in Bash to obtain it).

**With runners configured**, write `.claude/yellow-ci.local.md`:

```yaml
---
schema: 1
runners:
  - name: [name]
    host: [host]
    user: [user]
    ssh_key: ~/.ssh/runner-key   # Only include when user provided a key path
defaults:
  ssh_timeout: 3
  max_parallel_ssh: 5
  cache_dirs:
    - /home/runner/.cache
  log_retention_days: 14
  docker_prune_age: 168h
---

## Runner Notes

Configured by /ci:setup on [ISO-8601-UTC]. Edit this file directly to add
runners or change defaults. Run `/ci:setup` to reconfigure interactively.
```

For multiple runners, repeat the `- name:` block under `runners:` for each.
When the user provided an SSH key path, include `ssh_key: <path>` in that
runner's config block. When they left the key path blank (pressed Enter), omit
the `ssh_key` field entirely for that runner.

**With no runners (user declined self-hosted)**, write a minimal config:

```yaml
---
schema: 1
# runners: []   # No self-hosted runners configured.
#                Add runners here if needed, then re-run /ci:setup.
defaults:
  ssh_timeout: 3
  max_parallel_ssh: 5
  cache_dirs:
    - /home/runner/.cache
  log_retention_days: 14
  docker_prune_age: 168h
---

## Runner Notes

Configured by /ci:setup on [ISO-8601-UTC].
No self-hosted runners configured. Run `/ci:setup` to add runners.
```

### Step 6: Validate Written Config

```bash
grep -qE '^schema:' .claude/yellow-ci.local.md
```

If this fails: Report "[yellow-ci] Config validation failed. Check `.claude/`
directory permissions and re-run `/ci:setup`." and stop.

After the bash check passes, **use the Read tool** to confirm:
- The file contains the expected `schema: 1` header
- Runner count in the file matches the number of runners collected in Step 4
- Each runner name entered appears verbatim in the file

If any runner name is missing or the count differs: report the mismatch and
stop. Do not proceed to Step 7 until the Read tool confirms correct content.

### Step 7: Report

_This step runs only when new config was written (Steps 4–6 completed)._

```
yellow-ci Setup Check
=====================

Prerequisites
  gh     OK (authenticated as @username)
  jq     OK
  ssh    OK

GitHub CLI
  Account:  github.com account @username
  Scopes:   repo, workflow, read:org   [WARN if missing repo or workflow]

Runner Config
  Written to: .claude/yellow-ci.local.md
  Runners:    [N configured | none configured]
  Names:      runner-01, runner-02   (if any)

Overall: PASS
```

Advisory: "`.claude/yellow-ci.local.md` contains runner hostnames. If this is a
shared repository, add it to `.gitignore` to avoid committing host details."

Ask via AskUserQuestion: "What would you like to do next?" Options:
`/ci:runner-health` (check runner infrastructure), `/ci:diagnose` (diagnose a CI
failure), `/ci:status` (recent workflow runs), `/ci:setup-self-hosted` (optimize
runner assignments), `Done`.

## Error Handling

| Error | Message | Action |
|---|---|---|
| `gh` not found | "Install from https://cli.github.com/" | Collect, stop after all checks |
| `jq` not found | "Install from https://jqlang.github.io/jq/download/" | Collect, stop after all checks |
| `ssh` not found | "Needed for runner health/cleanup commands only" | Warn, continue |
| `gh` not authenticated | "Run: gh auth login" | Stop |
| `gh auth status` network error | "Could not reach GitHub API — check connectivity." | Stop |
| Missing `repo` scope | "Re-authenticate: gh auth login --scopes repo,workflow,read:org" | Warn, continue |
| Missing `workflow` scope | Same as above | Warn, continue |
| Runner name invalid | "Expected: lowercase alphanumeric/dash, 2-64 chars" | Re-prompt |
| SSH host invalid | "Must be private IPv4 (10.x, 127.x, 192.168.x, 172.16-31.x) or internal FQDN" | Re-prompt |
| SSH public IP entered | "Public IPs are not allowed. Use a private network address." | Re-prompt |
| FQDN has public TLD | "FQDNs must end with an internal suffix (.internal, .local, .lan, .corp, .home, .intra, .private)." | Re-prompt |
| SSH user invalid | "Expected: lowercase, starts with letter/underscore, max 32 chars" | Re-prompt |
| SSH key path invalid | "Must start with ~ or /, alphanumeric/dots/dashes only, no '..' or metacharacters" | Re-prompt |
| `mkdir -p .claude` fails | "[yellow-ci] Cannot create .claude/ — check permissions." | Stop |
| Config write fails | "Check .claude/ directory permissions" | Stop |
| Config validation fails | "[yellow-ci] Config validation failed. Re-run /ci:setup." | Stop |
| Runner count mismatch after write | "[yellow-ci] Written runner count differs from collected. Re-run /ci:setup." | Stop |

See `ci-conventions` skill for SSH host validation patterns and runner name
format rules.
