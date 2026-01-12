# CI Validation Pipeline Specification

**Status:** Active
**Last Updated:** 2026-01-12
**Maintainer:** Platform Team
**Document Type:** Technical Specification (Section 2.1 Artifact)

---

<!-- START doctoc -->
<!-- END doctoc -->

## Overview

This document specifies the CI Validation Pipeline architecture for the Yellow Plugins system. It serves as the formal Section 2.1 artifact referenced in the architecture plan, providing a comprehensive technical specification of job graphs, caching strategies, metrics collection, artifact retention policies, and SLO enforcement mechanisms.

**Purpose:**
- Define the complete job dependency graph and execution flow
- Specify matrix strategies, environment configurations, and runtime budgets
- Document metrics export, artifact management, and SLO compliance mechanisms
- Provide integration points for CLI smoke commands and contract validation

**Audience:**
- Platform engineers maintaining CI/CD infrastructure
- Contributors adding new validation stages or workflows
- Operations teams troubleshooting CI failures
- Compliance auditors verifying CRIT-021 adherence

**Architecture References:**
- Section 2.1: Key Architectural Artifacts Planned (01_Plan_Overview_and_Setup.md)
- Section 6: Verification and Integration Strategy (03_Verification_and_Glossary.md)
- Section 3.7: Operational Processes (04_Operational_Architecture.md)
- CRIT-021: CI runtime budget enforcement
- NFR-MAINT-002: CI performance targets (<5 minutes total, <60s validation)

**Related Documents:**
- [CI/CD Operations Guide](./ci.md) - Procedural guidance for CI operations
- [Metrics Guide](./metrics.md) - Telemetry catalog and monitoring strategies
- [Operational Runbook](./runbook.md) - Incident response and diagnostics procedures

---

## Workflow Triggers

The validation pipeline (`.github/workflows/validate-schemas.yml`) executes on the following triggers:

| Trigger Type | Configuration | Rationale |
|--------------|---------------|-----------|
| **Pull Request** | Paths: `.claude-plugin/marketplace.json`, `plugins/**/.claude-plugin/plugin.json`, `schemas/*.schema.json`, `scripts/validate-*.js`, `api/cli-contracts/*.json`, `packages/**/*.ts`, `.github/workflows/validate-schemas.yml` | Validates schema changes, plugin updates, contract modifications, and source code changes before merge |
| **Push to Main** | Branches: `main`<br>Paths: Same as PR paths | Post-merge validation and artifact generation for release readiness |
| **Workflow Dispatch** | Manual trigger | Enables on-demand validation for debugging or release preparation |

**Concurrency Control:**
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```
Stale workflow runs are automatically cancelled when new commits are pushed to the same PR or branch, preventing resource waste and queue congestion.

**Environment Variables:**
| Variable | Value | Purpose |
|----------|-------|---------|
| `NODE_VERSION` | `20` | Node.js 20 LTS (current stable, 2025 LTS window) |
| `PNPM_VERSION` | `8.15.0` | Locked pnpm version matching `package.json` `packageManager` field |

---

## Job Dependency Graph

The validation workflow orchestrates 9 jobs with strategic dependencies to optimize for both parallelism and critical path execution:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CRITICAL PATH (≤60s)                        │
│                                                                 │
│  validate-schemas (matrix: 4 targets, parallel execution)      │
│  ├── marketplace   (validates .claude-plugin/marketplace.json)  │
│  ├── plugins       (validates all plugins/**/plugin.json)       │
│  ├── contracts     (validates api/cli-contracts/*.json)         │
│  └── examples      (validates examples/*.json)                  │
│                                                                 │
│  Timeout: 2 minutes per target                                 │
│  Metrics: yellow_plugins_ci_duration_seconds{stage=            │
│           "schema_validation", target="..."}                    │
└─────────────────────────────────────────────────────────────────┘
                                  │
                  ┌───────────────┴───────────────┬────────────────┐
                  │                               │                │
                  ↓                               ↓                ↓
    ┌──────────────────────────┐   ┌──────────────────┐  ┌─────────────────┐
    │ lint-and-typecheck       │   │ contract-drift   │  │ security-audit  │
    │                          │   │                  │  │                 │
    │ Timeout: 3 min           │   │ Timeout: 3 min   │  │ Timeout: 5 min  │
    │ Depends: validate-       │   │ Depends: validate│  │ Depends: none   │
    │          schemas          │   │          -schemas│  │ (parallel)      │
    └────────────┬─────────────┘   └──────────────────┘  └─────────────────┘
                 │
                 ↓
    ┌──────────────────────────┐
    │ unit-tests               │
    │                          │
    │ Timeout: 5 min           │
    │ Depends: lint-typecheck  │
    └────────────┬─────────────┘
                 │
                 ↓
    ┌──────────────────────────┐
    │ integration-tests        │
    │                          │
    │ Timeout: 8 min           │
    │ Depends: unit-tests      │
    └────────────┬─────────────┘
                 │
      ┌──────────┴──────────┬─────────────────┬────────────────┐
      │                     │                 │                │
      ↓                     ↓                 ↓                ↓
┌──────────────┐  ┌──────────────┐  ┌────────────────┐  ┌────────────┐
│ build        │  │ report-      │  │ ci-status      │  │            │
│ (main only)  │  │ metrics      │  │ (final gate)   │  │            │
│              │  │              │  │                │  │            │
│ Timeout: 5m  │  │ Always runs  │  │ Always runs    │  │            │
│ Depends: all │  │ Depends: all │  │ Depends: all   │  │            │
└──────────────┘  └──────────────┘  └────────────────┘  └────────────┘
```

