# Audit Trail Documentation

**Document Version**: 1.0.0
**Last Updated**: 2026-01-12
**Task Reference**: I3.T4 - Enhanced Uninstall Experience
**Purpose**: Transaction audit logging for install, update, rollback, and uninstall operations

---

## Overview

The `.claude-plugin/audit/` directory contains immutable transaction logs for all plugin lifecycle operations. These logs provide complete traceability for debugging, compliance, security audits, and postmortem analysis.

### Design Principles

1. **Immutable**: Audit logs are append-only; never modified after creation
2. **Structured**: JSON format for machine-readable analysis
3. **Complete**: Captures all transaction phases, timing, and outcomes
4. **Traceable**: Every operation has a unique transaction ID
5. **Forensic**: Includes consent digests, error details, and retry history
6. **Cross-Referenced**: Each entry can be correlated with `docs/contracts/error-codes.md` (CRIT-011, FR-010 scenarios)

---

## Directory Structure

```
.claude-plugin/audit/
├── README.md                           # This file
├── install-<transaction-id>.json       # Install operation logs
├── update-<transaction-id>.json        # Update operation logs
├── rollback-<transaction-id>.json      # Rollback operation logs
├── uninstall-<transaction-id>.json     # Uninstall operation logs
└── index.json                          # Audit log index (optional)
```

### File Naming Convention

- **Format:** `<operation>-<transaction-id>.json`
- **Transaction ID:** `tx-<operation>-<timestamp>-<random>`
- **Example:** `uninstall-tx-uninstall-1736704200000-abc123.json`

---

## Log Schema

### Common Fields (All Operations)

```typescript
{
  // Transaction metadata
  transactionId: string;          // Unique identifier
  operation: string;              // "install" | "update" | "rollback" | "uninstall"
  pluginId: string;               // Plugin identifier
  version?: string;               // Target version (install/update/rollback)

  // Timing
  timestamp: string;              // ISO 8601 start time
  completedAt?: string;           // ISO 8601 completion time
  durationMs: number;             // Total operation duration

  // Outcome
  success: boolean;               // Operation success/failure
  error?: {                       // Present if success=false
    code: string;                 // Error code (e.g., "ERR-UNINSTALL-001")
    message: string;              // Human-readable error
    failedStep?: string;          // Phase where failure occurred
    details?: unknown;            // Additional error context
  };

  // Execution phases
  steps: Array<{
    phase: string;                // Phase name (e.g., "VALIDATE", "LIFECYCLE")
    status: "success" | "failed" | "skipped";
    durationMs: number;           // Phase duration
    details?: Record<string, unknown>; // Phase-specific metadata
    error?: {                     // Phase-level error details
      code: string;
      message: string;
    };
  }>;

  // Context
  correlationId?: string;         // Correlation ID from request
  userId?: string;                // User identifier (if available)
  hostname: string;               // Machine hostname
  platform: string;               // OS platform (linux/darwin/win32)
  nodeVersion: string;            // Node.js version
  claudeCodeVersion: string;      // Claude Code version
}
```

---

## Uninstall Log Schema

### Complete Example

