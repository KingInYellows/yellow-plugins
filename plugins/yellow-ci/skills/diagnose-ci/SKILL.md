---
name: diagnose-ci
description:
  CI debugging workflow guide for self-hosted runners. Use when learning CI
  debugging workflows, understanding failure patterns (F01-F12), or
  troubleshooting GitHub Actions on self-hosted runners.
user-invokable: true
---

# Diagnosing CI Failures on Self-Hosted Runners

Understanding and resolving GitHub Actions workflow failures on self-hosted
self-hosted runners.

## When to Use

Use when learning CI debugging workflows, understanding failure patterns, or
need guidance on troubleshooting self-hosted runner issues. This skill provides
contextual knowledge that agents and commands reference during CI analysis.

## Usage

### Quick Start

1. Check recent runs: `/ci:status`
2. Diagnose a failure: `/ci:diagnose [run-id]`
3. Check runner health: `/ci:runner-health [runner-name]`

### Common Failure Workflows

#### Resource Exhaustion (F01 OOM, F02 Disk Full)

Symptoms: Exit code 137, `Killed`, `No space left on device`

Workflow:

1. Run `/ci:diagnose` to confirm pattern
2. Run `/ci:runner-health` to check current resource state
3. If disk full: `/ci:runner-cleanup` to free space
4. If OOM: Increase VM memory or reduce build parallelism
5. Re-run the failed workflow

#### Environment Drift (F03 Missing Deps, F06 Stale State)

Symptoms: `command not found`, tests pass locally but fail in CI

Workflow:

1. Run `/ci:diagnose` to identify missing tool or stale state
2. Check workflow setup steps — pin tool versions
3. Add `clean: true` to checkout step
4. Run `/ci:lint-workflows` to catch other self-hosted pitfalls

#### Docker Issues (F04)

Symptoms: `Cannot connect to Docker daemon`, rate limiting

Workflow:

1. Run `/ci:diagnose` to confirm Docker pattern
2. Check runner: `/ci:runner-health` — verify Docker status
3. If rate limited: configure Docker Hub mirror or authenticate
4. If daemon down: restart via SSH or `/ci:runner-cleanup`

#### Flaky Tests (F07)

Symptoms: Intermittent failures, passes on re-run

Workflow:

1. Run `/ci:diagnose` on last 3-5 failures to identify pattern
2. Look for timing-dependent assertions
3. Add retry annotation or increase timeouts
4. Fix underlying race condition

#### Runner Agent Issues (F09)

Symptoms: Runner offline, heartbeat timeout, `Runner.Listener` crash

Workflow:

1. Check runner status: `/ci:runner-health runner-name`
2. If offline: SSH and restart service
3. If version mismatch: update runner binary
4. If deregistered: re-register with new token

## Failure Pattern Reference

12 categories cover self-hosted runner issues (F01-F12). The `ci-conventions`
skill contains the full pattern library with log signals, severity levels, and
detailed fix suggestions.

## Prevention

Run `/ci:lint-workflows` before pushing workflow changes to catch common
self-hosted pitfalls (14 rules, W01-W14).