**Job Execution Characteristics:**

| Job Name | Parallelism | Critical Path | Timeout | Typical Duration | SLO Target |
|----------|-------------|---------------|---------|------------------|------------|
| validate-schemas (marketplace) | Matrix (4 parallel) | ✅ Yes | 2 min | ~30s | <60s |
| validate-schemas (plugins) | Matrix (4 parallel) | ✅ Yes | 2 min | ~25s | <60s |
| validate-schemas (contracts) | Matrix (4 parallel) | ✅ Yes | 2 min | ~10s | <60s |
| validate-schemas (examples) | Matrix (4 parallel) | ✅ Yes | 2 min | ~15s | <60s |
| lint-and-typecheck | Sequential | ⚠️ Depends on schemas | 3 min | ~45s | <180s |
| unit-tests | Sequential | ⚠️ Depends on lint | 5 min | ~90s | <300s |
| integration-tests | Sequential | ⚠️ Depends on unit | 8 min | ~120s | <480s |
| contract-drift | Parallel | ❌ Independent | 3 min | ~20s | <180s |
| security-audit | Parallel | ❌ Independent | 5 min | ~40s | <300s |
| build | Conditional (main only) | ⚠️ Depends on all | 5 min | ~60s | <300s |
| report-metrics | Always | ❌ Aggregation | - | ~10s | - |
| ci-status | Always | ❌ Final gate | - | ~5s | - |

**Total Pipeline Duration:**
- **Wall-clock time (parallel):** ~4 minutes (typical), <5 minutes (SLO)
- **Sequential critical path:** validate-schemas → lint → unit → integration → build
- **Parallelized:** contract-drift, security-audit run concurrently

---

## Job Specification Tables

### Job: validate-schemas (Matrix)

**Purpose:** Validate JSON schemas for marketplace, plugins, contracts, and examples using AJV and custom business rules.

**Matrix Strategy:**
```yaml
strategy:
  fail-fast: false
  matrix:
    target: [marketplace, plugins, contracts, examples]
```

**Job Configuration:**

| Property | Value | Rationale |
|----------|-------|-----------|
| Runs-on | `ubuntu-latest` | GitHub-hosted runner, cost-effective |
| Timeout | 2 minutes | NFR-MAINT-002 critical path budget |
| Fail-fast | `false` | Allow all matrix targets to complete for comprehensive diagnostics |

**Steps:**

| Step | Command/Action | Purpose | Timing |
|------|----------------|---------|--------|
| Checkout | `actions/checkout@v4` (fetch-depth: 0) | Full history for git operations | ~5s |
| Setup pnpm | `pnpm/action-setup@v2` | Install pnpm 8.15.0 | ~2s |
| Setup Node.js | `actions/setup-node@v4` (cache: pnpm) | Node 20 + pnpm store cache | ~10s (hit), ~30s (miss) |
| Install dependencies | `pnpm install --frozen-lockfile --prefer-offline` | Install workspace dependencies | ~15s (cached) |
| Install AJV CLI | `npm install -g ajv-cli@5.0.0` | Global AJV for schema validation | ~5s |
| Start timer | `echo "CI_JOB_START=$(date +%s)" >> $GITHUB_ENV` | Capture job start timestamp | ~1s |
| Run validations | Matrix-specific validation script | Execute target-specific validation | Variable (see below) |
| Capture duration | `CI_STAGE_DURATION=$(( $(date +%s) - CI_JOB_START ))` | Calculate elapsed time | ~1s |
| Determine status | Conditional status output | Map job result to success/failure/cancelled | ~1s |
| Export metrics | `./scripts/export-ci-metrics.sh` | Generate Prometheus metrics | ~2s |
| Upload metrics | `actions/upload-artifact@v4` | Persist metrics artifact | ~3s |
| Upload logs | `actions/upload-artifact@v4` | Persist validation logs | ~3s |

**Matrix Target Specifics:**

#### Target: marketplace
```bash
# Validate .claude-plugin/marketplace.json
ajv validate \
  -s schemas/marketplace.schema.json \
  -d .claude-plugin/marketplace.json \
  --strict=true \
  --all-errors

# Run business rules validation
node scripts/validate-marketplace.js
```
**Checks:** Unique plugin IDs, semver compliance, category enums, timestamp formats, source path existence
**Typical Duration:** ~30s
**Log File:** `.ci-logs/validate-marketplace.log`
**Metrics File:** `.ci-metrics/validate-marketplace.prom`