```json
{
  "transactionId": "tx-uninstall-1736704200000-abc123",
  "operation": "uninstall",
  "pluginId": "database-connector",
  "timestamp": "2026-01-12T10:30:00.000Z",
  "completedAt": "2026-01-12T10:30:00.142Z",
  "durationMs": 142,
  "success": true,

  "steps": [
    {
      "phase": "VALIDATE",
      "status": "success",
      "durationMs": 5,
      "details": {
        "installedVersion": "2.1.0",
        "cachePath": "/home/user/.config/claude-code/cache/database-connector/2.1.0",
        "registryCheck": "passed"
      }
    },
    {
      "phase": "LIFECYCLE_PRE",
      "status": "success",
      "durationMs": 12,
      "details": {
        "scriptPath": "scripts/uninstall.sh",
        "scriptDigest": "sha256:a3f5b9c2e1d4f7a8b6c3e9f1d2a4b5c6d7e8f9a0b1c2d3e4",
        "consentRequired": true,
        "consentGiven": true,
        "reviewedAt": "2026-01-12T10:30:00.010Z"
      }
    },
    {
      "phase": "LIFECYCLE",
      "status": "success",
      "durationMs": 85,
      "details": {
        "scriptPath": "scripts/uninstall.sh",
        "exitCode": 0,
        "stdout": "Removing database connection configs...\nCleanup complete\n",
        "stderr": "",
        "consented": true,
        "sandboxed": true,
        "executedAt": "2026-01-12T10:30:00.025Z"
      }
    },
    {
      "phase": "DEACTIVATE",
      "status": "success",
      "durationMs": 8,
      "details": {
        "symlinkPath": "/home/user/.config/claude-code/plugins/database-connector",
        "targetPath": "/home/user/.config/claude-code/cache/database-connector/2.1.0",
        "removed": true,
        "atomic": true
      }
    },
    {
      "phase": "REGISTRY_UPDATE",
      "status": "success",
      "durationMs": 12,
      "details": {
        "registryPath": "/home/user/.config/claude-code/registry/installed.json",
        "backupCreated": true,
        "backupPath": "/home/user/.config/claude-code/registry/installed.json.backup",
        "atomic": true,
        "removedEntry": {
          "pluginId": "database-connector",
          "version": "2.1.0",
          "installedAt": "2026-01-10T14:20:00.000Z"
        }
      }
    },
    {
      "phase": "CACHE_CLEANUP",
      "status": "success",
      "durationMs": 30,
      "details": {
        "policy": "keep-last-n",
        "keepLastN": 3,
        "versionsFound": ["2.1.0", "2.0.5", "2.0.3", "1.9.8", "1.9.6"],
        "versionsRetained": ["2.1.0", "2.0.5", "2.0.3"],
        "versionsRemoved": ["1.9.8", "1.9.6"],
        "freedBytes": 13004800,
        "freedMb": 12.4
      }
    },
    {
      "phase": "TELEMETRY",
      "status": "success",
      "durationMs": 2,
      "details": {
        "eventEmitted": "plugin.uninstall.completed",
        "telemetryFile": ".claude-plugin/telemetry/2026-01-12.jsonl"
      }
    }
  ],

  "cacheRetention": {
    "policy": "keep-last-n",
    "keepLastN": 3,
    "versionsRemoved": 2,
    "versionsRetained": 3,
    "freedMb": 12.4
  },

  "registryDelta": {
    "removed": ["database-connector"]
  },

  "lifecycleScript": {
    "executed": true,
    "scriptPath": "scripts/uninstall.sh",
    "scriptDigest": "sha256:a3f5b9c2e1d4f7a8b6c3e9f1d2a4b5c6d7e8f9a0b1c2d3e4",
    "exitCode": 0,
    "durationMs": 85,
    "consented": true,
    "consentedAt": "2026-01-12T10:30:00.010Z"
  },

  "request": {
    "pluginId": "database-connector",
    "cacheRetentionPolicy": "keep-last-n",
    "keepLastN": 3,
    "force": false,
    "dryRun": false,
    "correlationId": "cli-req-abc123"
  },

  "correlationId": "cli-req-abc123",
  "hostname": "dev-machine",
  "platform": "linux",
  "nodeVersion": "20.10.0",
  "claudeCodeVersion": "2.3.0"
}
```

---

## Error Log Example

### Uninstall with Lifecycle Script Failure

```json
{
  "transactionId": "tx-uninstall-1736704500000-def456",
  "operation": "uninstall",
  "pluginId": "broken-plugin",
  "timestamp": "2026-01-12T10:35:00.000Z",
  "completedAt": "2026-01-12T10:35:00.095Z",
  "durationMs": 95,
  "success": true,  // Note: Uninstall succeeds despite lifecycle failure

  "steps": [
    {
      "phase": "VALIDATE",
      "status": "success",
      "durationMs": 4
    },
    {
      "phase": "LIFECYCLE",
      "status": "failed",  // Lifecycle script failed
      "durationMs": 58,
      "details": {
        "scriptPath": "scripts/uninstall.sh",
        "exitCode": 1,
        "stdout": "",
        "stderr": "Error: Missing cleanup dependency 'jq'\n",
        "consented": true
      },
      "error": {
        "code": "CRIT-011",
        "message": "Lifecycle script exited with non-zero code: 1"
      }
    },
    {
      "phase": "DEACTIVATE",
      "status": "success",
      "durationMs": 7
    },
    {
      "phase": "REGISTRY_UPDATE",
      "status": "success",
      "durationMs": 10
    },
    {
      "phase": "CACHE_CLEANUP",
      "status": "success",
      "durationMs": 14
    }
  ],

  "warnings": [
    {
      "code": "CRIT-011",
      "phase": "LIFECYCLE",
      "message": "Lifecycle uninstall script failed but uninstall continued",
      "resolution": "Manual cleanup may be required. Check plugin documentation."
    }
  ],

  "lifecycleScript": {
    "executed": true,
    "scriptPath": "scripts/uninstall.sh",
    "exitCode": 1,
    "durationMs": 58,
    "consented": true,
    "failed": true,
    "failureMessage": "Error: Missing cleanup dependency 'jq'"
  },

  "correlationId": "cli-req-def456",
  "hostname": "prod-server",
  "platform": "linux",
  "nodeVersion": "20.10.0",
  "claudeCodeVersion": "2.3.0"
}
```

---

## Install Log Schema

### Example

