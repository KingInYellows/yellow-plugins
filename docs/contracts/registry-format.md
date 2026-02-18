# Registry Format Specification

**Version:** 1.0 **Last Updated:** 2026-01-11 **Task Reference:** I2.T2 - Cache
manager + registry persistence **Schema:** `.claude-plugin/registry.schema.json`

---

## Overview

The plugin registry (`.claude-plugin/registry.json`) is the **single source of
truth** for tracking locally installed plugins. It records installation state,
cache locations, transaction IDs, telemetry snapshots, and lifecycle consent
references.

The registry supports atomic updates, transaction tracing, rollback
capabilities, and observability through structured telemetry.

---

## File Location & Structure

**Path:** `.claude-plugin/registry.json` **Format:** JSON (UTF-8 encoded)
**Schema Version:** 1.0 (see `.claude-plugin/registry.schema.json`)

### Root Structure

```json
{
  "metadata": { ... },
  "plugins": [ ... ],
  "activePins": [ ... ],
  "telemetry": { ... }
}
```

---

## Field Specifications

### 1. `metadata` (Required)

Registry metadata for versioning, integrity validation, and migration support.

| Field                | Type    | Required | Description                                   | Constraints                         |
| -------------------- | ------- | -------- | --------------------------------------------- | ----------------------------------- |
| `registryVersion`    | string  | ✓        | Schema version for migration                  | Pattern: `^\d+\.\d+$` (e.g., "1.0") |
| `lastUpdated`        | string  | ✓        | ISO 8601 timestamp of last modification       | Format: `date-time`                 |
| `modifiedBy`         | string  |          | CLI version that last modified registry       | Pattern: `^\d+\.\d+\.\d+$` (semver) |
| `totalInstallations` | integer | ✓        | Total plugin count (matches `plugins.length`) | Min: 0                              |
| `checksum`           | string  |          | SHA-256 checksum of registry file             | Pattern: `^[a-f0-9]{64}$`           |

**Example:**

```json
{
  "metadata": {
    "registryVersion": "1.0",
    "lastUpdated": "2026-01-11T10:30:45.123Z",
    "modifiedBy": "0.1.0",
    "totalInstallations": 3,
    "checksum": "a3f5e8c..."
  }
}
```

---

### 2. `plugins` (Required)

Array of installed plugin records. Each entry tracks installation state, cache
location, and metadata.

| Field                  | Type     | Required | Description                            | Constraints                                                          |
| ---------------------- | -------- | -------- | -------------------------------------- | -------------------------------------------------------------------- |
| `pluginId`             | string   | ✓        | Unique plugin identifier               | Pattern: `^[a-z0-9-]+$`, Max: 64 chars                               |
| `version`              | string   | ✓        | Installed semantic version             | Pattern: `^\d+\.\d+\.\d+$`                                           |
| `source`               | string   | ✓        | Source URI/path                        | Max: 500 chars                                                       |
| `installState`         | enum     | ✓        | Current state                          | Values: `STAGING`, `INSTALLED`, `FAILED`, `UNINSTALLING`, `DISABLED` |
| `installedAt`          | string   | ✓        | Installation timestamp                 | Format: `date-time` (ISO 8601)                                       |
| `cachePath`            | string   | ✓        | Absolute path to cached artifacts      | Max: 500 chars                                                       |
| `symlinkTarget`        | string   |          | Symlink target for active installation | Max: 500 chars                                                       |
| `lastValidatedAt`      | string   |          | Last integrity check timestamp         | Format: `date-time`                                                  |
| `transactionId`        | string   | ✓        | Transaction ID for tracing             | Pattern: `^tx-`, Max: 64 chars                                       |
| `pinned`               | boolean  |          | Whether version is pinned              | Defaults to `false`                                                  |
| `telemetryRef`         | string   |          | Reference to telemetry snapshot        | Pattern: `^tel-`                                                     |
| `lifecycleConsentRefs` | string[] |          | Array of consented script digests      | Each: SHA-256 hex (64 chars)                                         |
| `errorDetails`         | object   |          | Error details if installation failed   | See below                                                            |

#### `installState` Values

- **`STAGING`**: Plugin is being downloaded/extracted (temporary state)
- **`INSTALLED`**: Plugin is fully installed and active
- **`FAILED`**: Installation failed (see `errorDetails`)
- **`UNINSTALLING`**: Plugin is being removed (temporary state)
- **`DISABLED`**: Plugin is installed but not active

#### `errorDetails` (Optional, only when `installState` is `FAILED`)

| Field      | Type   | Required | Description                          |
| ---------- | ------ | -------- | ------------------------------------ |
| `code`     | string | ✓        | Error code (e.g., `DOWNLOAD_FAILED`) |
| `message`  | string | ✓        | Human-readable error message         |
| `failedAt` | string | ✓        | ISO 8601 timestamp of failure        |