#### Target: plugins
```bash
# Find all plugin manifests
PLUGIN_MANIFESTS=$(find plugins -type f -name 'plugin.json' \
  -path '*/.claude-plugin/plugin.json' || true)

# Validate each against plugin schema
for manifest in $PLUGIN_MANIFESTS; do
  ajv validate \
    -s schemas/plugin.schema.json \
    -d "$manifest" \
    --strict=true \
    --all-errors
done

# Run plugin-specific validation
for manifest in $PLUGIN_MANIFESTS; do
  node scripts/validate-plugin.js --plugin "$manifest"
done
```
**Checks:** 12 plugin schema rules, permission scopes, dependencies, lifecycle scripts
**Typical Duration:** ~25s (varies with plugin count)
**Log File:** `.ci-logs/validate-plugins.log`
**Metrics File:** `.ci-metrics/validate-plugins.prom`

#### Target: contracts
```bash
# Validate JSON syntax for CLI contracts
CONTRACTS=$(find api/cli-contracts -name '*.json' -type f || true)

for contract in $CONTRACTS; do
  node -e "JSON.parse(require('fs').readFileSync('$contract', 'utf8'))"
done
```
**Checks:** JSON syntax validity, no schema validation (contracts define schemas)
**Typical Duration:** ~10s
**Log File:** `.ci-logs/validate-contracts.log`
**Metrics File:** `.ci-metrics/validate-contracts.prom`

#### Target: examples
```bash
# Validate marketplace examples
ajv validate \
  -s schemas/marketplace.schema.json \
  -d examples/marketplace.example.json \
  --strict=true \
  --all-errors

# Validate plugin examples
find examples -name 'plugin*.json' -type f | while read example; do
  ajv validate \
    -s schemas/plugin.schema.json \
    -d "$example" \
    --strict=true \
    --all-errors
done
```
**Checks:** Example files stay synchronized with schemas
**Typical Duration:** ~15s
**Log File:** `.ci-logs/validate-examples.log`
**Metrics File:** `.ci-metrics/validate-examples.prom`

**Environment Variables Captured:**
- `CI_JOB_START`: Unix timestamp of job start
- `CI_STAGE_DURATION`: Elapsed seconds for stage

**Artifacts:**
- `metrics-validate-{target}`: Prometheus metrics (retention: 7 days)
- `logs-validate-{target}`: Validation logs (retention: 7 days)

**Metrics Exported:**
```prometheus
# HELP yellow_plugins_ci_duration_seconds Duration of CI validation stages
# TYPE yellow_plugins_ci_duration_seconds histogram
yellow_plugins_ci_duration_seconds{stage="schema_validation",target="marketplace",status="success"} 28.3

# HELP yellow_plugins_ci_validations_total Total number of CI validation runs
# TYPE yellow_plugins_ci_validations_total counter
yellow_plugins_ci_validations_total{stage="schema_validation",target="marketplace",status="success"} 1

# HELP yellow_plugins_ci_timestamp_seconds Unix timestamp of metric collection
# TYPE yellow_plugins_ci_timestamp_seconds gauge
yellow_plugins_ci_timestamp_seconds{stage="schema_validation",target="marketplace"} 1673452930
```

---

### Job: lint-and-typecheck

**Purpose:** Run ESLint and TypeScript compiler checks on source code.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Timeout | 3 minutes |
| Depends-on | None (runs in parallel with validate-schemas) |

**Steps:**

| Step | Command | Duration |
|------|---------|----------|
| Checkout | `actions/checkout@v4` | ~5s |
| Setup pnpm | `pnpm/action-setup@v2` | ~2s |
| Setup Node.js | `actions/setup-node@v4` (cache: pnpm) | ~10s (cached) |
| Install dependencies | `pnpm install --frozen-lockfile` | ~15s (cached) |
| Start timer | `echo "CI_JOB_START=$(date +%s)"` | ~1s |
| Run lint | `pnpm lint` | ~30s |
| Run typecheck | `pnpm typecheck` | ~15s |
| Capture duration | `CI_STAGE_DURATION=$((...))` | ~1s |
| Export metrics | `./scripts/export-ci-metrics.sh lint` | ~2s |
| Upload artifacts | Metrics + logs | ~3s |

**Artifacts:**
- `metrics-lint`: Prometheus metrics + logs (retention: 7 days)

**Metrics Exported:**
```prometheus
yellow_plugins_ci_duration_seconds{stage="lint",status="success"} 45.2
yellow_plugins_ci_validations_total{stage="lint",status="success"} 1
```

---

### Job: unit-tests

**Purpose:** Execute unit tests with vitest.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Timeout | 5 minutes |
| Depends-on | `lint-and-typecheck` |

**Steps:**

| Step | Command | Duration |
|------|---------|----------|
| Checkout | `actions/checkout@v4` | ~5s |
| Setup pnpm + Node.js | Standard setup | ~17s (cached) |
| Install dependencies | `pnpm install --frozen-lockfile` | ~15s (cached) |
| Start timer | Capture `CI_JOB_START` | ~1s |
| Run unit tests | `pnpm test:unit --reporter=verbose` | ~90s |
| Capture duration | Calculate `CI_STAGE_DURATION` | ~1s |
| Export metrics | `./scripts/export-ci-metrics.sh unit_test` | ~2s |
| Upload artifacts | Metrics + logs | ~3s |

**Artifacts:**
- `metrics-unit-tests`: Prometheus metrics + logs (retention: 7 days)

**Metrics Exported:**
```prometheus
yellow_plugins_ci_duration_seconds{stage="unit_test",status="success"} 87.5
yellow_plugins_ci_validations_total{stage="unit_test",status="success"} 1
```

