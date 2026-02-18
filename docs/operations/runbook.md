# Operational Runbook

**Status:** Active
**Last Updated:** 2026-01-12
**Maintainer:** Platform Team
**Document Type:** Operational Procedures

---

<!-- START doctoc -->
<!-- END doctoc -->

## Overview

This runbook provides step-by-step procedures for diagnosing and remediating operational issues in the Yellow Plugins system. It covers incident response workflows, diagnostics commands, failure recovery procedures, and escalation paths referenced in Architecture §3.7. Dedicated sections document lifecycle script incidents, cache recovery, publish rollback, telemetry export, and KPI escalation steps that Section 6 of the verification strategy treats as gating artifacts.

**Purpose:**
- Guide operators through incident response and system recovery
- Provide concrete commands for common failure scenarios
- Define escalation paths for complex issues
- Document remediation procedures linked to CI failures

**Audience:**
- Platform engineers responding to incidents
- Contributors troubleshooting local development issues
- CI/CD maintainers debugging workflow failures
- Operations teams recovering from system corruption

**Related Documents:**
- [CI/CD Operations Guide](./ci.md) - CI workflow procedural guidance
- [CI Validation Pipeline Spec](./ci-pipeline.md) - Technical pipeline specification
- [Metrics Guide](./metrics.md) - Telemetry and monitoring
- [Section 6 Verification Strategy](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md#6-verification-and-integration-strategy) - Defines verification hooks and documentation gates

---

## Prerequisites

Before using this runbook, ensure you have the following tools installed:

### Required Tools

| Tool | Version | Installation | Verification |
|------|---------|--------------|--------------|
| **pnpm** | 8.15.0 | `npm install -g pnpm@8.15.0` | `pnpm --version` |
| **Node.js** | 20 LTS | https://nodejs.org | `node --version` |
| **Git** | ≥2.30 | https://git-scm.com | `git --version` |
| **GitHub CLI** | Latest | `brew install gh` / https://cli.github.com | `gh --version` |
| **jq** | Latest | `brew install jq` / `apt install jq` | `jq --version` |
| **Docker** (optional) | Latest | https://docker.com | `docker --version` |

### Repository Access

```bash
# Clone repository
git clone https://github.com/kinginyellow/yellow-plugins.git
cd yellow-plugins

# Install dependencies
pnpm install

# Verify setup
pnpm validate
```

### GitHub Authentication

```bash
# Authenticate GitHub CLI
gh auth login

# Verify access
gh repo view kinginyellow/yellow-plugins
```

---

## Incident Response Workflow

### Quick Reference

| Incident Type | First Command | Diagnostic Tool | Remediation Section |
|---------------|---------------|-----------------|---------------------|
| CI Validation Failure | `gh run view <run-id>` | GitHub Actions logs | [CI Failures](#ci-validation-failures) |
| Schema Validation Error | `pnpm validate:schemas` | AJV validation output | [Schema Failures](#schema-validation-failures) |
| Registry Corruption | `cat .claude-plugin/registry.json` | JSON validation | [Registry Recovery](#registry-corruption-recovery) |
| Cache Issues | `ls -lh ~/.claude/plugins/cache/` | Directory inspection | [Cache Recovery](#cache-recovery) |
| Dependency Vulnerabilities | `pnpm audit` | npm audit report | [Security Incidents](#security-audit-failures) |
| Lifecycle Script Failure | `grep lifecycle_consent .claude-plugin/audit/*.jsonl` | Audit logs | [Lifecycle Script Incidents](#lifecycle-script-incidents) |
| Publish Rollback | `git log .claude-plugin/marketplace.json` | Git history | [Publish Rollback](#publish-rollback) |
| Telemetry Export | `pnpm metrics` | Metrics export | [Telemetry Export](#telemetry-export-and-audit-review) |
| KPI Threshold Breach | Review quarterly metrics | KPI reports | [KPI Escalation](#kpi-escalation-paths) |

### Incident Response Steps

1. **Triage** (0-5 minutes)
   - Identify incident type and scope
   - Check if incident is blocking (production) or non-blocking (development)
   - Gather initial context (error messages, logs, metrics)

2. **Diagnose** (5-30 minutes)
   - Run diagnostic commands (see incident-specific sections below)
   - Download relevant artifacts (CI logs, metrics)
   - Review recent changes (git history, PR diffs)

3. **Remediate** (30 minutes - 4 hours)
   - Apply appropriate fix from runbook
   - Verify fix resolves issue
   - Document any deviations or discoveries

4. **Escalate** (>4 hours)
   - Create GitHub issue with full context
   - Tag platform team for review
   - Consider rollback if production-impacting
   - Create postmortem using [template](./postmortem-template.md) for all P0/P1 incidents

---

## CI Validation Failures

### Symptoms

- GitHub Actions workflow shows red X
- PR checks fail with validation errors
- Commit status indicates failure

### Diagnosis

**Step 1: Identify Failed Job**

```bash
# View workflow run summary
gh run view <run-id>

# Example output:
# X validate-schemas (marketplace)  ✓ validate-schemas (plugins)
# ✓ lint-and-typecheck              X unit-tests
```

**Step 2: Download Artifacts**

```bash
# Download all artifacts
gh run download <run-id>

# Download specific artifact
gh run download <run-id> --name logs-validate-marketplace
```

**Step 3: Review Logs**

```bash
# View validation logs
cat logs-validate-marketplace/validate-marketplace.log

# View GitHub Actions logs directly
gh run view <run-id> --log | grep -A 20 "Schema validation"
```

### Common Failures

#### 1. Schema Validation Failure

**Symptoms:**
- `validate-schemas` job fails
- Log shows AJV validation errors

**Diagnosis:**
```bash
# Run validation locally
pnpm validate:schemas

# Validate specific target
node scripts/validate-marketplace.js
node scripts/validate-plugin.js --plugin plugins/example/.claude-plugin/plugin.json
```

**Remediation:**

**For Marketplace Validation Errors:**
```bash
# Check marketplace.json syntax
jq '.' .claude-plugin/marketplace.json

# Common fixes:
# - Remove trailing commas
# - Ensure all plugin IDs are unique
# - Verify all versions use semver format (1.2.3)
# - Check category names match allowed enum values

# Validate against schema
ajv validate -s schemas/marketplace.schema.json -d .claude-plugin/marketplace.json --all-errors
```

**For Plugin Validation Errors:**
```bash
# Check plugin.json syntax
jq '.' plugins/example/.claude-plugin/plugin.json

# Common fixes:
# - Ensure required fields present: id, name, version, author, description
# - Verify permissions array has scope + reason for each entry
# - Check compatibility.claudeCode matches semver range format

# Validate specific plugin
node scripts/validate-plugin.js --plugin plugins/example/.claude-plugin/plugin.json
```

**Fix and Re-run:**
```bash
# After fixing validation errors
git add .claude-plugin/marketplace.json plugins/
git commit -m "fix: resolve schema validation errors"
git push

# CI will automatically re-run
```

**Reference:** [CI Pipeline Spec: validate-schemas job](./ci-pipeline.md#job-validate-schemas-matrix)

#### 2. Lint/TypeCheck Failure

**Symptoms:**
- `lint-and-typecheck` job fails
- ESLint or TypeScript compiler errors

**Diagnosis:**
```bash
# Run linter locally
pnpm lint

# Run type checker
pnpm typecheck

# Run both
pnpm validate
```

**Remediation:**
```bash
# Auto-fix linting issues
pnpm lint:fix

# For type errors, review compiler output
pnpm typecheck --pretty

# Common fixes:
# - Add missing type annotations
# - Fix import paths
# - Resolve circular dependencies
```

**Fix and Re-run:**
```bash
git add .
git commit -m "fix: resolve lint and type errors"
git push
```

**Reference:** [CI Pipeline Spec: lint-and-typecheck job](./ci-pipeline.md#job-lint-and-typecheck)

#### 3. Test Failures

**Symptoms:**
- `unit-tests` or `integration-tests` job fails
- Test assertions fail

**Diagnosis:**
```bash
# Run unit tests locally with verbose output
pnpm test:unit --reporter=verbose

# Run specific test file
pnpm test:unit path/to/test.spec.ts

# Run integration tests
pnpm test:integration --reporter=verbose
```

**Remediation:**

**For Flaky Tests:**
```bash
# Increase timeouts in test files
# Edit test file and add timeout option:
# test('example', async () => { /* ... */ }, { timeout: 10000 })

# Or run with retry flag
pnpm test:unit --retry=2
```

**For Regression Bugs:**
```bash
# Fix failing assertions
# Add regression test to prevent recurrence

# Verify fix locally
pnpm test
```

**Fix and Re-run:**
```bash
git add tests/
git commit -m "fix: resolve test failures"
git push
```

**Reference:** [CI Pipeline Spec: unit-tests, integration-tests](./ci-pipeline.md#job-unit-tests)

#### 4. SLO Budget Exceeded

**Symptoms:**
- `report-metrics` job fails
- Error: "Schema validation target exceeded 60s budget"

**Diagnosis:**
```bash
# Download aggregated metrics
gh run download <run-id> --name ci-metrics-aggregated

# Check validation durations
grep 'schema_validation' aggregated-metrics/ci-metrics.prom

# Example output:
# yellow_plugins_ci_duration_seconds{stage="schema_validation",target="plugins",status="success"} 73.2
```

**Remediation:**

**Short-term Fix (Increase Timeout):**
```yaml
# Edit .github/workflows/validate-schemas.yml
validate-schemas:
  timeout-minutes: 3  # Increase from 2 to 3 minutes
```

**Long-term Fix (Optimize Validation):**
```bash
# Profile validation script
time node scripts/validate-plugin.js --plugin plugins/example/.claude-plugin/plugin.json

# Optimize:
# - Parallelize plugin iteration
# - Cache AJV schema compilation
# - Reduce file I/O operations
```

**Escalation:**
If performance degradation persists, create a GitHub issue:
```bash
gh issue create --title "CI validation exceeds SLO budget" \
  --body "Schema validation target 'plugins' consistently exceeds 60s budget. Current duration: 73.2s. Optimization needed."
```

**Reference:** [CI Pipeline Spec: SLO Enforcement](./ci-pipeline.md#runtime-budgets-and-slo-enforcement)

---

## Schema Validation Failures

### Invalid JSON Syntax

**Symptoms:**
- Parse error: "Unexpected token" or "Trailing comma"
- AJV validation fails with syntax error

**Diagnosis:**
```bash
# Validate JSON syntax
jq '.' .claude-plugin/marketplace.json

# If jq fails, output shows line/column of error
```

**Remediation:**
```bash
# Common JSON syntax errors:
# 1. Trailing commas (not allowed in JSON)
# 2. Missing commas between array/object elements
# 3. Unquoted keys
# 4. Single quotes instead of double quotes

# Use jq to format and fix syntax
jq '.' .claude-plugin/marketplace.json > marketplace-fixed.json
mv marketplace-fixed.json .claude-plugin/marketplace.json

# Verify fix
pnpm validate:schemas
```

### Schema Constraint Violations

**Symptoms:**
- AJV validation error: "should have required property" or "should match pattern"
- Workflow log shows specific field violations

**Diagnosis:**
```bash
# Run validation with all errors
ajv validate -s schemas/marketplace.schema.json -d .claude-plugin/marketplace.json --all-errors

# Review schema requirements
cat schemas/marketplace.schema.json | jq '.required'
```

**Remediation:**

**Missing Required Fields:**
```bash
# Check marketplace.json has all required fields:
# - schemaVersion, marketplaceName, marketplaceVersion, lastUpdated, plugins

jq '.plugins[] | select(.id == null or .version == null)' .claude-plugin/marketplace.json

# Add missing fields
jq '.plugins[0] += {"description": "Plugin description"}' .claude-plugin/marketplace.json
```

**Invalid Enum Values:**
```bash
# Check allowed categories
cat schemas/plugin.schema.json | jq '.properties.category.enum'

# Example categories: productivity, development, writing, data, automation,
#                      api-integration, ui-enhancement, analytics, security, other

# Fix invalid category
jq '.plugins[] | select(.category == "invalid") | .category = "other"' \
  .claude-plugin/marketplace.json
```

**Invalid Semver:**
```bash
# Check version format (must be X.Y.Z)
jq '.plugins[].version' .claude-plugin/marketplace.json | grep -v '^"[0-9]\+\.[0-9]\+\.[0-9]\+"$'

# Fix invalid versions
# 1.2 → 1.2.0
# 1 → 1.0.0
# v1.2.3 → 1.2.3 (remove 'v' prefix)
```

**Verification:**
```bash
# After fixing, verify all validations pass
pnpm validate

# Expected output: "All validations passed"
```

---

## Registry Corruption Recovery

### Symptoms

- Plugin commands fail with "Registry is corrupted"
- `registry.json` is malformed or missing
- Metric: `yellow_plugins_registry_corruption_incidents_total > 0`

### Diagnosis

**Step 1: Check Registry File**
```bash
# Verify registry.json exists
ls -l .claude-plugin/registry.json

# Validate JSON syntax
jq '.' .claude-plugin/registry.json

# If jq fails, registry is corrupted
```

**Step 2: Check Backup Availability**
```bash
# Check for registry backup
ls -l .claude-plugin/registry.json.backup

# View backup creation time
stat .claude-plugin/registry.json.backup
```

**Step 3: Review Logs**
```bash
# Check for interrupted write operations
grep -r "registry" .ci-logs/ | grep -i "error\|interrupt\|corrupt"

# Check metrics for corruption incidents
grep "registry_corruption" .ci-metrics/*.prom
```

### Remediation

#### Option 1: Restore from Backup

```bash
# Verify backup is valid JSON
jq '.' .claude-plugin/registry.json.backup

# Restore backup
cp .claude-plugin/registry.json.backup .claude-plugin/registry.json

# Verify restoration
jq '.' .claude-plugin/registry.json

# Test registry operations
pnpm plugin list  # Should succeed
```

#### Option 2: Rebuild Registry (No Backup Available)

```bash
# Create minimal registry structure
cat > .claude-plugin/registry.json <<'EOF'
{
  "schemaVersion": "1.0.0",
  "installedPlugins": [],
  "lastModified": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

# Validate new registry
jq '.' .claude-plugin/registry.json

# Re-install plugins manually
# (All installed plugins must be reinstalled)
pnpm plugin install example-plugin@1.0.0
```

#### Option 3: Restore from Git History

```bash
# Find last known good registry commit
git log --oneline -- .claude-plugin/registry.json

# Restore from specific commit
git checkout <commit-sha> -- .claude-plugin/registry.json

# Verify restoration
jq '.' .claude-plugin/registry.json
```

### Post-Recovery Actions

```bash
# Create fresh backup
cp .claude-plugin/registry.json .claude-plugin/registry.json.backup

# Verify atomic write semantics
# Check that registry updates use temp file + rename pattern
grep -r "writeFileSync.*registry" packages/ | grep -i "tmp\|temp"

# Report incident
gh issue create --title "Registry corruption incident" \
  --body "Registry file was corrupted. Restored from backup. Investigate root cause."
```

**Reference:** [Metrics Guide: Registry Corruption](./metrics.md#yellow_plugins_registry_corruption_incidents_total)

---

## Cache Recovery

### Symptoms

- Low cache hit ratio (<60%)
- Cache eviction warnings
- Plugin reinstalls take longer than expected
- Metric: `yellow_plugins_cache_hit_ratio < 0.6`

### Diagnosis

**Step 1: Check Cache Size**
```bash
# Inspect cache directory
du -sh ~/.claude/plugins/cache/

# Check cache size metric
grep "cache_size_bytes" .ci-metrics/*.prom

# Check if approaching 500 MB limit
# SLO Target: ≤ 500 MB (524,288,000 bytes)
```

**Step 2: Check Eviction Frequency**
```bash
# Check eviction metrics
grep "cache_evictions_total" .ci-metrics/*.prom

# Review cache contents
ls -lhR ~/.claude/plugins/cache/

# Count cached plugins
find ~/.claude/plugins/cache/ -name 'plugin.json' | wc -l
```

**Step 3: Identify Cache Misses**
```bash
# Check cache hit ratio
grep "cache_hit_ratio" .ci-metrics/*.prom

# Expected: ≥ 0.6 for reinstall scenarios

# Review logs for cache miss patterns
grep "cache miss" .ci-logs/*.log
```

### Remediation

#### Clear Cache

```bash
# Full cache clear (use with caution)
rm -rf ~/.claude/plugins/cache/*

# Verify cache is empty
ls ~/.claude/plugins/cache/

# Reinstall plugins to rebuild cache
pnpm plugin install example-plugin@1.0.0
```

#### Pin Critical Plugins

```bash
# Pin frequently used plugins to prevent eviction
pnpm plugin pin markdown-formatter
pnpm plugin pin hookify
pnpm plugin pin text-analyzer

# Verify pinned status
jq '.pinnedPlugins' .claude-plugin/config.json
```

#### Increase Cache Capacity

```bash
# Edit config to increase cache limit (requires implementation)
jq '.cache.maxSize = 1048576000' .claude-plugin/config.json  # 1 GB

# Note: This feature may not be implemented in Phase 1
# Check documentation for cache configuration options
```

#### Pre-warm Cache

```bash
# Install common plugins to warm cache before workflows
pnpm plugin install markdown-formatter@1.2.3
pnpm plugin install hookify@2.0.0
pnpm plugin install text-analyzer@1.5.0

# Verify cache size
du -sh ~/.claude/plugins/cache/
```

**Reference:** [Metrics Guide: Cache Performance](./metrics.md#cache-performance-metrics), [Verification Strategy §6](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md#6-verification-and-integration-strategy)

---

## Security Audit Failures

### Dependency Vulnerabilities

**Symptoms:**
- `security-audit` job fails or emits warnings
- `pnpm audit` reports CVEs

**Diagnosis:**
```bash
# Run dependency audit locally
pnpm audit

# Show detailed vulnerability information
pnpm audit --audit-level moderate --json

# List outdated packages
pnpm outdated
```

**Remediation:**

**Update Vulnerable Dependencies:**
```bash
# Update specific package
pnpm update <package-name>

# Update all dependencies (use with caution)
pnpm update

# Verify no high/critical vulnerabilities remain
pnpm audit --audit-level high

# Re-run tests after updates
pnpm test
```

**Fix and Re-run:**
```bash
git add pnpm-lock.yaml
git commit -m "fix(deps): update dependencies to resolve CVEs"
git push
```

**Escalation:**
If vulnerabilities cannot be resolved (no patch available):
```bash
# Document exception
echo "CVE-2023-XXXX: No patch available. Mitigation: ..." > .security-exceptions.md

# Consider dependency substitution or removal
```

### Secret Detection

**Symptoms:**
- `security-audit` job fails with "Sensitive data found"
- Workflow blocks merge

**Diagnosis:**
```bash
# Run secret scan locally
grep -rE '(api[_-]?key|password|token|secret)' .claude-plugin/ plugins/ --include="*.json" | grep -v '"permissionScopes"'

# Example matches:
# .claude-plugin/marketplace.json:  "apiKey": "sk-1234..."
```

**Remediation:**

**Remove Hardcoded Secrets:**
```bash
# Edit files to remove secrets
# Replace with environment variables or placeholders

# Example:
# BEFORE: "apiKey": "sk-1234abcd"
# AFTER:  "apiKey": "${ANTHROPIC_API_KEY}"

# Verify secrets removed
grep -rE '(api[_-]?key|password|token|secret)' .claude-plugin/ plugins/ --include="*.json"

# Should return no matches (except permissionScopes)
```

**Rotate Compromised Credentials:**
```bash
# If secrets were committed to git history:
# 1. Rotate credentials immediately (new API keys, passwords)
# 2. Consider using git-filter-repo to rewrite history (advanced)
# 3. Document incident and remediation steps
```

**Update .gitignore:**
```bash
# Add patterns to prevent future commits
echo ".env" >> .gitignore
echo "*.secret.json" >> .gitignore
echo "credentials.json" >> .gitignore

git add .gitignore
git commit -m "chore: update gitignore to prevent secret commits"
```

**Reference:** [CI Pipeline Spec: security-audit job](./ci-pipeline.md#job-security-audit)

---

## Contract Drift Issues

### Symptoms

- `contract-drift` job emits warning
- Message: "CLI contracts have been modified"
- PR includes changes to `api/cli-contracts/*.json`

### Diagnosis

```bash
# Check what contract files changed
git diff origin/main...HEAD -- api/cli-contracts/

# Review contract differences
git diff origin/main:api/cli-contracts/install.json HEAD:api/cli-contracts/install.json

# Validate contract syntax
jq '.' api/cli-contracts/install.json

# Validate examples against contracts (if examples exist)
for contract in api/cli-contracts/*.json; do
  base=$(basename "$contract" .json)
  if [ -f "examples/requests/${base}.json" ]; then
    ajv validate -s "$contract" -d "examples/requests/${base}.json"
  fi
done
```

### Remediation

#### Review Breaking Changes

**Check for backward-incompatible changes:**
- Removed required fields
- Changed field types (string → number)
- Renamed fields
- Modified enum values

**Example:**
```bash
# BEFORE (v1.0):
{
  "request": {
    "pluginId": "string",
    "version": "string"
  }
}

# AFTER (v1.1 - BREAKING):
{
  "request": {
    "pluginIdentifier": "string",  // RENAMED: pluginId → pluginIdentifier
    "version": "string"
  }
}
```

**Remediation:**
1. **Revert breaking change:** Restore original field name
2. **Add compatibility shim:** Support both old and new field names
3. **Version contract:** Create `install-v2.json` alongside `install.json`

#### Update Contract Examples

```bash
# Add request/response examples for new contracts
mkdir -p examples/requests examples/responses

# Create example request
cat > examples/requests/install.json <<'EOF'
{
  "pluginId": "markdown-formatter",
  "version": "1.2.3",
  "options": {
    "force": false
  }
}
EOF

# Validate example against contract
ajv validate -s api/cli-contracts/install.json -d examples/requests/install.json
```

#### Document Migration Path

```bash
# Add entry to CHANGELOG.md
cat >> CHANGELOG.md <<'EOF'
## [Unreleased]
### Changed
- CLI contract for install command updated to version 1.1
- BREAKING: `pluginId` field renamed to `pluginIdentifier`
- Migration: Update all install requests to use new field name

EOF

# Commit changes
git add CHANGELOG.md api/cli-contracts/ examples/
git commit -m "feat(contracts): update install contract to v1.1"
```

**Reference:** [CI Pipeline Spec: contract-drift job](./ci-pipeline.md#job-contract-drift)

---

## Local Development Issues

### pnpm Install Failures

**Symptoms:**
- `pnpm install` fails with lockfile errors
- Dependencies don't match expected versions

**Diagnosis:**
```bash
# Check pnpm version
pnpm --version  # Should be 8.15.0

# Verify lockfile integrity
pnpm install --frozen-lockfile

# If fails, check for lockfile conflicts
git status pnpm-lock.yaml
```

**Remediation:**
```bash
# Update pnpm to locked version
npm install -g pnpm@8.15.0

# Regenerate lockfile (use with caution)
rm pnpm-lock.yaml
pnpm install

# Verify no unintended changes
git diff pnpm-lock.yaml

# If diff is minimal, commit
git add pnpm-lock.yaml
git commit -m "chore: regenerate pnpm lockfile"
```

### TypeScript Compilation Errors

**Symptoms:**
- `pnpm build` fails
- TypeScript compiler errors

**Diagnosis:**
```bash
# Run type checker
pnpm typecheck

# Check TypeScript version
pnpm list typescript

# Verify tsconfig.json is valid
jq '.' tsconfig.json
```

**Remediation:**
```bash
# Clean build artifacts
rm -rf dist/ packages/*/dist/

# Reinstall dependencies
pnpm install

# Rebuild
pnpm build

# If errors persist, review compiler output
pnpm build --verbose
```

### Git Workflow Issues

**Symptoms:**
- Unable to push commits
- PR checks not running

**Diagnosis:**
```bash
# Check git remote
git remote -v

# Verify branch tracking
git branch -vv

# Check if fork is up to date
git fetch upstream
git log HEAD..upstream/main --oneline
```

**Remediation:**
```bash
# Sync fork with upstream
git fetch upstream
git checkout main
git merge upstream/main
git push origin main

# Rebase feature branch
git checkout feature-branch
git rebase main
git push --force-with-lease
```

---

## Escalation Paths

### When to Escalate

Escalate to platform team if:
- Issue persists >4 hours without resolution
- Remediation steps in this runbook fail
- Issue impacts production or blocks releases
- Root cause is unclear or systemic

### Creating GitHub Issues

```bash
# Create issue with template
gh issue create --title "CI validation consistently failing for plugins target" \
  --body "**Summary:** Schema validation for plugins target consistently exceeds 60s budget.

**Diagnostics:**
- Run ID: 12345678
- Duration: 73.2s (target: <60s)
- Plugin count: 15

**Attempted Remediation:**
- [x] Optimized validation script (no improvement)
- [x] Increased timeout to 3 minutes (temporary workaround)
- [ ] Need architectural review for long-term fix

**Artifacts:**
- Logs: [link to downloaded logs]
- Metrics: yellow_plugins_ci_duration_seconds{target=\"plugins\"} 73.2

**Recommendation:**
Consider splitting plugin validation into multiple matrix jobs or parallelizing plugin iteration.

**Priority:** High (blocking CI SLO compliance)"
```

### Internal Escalation

| Severity | Response Time | Contact |
|----------|---------------|---------|
| **P0 (Production Down)** | <1 hour | Maintainer direct contact |
| **P1 (CI Blocked)** | <4 hours | GitHub issue + team mention |
| **P2 (Degraded Performance)** | <24 hours | GitHub issue |
| **P3 (Enhancement/Optimization)** | <1 week | GitHub discussion |

### External Escalation

For issues with external dependencies:
- **GitHub Actions:** https://github.com/contact/support
- **pnpm:** https://github.com/pnpm/pnpm/issues
- **Node.js:** https://github.com/nodejs/node/issues

---

## Lifecycle Script Incidents

### Symptoms

- Lifecycle script execution fails during install/update/uninstall
- User declines script consent, blocking operation
- Script timeout or sandbox violation
- Metric: `yellow_plugins_lifecycle_executions_total{exit_code != 0}`

### Diagnosis

**Step 1: Check Audit Logs**
```bash
# Review lifecycle consent events
grep 'lifecycle_consent' .claude-plugin/audit/*.jsonl

# Check script execution outcomes
grep 'lifecycle_execution' .claude-plugin/audit/*.jsonl

# Example output:
# {"level":"audit","eventType":"lifecycle_consent","pluginId":"text-analyzer","scriptDigest":"sha256:a1b2c3d4...","consentGranted":true,"exitCode":1}
```

**Step 2: Review Script Digest**
```bash
# Verify script contents match expected digest
cat .claude-plugin/cache/text-analyzer/2.0.0/lifecycle/install.sh | sha256sum

# Compare with logged digest from audit event
```

**Step 3: Check Sandbox Logs**
```bash
# Review sandbox execution logs
cat .ci-logs/lifecycle-execution-*.log

# Check for timeout, permission errors, or exit codes
```

### Remediation

#### Option 1: Script Declined by User

**Symptoms:** User typed incorrect confirmation or declined consent

**Remediation:**
```bash
# Re-attempt install with explicit consent
plugin install text-analyzer@2.0.0

# When prompted, type exact confirmation string:
# "I TRUST THIS SCRIPT"

# Alternative: Skip lifecycle scripts (use with caution)
plugin install text-analyzer@2.0.0 --skip-lifecycle
```

#### Option 2: Script Execution Failed

**Symptoms:** Script ran but exited with non-zero code

**Diagnosis:**
```bash
# Check script exit code from audit log
grep 'exitCode' .claude-plugin/audit/*.jsonl | grep 'text-analyzer'

# Review script output
cat .claude-plugin/cache/text-analyzer/2.0.0/lifecycle/install.log
```

**Remediation:**
```bash
# Fix script dependencies or permissions
# Contact plugin author if script is malformed

# For immediate unblock, install older version
plugin install text-analyzer@1.9.0
```

#### Option 3: Sandbox Timeout

**Symptoms:** Script exceeded execution time limit

**Diagnosis:**
```bash
# Check execution duration from audit log
grep 'executionDurationMs' .claude-plugin/audit/*.jsonl | grep 'text-analyzer'

# Default timeout: 60 seconds for lifecycle scripts
```

**Remediation:**
```bash
# Increase timeout via config (if script legitimately needs more time)
jq '.lifecycle.timeout = 120000' .claude-plugin/config.json > config.tmp
mv config.tmp .claude-plugin/config.json

# Re-attempt install
plugin install text-analyzer@2.0.0
```

### Post-Incident Actions

```bash
# Document script failure in issue
gh issue create --title "Lifecycle script failure: text-analyzer@2.0.0" \
  --body "Script digest: sha256:a1b2c3d4...
Exit code: 1
Audit log: [attach log excerpt]
Reproduction steps: [describe]"

# If script is malicious, report to plugin author and remove from marketplace
```

**Reference:** [Metrics Guide: Lifecycle Consent Tracking](./metrics.md#yellow_plugins_lifecycle_prompt_declines_total), [Verification Strategy §6](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md#6-verification-and-integration-strategy)

---

## Publish Rollback

### Symptoms

- Published plugin breaks marketplace validation
- Incorrect version published (e.g., 2.0.0 instead of 1.3.1)
- Missing or corrupted plugin manifest after publish
- CI validation fails after marketplace update merged

### Diagnosis

**Step 1: Identify Problematic Commit**
```bash
# Check recent marketplace.json changes
git log -p --follow .claude-plugin/marketplace.json | head -100

# Identify commit that introduced issue
git blame .claude-plugin/marketplace.json
```

**Step 2: Verify Schema Validation**
```bash
# Run schema validation locally
pnpm validate:schemas

# Check specific plugin entry
jq '.plugins[] | select(.id == "text-analyzer")' .claude-plugin/marketplace.json
```

**Step 3: Check CI Workflow Status**
```bash
# Review failed CI run
gh run list --workflow=validate-schemas.yml --limit 5

# Download CI logs and artifacts
gh run download <failed-run-id>
```

### Remediation

#### Option 1: Revert Git Commit

**Symptoms:** Last publish commit broke validation

**Remediation:**
```bash
# Revert the problematic commit
git revert <commit-sha>

# Verify revert fixes validation
pnpm validate:schemas

# Push revert
git push origin main

# Delete incorrect git tag if created
git tag -d v2.0.0
git push origin :refs/tags/v2.0.0
```

#### Option 2: Manual Marketplace Fix

**Symptoms:** Specific plugin entry is malformed

**Remediation:**
```bash
# Edit marketplace.json to fix entry
jq '.plugins |= map(if .id == "text-analyzer" then .version = "1.3.1" else . end)' \
  .claude-plugin/marketplace.json > marketplace.tmp
mv marketplace.tmp .claude-plugin/marketplace.json

# Validate fix
pnpm validate:schemas

# Commit correction
git add .claude-plugin/marketplace.json
git commit -m "fix: correct text-analyzer version to 1.3.1"
git push origin main
```

#### Option 3: Restore from Backup

**Symptoms:** Marketplace.json severely corrupted

**Remediation:**
```bash
# Restore from git history
git checkout HEAD~1 -- .claude-plugin/marketplace.json

# Verify restoration
jq '.' .claude-plugin/marketplace.json

# Validate schemas
pnpm validate:schemas

# Commit restoration
git add .claude-plugin/marketplace.json
git commit -m "fix: restore marketplace.json from previous commit"
git push origin main
```

### Post-Rollback Actions

```bash
# Verify CI passes after rollback
gh run list --workflow=validate-schemas.yml --limit 1

# Update release notes with rollback information
echo "## Rollback Notice
Version 2.0.0 was rolled back due to marketplace validation failure.
Restored to version 1.3.1.
See incident #123 for details." >> CHANGELOG.md

# Create postmortem
cp docs/operations/postmortem-template.md docs/operations/postmortem-2026-001.md
# Fill out postmortem details
```

**Reference:** [CI Pipeline Spec: Publishing Workflow](./ci-pipeline.md), [Metrics Guide: CI Validation](./metrics.md#yellow_plugins_ci_validations_total), [Verification Strategy §6](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md#6-verification-and-integration-strategy)

---

## Telemetry Export and Audit Review

### Symptoms

- Need to export telemetry for incident investigation
- Audit log review required for security compliance
- Metrics snapshot needed for KPI reporting
- Correlation ID tracing across logs, metrics, and audit events

### Exporting Telemetry Artifacts

**Step 1: Collect Audit Logs**
```bash
# Export lifecycle consent logs
grep 'lifecycle_consent' .claude-plugin/audit/*.jsonl > audit-lifecycle-$(date +%Y%m%d).jsonl

# Export all audit events for date range
grep -E '2026-01-(10|11|12)' .claude-plugin/audit/*.jsonl > audit-export-jan10-12.jsonl

# Compress for upload
tar -czf audit-export-jan10-12.tar.gz audit-export-jan10-12.jsonl
```

**Step 2: Export Metrics Snapshots**
```bash
# Export Prometheus metrics
pnpm metrics > metrics-snapshot-$(date +%Y%m%d).prom

# Export JSON format for programmatic analysis
pnpm metrics --format json > metrics-snapshot-$(date +%Y%m%d).json

# Compress for upload
tar -czf metrics-snapshot-$(date +%Y%m%d).tar.gz metrics-snapshot-*.{prom,json}
```

**Step 3: Export Structured Logs**
```bash
# Collect structured JSON logs from .claude-plugin/logs/
tar -czf logs-export-$(date +%Y%m%d).tar.gz .claude-plugin/logs/*.jsonl

# Filter logs by correlation ID for specific incident
jq 'select(.correlationId == "a3f2c9d8-1b4e-4a5c-9d7f-8e3c2a1b4d5e")' \
  .claude-plugin/logs/*.jsonl > incident-correlation-trace.jsonl
```

**Step 4: Upload to GitHub (CI Context)**
```yaml
# In GitHub Actions workflow
- name: Collect Telemetry Artifacts
  run: |
    mkdir -p telemetry-export
    cp .claude-plugin/audit/*.jsonl telemetry-export/
    pnpm metrics > telemetry-export/metrics-snapshot.prom
    pnpm metrics --format json > telemetry-export/metrics-snapshot.json
    cp .claude-plugin/logs/*.jsonl telemetry-export/ || true

- name: Upload Telemetry Artifacts
  uses: actions/upload-artifact@v3
  with:
    name: telemetry-export-${{ github.run_id }}
    path: telemetry-export/
    retention-days: 90
```

### Audit Log Review

**Review Lifecycle Script Consent Events**
```bash
# List all consent events with outcomes
jq 'select(.eventType == "lifecycle_consent") |
  {plugin: .pluginId, version: .version, consent: .consentGranted, exitCode: .exitCode}' \
  .claude-plugin/audit/*.jsonl

# Count consent declines by plugin
jq -r 'select(.eventType == "lifecycle_consent" and .consentGranted == false) | .pluginId' \
  .claude-plugin/audit/*.jsonl | sort | uniq -c | sort -rn
```

**Review Command Execution Patterns**
```bash
# Summarize commands by type
jq -r '.command' .claude-plugin/logs/*.jsonl | sort | uniq -c | sort -rn

# Identify failed operations
jq 'select(.level == "error") | {command: .command, error: .errorCode, time: .timestamp}' \
  .claude-plugin/logs/*.jsonl
```

**Trace Correlation ID Across Artifacts**
```bash
# Given a correlation ID, trace across logs, metrics, and audit
CORRELATION_ID="a3f2c9d8-1b4e-4a5c-9d7f-8e3c2a1b4d5e"

# Find in logs
grep "$CORRELATION_ID" .claude-plugin/logs/*.jsonl

# Find in audit
grep "$CORRELATION_ID" .claude-plugin/audit/*.jsonl

# Find associated transaction ID
jq -r "select(.correlationId == \"$CORRELATION_ID\") | .data.transactionId" \
  .claude-plugin/logs/*.jsonl
```

### KPI Reporting from Telemetry

**Generate KPI Report for Quarterly Review**
```bash
# Install success rate (Architecture §3.16)
TOTAL_INSTALLS=$(jq -r 'select(.command == "install") | .command' .claude-plugin/logs/*.jsonl | wc -l)
FAILED_INSTALLS=$(jq -r 'select(.command == "install" and .level == "error") | .command' .claude-plugin/logs/*.jsonl | wc -l)
SUCCESS_RATE=$(echo "scale=2; (($TOTAL_INSTALLS - $FAILED_INSTALLS) / $TOTAL_INSTALLS) * 100" | bc)
echo "Install Success Rate: $SUCCESS_RATE% (Target: ≥ 99%)"

# Rollback duration (Architecture §3.16)
AVG_ROLLBACK=$(jq -r 'select(.command == "rollback") | .durationMs' .claude-plugin/logs/*.jsonl | \
  awk '{sum+=$1; count++} END {print sum/count/1000 "s"}')
echo "Average Rollback Duration: $AVG_ROLLBACK (Target: < 60s)"

# Cache eviction frequency
EVICTIONS=$(grep 'cache_evictions_total' metrics-snapshot.prom | awk '{print $2}')
echo "Cache Evictions: $EVICTIONS (Monitor for spikes)"
```

**Reference:** [Metrics Guide](./metrics.md), [Operational Architecture §3.16](../.codemachine/artifacts/architecture/04_Operational_Architecture.md#3-16-operational-kpis), [Verification Strategy §6](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md#6-verification-and-integration-strategy)

---

## KPI Escalation Paths

When KPIs fall outside target thresholds (Architecture §3.16) or Section 6 verification hooks detect missing telemetry, follow these escalation procedures:

### Install Success Rate < 99%

**Severity:** P1 (Significant degradation)

**Escalation Steps:**
1. Create incident tracking issue immediately
2. Run diagnostics: `pnpm validate:schemas`, check CI logs, review error codes
3. Identify pattern: schema failures, cache issues, network problems
4. Implement fix or workaround within 4 hours
5. Create postmortem using [template](./postmortem-template.md)

### Rollback Duration > 60s

**Severity:** P2 (Degraded performance)

**Escalation Steps:**
1. Review cache integrity: verify symlink state, check cache size
2. Profile rollback operation: identify slow steps (symlink swap, registry write)
3. Document findings in GitHub issue
4. Optimize within 1 week or adjust SLO target (requires architecture approval)

### Cache Eviction Frequency Spike

**Severity:** P2 (Degraded performance)

**Escalation Steps:**
1. Calculate baseline eviction rate from historical metrics
2. Identify cause: large plugin packages, cache size threshold too low
3. Adjust cache policies or recommend pinning frequently-used plugins
4. Monitor for 1 week to confirm stabilization

### Doc Update Latency > 2 Days

**Severity:** P3 (Process issue)

**Escalation Steps:**
1. Identify stale documentation via git log comparison
2. Assign documentation update to code author
3. Add documentation checklist to PR template
4. Review quarterly to ensure compliance

**Reference:** [Escalation Paths](#escalation-paths), [Postmortem Template](./postmortem-template.md)

---

## Preventive Maintenance

### Weekly Checks

```bash
# Review aggregated metrics
gh run list --workflow=validate-schemas.yml --limit 10
gh run download $(gh run list --workflow=validate-schemas.yml --limit 1 --json databaseId -q '.[0].databaseId') --name ci-metrics-aggregated

# Check SLO compliance
grep 'schema_validation' aggregated-metrics/ci-metrics.prom

# Monitor cache hit rates
grep 'cache_hit_ratio' .ci-metrics/*.prom

# Review audit logs for anomalies
jq 'select(.level == "audit")' .claude-plugin/audit/*.jsonl | tail -50
```

### Monthly Maintenance

```bash
# Update Docker base image digest (security patches)
# Check for new Node 20 slim image
docker pull node:20-slim
docker inspect node:20-slim | jq '.[0].Id'

# Update Dockerfile SHA-256 pin
# Edit Dockerfile and update @sha256:... to latest digest

# Review artifact retention policies
gh api /repos/kinginyellow/yellow-plugins/actions/artifacts | jq '.artifacts[] | {name, expired}'

# Audit security vulnerabilities
pnpm audit

# Export monthly metrics for KPI review
pnpm metrics > metrics-monthly-$(date +%Y-%m).prom

# Review lifecycle consent decline rates
jq 'select(.eventType == "lifecycle_consent" and .consentGranted == false)' \
  .claude-plugin/audit/*.jsonl | wc -l
```

### Quarterly Reviews

```bash
# Update GitHub Actions versions (dependabot PRs)
# Review and merge dependabot PRs for actions/checkout, actions/upload-artifact, etc.

# Review performance budgets
# Analyze p95 durations for all stages
# Adjust SLO targets if needed (requires architecture approval)

# Audit security audit rules
# Review scripts/validate-permissions.js for new permission scopes
# Update secret scanning regex patterns

# Document new failure scenarios in this runbook

# Conduct KPI review (Architecture §3.16 / Verification Strategy §6)
# Generate KPI report from quarterly telemetry exports
# Review postmortems and action item completion
# Update operational processes based on lessons learned
```

---

## References

### Internal Documentation
- [CI Validation Pipeline Spec](./ci-pipeline.md) - Technical pipeline specification
- [CI/CD Operations Guide](./ci.md) - CI workflow procedural guidance
- [Metrics Guide](./metrics.md) - Telemetry catalog and monitoring
- [Postmortem Template](./postmortem-template.md) - Incident investigation workflow
- [Traceability Matrix](../traceability-matrix.md) - Requirements coverage
- [SPECIFICATION.md](../SPECIFICATION.md) - Complete technical specification

### Architecture Documents
- [04_Operational_Architecture.md](../.codemachine/artifacts/architecture/04_Operational_Architecture.md) - Section 3.7, 3.11, 3.16
- [03_Verification_and_Glossary.md](../.codemachine/artifacts/plan/03_Verification_and_Glossary.md) - Section 6 verification strategy

### External Resources
- [GitHub Actions Troubleshooting](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows)
- [pnpm Troubleshooting](https://pnpm.io/errors)
- [JSON Schema Validation](https://json-schema.org/understanding-json-schema/)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-12 | 1.1.0 | Extended with lifecycle script incidents, publish rollback, telemetry export, and KPI escalation paths (I4.T4 deliverable) |
| 2026-01-12 | 1.0.0 | Initial operational runbook (I4.T3 deliverable) |

---

**Document Status:** Production-Ready
**Approval Status:** Active (I4.T4 acceptance criteria met)
**Next Review:** 2026-02-12

---

**END OF OPERATIONAL RUNBOOK**
