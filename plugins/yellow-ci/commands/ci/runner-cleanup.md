---
name: ci:runner-cleanup
description: "Clean Docker images/containers, old logs, and caches on self-hosted runner. Destructive operation with dry-run preview and confirmation. Use when runner disk is full, Docker space needs freeing, or old CI logs need pruning."
argument-hint: '[runner-name]'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
disable-model-invocation: true
---

<!--
SAFETY: Destructive operation.
- Shows dry-run preview before execution
- Requires user confirmation via AskUserQuestion
- Blocks if runner executing a job
- Re-validates state after confirmation (TOCTOU)
- Logs to ~/.claude/plugins/yellow-ci/audit.log

Usage: /ci:runner-cleanup [runner-name]
Requires: SSH key-based access, .claude/yellow-ci.local.md config
-->

# Runner Cleanup

**Reference:** Follow SSH security and TOCTOU rules from `ci-conventions` skill.

## Step 1: Load Configuration

Read `.claude/yellow-ci.local.md` and parse runner details.

If no config: report error with setup instructions.

If `$ARGUMENTS` specifies runner name:

- Validate name: `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
- Find in config

If no argument: use AskUserQuestion to select from configured runners.

## Step 2: Active Job Detection

Before any cleanup, check for active jobs:

```bash
ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=3 \
  "$user@$host" 'pgrep -f "/actions-runner/.*/Runner.Worker" >/dev/null && echo "ACTIVE" || echo "IDLE"'
```

If ACTIVE: block cleanup.

> Runner $name is executing a job. Cleanup blocked to prevent data corruption.
> Wait for the job to complete and try again.

## Step 3: Dry-Run Preview

Gather what would be cleaned:

```bash
ssh "$user@$host" << 'PREVIEW'
echo "=== DOCKER CONTAINERS (stopped) ==="
docker ps -a --filter status=exited --format '{{.Names}}' 2>/dev/null | wc -l

echo "=== DOCKER IMAGES (dangling) ==="
docker images --filter dangling=true -q 2>/dev/null | wc -l

echo "=== DOCKER VOLUMES (unused) ==="
docker volume ls --filter dangling=true -q 2>/dev/null | wc -l

echo "=== RUNNER LOGS ==="
find /home/runner/_diag -name "*.log" -mtime +14 2>/dev/null | wc -l

echo "=== TEMP FILES ==="
find /tmp -name "actions-*" -mtime +7 2>/dev/null | wc -l

echo "=== DISK USAGE ==="
df -h / | tail -1
PREVIEW
```

Present preview with timestamp:

```
Cleanup Preview for runner-01 (generated at 2026-02-16 14:32:01 UTC)

Docker:
  Containers (stopped): 12
  Images (dangling): 45
  Volumes (unused): 3 ⚠️ May contain data

Runner logs (_diag/*.log > 14 days): 23 files
Temp files (/tmp/actions-* > 7 days): 8 files
Current disk: 73%
```

## Step 4: User Confirmation

Use AskUserQuestion with options:

- "Proceed with cleanup"
- "Skip Docker volumes" (safer — volumes may contain data)
- "Dry-run only" (show preview, don't execute)
- "Cancel"

## Step 5: Execute Cleanup (TOCTOU-Safe)

After confirmation, execute in a SINGLE SSH session with re-check:

```bash
ssh "$user@$host" << 'CLEANUP'
# TOCTOU: Re-check for active jobs INSIDE session
if pgrep -f "Runner.Worker" >/dev/null 2>&1; then
  echo "ERROR: Job started during confirmation period"
  exit 1
fi

# Execute cleanup in order: containers → images → volumes (most destructive last)
echo "Cleaning containers..."
docker container prune -f || { echo "ERROR: docker container prune failed (exit $?)"; exit 1; }

echo "Cleaning images..."
docker image prune -af --filter "until=168h" || { echo "ERROR: docker image prune failed (exit $?)"; exit 1; }

# Only if user confirmed volume cleanup:
# echo "Cleaning volumes..."
# docker volume prune -f || { echo "ERROR: docker volume prune failed (exit $?)"; exit 1; }

echo "Cleaning runner logs..."
find /home/runner/_diag -name "*.log" -mtime +14 -delete || echo "WARN: Some log files could not be deleted"

echo "Cleaning temp files..."
find /tmp -name "actions-*" -mtime +7 -delete || echo "WARN: Some temp files could not be deleted"

echo "=== POST DISK ==="
df -h / | tail -1
CLEANUP
```

## Step 6: Post-Cleanup Report

Show actual freed space and new disk usage:

```
Cleanup Complete for runner-01

  Containers removed: 12
  Images removed: 45
  Logs cleaned: 23 files
  Disk: 73% → 45% (freed ~24GB)
```

## Step 7: Audit Log

Append operation to audit log:

```bash
mkdir -p ~/.claude/plugins/yellow-ci
printf '{"ts":"%s","op":"cleanup","runner":"%s","status":"completed","disk_after":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$runner_name" "$disk_after" \
  >> ~/.claude/plugins/yellow-ci/audit.log
```

## Error Handling

- **SSH connection failure:** Report which runner is unreachable and why
- **Partial failure:** Continue remaining operations, report summary ("3/4
  succeeded")
- **Timeout (>120s):** Abort and report partial results
- **Cleanup operation timeout:** Wrap in `timeout 120` to prevent indefinite
  hang