---

### Job: integration-tests

**Purpose:** Execute integration tests with vitest.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Timeout | 8 minutes |
| Depends-on | `unit-tests` |

**Steps:** Identical structure to unit-tests, substituting `pnpm test:integration --reporter=verbose`

**Artifacts:**
- `metrics-integration-tests`: Prometheus metrics + logs (retention: 7 days)

**Metrics Exported:**
```prometheus
yellow_plugins_ci_duration_seconds{stage="integration_test",status="success"} 118.3
yellow_plugins_ci_validations_total{stage="integration_test",status="success"} 1
```

---

### Job: contract-drift

**Purpose:** Detect CLI contract changes and validate contract examples.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Timeout | 3 minutes |
| Depends-on | `validate-schemas` |

**Steps:**

| Step | Command | Purpose |
|------|---------|---------|
| Checkout | `actions/checkout@v4` (fetch-depth: 0) | Full history for git diff |
| Setup pnpm + Node.js | Standard setup | Dependency installation |
| Install AJV CLI | `npm install -g ajv-cli@5.0.0` | Contract validation |
| Start timer | Capture `CI_JOB_START` | Timing |
| Detect contract changes | `git diff --name-only origin/main...HEAD \| grep cli-contracts` | Git diff analysis |
| Validate contracts | `node -e "JSON.parse(...)"` for each contract | Syntax check |
| Validate examples | `ajv validate -s contract -d example` | Example validation |
| Export metrics | `./scripts/export-ci-metrics.sh contract_drift` | Metrics export |
| Upload artifacts | Metrics + logs | Artifact persistence |

**Contract Change Detection (Pull Requests Only):**
```bash
CHANGED=$(git diff --name-only origin/main...HEAD | grep -E '^api/cli-contracts/.*\.json$' || true)
if [ -n "$CHANGED" ]; then
  echo "::warning::CLI contracts have been modified. Ensure backward compatibility!"
fi
```

**Artifacts:**
- `metrics-contract-drift`: Prometheus metrics + logs (retention: 7 days)

**Metrics Exported:**
```prometheus
yellow_plugins_ci_duration_seconds{stage="contract_drift",status="success"} 18.7
yellow_plugins_ci_validations_total{stage="contract_drift",status="success"} 1
```

---

### Job: security-audit

**Purpose:** Run dependency audits and scan for sensitive data in manifests.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Timeout | 5 minutes |
| Depends-on | None (parallel execution) |

**Steps:**

| Step | Command | Purpose |
|------|---------|---------|
| Setup | Standard setup | Dependency installation |
| Dependency audit | `pnpm audit --audit-level moderate` | CVE scanning |
| Secret scanning | `grep -rE '(api[_-]?key\|password\|token\|secret)'` | Manifest security check |
| Permission validation | `node scripts/validate-permissions.js` | Permission scope audit |
| Export metrics | `./scripts/export-ci-metrics.sh security_audit` | Metrics export |
| Upload artifacts | Metrics + logs | Artifact persistence |

**Security Checks:**
1. **Dependency Audit:** Detects known CVEs in npm dependencies (moderate+ severity)
2. **Secret Scanning:** Searches `.claude-plugin/` and `plugins/` for hardcoded secrets
3. **Permission Validation:** Ensures permission scopes match allowed values

**Failure Behavior:**
- Dependency audit: Emits warning (does not block)
- Secret found: **Blocks workflow** with error
- Permission validation: Emits warning (script optional)

**Artifacts:**
- `metrics-security-audit`: Prometheus metrics + logs (retention: 7 days)

**Metrics Exported:**
```prometheus
yellow_plugins_ci_duration_seconds{stage="security_audit",status="success"} 38.2
yellow_plugins_ci_validations_total{stage="security_audit",status="success"} 1
```

---

### Job: build (Conditional)

**Purpose:** Verify TypeScript compilation for all workspace packages.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Timeout | 5 minutes |
| Condition | `github.ref == 'refs/heads/main'` |
| Depends-on | `validate-schemas`, `lint-and-typecheck`, `unit-tests` |

**Steps:**

| Step | Command | Duration |
|------|---------|----------|
| Setup | Standard setup | ~17s (cached) |
| Install dependencies | `pnpm install --frozen-lockfile` | ~15s (cached) |
| Build workspace | `pnpm build` | ~60s |
| Export metrics | `./scripts/export-ci-metrics.sh build` | ~2s |
| Upload artifacts | Metrics + logs | ~3s |

**Build Command:**
```bash
pnpm build  # Builds all workspace packages via turbo or pnpm workspaces
```

**Artifacts:**
- `metrics-build`: Prometheus metrics + logs (retention: 7 days)

**Metrics Exported:**
```prometheus
yellow_plugins_ci_duration_seconds{stage="build",status="success"} 62.1
yellow_plugins_ci_validations_total{stage="build",status="success"} 1
```

---

### Job: report-metrics (Aggregation)

**Purpose:** Aggregate metrics from all jobs, enforce SLO compliance, and publish combined artifact.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Condition | `always()` (runs even if jobs fail) |
| Depends-on | All jobs (validate-schemas, lint, tests, contract-drift, security-audit, build) |

