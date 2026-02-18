# Transaction Boundaries and Operational Guide

**Generated for:** Task I2.T3 - Install Transaction Orchestrator **Date:**
2026-01-11 **Spec References:** Section 3.10 (Install Transaction Lifecycle),
CRIT-001, CRIT-002, CRIT-018 **Diagram Reference:**
[install-sequence.puml](../diagrams/install-sequence.puml)

---

## Overview

This document defines transaction boundaries, atomic operations, and rollback
procedures for plugin install/update/rollback operations. Every operation
generates a unique `transactionId` that threads through logs, registry entries,
telemetry snapshots, and audit trails, enabling deterministic postmortem
analysis.

---

## Transaction Lifecycle (7 Steps)

### Step 1: VALIDATE

**Boundary:** Pre-mutation validation phase **Duration:** < 5 seconds
**Atomic:** No (read-only)

**Operations:**

- Validate marketplace index freshness
- Check plugin existence and version availability
- Run compatibility checks (OS, arch, Node version, Claude Code version)
- Verify feature flags (`enableRollback` for rollback operations)

**File Paths:**

- **Read:** `.claude-plugin/marketplace.json`
- **Read:** `.claude-plugin/registry.json`
- **Read:** `.claude-plugin/flags.json`

**Failure Handling:**

- Abort immediately, no cleanup required
- Error codes: `ERR-INSTALL-001` (already installed), `ERR-COMPAT-001`
  (incompatible)

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "correlationId": "corr-xyz123",
  "phase": "VALIDATE",
  "pluginId": "example-plugin",
  "version": "1.2.3",
  "compatibilityVerdict": {
    "compatible": true,
    "os": "linux",
    "arch": "x64",
    "nodeVersion": "18.12.0"
  }
}
```

**Decision Tree:**

```
┌─ Plugin already installed?
│  ├─ YES + force=false → ERROR: ERR-INSTALL-001
│  └─ NO or force=true → Continue
│
├─ Compatible with host?
│  ├─ NO → ERROR: ERR-COMPAT-001
│  └─ YES → Continue to STAGE
```

---

### Step 2: STAGE

**Boundary:** Temporary workspace provisioning **Duration:** < 1 second
**Atomic:** No (directory creation, fails gracefully)

**Operations:**

- Generate `transactionId` if not provided
- Create `.claude-plugin/tmp/<transactionId>` directory
- Return staging path to orchestrator

**File Paths:**

- **Write:** `.claude-plugin/tmp/<transactionId>/` (directory)

**Failure Handling:**

- If mkdir fails, abort with `ERR-INSTALL-002`
- No cleanup required (directory doesn't exist yet)

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "phase": "STAGE",
  "stagingPath": "/home/user/.claude-plugin/tmp/tx-1736611200000-a1b2c3d4",
  "operation": "mkdir"
}
```

---

### Step 3: DOWNLOAD & EXTRACT

**Boundary:** Artifact retrieval and manifest validation **Duration:** < 120
seconds (NFR: install under 2 minutes) **Atomic:** No (network I/O, multi-step)

**Operations:**

- Download plugin archive from marketplace or source URI
- Extract to staging directory
- Read and parse `plugin.json` manifest
- Validate manifest against JSON Schema Draft-07
- Verify checksums and signatures (if present)

**File Paths:**

- **Download:** Marketplace artifact URL → staging directory
- **Read:** `<stagingPath>/plugin.json`
- **Write:** `<stagingPath>/*` (extracted files)

**Failure Handling:**