```json
{
  "transactionId": "tx-1736700000000-xyz789",
  "operation": "install",
  "pluginId": "git-helper",
  "version": "1.2.3",
  "timestamp": "2026-01-12T09:00:00.000Z",
  "completedAt": "2026-01-12T09:00:02.543Z",
  "durationMs": 2543,
  "success": true,

  "steps": [
    {
      "phase": "VALIDATE",
      "status": "success",
      "durationMs": 45,
      "details": {
        "marketplaceCheck": "passed",
        "compatibilityCheck": "passed",
        "alreadyInstalled": false
      }
    },
    {
      "phase": "STAGE",
      "status": "success",
      "durationMs": 120,
      "details": {
        "stagingPath": "/tmp/plugin-staging-xyz789",
        "created": true
      }
    },
    {
      "phase": "DOWNLOAD",
      "status": "success",
      "durationMs": 1850,
      "details": {
        "source": "https://github.com/user/git-helper",
        "sizeBytes": 524288,
        "checksum": "sha256:abc123...",
        "verified": true
      }
    },
    {
      "phase": "EXTRACT",
      "status": "success",
      "durationMs": 85,
      "details": {
        "manifestPath": "plugin.json",
        "manifestValid": true
      }
    },
    {
      "phase": "LIFECYCLE_PRE",
      "status": "success",
      "durationMs": 150,
      "details": {
        "preInstallScript": "scripts/install.sh",
        "exitCode": 0,
        "consented": true
      }
    },
    {
      "phase": "PROMOTE",
      "status": "success",
      "durationMs": 180,
      "details": {
        "cachePath": "/home/user/.config/claude-code/cache/git-helper/1.2.3",
        "evictionTriggered": false
      }
    },
    {
      "phase": "ACTIVATE",
      "status": "success",
      "durationMs": 95,
      "details": {
        "symlinkCreated": true,
        "registryUpdated": true,
        "backupCreated": true
      }
    },
    {
      "phase": "TELEMETRY",
      "status": "success",
      "durationMs": 3
    }
  ],

  "registryDelta": {
    "added": ["git-helper"]
  },

  "cacheOperations": {
    "staged": true,
    "promoted": true,
    "checksum": "sha256:abc123...",
    "evicted": 0,
    "sizeMb": 0.5
  },

  "correlationId": "cli-req-xyz789",
  "hostname": "dev-laptop",
  "platform": "darwin",
  "nodeVersion": "20.10.0",
  "claudeCodeVersion": "2.3.0"
}
```

---

## Update Log Schema

### Example

```json
{
  "transactionId": "tx-update-1736705000000-uvw123",
  "operation": "update",
  "pluginId": "linter-plugin",
  "version": "3.0.0",
  "previousVersion": "2.5.1",
  "timestamp": "2026-01-12T11:00:00.000Z",
  "completedAt": "2026-01-12T11:00:01.890Z",
  "durationMs": 1890,
  "success": true,

  "steps": [
    {
      "phase": "VALIDATE",
      "status": "success",
      "durationMs": 35,
      "details": {
        "currentVersion": "2.5.1",
        "targetVersion": "3.0.0",
        "changelogUrl": "https://github.com/user/linter-plugin/CHANGELOG.md"
      }
    }
    // ... similar to install
  ],

  "registryDelta": {
    "updated": ["linter-plugin"]
  },

  "versionTransition": {
    "from": "2.5.1",
    "to": "3.0.0",
    "changelogReviewed": true
  },

  "correlationId": "cli-req-uvw123",
  "hostname": "dev-machine",
  "platform": "linux",
  "nodeVersion": "20.10.0",
  "claudeCodeVersion": "2.3.0"
}
```

---

## Rollback Log Schema

### Example

```json
{
  "transactionId": "tx-rollback-1736706000000-rst456",
  "operation": "rollback",
  "pluginId": "api-client",
  "version": "1.8.2",
  "previousVersion": "1.9.0",
  "timestamp": "2026-01-12T11:15:00.000Z",
  "completedAt": "2026-01-12T11:15:00.245Z",
  "durationMs": 245,
  "success": true,

  "steps": [
    {
      "phase": "VALIDATE",
      "status": "success",
      "durationMs": 20,
      "details": {
        "currentVersion": "1.9.0",
        "targetVersion": "1.8.2",
        "cacheAvailable": true
      }
    },
    {
      "phase": "ACTIVATE",
      "status": "success",
      "durationMs": 210,
      "details": {
        "symlinkUpdated": true,
        "registryUpdated": true,
        "cacheHit": true
      }
    },
    {
      "phase": "TELEMETRY",
      "status": "success",
      "durationMs": 5
    }
  ],

  "registryDelta": {
    "updated": ["api-client"]
  },

  "rollbackReason": "Version 1.9.0 introduced breaking API changes",

  "correlationId": "cli-req-rst456",
  "hostname": "prod-server",
  "platform": "linux",
  "nodeVersion": "20.10.0",
  "claudeCodeVersion": "2.3.0"
}
```