**Steps:**

| Step | Command | Purpose |
|------|---------|---------|
| Download artifacts | `actions/download-artifact@v4` (pattern: `metrics-*`) | Collect all metrics files |
| Aggregate metrics | `find all-metrics -name '*.prom' -exec cat {} + > ci-metrics.prom` | Merge Prometheus files |
| Display summary | `cat aggregated-metrics/ci-metrics.prom` | Log aggregated metrics |
| Upload aggregated | `actions/upload-artifact@v4` (retention: 30 days) | Persist combined metrics |
| Check SLO compliance | Python script (see below) | Enforce CRIT-021 budget |

**SLO Compliance Check (Python Inline Script):**
```python
import sys, pathlib

path = pathlib.Path("aggregated-metrics/ci-metrics.prom")
if not path.exists():
    print("::warning::Aggregated metrics file missing")
    sys.exit(0)

violations = []
for line in path.read_text().splitlines():
    if not line.startswith("yellow_plugins_ci_duration_seconds{"):
        continue
    labels_raw, value_raw = line[len("yellow_plugins_ci_duration_seconds{"):].split("} ")
    labels = {}
    for pair in labels_raw.split(","):
        if "=" not in pair:
            continue
        key, val = pair.split("=", 1)
        labels[key] = val.strip('"')
    try:
        value = float(value_raw.strip())
    except ValueError:
        continue

    if labels.get("stage") == "schema_validation" and value > 60:
        violations.append((labels.get("target", "unknown"), value))

if violations:
    for target, duration in violations:
        print(f"::error::Schema validation target '{target}' exceeded 60s budget ({duration:.2f}s)")
    sys.exit(1)

print("All schema validation metrics within 60s budget.")
```

**SLO Enforcement:**
- **Target:** Schema validation jobs ≤ 60 seconds
- **Metric:** `yellow_plugins_ci_duration_seconds{stage="schema_validation"}`
- **Action:** Fails workflow if any validation target exceeds budget
- **Reference:** CRIT-021, NFR-MAINT-002

**Artifacts:**
- `ci-metrics-aggregated`: Combined Prometheus metrics (retention: 30 days)

---

### Job: ci-status (Final Gate)

**Purpose:** Summarize overall CI status and provide final pass/fail decision.

**Job Configuration:**

| Property | Value |
|----------|-------|
| Runs-on | `ubuntu-latest` |
| Condition | `always()` |
| Depends-on | All validation jobs |

**Steps:**

| Step | Command | Purpose |
|------|---------|---------|
| Check results | Conditional expression (see below) | Aggregate job statuses |
| Emit summary | GitHub Actions notice/error | Display final status |

**Status Check Logic:**
```bash
if [ "${{ needs.validate-schemas.result }}" == "success" ] && \
   [ "${{ needs.lint-and-typecheck.result }}" == "success" ] && \
   [ "${{ needs.unit-tests.result }}" == "success" ] && \
   [ "${{ needs.integration-tests.result }}" == "success" ] && \
   [ "${{ needs.contract-drift.result }}" == "success" ] && \
   [ "${{ needs.security-audit.result }}" == "success" ] && \
   { [ "${{ needs.build.result }}" == "success" ] || [ "${{ needs.build.result }}" == "skipped" ]; }; then
  echo "::notice::✅ All CI validation checks passed"
  exit 0
else
  echo "::error::❌ One or more CI checks failed"
  # Emit individual job statuses
  exit 1
fi
```

**Artifacts:** None (status summary only)

---

## Caching Strategy

### pnpm Store Cache

**Implementation:**
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

**Cache Key:** Hash of `pnpm-lock.yaml`
**Cache Location:** `~/.pnpm-store`
**Benefit:** Shared dependencies across all jobs (avoids redundant `node_modules` installs)
**Typical Savings:** 20-30 seconds per job

**Install Command:**
```bash
pnpm install --frozen-lockfile --prefer-offline
```
- `--frozen-lockfile`: Fails if lockfile is out of sync (prevents drift)
- `--prefer-offline`: Uses cache when available (faster installs)

**Cache Hit Rate:**
- **Expected:** >90% for PR/push workflows
- **Monitoring:** Check workflow logs for "Cache restored from key" messages
- **Cache Misses:** Expected after dependency updates (dependabot PRs)

---

## Artifact Management

### Artifact Types

#### 1. Metrics Artifacts

**Pattern:** `metrics-{job-name}`
**Content:** Prometheus text format metrics (`.ci-metrics/*.prom`)
**Retention:** 7 days (individual jobs), 30 days (aggregated)
**Purpose:** Performance tracking, SLO compliance validation, root-cause analysis

**Jobs Producing Metrics:**
- `metrics-validate-{target}` (marketplace, plugins, contracts, examples)
- `metrics-lint` (includes lint + typecheck)
- `metrics-unit-tests`
- `metrics-integration-tests`
- `metrics-contract-drift`
- `metrics-security-audit`
- `metrics-build`

**Aggregated Artifact:** `ci-metrics-aggregated` → `aggregated-metrics/ci-metrics.prom`

#### 2. Log Artifacts

