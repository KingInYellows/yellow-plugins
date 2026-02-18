# Workflow Linter Rules

Rules for detecting common issues in GitHub Actions workflow files for self-hosted runners.

## Rule Index

| ID | Rule | Severity | Auto-fixable |
|----|------|----------|-------------|
| W01 | Missing `timeout-minutes` on job | Error | Yes |
| W02 | No caching for package manager install | Warning | Yes |
| W03 | Hardcoded paths (e.g., `/home/runner/`) | Warning | Yes |
| W04 | Missing `concurrency` group for PRs | Warning | Yes |
| W05 | No cleanup step (dangling containers/artifacts) | Warning | No |
| W06 | Using `ubuntu-latest` on self-hosted | Warning | No |
| W07 | Missing `runs-on: self-hosted` label | Error | No |
| W08 | No artifact retention policy | Info | Yes |
| W10 | Checkout without `clean: true` on self-hosted | Warning | Yes |
| W11 | Missing `fail-fast: false` in matrix | Warning | Yes |
| W12 | No `environment` for deployment workflows | Warning | No |
| W13 | Using `actions/cache@v2` (outdated) | Error | Yes |
| W14 | Missing `if: always()` on cleanup steps | Warning | Yes |

Note: W09 removed (continue-on-error: false is implicit default).

## Rule Details

### W01: Missing timeout-minutes

**Severity:** Error | **Auto-fix:** Add `timeout-minutes: 60`

Jobs without timeout can run indefinitely on self-hosted runners, blocking other jobs.

**Detection:** Job definition without `timeout-minutes` key.

**Fix:**
```yaml
jobs:
  build:
    timeout-minutes: 60  # Add this
    runs-on: self-hosted
```

### W02: No Caching

**Severity:** Warning | **Auto-fix:** Add ecosystem-appropriate cache

**Detection:** Steps with `npm install`, `pip install`, `cargo build`, `go build` without preceding cache step.

**Ecosystem-specific fixes:**

Node.js (pnpm):
```yaml
- uses: actions/setup-node@v4
  with:
    cache: 'pnpm'
```

Rust:
```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cargo
      target/
    key: cargo-${{ hashFiles('Cargo.lock') }}
```

Go:
```yaml
- uses: actions/setup-go@v5
  with:
    cache: true
```

Python:
```yaml
- uses: actions/setup-python@v5
  with:
    cache: 'pip'
```

### W03: Hardcoded Paths

**Severity:** Warning | **Auto-fix:** Replace with `${{ github.workspace }}`

**Detection:** Strings containing `/home/runner/work/`, `/home/runner/actions-runner/`.

### W04: Missing Concurrency Group

**Severity:** Warning | **Auto-fix:** Add concurrency block

**Detection:** Workflow triggered by `pull_request` without top-level `concurrency` key.

**Fix:**
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### W05: No Cleanup Step

**Severity:** Warning | **Auto-fix:** No (requires context)

**Detection:** Jobs using Docker (`docker run`, `docker-compose`) without cleanup step.

### W06: ubuntu-latest on Self-Hosted

**Severity:** Warning | **Auto-fix:** No (label depends on setup)

**Detection:** `runs-on: ubuntu-latest` in a repo that also has `runs-on: self-hosted` jobs.

### W07: Missing self-hosted Label

**Severity:** Error | **Auto-fix:** No

**Detection:** Job without `runs-on` containing `self-hosted` when repo is configured for self-hosted runners.

### W08: No Artifact Retention

**Severity:** Info | **Auto-fix:** Add `retention-days: 7`

**Detection:** `actions/upload-artifact` without `retention-days`.

### W10: Checkout Without clean

**Severity:** Warning | **Auto-fix:** Add `clean: true`

**Detection:** `actions/checkout` on self-hosted runner without `clean: true`.

**Fix:**
```yaml
- uses: actions/checkout@v4
  with:
    clean: true
```

### W11: Missing fail-fast: false

**Severity:** Warning | **Auto-fix:** Add `fail-fast: false`

**Detection:** Matrix strategy without `fail-fast: false`.

### W12: No Environment for Deployments

**Severity:** Warning | **Auto-fix:** No (environment name varies)

**Detection:** Job with `deploy` in name/step but no `environment` key.

### W13: Outdated actions/cache

**Severity:** Error | **Auto-fix:** Update to `@v4`

**Detection:** `actions/cache@v2` or `actions/cache@v3`.

### W14: Missing if: always() on Cleanup

**Severity:** Warning | **Auto-fix:** Add `if: always()`

**Detection:** Steps named with "cleanup", "teardown", "clean" without `if: always()`.

**Fix:**
```yaml
- name: Cleanup
  if: always()
  run: docker compose down
```
