---
name: ci-conventions
description: Shared conventions for CI analysis — validation rules, failure patterns, error catalog, and security patterns. Use when agents or commands need CI-specific validation or pattern matching reference.
user-invokable: false
---

# CI Conventions for Yellow-CI Plugin

Shared knowledge for analyzing GitHub Actions CI failures on self-hosted runners.

## When This Skill Loads

Loaded automatically by:
- `failure-analyst` agent during log analysis
- `workflow-optimizer` agent during optimization
- `runner-diagnostics` agent during investigation
- `/ci:diagnose` command when processing run IDs
- `/ci:lint-workflows` command when checking rules
- `/ci:runner-health`, `/ci:runner-cleanup` when validating runner names

## Usage

Reference this skill for validation patterns, failure categories, and security rules. Load specific reference files for detailed catalogs.

## Core Failure Categories

12 failure categories (F01-F12) cover self-hosted runner issues. For detailed pattern matching with log signals and suggested fixes, load `references/failure-patterns.md`.

Quick grep patterns:
- OOM: `Killed.*signal 9|ENOMEM|JavaScript heap`
- Disk full: `No space left|ENOSPC`
- Missing deps: `command not found|not found in PATH`
- Docker: `Cannot connect.*Docker daemon|toomanyrequests`
- Network: `Could not resolve host|Connection timed out`
- Stale state: `EEXIST|leftover lockfiles`
- Flaky test: `timeout|ETIMEDOUT` (intermittent)
- Permissions: `Permission denied|EACCES`
- Runner agent: `Runner.Listener` crash, heartbeat timeout
- Stale cache: `Error restoring cache`
- Job timeout: `exceeded maximum execution time`
- Env leak: Secrets visible in logs, `set -x` output

## Validation Schemas

All inputs validated before use in paths or SSH commands. For complete regex patterns and edge cases, load `references/security-patterns.md`.

Quick reference:
- Runner names: `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
- Run IDs: `^[1-9][0-9]{0,19}$` (no leading zeros, max 9007199254740991)
- SSH hosts: Private IPv4 (10.x, 172.16-31.x, 192.168.x) or FQDN only
- SSH users: `^[a-z_][a-z0-9_-]{0,31}$`
- Cache dirs: Whitelist /home/runner, /tmp, /var/cache only

## Linter Rules

14 rules (W01-W14) for workflow linting. For detailed specifications with auto-fix logic and ecosystem patterns, load `references/linter-rules.md`.

## Secret Redaction

13+ regex patterns for redacting secrets from CI logs. Always apply `redact_secrets()` from `lib/redact.sh` before displaying any log content. Wrap output in prompt injection fences.

## Error Catalog

| Code | Component | Message Template |
|------|-----------|------------------|
| E01 | diagnose | No failed runs found for %s |
| E02 | runner-health | SSH connection timeout: %s (%ds) |
| E03 | runner-cleanup | Runner executing job, cleanup blocked: %s |
| E04 | config | Invalid YAML in .claude/yellow-ci.local.md |
| E05 | config | Config not found: .claude/yellow-ci.local.md |
| E06 | validate | Invalid runner name: %s (must match [a-z0-9-]) |
| E07 | validate | Invalid run ID: %s (digits only, no leading zeros) |
| E08 | validate | SSH host not in private range: %s |
| E09 | lint | YAML syntax error in %s at line %d |
| E10 | auth | GitHub CLI not authenticated (run: gh auth login) |

## SSH Security Rules

- `StrictHostKeyChecking=accept-new` — Auto-accept new hosts, reject changed keys
- `BatchMode=yes` — No interactive prompts
- `ConnectTimeout=3` — Fail fast on unreachable hosts
- `ServerAliveInterval=60`, `ServerAliveCountMax=3` — Keep-alive during operations
- Key-based only, no password auth, no agent forwarding (`-A`)
- Validate all inputs before interpolating into SSH commands