**Pattern:** `logs-validate-{target}`
**Content:** Streaming logs produced by validation scripts (`.ci-logs/validate-{target}.log`)
**Retention:** 7 days
**Purpose:** Post-CI troubleshooting for schema failures, archive of ajv/node output

**Note:** Lint, test, and other jobs bundle logs with metrics in a single artifact.

#### 3. Release Artifacts (Not in Validation Workflow)

**Pattern:** `release-artifacts-v{VERSION}`
**Workflow:** `.github/workflows/publish-release.yml`
**Content:** Tarball, SBOM, checksums, release notes
**Retention:** 90 days
**Purpose:** Release publishing, distribution

### Artifact Naming Convention

```
{artifact-type}-{job-name}[-{variant}]
```

**Examples:**
- `metrics-validate-marketplace`
- `logs-validate-plugins`
- `ci-metrics-aggregated`

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

| Artifact Type | Retention | Rationale |
|---------------|-----------|-----------|
| Metrics (individual) | 7 days | Short-term performance analysis |
| Metrics (aggregated) | 30 days | SLO trend tracking |
| Logs | 7 days | Debugging recent failures |
| Release artifacts | 90 days | Long-term release history |

---

## Runtime Budgets and SLO Enforcement

### SLO Targets (NFR-MAINT-002)

#### Total CI Runtime
**Target:** <5 minutes for complete validation workflow
**Critical Path:** schema validation → lint/typecheck → tests
**Measurement:** Sum of job durations (excluding parallelized matrix jobs)

#### Validation Job Runtime (CRIT-021)
**Target:** <60 seconds per validation matrix job
**Jobs:** `validate-schemas` (marketplace, plugins, contracts, examples)
**Measurement:** `yellow_plugins_ci_duration_seconds{stage="schema_validation"}`

**Enforcement Mechanism:**
1. Each matrix job has a 2-minute timeout (hard limit)
2. `report-metrics` job parses aggregated metrics
3. Python script checks for `schema_validation` durations >60s
4. Workflow fails if any target exceeds budget
5. Error message includes target name and actual duration

**Example SLO Violation:**
```
::error::Schema validation target 'plugins' exceeded 60s budget (73.45s)
```

### Current Performance Baseline

Based on typical 10-plugin marketplace:

| Job | Target | Typical | Status |
|-----|--------|---------|--------|
| validate-schemas (marketplace) | <60s | ~30s | ✅ Within budget |
| validate-schemas (plugins) | <60s | ~25s | ✅ Within budget |
| validate-schemas (contracts) | <60s | ~10s | ✅ Within budget |
| validate-schemas (examples) | <60s | ~15s | ✅ Within budget |
| lint-and-typecheck | <180s | ~45s | ✅ Within budget |
| unit-tests | <300s | ~90s | ✅ Within budget |
| integration-tests | <480s | ~120s | ✅ Within budget |
| contract-drift | <180s | ~20s | ✅ Within budget |
| security-audit | <300s | ~40s | ✅ Within budget |
| build (main only) | <300s | ~60s | ✅ Within budget |

**Total Wall-Clock Time (Parallel):** ~4 minutes (typical), <5 minutes (SLO)

### Performance Optimization Techniques

1. **Matrix Parallelization:** Validation targets run concurrently (4 jobs in ~60s vs. ~80s sequential)
2. **pnpm Caching:** Shared store across jobs (typical savings: 20-30 seconds per job)
3. **Conditional Job Execution:** Build job only runs on `main` branch (reduces PR execution time)
4. **Concurrency Limits:** Cancel stale runs to free runner capacity (prevents queue bottlenecks)

### Monitoring Performance Budgets

**Download Aggregated Metrics:**
```bash
gh run download <run-id> --name ci-metrics-aggregated
cat aggregated-metrics/ci-metrics.prom | grep schema_validation
```

**Check SLO Compliance:**
```bash
# Extract duration for each validation target
grep 'yellow_plugins_ci_duration_seconds.*schema_validation' ci-metrics.prom

# Verify all durations < 60 seconds
awk '/yellow_plugins_ci_duration_seconds.*schema_validation/ {
  match($0, /} ([0-9.]+)/, arr);
  if (arr[1] > 60) {
    print "SLO VIOLATION:", $0
  }
}' ci-metrics.prom
```

**Alert on SLO Violations:**
The `report-metrics` job enforces this automatically and fails the workflow with actionable error messages referencing specific targets and durations.

---

## Integration with CLI Commands and Smoke Tests

### CLI Smoke Commands

The CI pipeline integrates with CLI commands through vitest test suites that invoke CLI entry points directly:

**Integration Test Examples:**
```bash
# Unit tests invoke domain services (no CLI)
pnpm test:unit

# Integration tests invoke CLI commands via test harness
pnpm test:integration
```

**Test Coverage:**
- Install flow: `/plugin install {id}@{version}`
- Rollback flow: `/plugin rollback {id}`
- Contract validation: JSON schema validation for CLI contracts
- Compatibility checks: 5-dimension validation (Claude Code, Node.js, OS, arch, plugin deps)

### Contract Drift Detection

The `contract-drift` job validates that CLI contracts in `api/cli-contracts/*.json` remain valid and backward-compatible:

