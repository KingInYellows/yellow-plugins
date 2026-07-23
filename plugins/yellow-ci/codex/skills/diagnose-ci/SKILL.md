---
name: diagnose-ci
description: Reference guide (not an executable action) for CI debugging workflows and the F01-F12 failure-pattern catalog on self-hosted runners. Consult when you need to understand debugging workflows or failure patterns; to actually run a diagnosis, use the ci-diagnose skill instead.
---

# Diagnosing CI Failures on Self-Hosted Runners

## What It Does

Explains how to understand and resolve GitHub Actions workflow failures on
self-hosted runners, including the F01-F12 failure-pattern catalog. This is a
**reference guide**, not an executable workflow — it documents the debugging
approach so agents and commands can reference it during CI analysis.

## When to Use

Consult this guide when learning CI debugging workflows, understanding failure
patterns, or troubleshooting self-hosted runner issues. To actually diagnose a
failed run, use the `ci-diagnose` skill; this guide only describes the approach.

## Usage

### Quick Start

1. List recent runs — the `ci-status` skill.
2. Diagnose a failure — the `ci-diagnose` skill (pass a run ID if you have one).
3. Check runner health — the `ci-runner-health` skill (pass a runner name to
   scope it).

### Common Failure Workflows

#### Resource Exhaustion (F01 OOM, F02 Disk Full)

Symptoms: exit code 137, `Killed`, `No space left on device`.

Approach:

1. Diagnose the failure to confirm the pattern (`ci-diagnose`).
2. Check the runner's current resource state (`ci-runner-health`).
3. If disk is full, preview what would be cleared (Docker images, caches, and
   old logs) and obtain explicit user confirmation before deleting anything —
   re-check the runner state immediately before deleting to avoid clearing
   data from an active job.
4. If out of memory, increase VM memory or reduce build parallelism.
5. Re-run the failed workflow.

#### Environment Drift (F03 Missing Deps, F06 Stale State)

Symptoms: `command not found`, tests pass locally but fail in CI.

Approach:

1. Diagnose to identify the missing tool or stale state (`ci-diagnose`).
2. Check the workflow setup steps — pin tool versions.
3. Add `clean: true` to the checkout step.
4. Lint the workflows to catch other self-hosted pitfalls (`ci-lint-workflows`).

#### Docker Issues (F04)

Symptoms: `Cannot connect to the Docker daemon`, rate limiting.

Approach:

1. Diagnose to confirm the Docker pattern (`ci-diagnose`).
2. Check the runner and verify Docker status (`ci-runner-health`).
3. If rate limited, configure a Docker Hub mirror or authenticate.
4. If the daemon is down, restart it on the runner over SSH.

#### Flaky Tests (F07)

Symptoms: intermittent failures, passes on re-run.

Approach:

1. Diagnose the last 3-5 failures to identify the pattern (`ci-diagnose`).
2. Look for timing-dependent assertions.
3. Add a retry annotation or increase timeouts.
4. Fix the underlying race condition.

#### Runner Agent Issues (F09)

Symptoms: runner offline, heartbeat timeout, `Runner.Listener` crash.

Approach:

1. Check runner status (`ci-runner-health`, scoped to the runner).
2. If offline, SSH in and restart the runner service.
3. If a version mismatch, update the runner binary.
4. If deregistered, re-register with a new token.

## Failure Pattern Reference

Twelve categories cover self-hosted runner issues (F01-F12). The `ci-conventions`
reference documents the full pattern library with log signals, severity levels,
and detailed fix suggestions.

## Prevention

Lint workflows before pushing changes to catch common self-hosted pitfalls
(14 rules, W01-W14) — the `ci-lint-workflows` skill.
