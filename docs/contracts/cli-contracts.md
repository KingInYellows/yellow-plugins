# CLI Contract Catalog

**Document Version**: 1.0.0
**Last Updated**: 2026-01-11
**Specification Reference**: Section 2 API Style, Section 4 Documentation Directive
**Status**: Active

<!-- anchor: cli-contracts-catalog -->

---

## Table of Contents

<!-- START doctoc -->
<!-- END doctoc -->

---

## 1. Overview

### 1.1 Purpose

This document defines the canonical JSON envelope contracts for CLI commands in the Claude Code Plugin Marketplace. These contracts enable:

- **Automation**: Programmatic command invocation via JSON payloads
- **Determinism**: Reproducible operations for CI/CD pipelines
- **Traceability**: Correlation IDs, transaction tracking, and audit trails
- **Validation**: Schema-driven request/response validation with AJV

### 1.2 Contract Style

<!-- anchor: contract-style -->

All CLI commands support dual modes of operation:

1. **Interactive Mode**: Standard CLI arguments and flags
2. **Automated Mode**: JSON input via `--input` flag, JSON output via `--output` flag

**Specification References**: [FR-001](../SPECIFICATION.md#fr-001), [FR-002](../SPECIFICATION.md#fr-002), [CRIT-001](../SPECIFICATION.md#crit-001), [CRIT-004](../SPECIFICATION.md#crit-004)

### 1.3 Schema Locations

All contract schemas are located in the `api/cli-contracts/` directory:

- `api/cli-contracts/install.json` - Install command contract
- `api/cli-contracts/update.json` - Update command contract
- `api/cli-contracts/rollback.json` - Rollback command contract

Each schema file defines both **request** (input) and **response** (output) envelopes using JSON Schema Draft-07.

---

## 2. Common Structures

<!-- anchor: common-structures -->

### 2.1 Base Request Envelope

All command requests share common metadata fields:

```typescript
interface BaseRequest {
  /** Correlation ID for request tracing */
  correlationId?: string;

  /** Enable dry-run mode (no side effects) */
  dryRun?: boolean;

  /** Feature flag overrides for this request */
  flagOverrides?: Record<string, boolean>;

  /** Telemetry context for observability */
  telemetryContext?: TelemetryContext;
}
```

### 2.2 Base Response Envelope

All command responses share common result fields:

```typescript
interface BaseResponse {
  /** Success indicator */
  success: boolean;

  /** Status code */
  status: 'success' | 'error' | 'dry-run' | 'partial';

  /** Human-readable message */
  message: string;

  /** Transaction ID for atomicity tracking */
  transactionId: string;

  /** Correlation ID echoed from request */
  correlationId: string;

  /** Command execution timestamp */
  timestamp: string; // ISO 8601

  /** CLI version */
  cliVersion: string;

  /** Error details (if status === 'error') */
  error?: ErrorDetails;

  /** Telemetry metrics */
  telemetry?: TelemetryMetrics;
}
```

### 2.3 Compatibility Intent

<!-- anchor: compatibility-intent -->

Platform and environment fingerprint for compatibility validation:

```typescript
interface CompatibilityIntent {
  /** Node.js version (semver) */
  nodeVersion: string;

  /** Operating system (linux, darwin, win32) */
  os: string;

  /** CPU architecture (x64, arm64) */
  arch: string;

  /** Claude Code version (semver) */
  claudeVersion?: string;
}
```

**Specification Reference**: [CRIT-002b](../SPECIFICATION.md#crit-002b), [CRIT-005](../SPECIFICATION.md#crit-005)

### 2.4 Feature Flag Evaluations

<!-- anchor: flag-evaluations -->

Feature flags evaluated during command execution:

```typescript
interface FlagEvaluations {
  /** Flag key to boolean value mapping */
  flags: Record<string, boolean>;

  /** Source of flag values (file, override, default) */
  source: 'config' | 'override' | 'default';

  /** Feature flags that influenced behavior */
  appliedFlags: string[];
}
```

**Specification Reference**: Section 4 Directives & Process (Feature-Flag Governance)

### 2.5 Error Details

<!-- anchor: error-details -->

Structured error information referencing the error catalog:

```typescript
interface ErrorDetails {
  /** Error code (e.g., ERR-INSTALL-001) */
  code: string;

  /** Error message */
  message: string;

  /** Severity level */
  severity: 'ERROR' | 'WARNING';

  /** Error category */
  category: string;

  /** Specification references */
  specReference?: string;

  /** Resolution guidance */
  resolution?: string;

  /** Additional context */
  context?: Record<string, unknown>;
}
```

**Cross-reference**: [Error Codes Reference](./error-codes.md)

### 2.6 Telemetry Context

<!-- anchor: telemetry-context -->

Observability metadata for structured logging and metrics:

```typescript
interface TelemetryContext {
  /** User session ID */
  sessionId?: string;

  /** Git commit hash */
  gitCommit?: string;

  /** Environment tags */
  tags?: Record<string, string>;
}

interface TelemetryMetrics {
  /** Command duration in milliseconds */
  durationMs: number;

  /** Cache hit/miss status */
  cacheStatus?: 'hit' | 'miss' | 'partial';

  /** Bytes downloaded */
  bytesDownloaded?: number;

  /** Number of lifecycle scripts executed */
  lifecycleScriptsRun?: number;

  /** Registry mutations count */
  registryMutations?: number;
}
```

**Specification Reference**: [CRIT-010](../SPECIFICATION.md#crit-010), Section 4 Security & Observability

---

## 3. Install Command Contract

<!-- anchor: install-contract -->

### 3.1 Command Metadata

- **Command**: `install`
- **Aliases**: `i`, `add`
- **Schema**: [`api/cli-contracts/install.json`](../../api/cli-contracts/install.json)
- **Specification Anchors**: [FR-001](../SPECIFICATION.md#fr-001), [CRIT-001](../SPECIFICATION.md#crit-001), [3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)
- **Error Codes**: `ERR-INSTALL-001`, `ERR-INSTALL-002`, `ERR-COMPAT-001`

### 3.2 Request Schema

```typescript
interface InstallRequest extends BaseRequest {
  /** Plugin identifier (kebab-case) */
  pluginId: string;

  /** Specific version to install (semver or 'latest') */
  version?: string;

  /** Force reinstall if already installed */
  force?: boolean;

  /** Compatibility requirements */
  compatibilityIntent: CompatibilityIntent;

  /** Skip lifecycle scripts */
  skipLifecycle?: boolean;

  /** Lifecycle script consent tokens */
  lifecycleConsent?: {
    /** Script type (preInstall, install, postInstall) */
    scriptType: string;
    /** SHA-256 digest of script content */
    digest: string;
    /** User consent timestamp */
    consentedAt: string; // ISO 8601
  }[];
}
```

### 3.3 Response Schema

```typescript
interface InstallResponse extends BaseResponse {
  /** Installed plugin details */
  data?: {
    /** Plugin identifier */
    pluginId: string;

    /** Installed version */
    version: string;

    /** Installation state */
    installState: 'active' | 'staged' | 'failed';

    /** Cache path */
    cachePath: string;

    /** Symlink target */
    symlinkTarget?: string;

    /** Registry delta */
    registryDelta?: {
      /** Added entries */
      added: string[];
      /** Modified entries */
      modified: string[];
    };

    /** Lifecycle scripts executed */
    lifecycleScripts?: {
      scriptType: string;
      exitCode: number;
      durationMs: number;
      digest: string;
    }[];

    /** Feature flags evaluated */
    flagEvaluations?: FlagEvaluations;
  };
}
```

### 3.4 Usage Examples

#### Interactive Mode

```bash
# Install latest version
pnpm cli install example-plugin

# Install specific version
pnpm cli install example-plugin --version 1.2.3

# Force reinstall
pnpm cli install example-plugin --force

# Dry run
pnpm cli install example-plugin --dry-run
```

#### Automated Mode (JSON Input)

```bash
# From file
pnpm cli install --input install-request.json --output install-result.json

# From stdin
cat install-request.json | pnpm cli install --input - --output -
```

**Request Payload (`install-request.json`)**:

```json
{
  "pluginId": "example-plugin",
  "version": "1.2.3",
  "force": false,
  "dryRun": false,
  "correlationId": "req-install-20260111-001",
  "compatibilityIntent": {
    "nodeVersion": "20.10.0",
    "os": "linux",
    "arch": "x64",
    "claudeVersion": "2.5.0"
  },
  "telemetryContext": {
    "sessionId": "sess-12345",
    "gitCommit": "abc123def",
    "tags": {
      "environment": "ci",
      "pipeline": "deploy"
    }
  }
}
```

**Response Payload (`install-result.json`)**:

```json
{
  "success": true,
  "status": "success",
  "message": "Successfully installed example-plugin@1.2.3",
  "transactionId": "txn-20260111-123456",
  "correlationId": "req-install-20260111-001",
  "timestamp": "2026-01-11T10:30:45.123Z",
  "cliVersion": "1.0.0",
  "data": {
    "pluginId": "example-plugin",
    "version": "1.2.3",
    "installState": "active",
    "cachePath": ".claude-plugin/cache/example-plugin-1.2.3",
    "symlinkTarget": ".claude-plugin/plugins/example-plugin",
    "registryDelta": {
      "added": ["example-plugin"],
      "modified": []
    },
    "lifecycleScripts": [
      {
        "scriptType": "postInstall",
        "exitCode": 0,
        "durationMs": 1250,
        "digest": "sha256:abc123..."
      }
    ],
    "flagEvaluations": {
      "flags": {
        "enableRollback": true,
        "strictCompatibility": true
      },
      "source": "config",
      "appliedFlags": ["strictCompatibility"]
    }
  },
  "telemetry": {
    "durationMs": 45678,
    "cacheStatus": "miss",
    "bytesDownloaded": 2048576,
    "lifecycleScriptsRun": 1,
    "registryMutations": 1
  }
}
```

---

## 4. Update Command Contract

<!-- anchor: update-contract -->

### 4.1 Command Metadata

- **Command**: `update`
- **Aliases**: `up`, `upgrade`
- **Schema**: [`api/cli-contracts/update.json`](../../api/cli-contracts/update.json)
- **Specification Anchors**: [FR-002](../SPECIFICATION.md#fr-002), [CRIT-002](../SPECIFICATION.md#crit-002), [3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)
- **Error Codes**: `ERR-UPDATE-001`, `ERR-UPDATE-002`, `ERR-COMPAT-001`

### 4.2 Request Schema

```typescript
interface UpdateRequest extends BaseRequest {
  /** Plugin identifier (omit for --all mode) */
  pluginId?: string;

  /** Update all installed plugins */
  all?: boolean;

  /** Compatibility requirements */
  compatibilityIntent: CompatibilityIntent;

  /** Target version constraint (semver range) */
  versionConstraint?: string;

  /** Skip lifecycle scripts */
  skipLifecycle?: boolean;

  /** Check for updates without installing */
  checkOnly?: boolean;
}
```

### 4.3 Response Schema

```typescript
interface UpdateResponse extends BaseResponse {
  /** Update results */
  data?: {
    /** Plugins updated */
    updated: {
      pluginId: string;
      fromVersion: string;
      toVersion: string;
      installState: 'active' | 'staged' | 'failed';
    }[];

    /** Plugins already up-to-date */
    upToDate: string[];

    /** Plugins skipped (compatibility issues) */
    skipped: {
      pluginId: string;
      reason: string;
      errorCode?: string;
    }[];

    /** Available updates (checkOnly mode) */
    availableUpdates?: {
      pluginId: string;
      currentVersion: string;
      latestVersion: string;
      changelogUrl?: string;
    }[];

    /** Registry delta */
    registryDelta?: {
      modified: string[];
    };

    /** Feature flags evaluated */
    flagEvaluations?: FlagEvaluations;
  };
}
```

### 4.4 Usage Examples

#### Interactive Mode

```bash
# Update specific plugin
pnpm cli update example-plugin

# Update all plugins
pnpm cli update --all

# Check for updates without installing
pnpm cli update --all --check-only
```

#### Automated Mode

**Request Payload (`update-request.json`)**:

```json
{
  "all": true,
  "checkOnly": false,
  "dryRun": false,
  "correlationId": "req-update-20260111-002",
  "compatibilityIntent": {
    "nodeVersion": "20.10.0",
    "os": "linux",
    "arch": "x64"
  }
}
```

**Response Payload**:

```json
{
  "success": true,
  "status": "success",
  "message": "Updated 2 plugins, 1 already up-to-date, 1 skipped",
  "transactionId": "txn-20260111-123457",
  "correlationId": "req-update-20260111-002",
  "timestamp": "2026-01-11T10:35:12.456Z",
  "cliVersion": "1.0.0",
  "data": {
    "updated": [
      {
        "pluginId": "example-plugin",
        "fromVersion": "1.2.3",
        "toVersion": "1.3.0",
        "installState": "active"
      },
      {
        "pluginId": "another-plugin",
        "fromVersion": "2.0.0",
        "toVersion": "2.1.0",
        "installState": "active"
      }
    ],
    "upToDate": ["stable-plugin"],
    "skipped": [
      {
        "pluginId": "incompatible-plugin",
        "reason": "Requires Node.js >= 22, current: 20.10.0",
        "errorCode": "ERROR-COMPAT-003"
      }
    ],
    "registryDelta": {
      "modified": ["example-plugin", "another-plugin"]
    }
  },
  "telemetry": {
    "durationMs": 87654,
    "cacheStatus": "partial",
    "bytesDownloaded": 4096000,
    "lifecycleScriptsRun": 2,
    "registryMutations": 2
  }
}
```

---

## 5. Rollback Command Contract

<!-- anchor: rollback-contract -->

### 5.1 Command Metadata

- **Command**: `rollback`
- **Aliases**: `rb`, `revert`
- **Schema**: [`api/cli-contracts/rollback.json`](../../api/cli-contracts/rollback.json)
- **Specification Anchors**: [FR-003](../SPECIFICATION.md#fr-003), [CRIT-018](../SPECIFICATION.md#crit-018), [3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)
- **Error Codes**: `ERR-ROLLBACK-001`, `ERR-ROLLBACK-002`, `ERR-CACHE-001`
- **Required Feature Flag**: `enableRollback`

### 5.2 Request Schema

```typescript
interface RollbackRequest extends BaseRequest {
  /** Plugin identifier */
  pluginId: string;

  /** Target version to rollback to */
  targetVersion?: string;

  /** Cache preference strategy */
  cachePreference: 'cached-only' | 'download-if-missing';

  /** User confirmation token */
  confirmationToken?: string;

  /** List available rollback targets without executing */
  listTargets?: boolean;
}
```

### 5.3 Response Schema

```typescript
interface RollbackResponse extends BaseResponse {
  /** Rollback result */
  data?: {
    /** Plugin identifier */
    pluginId: string;

    /** Version before rollback */
    fromVersion: string;

    /** Version after rollback */
    toVersion: string;

    /** Rollback state */
    installState: 'active' | 'staged' | 'failed';

    /** Cache source used */
    cacheSource: 'cached' | 'downloaded';

    /** Available rollback targets (listTargets mode) */
    availableTargets?: {
      version: string;
      cached: boolean;
      installedAt: string; // ISO 8601
      cachePath?: string;
    }[];

    /** Rollback checkpoint */
    checkpointId?: string;

    /** Registry delta */
    registryDelta?: {
      modified: string[];
    };

    /** Feature flags evaluated */
    flagEvaluations?: FlagEvaluations;
  };
}
```

### 5.4 Usage Examples

#### Interactive Mode

```bash
# Rollback to previous cached version (interactive selection)
pnpm cli rollback example-plugin

# Rollback to specific version
pnpm cli rollback example-plugin --version 1.0.0

# List available rollback targets
pnpm cli rollback example-plugin --list-targets
```

#### Automated Mode

**Request Payload (`rollback-request.json`)**:

```json
{
  "pluginId": "example-plugin",
  "targetVersion": "1.2.0",
  "cachePreference": "cached-only",
  "confirmationToken": "user-confirmed-20260111",
  "dryRun": false,
  "correlationId": "req-rollback-20260111-003",
  "flagOverrides": {
    "enableRollback": true
  }
}
```

**Response Payload**:

```json
{
  "success": true,
  "status": "success",
  "message": "Successfully rolled back example-plugin from 1.3.0 to 1.2.0",
  "transactionId": "txn-20260111-123458",
  "correlationId": "req-rollback-20260111-003",
  "timestamp": "2026-01-11T10:40:30.789Z",
  "cliVersion": "1.0.0",
  "data": {
    "pluginId": "example-plugin",
    "fromVersion": "1.3.0",
    "toVersion": "1.2.0",
    "installState": "active",
    "cacheSource": "cached",
    "checkpointId": "ckpt-20260111-001",
    "registryDelta": {
      "modified": ["example-plugin"]
    },
    "flagEvaluations": {
      "flags": {
        "enableRollback": true
      },
      "source": "override",
      "appliedFlags": ["enableRollback"]
    }
  },
  "telemetry": {
    "durationMs": 5432,
    "cacheStatus": "hit",
    "bytesDownloaded": 0,
    "lifecycleScriptsRun": 0,
    "registryMutations": 1
  }
}
```

---

## 6. Automation & CI/CD Integration

<!-- anchor: automation-integration -->

### 6.1 Schema Validation

All JSON schemas are validated using AJV (JSON Schema validator):

```bash
# Install AJV CLI
npm install -g ajv-cli

# Validate request payload
ajv validate -s api/cli-contracts/install.json -d install-request.json

# Validate response payload
ajv validate -s api/cli-contracts/install.json -d install-result.json --valid
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "validate:contracts": "ajv validate -s 'api/cli-contracts/*.json' -d 'examples/requests/*.json'"
  }
}
```

### 6.2 CI/CD Pipeline Examples

#### GitHub Actions Workflow

```yaml
name: Install Plugin

on:
  workflow_dispatch:
    inputs:
      plugin_id:
        description: 'Plugin ID to install'
        required: true
      version:
        description: 'Version (optional)'
        required: false

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate Install Request
        run: |
          cat > install-request.json <<EOF
          {
            "pluginId": "${{ github.event.inputs.plugin_id }}",
            "version": "${{ github.event.inputs.version || 'latest' }}",
            "correlationId": "${{ github.run_id }}-${{ github.run_number }}",
            "compatibilityIntent": {
              "nodeVersion": "$(node -v | sed 's/v//')",
              "os": "linux",
              "arch": "x64"
            },
            "telemetryContext": {
              "sessionId": "${{ github.run_id }}",
              "gitCommit": "${{ github.sha }}",
              "tags": {
                "environment": "ci",
                "workflow": "${{ github.workflow }}"
              }
            }
          }
          EOF

      - name: Validate Request
        run: ajv validate -s api/cli-contracts/install.json -d install-request.json

      - name: Install Plugin
        run: |
          pnpm cli install --input install-request.json --output install-result.json

      - name: Validate Response
        run: ajv validate -s api/cli-contracts/install.json -d install-result.json

      - name: Upload Results
        uses: actions/upload-artifact@v4
        with:
          name: install-results
          path: |
            install-request.json
            install-result.json
```

#### Shell Script Automation

```bash
#!/usr/bin/env bash
# install-plugin.sh - Automated plugin installation

set -euo pipefail

PLUGIN_ID="${1:?Plugin ID required}"
VERSION="${2:-latest}"
CORRELATION_ID="$(uuidgen)"

# Generate request payload
cat > /tmp/install-request.json <<EOF
{
  "pluginId": "${PLUGIN_ID}",
  "version": "${VERSION}",
  "correlationId": "${CORRELATION_ID}",
  "compatibilityIntent": {
    "nodeVersion": "$(node -v | sed 's/v//')",
    "os": "$(uname -s | tr '[:upper:]' '[:lower:]')",
    "arch": "$(uname -m)"
  }
}
EOF

# Validate request
ajv validate -s api/cli-contracts/install.json -d /tmp/install-request.json

# Execute install
pnpm cli install --input /tmp/install-request.json --output /tmp/install-result.json

# Check result
if jq -e '.success == true' /tmp/install-result.json >/dev/null; then
  echo "✅ Installation successful"
  jq -r '.message' /tmp/install-result.json
  exit 0
else
  echo "❌ Installation failed"
  jq -r '.error.message' /tmp/install-result.json
  exit 1
fi
```

### 6.3 Dry-Run Testing

All commands support `--dry-run` mode for safe pre-flight validation:

```bash
# Test install without side effects
pnpm cli install example-plugin --dry-run

# JSON mode dry run
cat request.json | pnpm cli install --input - --dry-run --output result.json
```

Dry-run responses include `status: "dry-run"` and omit transactionId/registry mutations.
They still emit synthetic `transactionId` values for correlation, but the `telemetry.registryMutations`
field remains zero and downstream services treat them as non-persistent simulations.

---

## 7. Specification Traceability

<!-- anchor: traceability -->

### 7.1 Functional Requirements Coverage

| Contract | FR Reference | Description |
|----------|--------------|-------------|
| Install | FR-001 | Schema-driven plugin installation |
| Update | FR-002 | Update installed plugins |
| Rollback | FR-003 | Rollback to previous versions |
| All | FR-006 | Manifest-driven command routing |

### 7.2 Critical Fixes Coverage

| Contract Section | CRIT Reference | Correction Applied |
|------------------|----------------|-------------------|
| Compatibility Intent | CRIT-002b, CRIT-005 | Platform/version validation |
| Error Details | CRIT-007 | Installation error handling |
| Telemetry Context | CRIT-010 | Lifecycle script observability |
| Feature Flags | CRIT-004 | Flag governance |
| Rollback Cache | CRIT-018 | 100% cached rollback success |

### 7.3 Non-Functional Requirements

| Contract Feature | NFR Reference | Implementation |
|------------------|---------------|----------------|
| Schema Validation | NFR-MAINT-002 | AJV validation with strict mode |
| Atomic Persistence | Section 4 Directives | transactionId tracking |
| Observability | Section 4 Security | Structured telemetry metrics |

---

## 8. Schema Evolution & Versioning

<!-- anchor: schema-versioning -->

### 8.1 Versioning Policy

Contract schemas follow semantic versioning:

- **Major**: Breaking changes (field removal, type changes)
- **Minor**: Backward-compatible additions (new optional fields)
- **Patch**: Fixes and clarifications (documentation, examples)

Schema `$id` includes version: `https://yellow-plugins.dev/schemas/cli-contracts/install/v1.json`

### 8.2 Migration Path

When schemas evolve:

1. Publish new schema version in `api/cli-contracts/`
2. Update CLI to accept both old and new versions (grace period: 2 minor versions)
3. Update traceability matrix with migration notes
4. Deprecate old version with sunset date in changelog

### 8.3 Backward Compatibility

CLI implementations MUST:

- Accept older schema versions (backward compatibility)
- Emit latest schema version responses
- Log warnings for deprecated fields
- Provide migration tooling for automated clients

---

## 9. Error Handling & Resilience

<!-- anchor: error-handling -->

### 9.1 Validation Errors

Invalid JSON input triggers immediate failure with detailed error:

```json
{
  "success": false,
  "status": "error",
  "message": "Invalid request payload",
  "error": {
    "code": "ERROR-SCHEMA-001",
    "message": "Request does not match install.json schema",
    "severity": "ERROR",
    "category": "SCHEMA_VALIDATION",
    "context": {
      "schemaPath": "#/properties/pluginId",
      "keyword": "required",
      "message": "must have required property 'pluginId'"
    },
    "specReference": "FR-001, FR-002",
    "resolution": "Validate JSON against api/cli-contracts/install.json"
  }
}
```

### 9.2 Partial Success

Commands that operate on multiple items (e.g., `update --all`) return `status: "partial"` when some operations fail:

```json
{
  "success": true,
  "status": "partial",
  "message": "Updated 2/3 plugins (1 failed)",
  "data": {
    "updated": [...],
    "skipped": [
      {
        "pluginId": "broken-plugin",
        "reason": "Checksum mismatch",
        "errorCode": "ERROR-INST-005"
      }
    ]
  }
}
```

### 9.3 Retry Logic

Network failures and timeouts should be retried with exponential backoff:

```typescript
async function retryCommand(payload: any, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await executeCommand(payload);

    if (result.success || !isRetryable(result.error?.code)) {
      return result;
    }

    if (attempt < maxRetries) {
      await sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
    }
  }
}

function isRetryable(errorCode?: string): boolean {
  return errorCode?.startsWith('ERROR-NET-') || errorCode === 'ERROR-INST-004';
}
```

---

## 10. Security Considerations

<!-- anchor: security -->

### 10.1 Input Validation

All JSON payloads MUST:

- Be validated against schemas before processing
- Reject additional properties not in schema
- Sanitize file paths to prevent directory traversal
- Validate semver ranges to prevent injection

### 10.2 Lifecycle Script Consent

Install/update requests requiring lifecycle scripts MUST include consent tokens:

```json
{
  "lifecycleConsent": [
    {
      "scriptType": "postInstall",
      "digest": "sha256:abc123...",
      "consentedAt": "2026-01-11T10:00:00Z"
    }
  ]
}
```

**Specification Reference**: [CRIT-010](../SPECIFICATION.md#crit-010)

### 10.3 Sensitive Data Redaction

Telemetry logs MUST redact:

- Environment variables (except allowlisted keys)
- File paths containing user home directories
- Network URLs with authentication tokens
- Git remote URLs with credentials

---

## 11. Reference Implementation

<!-- anchor: reference-implementation -->

### 11.1 CLI IO Helper

Location: `packages/cli/src/lib/io.ts`

Provides:

- `loadRequest<T>(options: BaseCommandOptions): Promise<T>` - Load JSON from `--input` or build from CLI args
- `writeResponse<T>(response: T, options: BaseCommandOptions): Promise<void>` - Write JSON to `--output` or stdout
- `validateSchema(data: unknown, schemaPath: string): Result<void>` - AJV validation wrapper

### 11.2 Command Integration Pattern

```typescript
import { loadRequest, writeResponse } from '../lib/io.js';
import type { InstallRequest, InstallResponse } from '@yellow-plugins/domain';

const installHandler: CommandHandler<InstallOptions> = async (options, context) => {
  // Load request from JSON or CLI args
  const request = await loadRequest<InstallRequest>(options, {
    pluginId: options.plugin,
    version: options.version,
    force: options.force,
    compatibilityIntent: buildCompatibilityIntent(),
    correlationId: context.correlationId,
    dryRun: options.dryRun,
  });

  // Execute domain logic
  const result = await installService.install(request);

  // Build response
  const response: InstallResponse = {
    ...buildBaseResponse(result, context),
    data: result.data,
  };

  // Write response
  await writeResponse(response, options);

  return toCommandResult(response);
};
```

---

## 12. Appendix

### 12.1 JSON Schema References

All schemas use JSON Schema Draft-07:

- **Specification**: https://json-schema.org/draft-07/schema
- **Validator**: AJV v8+ (strict mode)
- **Format validators**: `uri`, `email`, `date-time`, `semver` (custom)

### 12.2 Related Documentation

- [Error Codes Reference](./error-codes.md)
- [Specification](../SPECIFICATION.md)
- [Operational Architecture](../architecture/04_Operational_Architecture.md)
- [Traceability Matrix](../traceability-matrix.md)

### 12.3 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-11 | Initial CLI contract catalog (I2.T4 deliverable) |

---

**Maintained by**: Claude Code Plugin Marketplace Team
**Contact**: See repository README for contribution guidelines
**License**: See LICENSE file in repository root