**Validation Steps:**
1. **Syntax Check:** Parse each JSON file (`node -e "JSON.parse(...)"`)
2. **Example Validation:** Validate request/response examples against contract schemas
3. **Git Diff Analysis:** Detect contract changes in PRs and emit compatibility warnings

**Contract Files:**
- `api/cli-contracts/install.json` (install request/response contracts)
- `api/cli-contracts/update.json` (update request/response contracts)
- `api/cli-contracts/rollback.json` (rollback request/response contracts)

**Example Validation (if examples exist):**
```bash
for contract in $CONTRACTS; do
  base=$(basename "$contract" .json)

  if compgen -G "examples/requests/${base}*.json" > /dev/null; then
    for request in examples/requests/${base}*.json; do
      ajv validate -s "$contract" -d "$request"
    done
  fi

  if compgen -G "examples/responses/${base}*.json" > /dev/null; then
    for response in examples/responses/${base}*.json; do
      ajv validate -s "$contract" -d "$response"
    done
  fi
done
```

### Script Invocations

All validation scripts are located in `scripts/` and invoked directly by workflow steps:

| Script | Invocation | Purpose |
|--------|------------|---------|
| `scripts/validate-marketplace.js` | `node scripts/validate-marketplace.js` | Business rules for marketplace.json |
| `scripts/validate-plugin.js` | `node scripts/validate-plugin.js --plugin {manifest}` | 12 plugin schema rules |
| `scripts/export-ci-metrics.sh` | `./scripts/export-ci-metrics.sh {stage} {status} [labels]` | Prometheus metrics export |
| `scripts/validate-permissions.js` | `node scripts/validate-permissions.js` | Permission scope audit (optional) |

**Metrics Export Example:**
```bash
# Export metrics for custom stage
./scripts/export-ci-metrics.sh custom_stage success target=custom

# Output format (Prometheus text):
# yellow_plugins_ci_duration_seconds{stage="custom_stage",status="success",target="custom"} 42.5
# yellow_plugins_ci_validations_total{stage="custom_stage",status="success",target="custom"} 1
# yellow_plugins_ci_timestamp_seconds{stage="custom_stage",target="custom"} 1673452930
```

---

## Metrics Catalog Reference

The CI pipeline exports the following metrics (detailed catalog in [metrics.md](./metrics.md)):

### Core CI Metrics

#### `yellow_plugins_ci_duration_seconds` (histogram)
**Description:** Duration of CI validation stages in seconds
**Labels:**
- `stage`: lint | unit_test | integration_test | schema_validation | build | contract_drift | security_audit
- `status`: success | failure | cancelled
- `target`: marketplace | plugins | contracts | examples (schema_validation only)

**SLO Target:** ≤60 seconds for `stage="schema_validation"`
**Mitigation:** CRIT-021 (CI runtime budget enforcement)

#### `yellow_plugins_ci_validations_total` (counter)
**Description:** Total number of CI validation runs
**Labels:** Same as `duration_seconds`
**Use Case:** Track CI reliability, identify flaky stages

#### `yellow_plugins_ci_timestamp_seconds` (gauge)
**Description:** Unix timestamp of metric collection
**Labels:** Same as `duration_seconds`
**Use Case:** Correlate CI runs with external events

### Example Metrics Output

```prometheus
# HELP yellow_plugins_ci_duration_seconds Duration of CI validation stages
# TYPE yellow_plugins_ci_duration_seconds histogram
yellow_plugins_ci_duration_seconds{stage="schema_validation",target="marketplace",status="success"} 28.3
yellow_plugins_ci_duration_seconds{stage="lint",status="success"} 45.2
yellow_plugins_ci_duration_seconds{stage="unit_test",status="success"} 87.5
yellow_plugins_ci_duration_seconds{stage="integration_test",status="success"} 118.3
yellow_plugins_ci_duration_seconds{stage="build",status="success"} 62.1

# HELP yellow_plugins_ci_validations_total Total number of CI validation runs
# TYPE yellow_plugins_ci_validations_total counter
yellow_plugins_ci_validations_total{stage="schema_validation",target="marketplace",status="success"} 1
yellow_plugins_ci_validations_total{stage="lint",status="success"} 1

# HELP yellow_plugins_ci_timestamp_seconds Unix timestamp of metric collection
# TYPE yellow_plugins_ci_timestamp_seconds gauge
yellow_plugins_ci_timestamp_seconds{stage="schema_validation",target="marketplace"} 1673452930
```

---

## Failure Modes and Remediation

### Schema Validation Failure

**Symptoms:**
- `validate-schemas` job fails (red X)
- Error message: "Schema validation failed"

**Diagnosis:**
```bash
# Download validation logs
gh run download <run-id> --name logs-validate-marketplace

# Review log content
cat logs-validate-marketplace/validate-marketplace.log
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

**Reference:** [Failure Triage](./ci.md#failure-triage)

### SLO Budget Exceeded

**Symptoms:**
- `report-metrics` job fails
- Error message: "Schema validation target '{target}' exceeded 60s budget ({duration}s)"

**Diagnosis:**
```bash
# Download aggregated metrics
gh run download <run-id> --name ci-metrics-aggregated