**Example Plugin Entry:**

```json
{
  "pluginId": "hookify",
  "version": "1.2.3",
  "source": "plugins/hookify",
  "installState": "INSTALLED",
  "installedAt": "2026-01-11T09:15:30.456Z",
  "cachePath": "/home/user/project/.claude-plugin/cache/hookify/1.2.3",
  "symlinkTarget": "/home/user/project/.claude/plugins/hookify",
  "lastValidatedAt": "2026-01-11T10:00:00.000Z",
  "transactionId": "tx-1736590530-abc123",
  "pinned": true,
  "telemetryRef": "tel-1736590530-def456",
  "lifecycleConsentRefs": [
    "a3f5e8c9d2b1a4c7e6f8d9b2a1c3e5f7a9b1c3d5e7f9b1a3c5e7f9b1a3c5e7f9"
  ]
}
```

---

### 3. `activePins` (Required)

Array of plugin IDs that are pinned (protected from cache eviction). Pinned
plugins have higher priority during eviction decisions.

**Type:** `string[]` **Constraints:**

- Each string must match pattern: `^[a-z0-9-]+$`
- Must reference existing `plugins[].pluginId`
- No duplicates (enforced by schema `uniqueItems`)

**Example:**

```json
{
  "activePins": ["hookify", "pr-review-toolkit"]
}
```

---

### 4. `telemetry` (Optional)

Object containing telemetry snapshots keyed by telemetry ID. Captures operation
metrics for observability.

**Structure:** `Record<string, TelemetrySnapshot>`

#### `TelemetrySnapshot` Fields

| Field           | Type    | Required | Description                 | Constraints                                                                                        |
| --------------- | ------- | -------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `id`            | string  | ✓        | Unique telemetry ID         | Pattern: `^tel-`, Max: 64 chars                                                                    |
| `transactionId` | string  | ✓        | Associated transaction ID   | Pattern: `^tx-`                                                                                    |
| `commandType`   | enum    | ✓        | CLI command type            | Values: `install`, `uninstall`, `update`, `rollback`, `validate`, `list`, `search`, `pin`, `unpin` |
| `durationMs`    | integer | ✓        | Operation duration          | Min: 0                                                                                             |
| `success`       | boolean | ✓        | Whether operation succeeded |                                                                                                    |
| `errorCode`     | string  |          | Error code if failed        | Max: 50 chars                                                                                      |
| `capturedAt`    | string  | ✓        | Snapshot timestamp          | Format: `date-time`                                                                                |
| `context`       | object  |          | Additional metadata         | Free-form object                                                                                   |

**Example:**

```json
{
  "telemetry": {
    "tel-1736590530-def456": {
      "id": "tel-1736590530-def456",
      "transactionId": "tx-1736590530-abc123",
      "commandType": "install",
      "durationMs": 3456,
      "success": true,
      "capturedAt": "2026-01-11T09:15:33.912Z",
      "context": {
        "pluginId": "hookify",
        "version": "1.2.3",
        "downloadSize": 1024000
      }
    }
  }
}
```

---

## Atomic Write Semantics

The registry **MUST** be updated atomically to prevent corruption from crashes
or interrupts.

### Atomic Write Protocol

1. **Write to temporary file:** `registry.json.tmp`
2. **Serialize with formatting:** Pretty-print JSON (2-space indent)
3. **Sync to disk (if supported):** `fsync()` on platforms that support it
4. **Atomic rename:** Move `registry.json.tmp` → `registry.json`
5. **Backup previous version (optional):** Keep in `.claude-plugin/backups/`

### Error Recovery

- **Corrupted registry detected:** Restore from most recent backup in `backups/`
- **Missing registry:** Rebuild from cache directory scan
- **Validation errors:** Log warnings, attempt partial recovery, or fail
  gracefully

