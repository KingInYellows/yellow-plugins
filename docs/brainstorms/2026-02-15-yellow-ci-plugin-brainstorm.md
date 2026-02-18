# Brainstorm: yellow-ci Plugin — CI Issue Resolution for Self-Hosted Runners

**Date:** 2026-02-15
**Status:** Draft

## What We're Building

A Claude Code plugin (`yellow-ci`) specialized in diagnosing, preventing, and resolving CI failures on self-hosted GitHub Actions runners running in a Proxmox homelab. The plugin uses a layered architecture so each capability is independently useful.

### Target Environment

- **CI Platform:** GitHub Actions with self-hosted runners
- **Infrastructure:** Proxmox VMs running `actions-runner` agent directly
- **Projects:** Polyglot OSS repos (TypeScript, Rust, Go, and more)
- **Access:** SSH from dev machine to runner VMs
- **Config:** Per-project `.local.md` settings for runner hostnames

## Why This Approach

The "Layered CI Toolkit" was chosen over a focused failure-analyst-only approach or a full GitOps runner management system because:

1. **Incremental value** — The reactive layer (failure analysis) delivers immediate value without requiring SSH setup. Prevention and maintenance layers add value as the user adopts them.
2. **Pragmatic scope** — Avoids over-engineering into infrastructure-as-code territory (that's Ansible's job) while still covering the three main pain points: diagnosis, prevention, and maintenance.
3. **Plugin-native** — Each layer maps cleanly to Claude Code primitives: agents for analysis, skills for workflows, hooks for prevention, commands for maintenance.

## Key Decisions

### Layer 1: Reactive — CI Failure Analyst

- **Agent: `ci-failure-analyst`** — Fetches GitHub Actions logs via `gh run view --log-failed`, parses output, identifies failure patterns (OOM, disk full, missing deps, flaky tests, network timeouts, Docker issues), and suggests targeted fixes.
- **Agent: `ci-log-researcher`** — Deep-dives into specific log sections, correlates with runner state, checks if the issue is environment-specific or code-specific.
- **Skill: `diagnose-ci`** — User-invocable `/diagnose-ci` that triggers the failure analyst on the latest failed run or a specific run ID.
- **Command: `ci-status`** — Quick view of recent CI run statuses for the current repo via `gh run list`.

### Layer 2: Preventive — Pre-Push Validation

- **Skill: `lint-workflow`** — Validates `.github/workflows/*.yml` for self-hosted runner pitfalls: missing cleanup steps, uncached dependencies, hardcoded paths, missing `timeout-minutes`, no `concurrency` groups.
- **Hook: `PreToolUse` on Bash** — (Optional) When pushing, warn if workflows have known anti-patterns.
- **Agent: `workflow-optimizer`** — Analyzes workflow files and suggests improvements: caching strategies, job parallelization, artifact management, conditional steps.

### Layer 3: Maintenance — Runner Health

- **Command: `runner-health`** — SSH into configured runners to check: disk space, memory, CPU load, Docker state, runner agent status, stale caches/artifacts. Requires user confirmation before any remediation.
- **Command: `runner-cleanup`** — Execute common cleanup tasks via SSH: prune Docker, clear GitHub Actions cache (`_work/_tool`), remove old logs. Always with `AskUserQuestion` confirmation.
- **Skill: `runner-setup-guide`** — Generates a hardened runner setup checklist based on the project's workflow requirements.

### Configuration

- **Per-project settings:** `.claude/yellow-ci.local.md` with YAML frontmatter:
  ```yaml
  runners:
    - name: runner-01
      host: 192.168.1.50
      user: runner
    - name: runner-02
      host: 192.168.1.51
      user: runner
  defaults:
    ssh_key: ~/.ssh/homelab
    cache_dirs:
      - /home/runner/actions-runner/_work/_tool
      - /home/runner/.cache
  ```
- **Fallback:** If no `.local.md` exists, Layer 3 commands gracefully degrade with instructions to configure.

### Failure Pattern Library

The analyst agent should understand these common self-hosted runner failure categories:

| Category | Signals | Common Fix |
|----------|---------|------------|
| Disk full | `No space left on device`, `ENOSPC` | Prune Docker, clear caches |
| OOM | `Killed`, `signal 9`, `ENOMEM` | Reduce parallelism, add swap |
| Missing deps | `command not found`, `not found in PATH` | Install missing tool, pin version |
| Docker issues | `Cannot connect to Docker daemon`, pull rate limit | Restart Docker, use mirror |
| Network | `Could not resolve host`, `Connection timed out` | Check DNS, retry with backoff |
| Stale state | Tests pass locally but fail in CI | Clean workspace, fresh checkout |
| Flaky tests | Intermittent failures, timing-dependent | Identify flaky test, add retry |
| Permission | `Permission denied`, `EACCES` | Fix ownership, check runner user |
| Runner agent | `Runner.Listener` crash, offline | Restart runner service |

### Security Considerations

- SSH commands always require `AskUserQuestion` confirmation before execution
- Never store SSH passwords — key-based auth only
- Runner hostnames in `.local.md` are gitignored (plugin should add to `.gitignore`)
- CI logs may contain secrets — agent must warn about this and avoid echoing full logs
- Prompt injection fencing: wrap CI log content in `--- begin ci-log ---` / `--- end ci-log ---` delimiters

## Open Questions

1. **MCP server for GitHub Actions?** — Should the plugin include an MCP server wrapping `gh` CLI for richer CI data, or is calling `gh` via Bash sufficient?
2. **Runner metrics over time?** — Should the plugin track runner health history (disk trend, failure rate) or is point-in-time checks enough?
3. **Multi-repo support?** — Should runner config be global (in `~/.claude/yellow-ci.local.md`) since the same runners serve multiple repos?
4. **act integration?** — Should the preventive layer include local workflow execution via `nektos/act` for pre-push testing?

## Scope Boundaries (YAGNI)

**In scope:**
- GitHub Actions on self-hosted runners (Linux VMs on Proxmox)
- Failure diagnosis, workflow linting, runner health checks
- SSH-based runner interaction with user confirmation

**Out of scope (for now):**
- Other CI platforms (Gitea, GitLab, Jenkins)
- Automated runner provisioning (use Ansible/Terraform for that)
- CI pipeline creation from scratch
- Windows/macOS runners
- Cloud-hosted runner management