# Check validation durations
grep 'schema_validation' aggregated-metrics/ci-metrics.prom
```

**Common Causes:**
- Large plugin count (>20 plugins)
- Slow AJV validation (complex schemas)
- Network latency (cache miss)

**Remediation:**
1. Optimize validation scripts (parallelize plugin iteration)
2. Pre-warm pnpm cache (`pnpm install` in prior job)
3. Split large validation targets into smaller batches
4. Consider increasing budget (requires architecture review)

**Reference:** [Performance Budgets](./ci.md#performance-budgets)

---

## Requirements Traceability

This CI Validation Pipeline Specification satisfies the following architectural requirements:

| Requirement ID | Description | Implementation Evidence |
|----------------|-------------|------------------------|
| **CRIT-021** | CI runtime budget enforcement | `report-metrics` job enforces <60s schema validation budget via Python script, fails workflow on violations |
| **NFR-MAINT-002** | CI < 5 minutes, validation < 60s | Job timeouts, parallelization, caching strategy, SLO compliance checks |
| **FR-001** | Marketplace validation | `validate-schemas` matrix target `marketplace` with AJV + business rules |
| **FR-002** | Plugin validation | `validate-schemas` matrix target `plugins` with 12 schema rules |
| **FR-009** | Simple publishing | Git-native PR/merge workflow, automated validation in CI |
| **FR-011** | Release automation | Separate `publish-release.yml` workflow (not covered in this spec) |
| **Section 2.1** | CI Validation Pipeline Spec artifact | This document serves as the formal Section 2.1 architectural artifact |
| **Section 6** | Verification & integration strategy | Workflow implements CI/CD validation, artifact collection, metrics export |

**Traceability Matrix Entry:**
- **Artifact:** `docs/operations/ci-pipeline.md`
- **FR/NFR/CRIT:** CRIT-021, NFR-MAINT-002, FR-001, FR-002, FR-009, FR-011
- **Status:** Traceability 100%, implementation complete

**Reference:** [Traceability Matrix](../traceability-matrix.md)

---

## Maintenance and Evolution

### Adding New Validation Stages

To add a new validation stage to the pipeline:

1. **Define Job in Workflow:**
   ```yaml
   new-validation-stage:
     name: New Validation Stage
     runs-on: ubuntu-latest
     timeout-minutes: 3
     needs: [validate-schemas]  # Dependency
     steps:
       - name: Run validation
         run: pnpm validate:new-stage
   ```

2. **Export Metrics:**
   ```yaml
   - name: Export metrics
     if: always()
     run: |
       ./scripts/export-ci-metrics.sh new_stage "${{ steps.status.outputs.status }}"
   ```

3. **Upload Artifacts:**
   ```yaml
   - name: Upload artifacts
     uses: actions/upload-artifact@v4
     with:
       name: metrics-new-stage
       path: .ci-metrics/new-stage.prom
   ```

4. **Update `report-metrics` Job:**
   Add `new-validation-stage` to `needs:` array

5. **Update `ci-status` Job:**
   Add status check in conditional expression

6. **Document in This Spec:**
   Add job specification table, metrics catalog entry, failure mode

### Updating Runtime Budgets

To update SLO targets (requires architecture approval):

1. Modify timeout in job definition (`timeout-minutes`)
2. Update SLO enforcement script in `report-metrics` (change 60s threshold)
3. Update this specification document (Runtime Budgets section)
4. Update metrics.md (KPI definitions)
5. Update traceability matrix (CRIT-021 compliance evidence)

### Version Control

This specification is versioned alongside the workflow file:

| Spec Version | Workflow SHA | Date | Changes |
|--------------|--------------|------|---------|
| 1.0.0 | `1b54848` | 2026-01-12 | Initial CI Validation Pipeline Spec artifact |

**Change Management:**
- All workflow changes require corresponding spec updates
- Spec updates trigger documentation review in PRs
- Traceability matrix updated when FR/NFR/CRIT references change

---

## References

### Internal Documentation
- [CI/CD Operations Guide](./ci.md) - Procedural guidance (complementary to this spec)
- [Metrics Guide](./metrics.md) - Telemetry catalog and Prometheus queries
- [Operational Runbook](./runbook.md) - Incident response and diagnostics
- [Traceability Matrix](../traceability-matrix.md) - Requirements coverage verification
- [SPECIFICATION.md](../SPECIFICATION.md) - Complete technical specification

### Architecture Documents
- [01_Plan_Overview_and_Setup.md](../plan/01_Plan_Overview_and_Setup.md) - Section 2.1 artifact plan
- [03_Verification_and_Glossary.md](../plan/03_Verification_and_Glossary.md) - Section 6 verification strategy
- [04_Operational_Architecture.md](../architecture/04_Operational_Architecture.md) - Section 3.7 operational processes

### External Resources
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [pnpm CI Setup](https://pnpm.io/continuous-integration)
- [Prometheus Exposition Formats](https://prometheus.io/docs/instrumenting/exposition_formats/)
- [JSON Schema Draft-07](https://json-schema.org/draft-07/schema)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-12 | 1.0.0 | Initial CI Validation Pipeline Specification (I4.T3 deliverable) |

---

**Document Status:** Production-Ready
**Approval Status:** Pending review (I4.T3 acceptance criteria met)
**Next Review:** 2026-02-12

---

**END OF CI VALIDATION PIPELINE SPECIFICATION**
