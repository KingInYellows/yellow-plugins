# yellow-ci

CI failure diagnosis, workflow linting, and runner health management for
self-hosted GitHub Actions runners on Proxmox homelab infrastructure.

## Installation

```bash
/plugin marketplace add KingInYellows/yellow-plugins --plugin yellow-ci
```

### Prerequisites

- [GitHub CLI](https://cli.github.com/) installed and authenticated
  (`gh auth login`)
- SSH client with key-based access to runner VMs (for runner health/cleanup
  commands)
- `jq` for JSON parsing

## Commands

### `/ci:diagnose [run-id]`

Diagnose CI failures and get actionable fix suggestions.

```
/ci:diagnose                  # Analyze latest failure
/ci:diagnose 123456789        # Analyze specific run
```

The failure analyst identifies root causes across 12 failure categories (OOM,
disk full, missing deps, Docker issues, network failures, stale state, flaky
tests, permissions, runner agent crashes, stale cache, job timeout, environment
leakage).

### `/ci:status`

Show recent workflow run status.

```
/ci:status
```

### `/ci:lint-workflows [file]`

Lint GitHub Actions workflow files for self-hosted runner pitfalls.

```
/ci:lint-workflows                          # Lint all workflows
/ci:lint-workflows .github/workflows/ci.yml # Lint specific file
```

Checks 14 rules (W01-W14) including missing timeouts, no caching, hardcoded
paths, outdated actions, and more.

### `/ci:runner-health [runner-name]`

Check self-hosted runner health via SSH.

```
/ci:runner-health             # Check all configured runners
/ci:runner-health runner-01   # Check specific runner
```

Reports disk usage, memory, CPU load, Docker status, and runner agent health.

### `/ci:runner-cleanup [runner-name]`

Clean Docker images/containers, old logs, and caches on runners.

```
/ci:runner-cleanup runner-01
```

Always shows a dry-run preview and requires confirmation before executing.

## Configuration

For runner health and cleanup commands, create `.claude/yellow-ci.local.md` in
your project:

```yaml
---
schema: 1
runners:
  - name: runner-01
    host: 192.168.1.50
    user: runner
  - name: runner-02
    host: 192.168.1.51
    user: runner
    ssh_key: ~/.ssh/homelab
defaults:
  ssh_timeout: 3
  max_parallel_ssh: 5
  cache_dirs:
    - /home/runner/.cache
  log_retention_days: 14
  docker_prune_age: 168h
---
## Runner Notes

Additional context about your runner setup.
```

### First-Time SSH Setup

Before using runner commands, accept host keys:

```bash
ssh runner@192.168.1.50  # Verify fingerprint, type 'yes'
```

Or pre-populate:

```bash
ssh-keyscan -H 192.168.1.50 >> ~/.ssh/known_hosts
```

## Agents

- **failure-analyst** — Automatically activated when discussing CI failures
- **workflow-optimizer** — Activated when asking about CI performance or caching
- **runner-diagnostics** — Deep investigation of runner infrastructure issues

## Security

- All CI log content is redacted for secrets (13+ patterns) before display
- SSH uses `StrictHostKeyChecking=accept-new` and `BatchMode=yes`
- Cleanup operations always require explicit user confirmation
- Runner state is re-checked after confirmation to prevent TOCTOU races