- Cleanup staging directory on validation failure
- Trigger rollback plan if download/extraction fails
- Error codes: `ERROR-CACHE-001` (corrupted cache), validation errors from AJV

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "phase": "EXTRACT",
  "manifestPath": "/home/user/.claude-plugin/tmp/tx-1736611200000-a1b2c3d4/plugin.json",
  "validationResult": {
    "valid": true,
    "schemaVersion": "1.0",
    "pluginId": "example-plugin",
    "version": "1.2.3"
  }
}
```

**Decision Tree:**

```
├─ Download successful?
│  ├─ NO → ERROR: Network failure, cleanup staging
│  └─ YES → Extract archive
│
├─ Manifest valid?
│  ├─ NO → ERROR: Schema validation failed, cleanup staging
│  └─ YES → Continue to LIFECYCLE_PRE
```

---

### Step 4: LIFECYCLE_PRE (Pre-Install Script)

**Boundary:** Sandboxed lifecycle script execution with consent **Duration:** <
5 minutes (timeout enforced) **Atomic:** No (external process execution)

**Operations:**

- Display lifecycle script contents to user (if `manifest.lifecycle.preInstall`
  exists)
- Record script digest (SHA-256)
- Obtain typed consent from user
- Execute script in sandbox (CPU/memory/timeout limits)
- Capture exit code and duration

**File Paths:**

- **Read:** `<stagingPath>/lifecycle/pre-install.sh` (or as defined in manifest)
- **Execute:** Sandboxed shell process

**Failure Handling:**

- If consent denied: cleanup staging, abort with user-friendly message
- If script fails (exit code ≠ 0): cleanup staging, abort with
  `ERR-LIFECYCLE-001`
- Timeout after 5 minutes: kill process, cleanup staging

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "phase": "LIFECYCLE_PRE",
  "scriptDigest": "sha256:abc123...",
  "consented": true,
  "executionResult": {
    "exitCode": 0,
    "durationMs": 1234,
    "success": true
  }
}
```

**Decision Tree:**

```
├─ Lifecycle script declared?
│  ├─ NO → Skip to PROMOTE
│  └─ YES → Display script to user
│
├─ User consents?
│  ├─ NO → ABORT: User declined, cleanup staging
│  └─ YES → Execute in sandbox
│
├─ Script exits cleanly?
│  ├─ NO → ERROR: ERR-LIFECYCLE-001, cleanup staging
│  └─ YES → Continue to PROMOTE
```

**CRIT-004 Compliance:**

- Scripts **must** be displayed before execution
- Consent **must** be explicitly granted (typed confirmation)
- Script digest **must** be recorded in registry for audit

---

### Step 5: PROMOTE

**Boundary:** Atomic cache promotion and eviction **Duration:** < 10 seconds
**Atomic:** **YES** (fs.rename within same filesystem)

**Operations:**

- Calculate checksum and size of staging directory
- Execute atomic `fs.rename(stagingPath, cachePath)`
  - Source: `.claude-plugin/tmp/<transactionId>`
  - Target: `.claude-plugin/cache/<pluginId>/<version>`
- Update cache index (`.claude-plugin/cache/index.json`)
- Enforce per-plugin retention (last 3 versions, respecting pins)
- Trigger global eviction if cache exceeds 500 MB

**File Paths:**

- **Move (Atomic):** `.claude-plugin/tmp/<txId>` →
  `.claude-plugin/cache/<pluginId>/<version>`
- **Write (Atomic):** `.claude-plugin/cache/index.json.tmp` → `index.json`

**Failure Handling:**