**Architecture Reference:**
[Section 3.4: Data Persistence & Cache Layout](#references)

---

## Eviction & Rollback Semantics

### Cache Eviction Rules

1. **Pinned protection:** Plugins in `activePins` are **never evicted** from
   cache
2. **Current version protection:** The active installed version is protected
3. **Version retention:** Keep last **3 versions** per plugin (configurable)
4. **LRU eviction:** When cache exceeds 500 MB, evict oldest-accessed
   non-protected versions
5. **Eviction logging:** Record all evictions in cache index for rollback
   guidance

### Rollback Support

- **Transaction IDs:** Enable tracing and linking registry changes to cache
  operations
- **Symlink preservation:** Before updates, record previous symlink target
- **Backup registry:** Create timestamped backup before destructive operations
- **Recovery guidance:** If evicted version needed, instruct user to re-fetch
  from git

**Functional Requirements:** CRIT-002 (eviction policy), CRIT-004 (rollback),
CRIT-018 (atomic persistence)

---

## Validation & Integrity

### Schema Validation

All registry updates **MUST** be validated against
`.claude-plugin/registry.schema.json` using AJV (JSON Schema Draft-07).

### Integrity Checks

1. **Checksum validation:** Compare `metadata.checksum` with computed SHA-256
2. **Cache path existence:** Verify `plugins[].cachePath` exists for `INSTALLED`
   state
3. **Pin consistency:** Ensure `activePins` references exist in `plugins[]`
4. **Transaction ID format:** Validate `tx-` prefix and uniqueness
5. **Date ordering:** `installedAt` should be ≤ `lastValidatedAt`

### Validation Frequency

- **On load:** Validate registry integrity at CLI startup
- **On update:** Validate before writing (fail transaction if invalid)
- **Scheduled:** Run integrity checks during idle periods (optional)

---

## Size Limits & Constraints

| Resource             | Limit              | Rationale                                     |
| -------------------- | ------------------ | --------------------------------------------- |
| Registry file size   | 10 MB (soft limit) | >1000 plugins would exceed, trigger warning   |
| Plugin ID length     | 64 chars           | Matches marketplace schema                    |
| Source URI length    | 500 chars          | Accommodate long git URLs                     |
| Cache path length    | 500 chars          | Filesystem path limits                        |
| Error message length | 500 chars          | Balance detail vs bloat                       |
| Telemetry snapshots  | 100 (rolling)      | Keep recent history, prevent unbounded growth |

---

## Migration Strategy

When registry schema evolves (e.g., `1.0` → `1.1`):

1. **Detect version mismatch:** Compare file `registryVersion` to expected
   schema
2. **Run migration script:** Transform old format to new format
3. **Update metadata:** Set `registryVersion` to new version
4. **Log migration:** Record in telemetry for auditing
5. **Keep backup:** Preserve pre-migration registry in `backups/`

**Migration triggers:**

- CLI detects lower `registryVersion` on load
- User runs explicit `claude-plugin migrate` command (future)

---

## Example Full Registry

```json
{
  "metadata": {
    "registryVersion": "1.0",
    "lastUpdated": "2026-01-11T10:30:45.123Z",
    "modifiedBy": "0.1.0",
    "totalInstallations": 2
  },
  "plugins": [
    {
      "pluginId": "hookify",
      "version": "1.2.3",
      "source": "plugins/hookify",
      "installState": "INSTALLED",
      "installedAt": "2026-01-11T09:15:30.456Z",
      "cachePath": "/home/user/project/.claude-plugin/cache/hookify/1.2.3",
      "symlinkTarget": "/home/user/project/.claude/plugins/hookify",
      "transactionId": "tx-1736590530-abc123",
      "pinned": true,
      "telemetryRef": "tel-1736590530-def456"
    },
    {
      "pluginId": "pr-review-toolkit",
      "version": "2.0.1",
      "source": "plugins/pr-review-toolkit",
      "installState": "INSTALLED",
      "installedAt": "2026-01-11T10:20:00.789Z",
      "cachePath": "/home/user/project/.claude-plugin/cache/pr-review-toolkit/2.0.1",
      "transactionId": "tx-1736594400-xyz789"
    }
  ],
  "activePins": ["hookify"],
  "telemetry": {
    "tel-1736590530-def456": {
      "id": "tel-1736590530-def456",
      "transactionId": "tx-1736590530-abc123",
      "commandType": "install",
      "durationMs": 3456,
      "success": true,
      "capturedAt": "2026-01-11T09:15:33.912Z"
    }
  }
}
```

---

## References

- **ERD:** `docs/diagrams/data-erd.puml` (InstalledPluginRegistry entity)
- **Schema:** `.claude-plugin/registry.schema.json`
- **Functional Requirements:**
  - **CRIT-001:** Transaction tracking and traceability
  - **CRIT-002:** Cache eviction policy (500 MB, last-3-versions)
  - **CRIT-004:** Rollback support for failed installations
  - **CRIT-010:** Telemetry instrumentation
  - **CRIT-018:** Atomic persistence guarantees
- **Non-Functional Requirements:**
  - **NFR-001:** Performance (registry load <100ms)
  - **NFR-002:** Reliability (no data loss on crash)

---

## Changelog

### Version 1.0 (2026-01-11)

- Initial registry format specification
- Defined atomic write protocol
- Documented eviction and rollback semantics
- Added telemetry snapshot structure
- Established validation and integrity checks
