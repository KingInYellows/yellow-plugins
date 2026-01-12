# Operational Runbook

**Status:** Active
**Last Updated:** 2026-01-12
**Maintainer:** Platform Team
**Document Type:** Operational Procedures

---

<!-- START doctoc -->
<!-- END doctoc -->

## Overview

This runbook provides step-by-step procedures for diagnosing and remediating operational issues in the Yellow Plugins system. It covers incident response workflows, diagnostics commands, failure recovery procedures, and escalation paths referenced in Architecture §3.7.

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

**Reference:** [Metrics Guide: Cache Performance](./metrics.md#cache-performance-metrics)

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
```

---

## References

### Internal Documentation
- [CI Validation Pipeline Spec](./ci-pipeline.md) - Technical pipeline specification
- [CI/CD Operations Guide](./ci.md) - CI workflow procedural guidance
- [Metrics Guide](./metrics.md) - Telemetry catalog and monitoring
- [Traceability Matrix](../traceability-matrix.md) - Requirements coverage
- [SPECIFICATION.md](../SPECIFICATION.md) - Complete technical specification

### Architecture Documents
- [04_Operational_Architecture.md](../architecture/04_Operational_Architecture.md) - Section 3.7 operational processes
- [03_Verification_and_Glossary.md](../plan/03_Verification_and_Glossary.md) - Section 6 verification strategy

### External Resources
- [GitHub Actions Troubleshooting](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows)
- [pnpm Troubleshooting](https://pnpm.io/errors)
- [JSON Schema Validation](https://json-schema.org/understanding-json-schema/)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-12 | 1.0.0 | Initial operational runbook (I4.T3 deliverable) |

---

**Document Status:** Production-Ready
**Approval Status:** Pending review (I4.T3 acceptance criteria met)
**Next Review:** 2026-02-12

---

**END OF OPERATIONAL RUNBOOK**