- If rename fails: staging directory remains, cleanup and abort
- If eviction fails: log warning but continue (non-blocking)
- Error code: `ERR-INSTALL-003`

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "phase": "PROMOTE",
  "cachePath": "/home/user/.claude-plugin/cache/example-plugin/1.2.3",
  "checksum": "sha256:def456...",
  "sizeBytes": 1048576,
  "sizeMb": 1.0,
  "evicted": {
    "triggered": true,
    "entriesEvicted": 1,
    "bytesFreed": 524288
  }
}
```

**Decision Tree:**

```
├─ Cache promotion successful?
│  ├─ NO → ERROR: ERR-INSTALL-003, cleanup staging
│  └─ YES → Update cache index
│
├─ Cache exceeds 500 MB?
│  ├─ YES → Run LRU eviction (respect pins, min 2 versions)
│  └─ NO → Continue to ACTIVATE
│
├─ Per-plugin retention violated?
│  ├─ YES → Remove oldest unpinned versions beyond 3
│  └─ NO → Continue to ACTIVATE
```

**CRIT-002 Compliance:**

- **500 MB global limit:** Enforced via LRU eviction
- **Last 3 versions per plugin:** Enforced during promotion
- **Pin protection:** Pinned versions never evicted
- **Minimum rollback set:** Always keep at least 2 versions per plugin if
  available

---

### Step 6: ACTIVATE

**Boundary:** Atomic registry update and symlink activation **Duration:** < 2
seconds **Atomic:** **YES** (registry write via temp-rename pattern)

**Operations:**

- Create `InstalledPlugin` record with transaction ID
- Write registry to temp file: `.claude-plugin/registry.json.tmp`
- Execute atomic `fs.rename(registry.json.tmp, registry.json)`
- Create or update symlink: `<installDir>/<pluginId>` → `<cachePath>`
- Record telemetry snapshot in registry

**File Paths:**

- **Write (Atomic):** `.claude-plugin/registry.json.tmp` →
  `.claude-plugin/registry.json`
- **Symlink:** `<installDir>/<pluginId>` →
  `.claude-plugin/cache/<pluginId>/<version>`

**Failure Handling:**

- If registry write fails: rollback cache promotion (remove cache directory)
- If symlink fails: log warning but continue (symlink is idempotent)
- Error code: `ERR-INSTALL-004`

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "phase": "ACTIVATE",
  "registryPath": "/home/user/.claude-plugin/registry.json",
  "symlinkTarget": "/home/user/.claude-code/plugins/example-plugin",
  "installState": "INSTALLED",
  "registryBackup": "/home/user/.claude-plugin/backups/registry-2026-01-11T12-00-00-000Z.json"
}
```

**Decision Tree:**

```
├─ Registry update successful?
│  ├─ NO → ERROR: ERR-INSTALL-004, rollback cache
│  └─ YES → Activate symlink
│
├─ Symlink creation successful?
│  ├─ NO → WARN: Symlink failed (non-fatal)
│  └─ YES → Continue to LIFECYCLE_POST
```

**CRIT-001 & CRIT-018 Compliance:**

- **Transaction tracking:** `transactionId` embedded in registry entry
- **Atomic operations:** Temp-rename pattern prevents partial writes
- **Backup creation:** Registry backup created before mutation (optional,
  controlled by flag)

---

### Step 7: TELEMETRY & CLEANUP

**Boundary:** Post-install lifecycle script and observability capture
**Duration:** < 5 seconds **Atomic:** No (fire-and-forget telemetry)

**Operations:**

- Execute post-install lifecycle script (if declared)
- Emit structured JSON logs with correlation ID
- Generate Prometheus metrics snapshot
- Create OpenTelemetry trace span
- Cleanup orphaned temp directories (>24 hours old)

**File Paths:**

- **Read:** `<cachePath>/lifecycle/post-install.sh` (if exists)
- **Write:** Stdout (structured logs), metrics endpoint, trace backend

**Failure Handling:**

- Post-install script failure: log warning but don't rollback (plugin already
  activated)
- Telemetry failure: log error but don't fail operation
- Cleanup failure: log warning but don't fail operation