---

## Using Audit Logs

### Query Recent Uninstalls

```bash
# Find all uninstall operations
find .claude-plugin/audit -name "uninstall-*.json"

# View most recent uninstall
ls -t .claude-plugin/audit/uninstall-*.json | head -1 | xargs cat | jq .
```

### Find Failed Operations

```bash
# Find all failed operations
jq -s 'map(select(.success == false))' .claude-plugin/audit/*.json
```

### Track Plugin History

```bash
# Find all operations for a specific plugin
jq -s 'map(select(.pluginId == "database-connector"))' .claude-plugin/audit/*.json
```

### Calculate Average Duration

```bash
# Average uninstall duration
jq -s 'map(select(.operation == "uninstall")) | map(.durationMs) | add / length' \
  .claude-plugin/audit/*.json
```

### Lifecycle Script Failure Analysis

```bash
# Find all lifecycle script failures
jq -s 'map(select(.steps[] | select(.phase == "LIFECYCLE" and .status == "failed")))' \
  .claude-plugin/audit/*.json
```

---

## Retention Policy

### Default Policy

- **Retention:** 90 days
- **Max Size:** 100 MB
- **Rotation:** Automatic when limit exceeded
- **Archive:** Oldest logs moved to `.claude-plugin/audit/archive/`

### Manual Cleanup

```bash
# Remove logs older than 90 days
find .claude-plugin/audit -name "*.json" -mtime +90 -delete

# Archive old logs
mkdir -p .claude-plugin/audit/archive
find .claude-plugin/audit -name "*.json" -mtime +30 \
  -exec mv {} .claude-plugin/audit/archive/ \;
```

---

## Security and Privacy

### Sensitive Data Handling

Audit logs **DO NOT** contain:
- User credentials
- API keys or tokens
- Personal identifiable information (PII)
- File contents from plugins

Audit logs **DO** contain:
- Plugin identifiers
- Transaction metadata
- Timing information
- Error codes and messages
- Lifecycle script paths (not contents)
- Consent digests (hashes, not actual consent text)

### Access Control

Audit logs should be:
- Readable only by the user who executed operations
- Protected with appropriate file permissions (600 or 640)
- Excluded from version control (add to `.gitignore`)

---

## Error Code Cross-Reference

### Uninstall Error Codes

| Code | Description | Documentation |
|------|-------------|---------------|
| ERR-UNINSTALL-001 | Plugin not installed | `docs/operations/uninstall.md` |
| ERR-UNINSTALL-002 | Registry update failed | `docs/operations/uninstall.md` |
| ERR-UNINSTALL-999 | Unexpected error | `docs/contracts/error-codes.md` |
| CRIT-011 | Lifecycle script failure | `docs/contracts/error-codes.md` - ERROR-INST-006 |
| FR-010 | Cache purge errors | `docs/operations/uninstall.md` |

---

## Integration with Telemetry

Audit logs complement telemetry but serve different purposes:

| Feature | Audit Logs | Telemetry |
|---------|------------|-----------|
| **Purpose** | Forensic analysis, compliance | Performance monitoring, metrics |
| **Format** | JSON files | JSONL stream |
| **Retention** | Long-term (90 days) | Short-term (30 days) |
| **Scope** | Per-transaction detail | Aggregate statistics |
| **Audience** | Developers, support | Monitoring systems |

See `.claude-plugin/telemetry/README.md` for telemetry documentation.

---

## Troubleshooting

### Missing Audit Logs

**Cause:** Operation failed before audit log creation.

**Check:**
```bash
# Verify audit directory exists
ls -la .claude-plugin/audit

# Check for partial logs
ls -la /tmp/plugin-staging-*
```

### Corrupted Audit Log

**Cause:** Disk full, power loss during write.

**Fix:**
```bash
# Validate JSON syntax
jq . .claude-plugin/audit/<file>.json

# Restore from backup if available
# (Audit logs are immutable after creation)
```

### Large Audit Directory

**Cause:** Many operations without cleanup.

**Fix:**
```bash
# Check current size
du -sh .claude-plugin/audit

# Run retention cleanup
plugin audit cleanup --days=90
```

---

## Related Documentation

- **Uninstall Operations:** `docs/operations/uninstall.md`
- **Install Operations:** `docs/operations/install.md`
- **Error Codes:** `docs/contracts/error-codes.md`
- **Telemetry:** `.claude-plugin/telemetry/README.md`
- **Architecture:** `docs/ARCHITECTURE.md` (Section 3.10: Transaction Lifecycle)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-12 | Initial audit trail documentation (I3.T4) |

---

**For Support:** Include transaction ID and audit log when reporting issues.
