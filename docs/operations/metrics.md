# Metrics and Observability Guide

**Status:** Active
**Last Updated:** 2026-01-11
**Maintainer:** Platform Team

---

## Overview

This document describes the telemetry and metrics infrastructure for the Yellow Plugins system. It covers structured logging, Prometheus metrics, OpenTelemetry tracing, and operational monitoring strategies aligned with the observability requirements defined in the architecture.

**Architecture References:**
- Section 3.0: The "Rulebook" (Cross-Cutting Concerns) - Observability mandate
- Section 3.5: Observability Fabric - Logging, metrics, and tracing implementation
- Section 3.11: Operational Metrics Catalog - KPI definitions and targets
- CRIT-004: Lifecycle script consent logging
- CRIT-008: Telemetry correlation IDs
- CRIT-010: Telemetry instrumentation points
- CRIT-021: CI runtime budget validation

---

## Table of Contents

1. [Observability Architecture](#observability-architecture)
2. [Structured Logging](#structured-logging)
3. [Prometheus Metrics](#prometheus-metrics)
4. [Metrics Catalog](#metrics-catalog)
5. [Exporting Metrics](#exporting-metrics)
6. [Retention and Storage](#retention-and-storage)
7. [Dashboard Examples](#dashboard-examples)
8. [Troubleshooting](#troubleshooting)

---

## Observability Architecture

The Yellow Plugins observability stack consists of three pillars:

### 1. Structured Logging
- **Dual-channel output:** JSON logs to stdout, human-readable logs to stderr
- **Correlation IDs:** Every command invocation receives a unique UUID for tracing
- **Transaction IDs:** Multi-step operations (install/rollback) share transaction IDs across all steps
- **Audit logging:** Lifecycle script consent events logged at AUDIT level with script digests and confirmation strings

### 2. Prometheus Metrics
- **In-memory collector:** Lightweight metrics collection without external dependencies
- **Namespace:** All metrics use `yellow_plugins_*` prefix
- **Export formats:** Prometheus text format (default), JSON format (programmatic)
- **Scraping:** Metrics available via `plugin metrics` command

### 3. OpenTelemetry Tracing
- **Local spans:** JSON span exports for CI artifact collection
- **Coverage:** Schema validation, compatibility checks, cache operations, lifecycle execution
- **Correlation:** Spans include correlation IDs for alignment with logs and metrics

---

## Structured Logging

### Log Entry Format

JSON logs written to stdout follow this schema:

```json
{
  "timestamp": "2026-01-11T14:32:10.123Z",
  "level": "info",
  "command": "install",
  "correlationId": "a3f2c9d8-1b4e-4a5c-9d7f-8e3c2a1b4d5e",
  "message": "Plugin installation started",
  "data": {
    "pluginId": "markdown-formatter",
    "version": "1.2.3",
    "transactionId": "tx-1673452930123-a9b8c7d"
  },
  "durationMs": 1234,
  "errorCode": "ERR-INSTALL-001"
}
```

### Log Levels

| Level   | Use Case | Examples |
|---------|----------|----------|
| `debug` | Verbose diagnostics (requires `--verbose`) | Cache lookup details, policy rule evaluation steps |
| `info`  | Normal operation events | Command start/completion, installation steps |
| `warn`  | Non-fatal issues | Compatibility warnings, cache eviction warnings |
| `error` | Operation failures | Installation errors, validation failures |
| `audit` | Security and compliance events | Lifecycle consent decisions, script execution outcomes |

### Correlation and Transaction IDs

**Correlation ID:**
- Generated once per CLI command invocation
- Propagates through all service calls
- Enables end-to-end trace of a single command

**Transaction ID:**
- Generated for multi-step operations (install, update, rollback)
- Shared across all steps in the transaction lifecycle
- Format: `tx-{timestamp}-{random}`
- Recorded in registry for rollback correlation

**Example:**
```json
{
  "correlationId": "a3f2c9d8-1b4e-4a5c-9d7f-8e3c2a1b4d5e",
  "transactionId": "tx-1673452930123-a9b8c7d",
  "message": "Stage 3/7: Extracting artifacts"
}
```

### Audit Logging for Lifecycle Scripts

Lifecycle script consent events include:
- Script digest (SHA-256)
- Confirmation string typed by user
- Consent decision (granted/declined)
- Execution outcome (exit code, duration)

**Example:**
```json
{
  "level": "audit",
  "eventType": "lifecycle_consent",
  "pluginId": "text-analyzer",
  "version": "2.0.0",
  "scriptDigest": "sha256:a1b2c3d4...",
  "confirmationString": "I consent to run this script",
  "consentGranted": true,
  "consentTimestamp": "2026-01-11T14:35:22Z",
  "exitCode": 0,
  "executionDurationMs": 2340
}
```

---

## Prometheus Metrics

### Metrics Types

1. **Counter:** Monotonically increasing values (e.g., total installs)
2. **Gauge:** Point-in-time values that can increase or decrease (e.g., cache size)
3. **Histogram:** Distribution of observed values (e.g., command duration buckets)

### Histogram Buckets

**Duration Histograms (milliseconds):**
```
[50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, +Inf]
```

**Size Histograms (bytes):**
```
[1KB, 10KB, 100KB, 1MB, 10MB, 50MB, 100MB, 500MB, +Inf]
```

---

## Metrics Catalog

### Command Performance Metrics

#### `yellow_plugins_command_duration_ms` (histogram)
**Description:** Duration of CLI commands in milliseconds
**Labels:**
- `command`: Command name (install, update, rollback, etc.)
- `status`: success | failure

**SLO Targets:**
- Install: ≤ 120 seconds (120,000 ms) for P95
- Publish: ≤ 10 minutes (600,000 ms) for P95

**CRIT Mitigation:** CRIT-010, CRIT-021

---

#### `yellow_plugins_install_total` (counter)
**Description:** Total number of plugin installations
**Labels:**
- `command`: install | update
- `status`: success | failure

**Use Case:** Track installation success rate, identify patterns in failures

---

#### `yellow_plugins_rollback_total` (counter)
**Description:** Total number of plugin rollbacks
**Labels:**
- `command`: rollback
- `status`: success | failure

**Use Case:** Monitor rollback frequency as indicator of stability issues

**CRIT Mitigation:** CRIT-002 (rollback support validation)

---

### Cache Performance Metrics

#### `yellow_plugins_cache_hit_ratio` (gauge)
**Description:** Ratio of cache hits to total cache accesses (0.0 to 1.0)
**Labels:** None

**SLO Target:** ≥ 0.6 (60% hit ratio) for reinstall scenarios

**Calculation:**
```
cache_hit_ratio = cache_hits_total / (cache_hits_total + cache_misses_total)
```

**CRIT Mitigation:** CRIT-010 (telemetry for cache effectiveness)

---

#### `yellow_plugins_cache_size_bytes` (gauge)
**Description:** Current size of the plugin cache in bytes
**Labels:** None

**SLO Target:** ≤ 500 MB (524,288,000 bytes)

**Use Case:** Trigger eviction warnings when approaching capacity limits

---

#### `yellow_plugins_cache_evictions_total` (counter)
**Description:** Total number of cache evictions
**Labels:**
- `pinned`: true | false

**Use Case:** Monitor cache pressure, validate pinned entries never evicted

**CRIT Mitigation:** CRIT-010 (eviction policy telemetry)

---

#### `yellow_plugins_cache_hits_total` (counter)
**Description:** Total number of cache hits
**Labels:** None

**Use Case:** Calculate cache hit ratio

---

#### `yellow_plugins_cache_misses_total` (counter)
**Description:** Total number of cache misses
**Labels:** None

**Use Case:** Calculate cache hit ratio, identify cold-start scenarios

---

### Validation and Compatibility Metrics

#### `yellow_plugins_schema_validation_failures_total` (counter)
**Description:** Total number of schema validation failures
**Labels:**
- `schema_type`: marketplace | plugin | registry | contract

**Use Case:** Detect systemic schema regressions, identify malformed marketplace data

**CRIT Mitigation:** CRIT-004 (validation instrumentation)

---

#### `yellow_plugins_validation_duration_ms` (histogram)
**Description:** Duration of validation operations in milliseconds
**Labels:**
- `schema_type`: marketplace | plugin | registry | contract
- `status`: success | failure

**Use Case:** Monitor validation performance, detect slow AJV checks

---

#### `yellow_plugins_compatibility_checks_total` (counter)
**Description:** Total number of compatibility checks
**Labels:**
- `verdict`: ALLOW | WARN | DENY

**Use Case:** Track policy enforcement distribution

**CRIT Mitigation:** CRIT-004 (compatibility policy telemetry)

---

#### `yellow_plugins_compatibility_check_duration_ms` (histogram)
**Description:** Duration of compatibility checks in milliseconds
**Labels:**
- `verdict`: ALLOW | WARN | DENY

**Use Case:** Monitor policy evaluation performance

---

### Lifecycle and Consent Metrics

#### `yellow_plugins_lifecycle_prompt_declines_total` (counter)
**Description:** Total number of declined lifecycle script prompts
**Labels:**
- `plugin_id`: Plugin identifier

**Use Case:** Identify untrusted plugins, measure consent friction

**CRIT Mitigation:** CRIT-004 (lifecycle consent tracking)

---

#### `yellow_plugins_lifecycle_executions_total` (counter)
**Description:** Total number of lifecycle script executions
**Labels:**
- `plugin_id`: Plugin identifier
- `exit_code`: Script exit code (0 = success)

**Use Case:** Track script execution outcomes, detect failing hooks

---

#### `yellow_plugins_lifecycle_execution_duration_ms` (histogram)
**Description:** Duration of lifecycle script executions in milliseconds
**Labels:**
- `plugin_id`: Plugin identifier

**Use Case:** Identify slow lifecycle scripts, detect timeout risks

---

### Feature Flag Metrics

#### `yellow_plugins_feature_flag_usage_total` (counter)
**Description:** Total number of feature flag usages
**Labels:**
- `flag_name`: Feature flag identifier
- `enabled`: true | false
- `command`: Command context

**Use Case:** Track experimental feature adoption, inform promotion decisions

**CRIT Mitigation:** CRIT-008 (feature flag telemetry)

---

### CI Validation Metrics

#### `yellow_plugins_ci_duration_seconds` (histogram)
**Description:** Duration of CI validation stages in seconds
**Labels:**
- `stage`: lint | unit_test | integration_test | schema_validation | build
- `status`: success | failure

**SLO Target:** ≤ 60 seconds for complete validation workflow

**CRIT Mitigation:** CRIT-021 (CI runtime budget enforcement)

---

#### `yellow_plugins_ci_validations_total` (counter)
**Description:** Total number of CI validation runs
**Labels:**
- `stage`: lint | unit_test | integration_test | schema_validation | build
- `status`: success | failure

**Use Case:** Track CI reliability, identify flaky stages

---

### Registry Metrics

#### `yellow_plugins_registry_corruption_incidents_total` (counter)
**Description:** Total number of registry corruption incidents
**Labels:** None

**SLO Target:** 0 incidents

**Use Case:** Trigger alerts on corruption detection, validate atomic write semantics

**CRIT Mitigation:** CRIT-018 (atomic operations validation)

---

#### `yellow_plugins_registry_operation_duration_ms` (histogram)
**Description:** Duration of registry operations in milliseconds
**Labels:**
- `operation`: registry_read | registry_write | registry_backup | registry_corruption
- `status`: success | failure

**Use Case:** Monitor registry I/O performance, detect slow file system operations

---

#### `yellow_plugins_registry_plugin_count` (gauge)
**Description:** Current number of plugins in the registry
**Labels:** None

**Use Case:** Track plugin inventory size

---

#### `yellow_plugins_registry_size_bytes` (gauge)
**Description:** Current size of the registry file in bytes
**Labels:** None

**Use Case:** Monitor registry growth, estimate backup storage needs

---

## Exporting Metrics

### CLI Command

Export metrics using the `plugin metrics` command:

```bash
# Prometheus text format (default)
plugin metrics

# JSON format for programmatic consumption
plugin metrics --format json

# Export and reset counters
plugin metrics --reset
```

### Prometheus Text Format

Example output:

```
# HELP yellow_plugins_command_duration_ms Duration of CLI commands in milliseconds
# TYPE yellow_plugins_command_duration_ms histogram
yellow_plugins_command_duration_ms_bucket{command="install",status="success",le="50"} 0
yellow_plugins_command_duration_ms_bucket{command="install",status="success",le="100"} 0
yellow_plugins_command_duration_ms_bucket{command="install",status="success",le="250"} 1
yellow_plugins_command_duration_ms_bucket{command="install",status="success",le="+Inf"} 5
yellow_plugins_command_duration_ms_sum{command="install",status="success"} 3420
yellow_plugins_command_duration_ms_count{command="install",status="success"} 5

# HELP yellow_plugins_cache_hit_ratio Ratio of cache hits to total cache accesses
# TYPE yellow_plugins_cache_hit_ratio gauge
yellow_plugins_cache_hit_ratio 0.75

# HELP yellow_plugins_install_total Total number of plugin installations
# TYPE yellow_plugins_install_total counter
yellow_plugins_install_total{command="install",status="success"} 42
yellow_plugins_install_total{command="install",status="failure"} 3
```

### JSON Format

Example output:

```json
{
  "yellow_plugins_command_duration_ms": {
    "type": "histogram",
    "help": "Duration of CLI commands in milliseconds",
    "values": [
      {
        "labels": {"command": "install", "status": "success", "le": "250"},
        "value": 1,
        "suffix": "bucket"
      },
      {
        "labels": {"command": "install", "status": "success"},
        "value": 3420,
        "suffix": "sum"
      },
      {
        "labels": {"command": "install", "status": "success"},
        "value": 5,
        "suffix": "count"
      }
    ]
  },
  "yellow_plugins_cache_hit_ratio": {
    "type": "gauge",
    "help": "Ratio of cache hits to total cache accesses",
    "values": [
      {
        "labels": {},
        "value": 0.75,
        "suffix": null
      }
    ]
  }
}
```

---

## Retention and Storage

### Local Storage

Metrics are stored **in-memory only** during CLI session:
- No persistent storage by default
- Metrics reset on process exit
- Use `--reset` flag for manual reset

### CI Artifact Collection

For CI workflows, capture metrics snapshots:

```yaml
- name: Collect Metrics
  run: |
    plugin metrics > metrics-snapshot.txt
    plugin metrics --format json > metrics-snapshot.json

- name: Upload Metrics Artifacts
  uses: actions/upload-artifact@v3
  with:
    name: metrics-snapshots
    path: |
      metrics-snapshot.txt
      metrics-snapshot.json
```

### Recommended Retention

- **CI artifacts:** 90 days (GitHub Actions default)
- **Log files:** 30 days for operational logs, 1 year for audit logs
- **Telemetry exports:** 7 days for development, 30 days for production

**Log Size Target:** ≤ 200 KB per install operation to keep audit storage reasonable

---

## Dashboard Examples

### Install Success Rate

```promql
# Install success rate over time
rate(yellow_plugins_install_total{status="success"}[5m]) /
rate(yellow_plugins_install_total[5m])
```

### P95 Command Duration

```promql
# P95 install duration
histogram_quantile(0.95,
  rate(yellow_plugins_command_duration_ms_bucket{command="install"}[5m])
)
```

### Cache Hit Ratio

```promql
# Cache hit ratio gauge
yellow_plugins_cache_hit_ratio
```

### Schema Validation Failures

```promql
# Validation failures by schema type
rate(yellow_plugins_schema_validation_failures_total[5m])
```

### Lifecycle Consent Decline Rate

```promql
# Consent decline rate by plugin
rate(yellow_plugins_lifecycle_prompt_declines_total[5m])
```

---

## Troubleshooting

### High Install Durations

**Symptom:** P95 install duration > 120 seconds

**Diagnosis:**
1. Check cache hit ratio: `yellow_plugins_cache_hit_ratio < 0.6` indicates cache misses
2. Review lifecycle execution durations: `yellow_plugins_lifecycle_execution_duration_ms`
3. Examine network latency for marketplace/artifact downloads

**Remediation:**
- Pre-warm cache with common plugins
- Optimize lifecycle scripts
- Increase cache capacity if eviction is frequent

---

### Low Cache Hit Ratio

**Symptom:** Cache hit ratio < 0.6 for reinstall scenarios

**Diagnosis:**
1. Check eviction frequency: `yellow_plugins_cache_evictions_total`
2. Review cache size: `yellow_plugins_cache_size_bytes` approaching 500 MB limit
3. Identify frequently evicted plugins

**Remediation:**
- Pin critical plugins to prevent eviction
- Increase cache capacity limit in config
- Review eviction policy (LRU + pinning guard rails)

---

### Schema Validation Failures

**Symptom:** High rate of `yellow_plugins_schema_validation_failures_total`

**Diagnosis:**
1. Check failure distribution by schema type
2. Review recent marketplace updates
3. Examine validation error codes in logs

**Remediation:**
- Rollback marketplace.json if malformed
- Update plugin manifests to match schema
- Validate registry.json and restore from backup if corrupted

---

### Registry Corruption

**Symptom:** `yellow_plugins_registry_corruption_incidents_total > 0`

**Diagnosis:**
1. Check registry backup availability
2. Review logs for interrupted write operations
3. Verify atomic write semantics (temp file + rename)

**Remediation:**
- Restore from latest backup (`.claude-plugin/registry.json.backup`)
- Investigate file system issues (disk full, permissions)
- Report incident for postmortem (see `docs/operations/postmortem-template.md`)

---

### CI Validation Timeout

**Symptom:** `yellow_plugins_ci_duration_seconds > 60` for validation stage

**Diagnosis:**
1. Identify slow stages: lint, test, or schema validation
2. Review test suite execution times
3. Check for network dependencies in tests

**Remediation:**
- Parallelize test execution
- Cache dependencies (pnpm store)
- Split integration tests into separate workflow

---

## Related Documentation

- [Architecture Blueprint](../architecture/01_Blueprint_Foundation.md) - Section 3.0 Observability Rulebook
- [Operational Architecture](../architecture/04_Operational_Architecture.md) - Section 3.5 Observability Fabric
- [Verification Strategy](../plan/03_Verification_and_Glossary.md) - Section 6 CI/CD validation
- [Postmortem Template](./postmortem-template.md) - Incident investigation workflow

---

**Document Control:**
- **Version:** 1.0.0
- **Approval Status:** Draft
- **Next Review:** 2026-02-11