**Log Sample:**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200000-a1b2c3d4",
  "correlationId": "corr-xyz123",
  "phase": "TELEMETRY",
  "commandType": "install",
  "durationMs": 15234,
  "success": true,
  "pluginId": "example-plugin",
  "version": "1.2.3",
  "cacheHit": false,
  "evictionTriggered": true,
  "lifecycleConsent": {
    "preInstall": "sha256:abc123...",
    "postInstall": "sha256:ghi789..."
  }
}
```

---

## Rollback Transaction Flow

### Rollback-Specific Steps

**Phases:** VALIDATE → RETRIEVE → LIFECYCLE_UNINSTALL → ACTIVATE → TELEMETRY

1. **VALIDATE:**
   - Check `enableRollback` feature flag
   - Verify plugin is installed
   - List cached versions for rollback targets

2. **RETRIEVE:**
   - Verify target version exists in cache
   - Update cache entry `lastAccessTime` (LRU tracking)
   - Skip download phase entirely

3. **LIFECYCLE_UNINSTALL:**
   - Execute uninstall script for current version (if declared)
   - Timeout: 5 minutes

4. **ACTIVATE:**
   - Update registry entry (point to rollback version)
   - Swap symlink target atomically
   - No cache promotion required

5. **TELEMETRY:**
   - Record rollback telemetry with `commandType: "rollback"`
   - Log target version and reason

**Log Sample (Rollback):**

```json
{
  "level": "info",
  "transactionId": "tx-1736611200001-e5f6g7h8",
  "correlationId": "corr-abc789",
  "commandType": "rollback",
  "pluginId": "example-plugin",
  "fromVersion": "1.2.3",
  "toVersion": "1.2.2",
  "cacheHit": true,
  "durationMs": 2345,
  "success": true
}
```

---

## Update Transaction Flow

### Update = Install with Force

Update operations reuse the install lifecycle with `force=true` to allow
"reinstalling" over an existing installation.

**Key Differences:**

- Validation step checks for version difference (skip if current == target)
- Registry delta reports `updated` instead of `added`
- Telemetry includes `fromVersion` and `toVersion` fields

---

## Atomic Operations Summary

| Operation             | File Path                             | Atomicity                | Rollback Strategy                               |
| --------------------- | ------------------------------------- | ------------------------ | ----------------------------------------------- |
| **Registry Write**    | `.claude-plugin/registry.json`        | **YES** (temp-rename)    | Restore from backup (`.claude-plugin/backups/`) |
| **Cache Promotion**   | `.claude-plugin/cache/<plugin>/<ver>` | **YES** (fs.rename)      | Remove cache directory on failure               |
| **Cache Index**       | `.claude-plugin/cache/index.json`     | **YES** (temp-rename)    | Rebuild from filesystem (recoverable)           |
| **Symlink**           | `<installDir>/<pluginId>`             | **YES** (atomic symlink) | Idempotent re-creation                          |
| **Temp Cleanup**      | `.claude-plugin/tmp/<txId>`           | **NO** (best-effort)     | Orphaned cleanup on next operation              |
| **Lifecycle Scripts** | External process                      | **NO** (external)        | Abort on failure, cleanup staging               |

---

## Error Codes & Failure Scenarios

### Install Errors

| Code              | Message                         | Phase    | Rollback Action                                 |
| ----------------- | ------------------------------- | -------- | ----------------------------------------------- |
| `ERR-INSTALL-001` | Already installed (use --force) | VALIDATE | None (abort early)                              |
| `ERR-INSTALL-002` | Failed to stage artifacts       | STAGE    | None (mkdir failed)                             |
| `ERR-INSTALL-003` | Failed to promote artifacts     | PROMOTE  | Cleanup staging directory                       |
| `ERR-INSTALL-004` | Failed to update registry       | ACTIVATE | Remove cache directory, restore registry backup |
| `ERR-INSTALL-999` | Unexpected error                | ANY      | Full rollback plan execution                    |

### Rollback Errors

| Code               | Message                     | Phase    | Recovery                                    |
| ------------------ | --------------------------- | -------- | ------------------------------------------- |
| `ERR-ROLLBACK-001` | Plugin not installed        | VALIDATE | None (inform user)                          |
| `ERR-ROLLBACK-002` | No cached version available | VALIDATE | None (inform user, suggest re-install)      |
| `ERR-ROLLBACK-003` | Failed to update registry   | ACTIVATE | Restore registry backup                     |
| `ERR-CACHE-001`    | Cache missing or corrupted  | RETRIEVE | Invalidate cache entry, suggest re-download |

### Compatibility Errors

| Code             | Message                       | Phase    | Action                                    |
| ---------------- | ----------------------------- | -------- | ----------------------------------------- |
| `ERR-COMPAT-001` | Incompatible host environment | VALIDATE | Abort, display compatibility requirements |

---

## CLI Command Examples

### Install

```bash
# Install latest version
plugin install example-plugin

# Install specific version
plugin install example-plugin --version 1.2.3

# Force reinstall
plugin install example-plugin --force

