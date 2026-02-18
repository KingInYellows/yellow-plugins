# CI/CD Operations Guide

**Status:** Active **Last Updated:** 2026-01-12 **Maintainer:** Platform Team

---

## Overview

This document provides operational guidance for the Yellow Plugins CI/CD
infrastructure. It covers GitHub Actions workflows, Docker-based build
environments, performance budgets, artifact management, and failure triage
procedures.

**Architecture References:**

- Appendix D: CI/CD Workflows (docs/SPECIFICATION.md)
- Section 8.4.3: CI/CD Workflow Specification
  (docs/technology-stack-complete.md)
- Section 6: Automation & CI/CD Integration (docs/contracts/cli-contracts.md)
- CRIT-021: CI runtime budget enforcement
- NFR-MAINT-002: CI performance targets (<5 minutes total, <60s for validation)

---

## Table of Contents

1. [Workflow Overview](#workflow-overview)
2. [Validation Workflow](#validation-workflow)
3. [Release Workflow](#release-workflow)
4. [Docker Build Environment](#docker-build-environment)
5. [Caching Strategy](#caching-strategy)
6. [Artifact Management](#artifact-management)
7. [Performance Budgets](#performance-budgets)
8. [Failure Triage](#failure-triage)
9. [Metrics and Monitoring](#metrics-and-monitoring)
10. [Manual Operations](#manual-operations)

---

## Workflow Overview

The Yellow Plugins CI/CD system consists of two primary workflows:

### 1. Validation Workflow (`.github/workflows/validate-schemas.yml`)

**Purpose:** Continuous validation of schemas, code quality, tests, and security
**Triggers:**

- Pull requests to `main` (on schema/plugin/contract/code changes)
- Pushes to `main` branch
- Manual workflow dispatch

**Jobs:**

- `validate-schemas` (matrix: marketplace, plugins, contracts, examples)
- `lint-and-typecheck`
- `unit-tests`
- `integration-tests`
- `contract-drift`
- `security-audit`
- `build` (main branch only)
- `report-metrics` (aggregation)
- `ci-status` (final gate)

**Performance Target:** Complete in <5 minutes total, with validation jobs <60
seconds

### 2. Release Workflow (`.github/workflows/publish-release.yml`)

**Purpose:** Automated release publishing with artifact generation **Triggers:**

- Tag push matching `v[0-9]+.[0-9]+.[0-9]+` (semantic versioning)
- Manual workflow dispatch with version input

**Jobs:**

- `validate-release` (full validation suite)
- `build-artifacts` (tarball, SBOM, checksums)
- `publish-release` (GitHub release creation)
- `publish-npm` (optional NPM publish)
- `notify` (status summary)

---

## Validation Workflow

### Job Dependency Graph

```
┌─────────────────────┐
│ validate-schemas    │  (Matrix: 4 targets, parallel)
│ - marketplace       │
│ - plugins           │
│ - contracts         │
│ - examples          │
└──────────┬──────────┘
           │
           ├──────────────────┬──────────────────┐
           ↓                  ↓                  ↓
  ┌─────────────────┐  ┌─────────────┐  ┌─────────────┐
  │ lint-typecheck  │  │ contract-   │  │ security-   │
  │                 │  │ drift       │  │ audit       │
  └────────┬────────┘  └─────────────┘  └─────────────┘
           │
           ↓
  ┌─────────────────┐
  │ unit-tests      │
  └────────┬────────┘
           │
           ↓
  ┌─────────────────┐
  │ integration-    │
  │ tests           │
  └────────┬────────┘
           │
           ├──────────────────┬─────────────────┐
           ↓                  ↓                 ↓
  ┌─────────────────┐  ┌─────────────┐  ┌───────────┐
  │ build (main)    │  │ report-     │  │ ci-status │
  │                 │  │ metrics     │  │           │
  └─────────────────┘  └─────────────┘  └───────────┘
```

### Matrix Strategy: validate-schemas

The `validate-schemas` job uses a matrix to parallelize validation across four
targets:

#### Target: `marketplace`

- Validates `.claude-plugin/marketplace.json` against
  `schemas/marketplace.schema.json`
- Runs business rules validation (`scripts/validate-marketplace.js`)
- Checks: unique plugin IDs, semver compliance, category enums, timestamp
  formats

#### Target: `plugins`

- Discovers all `plugins/**/.claude-plugin/plugin.json` files
- Validates each against `schemas/plugin.schema.json`
- Runs plugin-specific validation (`scripts/validate-plugin.js`)
- Checks: 12 plugin schema rules, permission scopes, dependencies

#### Target: `contracts`

- Validates JSON syntax for all `api/cli-contracts/*.json` files
- Ensures contract schemas are well-formed
- Used for API contract drift detection

#### Target: `examples`

- Validates `examples/marketplace.example.json`
- Validates all `examples/plugin*.json` files
- Ensures example files stay synchronized with schemas

### Environment Variables

```yaml
NODE_VERSION: '20' # Node.js 20 LTS
PNPM_VERSION: '8.15.0' # Locked pnpm version (matches packageManager)
```

### Concurrency Control

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Stale workflow runs are automatically cancelled when new commits are pushed to
the same PR or branch.

---

## Release Workflow

### Version Extraction

The workflow supports two trigger modes:

1. **Tag Push:** Extracts version from tag name (e.g., `v1.2.3` → `1.2.3`)
2. **Manual Dispatch:** Uses user-provided version input

Pre-release detection:

- Tags with hyphens (e.g., `v1.0.0-beta.1`) are marked as pre-releases
- Manual dispatch includes `prerelease` boolean input

### Validation Requirements

Before publishing, the release workflow runs:

- Schema validation (`pnpm validate:schemas`)
- Linting (`pnpm lint`)
- Type checking (`pnpm typecheck`)
- Unit tests (`pnpm test:unit`)
- Integration tests (`pnpm test:integration`)
- Version consistency check (package.json matches release version)

### Artifact Generation

**Tarball Archive:**

```bash
yellow-plugins-v{VERSION}.tar.gz
```

Excludes: `node_modules`, `.git`, `dist-release`, `.ci-metrics`

**SBOM (Software Bill of Materials):**

- `sbom.json`: Full dependency tree (JSON format)
- `dependencies.txt`: Human-readable list (depth=0)

**Checksums:**

- `SHA256SUMS.txt`: Checksums for all release artifacts

### GitHub Release

Created via `softprops/action-gh-release@v1`:

- Tag: `v{VERSION}`
- Name: `Release v{VERSION}`
- Body: Extracted from `CHANGELOG.md` (version-specific section)
- Files: All artifacts in `dist-release/`
- Generate release notes: `true` (auto-generates from commit history)

### NPM Publishing (Optional)

Requires configuration:

1. Add `NPM_TOKEN` secret to repository
2. Only runs for non-prerelease versions
3. Only runs on main repository (`KingInYellows/yellow-plugins`)
4. Publishes all workspace packages with `--access public`

---

## Docker Build Environment

### Dockerfile Location

`Dockerfile` (repository root)

### Base Image

```dockerfile
FROM node:20-slim@sha256:a22f79e64de59efd3533828aecc9817bfdc1cd37dde598aa27d6065e7b1f0abc
```

**Digest Pinning Rationale:**

- Ensures immutable, reproducible builds
- Prevents supply chain attacks via floating tags
- Aligns with security best practices (CRIT-021 compliance)

### Installed Tools

- **Node.js:** 20 LTS (from base image)
- **pnpm:** 8.15.0 (via corepack, matches `packageManager` field)
- **git:** 1:2.39.\* (for repository operations)
- **ajv-cli:** 5.0.0 (global, for schema validation)
- **TypeScript:** 5.3.3 (global, for type checking)

### Build Commands

**Build image:**

```bash
docker build -t yellow-plugins-ci:latest .
```

**Run validation in container:**

```bash
docker run --rm yellow-plugins-ci:latest pnpm validate:schemas
```

**Interactive shell:**

```bash
docker run --rm -it yellow-plugins-ci:latest /bin/bash
```

### Layer Caching Optimization

The Dockerfile is structured for optimal layer caching:

1. Install system packages (rarely changes)
2. Install global tools (rarely changes)
3. Copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
4. Run `pnpm install --frozen-lockfile` (cached until lockfile changes)
5. Copy rest of workspace (invalidates only on source code changes)

---

## Caching Strategy

### pnpm Store Cache

**Action:** `pnpm/action-setup@v2` + `actions/setup-node@v4`

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v2
  with:
    version: ${{ env.PNPM_VERSION }}

- name: Setup Node.js with cache
  uses: actions/setup-node@v4
  with:
    node-version: ${{ env.NODE_VERSION }}
    cache: 'pnpm'
```

**Cache Key:** Hash of `pnpm-lock.yaml` **Cache Location:** `~/.pnpm-store`
**Benefit:** Shared dependencies across all jobs (avoids redundant
`node_modules` installs)

### Install Command

```bash
pnpm install --frozen-lockfile --prefer-offline
```

- `--frozen-lockfile`: Fails if lockfile is out of sync (prevents drift)
- `--prefer-offline`: Uses cache when available (faster installs)

### Cache Hit Rate

Monitor cache effectiveness:

- Check workflow logs for "Cache restored from key" messages
- Expected hit rate: >90% for PR/push workflows
- Cache misses expected after dependency updates

---

## Artifact Management

### Artifact Types

#### 1. Metrics Artifacts

**Pattern:** `metrics-{job-name}` **Content:** Prometheus text format metrics
(`.ci-metrics/*.prom`) plus the corresponding `.ci-logs/*.log` **Retention:** 7
days (individual jobs), 30 days (aggregated) **Purpose:** Performance tracking,
SLO compliance validation, root-cause analysis

**Jobs producing metrics:**

- `metrics-validate-{target}` (marketplace, plugins, contracts, examples) —
  metrics only (logs use dedicated `logs-validate-*`)
- `metrics-lint` (includes lint + typecheck logs)
- `metrics-unit-tests`
- `metrics-integration-tests`
- `metrics-contract-drift`
- `metrics-security-audit`
- `metrics-build`

> Each artifact now packages the `.prom` metrics file together with the matching
> `.log`, so downloading one artifact yields both telemetry and textual logs for
> the job.

**Aggregated artifact:** `ci-metrics-aggregated` →
`aggregated-metrics/ci-metrics.prom`

#### 2. Log Artifacts

**Pattern:** `logs-validate-{target}` **Content:** Streaming logs produced by
schema validation scripts (captured via `.ci-logs/validate-{target}.log`)
**Retention:** 7 days **Purpose:** Post-CI troubleshooting for schema failures,
archive of ajv/node output

#### 3. Release Artifacts

**Pattern:** `release-artifacts-v{VERSION}` **Content:** Tarball, SBOM,
checksums, release notes **Retention:** 90 days **Purpose:** Release publishing,
distribution

### Artifact Naming Convention

```
{artifact-type}-{job-name}[-{variant}]
```

Examples:

- `metrics-validate-marketplace`
- `logs-validate-plugins`
- `release-artifacts-v1.2.3`

### Downloading Artifacts Locally

```bash
# Install GitHub CLI
gh auth login

# List artifacts for a workflow run
gh run view <run-id> --log

# Download all artifacts
gh run download <run-id>

# Download specific artifact
gh run download <run-id> --name metrics-validate-marketplace
```

### Artifact Retention Policies

| Artifact Type        | Retention | Rationale                       |
| -------------------- | --------- | ------------------------------- |
| Metrics (individual) | 7 days    | Short-term performance analysis |
| Metrics (aggregated) | 30 days   | SLO trend tracking              |
| Logs                 | 7 days    | Debugging recent failures       |
| Release artifacts    | 90 days   | Long-term release history       |

---

## Performance Budgets

### SLO Targets

#### NFR-MAINT-002: Total CI Runtime

**Target:** <5 minutes for complete validation workflow **Critical Path:**
schema validation → lint/typecheck → tests **Measurement:** Sum of job durations
(excluding parallelized matrix jobs)

#### CRIT-021: Validation Job Runtime

**Target:** <60 seconds per validation matrix job **Jobs:** `validate-schemas`
(marketplace, plugins, contracts, examples) **Measurement:**
`yellow_plugins_ci_duration_seconds{stage="schema_validation"}`

### Current Performance Baseline

Based on typical 10-plugin marketplace:

| Job                            | Target | Typical | Status |
| ------------------------------ | ------ | ------- | ------ |
| validate-schemas (marketplace) | <60s   | ~30s    | ✅     |
| validate-schemas (plugins)     | <60s   | ~25s    | ✅     |
| validate-schemas (contracts)   | <60s   | ~10s    | ✅     |
| validate-schemas (examples)    | <60s   | ~15s    | ✅     |
| lint-and-typecheck             | <180s  | ~45s    | ✅     |
| unit-tests                     | <300s  | ~90s    | ✅     |
| integration-tests              | <480s  | ~120s   | ✅     |

### Performance Optimization Techniques

#### 1. Matrix Parallelization

- Validation targets run concurrently
- Reduces wall-clock time (4 jobs in ~60s vs. ~80s sequential)

#### 2. pnpm Caching

- Shared store across jobs
- Typical savings: 20-30 seconds per job

#### 3. Conditional Job Execution

- Build job only runs on `main` branch
- Security audit runs in parallel (not on critical path)

#### 4. Concurrency Limits

- Cancel stale runs to free runner capacity
- Prevents queue bottlenecks

### Monitoring Performance Budgets

**Download aggregated metrics:**

```bash
gh run download <run-id> --name ci-metrics-aggregated
cat aggregated-metrics/ci-metrics.prom | grep schema_validation
```

**Check SLO compliance:**

```bash
# Extract duration for each validation target
grep 'yellow_plugins_ci_duration_seconds.*schema_validation' ci-metrics.prom

# Verify all durations < 60 seconds
```

> The `report-metrics` job enforces this budget automatically and fails the
> workflow when any schema validation sample exceeds 60 seconds, resulting in
> immediate CRIT-021 alerts.

---

## Failure Triage

### Common Failure Scenarios

#### 1. Schema Validation Failure

**Symptoms:**

- `validate-schemas` job fails (red X)
- Error message: "Schema validation failed"

**Diagnosis:**

```bash
# Check validation logs
gh run view <run-id> --log | grep -A 20 "Schema validation"

# Download logs artifact
gh run download <run-id> --name logs-validate-marketplace
```

**Common Causes:**

- Invalid JSON syntax (missing commas, trailing commas)
- Schema constraint violations (missing required fields, invalid enum values)
- Business rule violations (duplicate plugin IDs, invalid semver)

**Remediation:**

1. Run local validation: `pnpm validate:schemas`
2. Fix schema errors identified
3. Commit and push fixes
4. CI will re-run automatically

#### 2. Lint Failures

**Symptoms:**

- `lint-and-typecheck` job fails
- Error message: ESLint errors or TypeScript compiler errors

**Diagnosis:**

```bash
# Run linter locally
pnpm lint

# Run type checker
pnpm typecheck
```

**Common Causes:**

- Code style violations (missing semicolons, incorrect indentation)
- Type errors (mismatched types, missing type annotations)
- Import errors (circular dependencies, missing modules)

**Remediation:**

1. Auto-fix linting: `pnpm lint:fix`
2. Fix remaining errors manually
3. Verify locally: `pnpm validate`

#### 3. Test Failures

**Symptoms:**

- `unit-tests` or `integration-tests` job fails
- Test output shows failed assertions

**Diagnosis:**

```bash
# Run tests locally with verbose output
pnpm test:unit --reporter=verbose

# Run specific test file
pnpm test:unit path/to/test.spec.ts
```

**Common Causes:**

- Regression bugs (code changes broke existing functionality)
- Flaky tests (timing issues, environment-dependent)
- Missing test data (fixtures not committed)

**Remediation:**

1. Fix failing tests
2. Add regression tests if new bug found
3. For flaky tests: increase timeouts, add retries, or fix race conditions

#### 4. Contract Drift Warnings

**Symptoms:**

- `contract-drift` job emits warning (orange)
- Message: "CLI contracts have been modified"

**Diagnosis:**

```bash
# Check what changed
git diff origin/main...HEAD -- api/cli-contracts/

# Review impact
cat api/cli-contracts/<changed-file>.json
```

**Common Causes:**

- Intentional API changes (new features, deprecations)
- Accidental breaking changes

**Remediation:**

1. Review contract changes for backward compatibility
2. Update contract version if breaking change
3. Document migration path in CHANGELOG.md
4. Consider adding compatibility shim if needed

#### 5. Security Audit Failures

**Symptoms:**

- `security-audit` job fails
- Message: "Vulnerabilities detected" or "Sensitive data found"

**Diagnosis:**

```bash
# Run audit locally
pnpm audit

# Check for secrets
grep -rE '(api[_-]?key|password|token|secret)' .claude-plugin/ plugins/ --include="*.json"
```

**Common Causes:**

- Known CVEs in dependencies
- Accidentally committed secrets
- Invalid permission scopes

**Remediation:**

1. Update vulnerable dependencies: `pnpm update <package>`
2. Remove committed secrets (use `.gitignore`, environment variables)
3. Rotate compromised credentials immediately

#### 6. Build Failures (main branch only)

**Symptoms:**

- `build` job fails on main branch
- Error message: TypeScript compilation errors

**Diagnosis:**

```bash
# Run build locally
pnpm build

# Check specific package
pnpm --filter @yellow-plugins/cli run build
```

**Common Causes:**

- Merge conflicts introduced type errors
- Missing build dependencies

**Remediation:**

1. Fix build errors locally
2. Test full workspace: `pnpm clean && pnpm install && pnpm build`
3. Push fix to main

### Escalation Path

1. **Immediate:** Check workflow logs, download artifacts
2. **<1 hour:** Run local reproduction, fix obvious errors
3. **<4 hours:** Investigate root cause, consult team
4. **>4 hours:** Create GitHub issue, escalate to maintainers

---

## Metrics and Monitoring

### Metrics Catalog

All metrics use the `yellow_plugins_ci_*` prefix.

#### `yellow_plugins_ci_duration_seconds` (histogram)

**Description:** Duration of CI validation stages in seconds **Labels:**

- `stage`: lint | unit_test | integration_test | schema_validation | build |
  contract_drift | security_audit
- `status`: success | failure | cancelled
- `target`: marketplace | plugins | contracts | examples (schema_validation
  only)

**SLO Target:** ≤60 seconds for `stage="schema_validation"` **Mitigation:**
CRIT-021 (CI runtime budget enforcement)

#### `yellow_plugins_ci_validations_total` (counter)

**Description:** Total number of CI validation runs **Labels:** Same as
`duration_seconds` **Use Case:** Track CI reliability, identify flaky stages

#### `yellow_plugins_ci_timestamp_seconds` (gauge)

**Description:** Unix timestamp of metric collection **Labels:** Same as
`duration_seconds` **Use Case:** Correlate CI runs with external events

### Prometheus Queries

**Check validation SLO compliance:**

```promql
histogram_quantile(0.95,
  sum(rate(yellow_plugins_ci_duration_seconds_bucket{stage="schema_validation"}[7d])) by (le)
) < 60
```

**Calculate failure rate:**

```promql
sum(rate(yellow_plugins_ci_validations_total{status="failure"}[7d])) by (stage)
/
sum(rate(yellow_plugins_ci_validations_total[7d])) by (stage)
```

**Identify slowest stages:**

```promql
topk(5,
  avg(yellow_plugins_ci_duration_seconds{status="success"}) by (stage)
)
```

### Exporting Metrics from CI

Metrics are automatically exported by each job using inline shell scripts. The
`scripts/export-ci-metrics.sh` helper can be used for custom metrics:

```bash
# Export metrics for custom stage
./scripts/export-ci-metrics.sh custom_stage success target=custom
```

> Pro tip: in GitHub Actions, capture the stage start time with
> `echo "CI_JOB_START=$(date +%s)" >> $GITHUB_ENV` before the workload runs,
> then emit `CI_STAGE_DURATION=$(( $(date +%s) - CI_JOB_START ))` afterwards so
> the helper script reports accurate durations.

---

## Manual Operations

### Running CI Workflows Locally

#### Using `act` (nektos/act)

Install `act`:

```bash
# macOS
brew install act

# Linux
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

Run validation workflow:

```bash
# Full workflow
act pull_request -W .github/workflows/validate-schemas.yml

# Specific job
act -j validate-schemas -W .github/workflows/validate-schemas.yml

# With secrets
act pull_request -s GITHUB_TOKEN=<token>
```

#### Using Docker

```bash
# Build CI container
docker build -t yellow-plugins-ci:latest .

# Run validation
docker run --rm -v $(pwd):/workspace yellow-plugins-ci:latest pnpm validate:schemas

# Run full test suite
docker run --rm -v $(pwd):/workspace yellow-plugins-ci:latest pnpm test
```

### Triggering Workflows Manually

#### Via GitHub CLI

```bash
# Trigger validation workflow
gh workflow run validate-schemas.yml

# Trigger release workflow
gh workflow run publish-release.yml -f version=1.2.3 -f prerelease=false

# List workflow runs
gh run list --workflow=validate-schemas.yml

# Watch run
gh run watch <run-id>
```

#### Via GitHub UI

1. Navigate to: `https://github.com/KingInYellows/yellow-plugins/actions`
2. Select workflow from left sidebar
3. Click "Run workflow" button
4. Fill in inputs (if any)
5. Click "Run workflow"

### Re-running Failed Jobs

```bash
# Re-run failed jobs only
gh run rerun <run-id> --failed

# Re-run entire workflow
gh run rerun <run-id>
```

### Debugging CI Issues

#### Enable debug logging

Add these secrets to repository:

- `ACTIONS_STEP_DEBUG=true`
- `ACTIONS_RUNNER_DEBUG=true`

#### SSH into runner (via tmate)

Add to workflow (temporary debugging only):

```yaml
- name: Setup tmate session
  uses: mxschmitt/action-tmate@v3
```

---

## Maintenance Checklist

### Weekly

- [ ] Review aggregated metrics artifacts
- [ ] Check SLO compliance (validation jobs <60s)
- [ ] Monitor cache hit rates

### Monthly

- [ ] Update Docker base image digest (security patches)
- [ ] Review and update Node/pnpm versions
- [ ] Audit artifact retention policies
- [ ] Review failure rates by stage

### Quarterly

- [ ] Update GitHub Actions versions (dependabot PRs)
- [ ] Review and optimize performance budgets
- [ ] Audit security audit rules
- [ ] Document new failure scenarios

---

## References

### Internal Documentation

- [Appendix D: CI/CD Workflows](../SPECIFICATION.md#appendix-d-cicd-workflows)
- [Technology Stack: CI/CD Specification](../technology-stack-complete.md#843-cicd-workflow-specification)
- [CLI Contracts: Automation Integration](../contracts/cli-contracts.md#6-automation--cicd-integration)
- [Metrics Guide](./metrics.md)

### External Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [pnpm CI Setup](https://pnpm.io/continuous-integration)
- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Prometheus Exposition Formats](https://prometheus.io/docs/instrumenting/exposition_formats/)

---

## Changelog

| Date       | Version | Changes                                |
| ---------- | ------- | -------------------------------------- |
| 2026-01-12 | 1.0.0   | Initial CI/CD operations guide (I4.T2) |

---

## Contact

For questions or issues related to CI/CD infrastructure:

- **GitHub Issues:** https://github.com/KingInYellows/yellow-plugins/issues
- **Maintainer:** Platform Team
- **Escalation:** Create issue with `ci-cd` label
