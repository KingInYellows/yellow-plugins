---
name: ci:runner-health
description: >
  Check self-hosted runner health via SSH. Use when user asks "runner status",
  "is runner healthy", "check runner", or wants to verify infrastructure before
  diagnosing CI failures.
argument-hint: '[runner-name]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

<!--
Usage: /ci:runner-health [runner-name]
       /ci:runner-health             # Check all configured runners
       /ci:runner-health runner-01   # Check specific runner
Requires: SSH key-based access to runner VMs, .claude/yellow-ci.local.md config
-->

# Runner Health Check

**Reference:** Follow SSH security rules from `ci-conventions` skill.

## Step 1: Load Configuration

Read `.claude/yellow-ci.local.md` and parse runner details from YAML
frontmatter.

If config not found:

> Runner config not found. Create `.claude/yellow-ci.local.md` with runner SSH
> details. See plugin README for configuration format.

## Step 2: Determine Targets

If `$ARGUMENTS` specifies a runner name:

- Validate name: must match `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
- Find matching runner in config
- If not found: "Runner '$name' not in config. Available: runner-01, runner-02"

Otherwise: check all configured runners with `enabled: true` (or all if no
enabled flag).

## Step 3: Check Each Runner

For each runner, SSH with fail-fast timeouts:

```bash
ssh -o StrictHostKeyChecking=accept-new \
    -o BatchMode=yes \
    -o ConnectTimeout=3 \
    -o ServerAliveInterval=60 \
    "$user@$host" << 'HEALTHCHECK'
echo "=== DISK ==="
df -h / /home 2>/dev/null | tail -n +2
echo "=== MEMORY ==="
free -m | grep -E 'Mem|Swap'
echo "=== CPU ==="
uptime
echo "=== DOCKER ==="
docker info --format 'Containers: {{.Containers}} (running: {{.ContainersRunning}})
Images: {{.Images}}' 2>/dev/null || echo "Docker not available"
echo "=== RUNNER ==="
systemctl is-active actions.runner.* 2>/dev/null || echo "inactive"
echo "=== NETWORK ==="
curl -sI --connect-timeout 3 https://github.com -o /dev/null -w 'GitHub: %{http_code}\n' 2>/dev/null || echo "GitHub: unreachable"
HEALTHCHECK
```

Use adaptive parallelism for multiple runners:

- 1-3 runners: all at once
- 4-10 runners: max 5 concurrent
- 10+: batch of runner_count/2

Connection timeout: 3s. Command timeout: 10s (via `timeout 10 ssh ...`).

## Step 4: Categorize Results

For SSH failures, categorize:

- **Timeout:** Runner may be powered off or network issue
- **Auth failed:** SSH key not configured for this runner
- **Refused:** Runner VM is up but SSH not running

## Step 5: Generate Report

Present as a table per runner with health indicators:

- Disk >90%: Critical
- Disk >80%: Warning
- Memory <500MB free: Warning
- Docker >100 images: Warning (suggest cleanup)
- Runner agent inactive: Critical
- Network unreachable: Critical

Summary line: "Successfully checked N/M runners (X timeout, Y auth failed)"

If any runner is degraded or critical, suggest:

- `/ci:runner-cleanup runner-name` for disk/Docker issues
- Manual SSH for agent restart