# Dry-run (simulate without mutations)
plugin install example-plugin --dry-run
```

### Rollback

```bash
# Interactive rollback (list cached versions)
plugin rollback example-plugin

# Rollback to specific version
plugin rollback example-plugin --version 1.2.2

# Dry-run rollback
plugin rollback example-plugin --dry-run
```

### Update

```bash
# Update to latest
plugin update example-plugin

# Update to specific version
plugin update example-plugin --version 1.3.0
```

---

## Observability & Audit

### Structured Logging

All operations emit JSON logs with:

- `transactionId`: Unique transaction identifier
- `correlationId`: User session correlation ID
- `phase`: Current transaction phase
- `durationMs`: Operation duration
- `success`: Boolean success indicator

### Telemetry Snapshots

Stored in `.claude-plugin/registry.json` under `telemetry` map:

```json
{
  "telemetry": {
    "tel-1736611200000-a1b2c3d4": {
      "id": "tel-1736611200000-a1b2c3d4",
      "transactionId": "tx-1736611200000-a1b2c3d4",
      "commandType": "install",
      "durationMs": 15234,
      "success": true,
      "capturedAt": "2026-01-11T12:00:15.234Z"
    }
  }
}
```

### Prometheus Metrics

- `plugin_installs_total{status="success|failure"}`
- `plugin_install_duration_seconds{phase="validate|stage|promote|activate"}`
- `cache_evictions_total{reason="size_limit|version_limit"}`
- `cache_size_bytes`

### OpenTelemetry Traces

- Span name: `plugin.install` / `plugin.rollback` / `plugin.update`
- Attributes: `plugin.id`, `plugin.version`, `transaction.id`, `correlation.id`

---

## Decision Trees

### Should I Rollback or Re-Install?

```
┌─ Target version in cache?
│  ├─ YES → Use rollback (faster, no download)
│  └─ NO → Re-install required
│
├─ Lifecycle scripts changed?
│  ├─ YES → Re-install (requires new consent)
│  └─ NO → Rollback is safe
│
├─ Rollback feature enabled?
│  ├─ NO → Enable in .claude-plugin/flags.json
│  └─ YES → Proceed with rollback
```

### When Does Eviction Trigger?

```
┌─ Cache size > 500 MB?
│  ├─ YES → LRU eviction starts
│  └─ NO → Check per-plugin retention
│
├─ Plugin has > 3 versions?
│  ├─ YES → Remove oldest unpinned versions
│  └─ NO → No eviction
│
├─ Pinned versions protected?
│  └─ ALWAYS → Pins never evicted
```

---

## FR/NFR Mapping

| Requirement              | ID       | Implementation                                  |
| ------------------------ | -------- | ----------------------------------------------- |
| **Install Plugin**       | FR-001   | Full 7-step transaction lifecycle               |
| **Update Plugin**        | FR-002   | Install with force flag, version diff telemetry |
| **Rollback Plugin**      | FR-003   | Cache-based rollback with feature flag gating   |
| **Install Duration**     | NFR      | < 2 minutes (enforced via timeout)              |
| **Rollback Success**     | CRIT-002 | 100% for cached versions (atomic operations)    |
| **Transaction Tracking** | CRIT-001 | `transactionId` in logs, registry, telemetry    |
| **Lifecycle Consent**    | CRIT-004 | Script display + typed consent before execution |
| **Telemetry**            | CRIT-010 | Structured JSON, Prometheus, OpenTelemetry      |
| **Atomic Operations**    | CRIT-018 | Temp-rename pattern for registry & cache        |

---

## Iteration 2 Knowledge Transfer Note

This document satisfies the I2 knowledge transfer requirement:

> Update `docs/operations/transaction-boundaries.md` with annotated log samples,
> CLI snippets, and decision trees so discovery-focused agents in `I3` can reuse
> orchestrators without reverse engineering internals.

Future agents should reference this document for:

- Understanding transaction phases and boundaries
- Implementing discovery UI that surfaces telemetry snapshots
- Debugging failed installations via transaction IDs
- Extending lifecycle hooks or adding new transaction phases

---

**End of Transaction Boundaries Documentation**
