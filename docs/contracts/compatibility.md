# Compatibility & Policy Engine - Contract Documentation

**Module:** `@yellow-plugins/domain/compatibility` **Task:** I2.T1 **Status:**
Implemented **Specification References:** FR-004, FR-005, CRIT-002b, CRIT-005,
CRIT-019

---

## Overview

The Compatibility & Policy Engine evaluates plugin compatibility requirements
against the host system environment, producing deterministic verdicts with
structured evidence payloads. This engine enforces compatibility policies for
Claude Code runtime, Node.js versions, OS platforms, CPU architectures, and
plugin dependencies.

The engine supports:

- **Deterministic evaluation** of compatibility requirements
- **Structured evidence** with error codes and specification references
- **Policy overrides** via flags and configuration
- **Offline-first** operation through cached environment fingerprints
- **Audit-friendly** logging with correlation IDs

---

## Core Concepts

### Compatibility Verdict

A **compatibility verdict** is the result of evaluating a plugin's requirements
against the current system environment. Verdicts have three possible statuses:

1. **`compatible`** - Plugin meets all requirements and can be installed
2. **`warn`** - Plugin has warnings but can proceed (e.g., conflict overrides
   active)
3. **`block`** - Plugin fails critical compatibility checks and cannot be
   installed

### Evidence Payload

Each verdict includes an **evidence payload** containing:

- Individual compatibility checks performed
- Required vs actual values for each check
- Validation errors with specification references
- Conflict information for plugin dependencies
- Evaluation timestamp for audit trails

### Policy Overrides

Administrators can override compatibility checks via configuration or feature
flags:

- `skipClaudeCheck` - Skip Claude Code version validation
- `skipNodeCheck` - Skip Node.js version validation
- `skipPlatformCheck` - Skip OS/arch validation
- `allowConflicts` - Downgrade plugin conflicts from block to warn

---

## API Contracts

### ICompatibilityService

Primary service interface for compatibility evaluation.

```typescript
interface ICompatibilityService {
  evaluateCompatibility(
    pluginId: string,
    version: string,
    compatibility: PluginCompatibility,
    environment: SystemEnvironment,
    registry?: RegistrySnapshot,
    overrides?: CompatibilityPolicyOverrides
  ): CompatibilityVerdict;
}
```

**Parameters:**

- `pluginId` - Plugin identifier (e.g., `'hookify'`)
- `version` - Plugin version (e.g., `'1.2.3'`)
- `compatibility` - Compatibility requirements from plugin manifest
- `environment` - Current system environment fingerprint
- `registry` (optional) - Installed plugin registry snapshot
- `overrides` (optional) - Policy overrides from flags/config

**Returns:** `CompatibilityVerdict` with status, checks, and evidence

**Example:**

```typescript
import { CompatibilityService } from '@yellow-plugins/domain';

const service = new CompatibilityService();
const verdict = service.evaluateCompatibility(
  'example-plugin',
  '1.0.0',
  {
    claudeCodeMin: '1.0.0',
    nodeMin: '18.0.0',
    os: ['linux', 'darwin'],
    arch: ['x64', 'arm64'],
  },
  environment
);

if (verdict.status === 'block') {
  console.error(verdict.summary);
  verdict.checks
    .filter((c) => !c.passed)
    .forEach((c) => console.error(c.error?.code, c.message));
}
```

---

### IHostFingerprintProvider

Infrastructure interface for obtaining system environment information.

```typescript
interface IHostFingerprintProvider {
  getEnvironment(): SystemEnvironment;
  getClaudeVersion(): string;
  getNodeVersion(): string;
  getPlatform(): string;
  getArchitecture(): string;
}
```

**Implementation:** `HostFingerprintProvider` in
`@yellow-plugins/infrastructure`

**Caching:** Environment snapshots are cached on first access to support
offline-first workflows and consistent results within a single command
execution.

**Example:**

```typescript
import { createFingerprintProvider } from '@yellow-plugins/infrastructure';

const provider = createFingerprintProvider(() => ['installed-plugin-a']);
const environment = provider.getEnvironment();

// {
//   claudeCodeVersion: '1.5.0',
//   nodeVersion: '20.10.0',
//   platform: 'linux',
//   arch: 'x64',
//   installedPlugins: ['installed-plugin-a']
// }
```

---

## Compatibility Checks

### 1. Claude Code Runtime Version

**Check IDs:** `claude-min`, `claude-max` **Type:** `claude-runtime`
**Specification:** CRIT-002b, FR-004 **Error Codes:** `ERROR-COMPAT-001`,
`ERROR-COMPAT-002`

Validates that the current Claude Code runtime version falls within the plugin's
required range.

**Manifest Fields:**

- `claudeCodeMin` - Minimum Claude Code version (required)
- `claudeCodeMax` - Maximum Claude Code version (optional)

**Example:**

```json
{
  "compatibility": {
    "claudeCodeMin": "1.5.0",
    "claudeCodeMax": "2.0.0"
  }
}
```

**Verdict Evidence:**

```typescript
{
  id: 'claude-min',
  type: 'claude-runtime',
  passed: false,
  required: '>=1.5.0',
  actual: '1.2.0',
  message: 'Claude Code 1.2.0 below minimum 1.5.0',
  error: {
    code: 'ERROR-COMPAT-001',
    message: 'Compatibility check failed for claudeCodeMin: expected >=1.5.0, got 1.2.0',
    path: '/compatibility/claudeCodeMin',
    severity: 'ERROR',
    category: 'COMPATIBILITY',
    specReference: 'CRIT-002b',
    resolution: 'Please ensure your system meets the requirement: claudeCodeMin >=1.5.0'
  }
}
```

---

### 2. Node.js Version

**Check IDs:** `node-min`, `node-max` **Type:** `node-version`
**Specification:** CRIT-005, CRIT-019, FR-004 **Error Codes:**
`ERROR-COMPAT-003` (min), `ERROR-COMPAT-007` (max)

Validates that the current Node.js version is within the range supported by the
plugin.

**Manifest Fields:**

- `nodeMin` - Minimum Node.js version (optional)
- `nodeMax` - Maximum Node.js version (optional, CRIT-019)

**Example:**

```json
{
  "compatibility": {
    "nodeMin": "18.0.0",
    "nodeMax": "24.0.0"
  }
}
```

**Notes:**

- Node.js version is extracted from `process.version` with `v` prefix removed
- Follows semantic versioning comparison rules for both minimum and maximum
  bounds
- Omitting `nodeMax` keeps Node.js unbounded above the minimum

---

### 3. Operating System Platform

**Check ID:** `os-platform` **Type:** `os` **Specification:** CRIT-005, FR-005
**Error Code:** `ERROR-COMPAT-004`

Validates that the current OS platform is in the plugin's supported list.

**Manifest Fields:**

- `os` - Array of supported OS platforms (optional)

**Supported Values:**

- `'darwin'` - macOS
- `'linux'` - Linux distributions
- `'win32'` - Windows

**Example:**

```json
{
  "compatibility": {
    "os": ["linux", "darwin"]
  }
}
```

**Notes:**

- Empty or missing `os` array means no OS restriction
- Platform value comes from `os.platform()`

---

### 4. CPU Architecture

**Check ID:** `cpu-arch` **Type:** `arch` **Specification:** CRIT-005, FR-005
**Error Code:** `ERROR-COMPAT-005`

Validates that the current CPU architecture is in the plugin's supported list.

**Manifest Fields:**

- `arch` - Array of supported CPU architectures (optional)

**Supported Values:**

- `'x64'` - 64-bit Intel/AMD
- `'arm64'` - 64-bit ARM (Apple Silicon, ARM servers)
- `'ia32'` - 32-bit Intel/AMD

**Example:**

```json
{
  "compatibility": {
    "arch": ["x64", "arm64"]
  }
}
```

---

### 5. Plugin Dependencies

**Check IDs:** `dependency-{pluginId}`, `conflict-{pluginId}` **Type:**
`plugin-conflict` **Specification:** CRIT-005, CRIT-019 **Error Code:**
`ERROR-COMPAT-006`

Validates that required plugin dependencies are installed in the registry.

**Manifest Fields:**

- `pluginDependencies` - Array of required plugin IDs (optional)

**Example:**

```json
{
  "compatibility": {
    "pluginDependencies": ["base-toolkit", "auth-provider"]
  }
}
```

**Policy Override:**

- When `allowConflicts` override is active, missing dependencies produce `warn`
  status instead of `block`
- Check ID changes from `dependency-{id}` to `conflict-{id}` when overridden
- Message includes "(conflict override active)" suffix

---

## Policy Overrides

Policy overrides allow selective bypass of compatibility checks for advanced use
cases or development environments.

### Configuration Sources

Overrides can be provided via:

1. **CLI flags** - `--skip-claude-check`, `--allow-conflicts`, etc.
2. **Feature flags** - `featureFlags.skipCompatibilityChecks`
3. **Config file** - `.claude-plugin/config.json` compatibility section

### Available Overrides

```typescript
interface CompatibilityPolicyOverrides {
  skipClaudeCheck?: boolean; // Skip Claude Code version checks
  skipNodeCheck?: boolean; // Skip Node.js version checks
  skipPlatformCheck?: boolean; // Skip OS/arch checks
  allowConflicts?: boolean; // Allow plugin conflicts (warn instead of block)
}
```

### Override Behavior

- **Skip checks** - Check is not performed, does not appear in verdict
- **Allow conflicts** - Failed dependency checks pass with warning message
- **Status impact** - Overridden conflicts produce `warn` status, not
  `compatible`

---

## Error Codes & Specification References

| Error Code         | Category      | Check Type        | Specification | Description                         |
| ------------------ | ------------- | ----------------- | ------------- | ----------------------------------- |
| `ERROR-COMPAT-001` | COMPATIBILITY | Claude Min        | CRIT-002b     | Claude Code version below minimum   |
| `ERROR-COMPAT-002` | COMPATIBILITY | Claude Max        | CRIT-002b     | Claude Code version exceeds maximum |
| `ERROR-COMPAT-003` | COMPATIBILITY | Node Min          | CRIT-005      | Node.js version below minimum       |
| `ERROR-COMPAT-007` | COMPATIBILITY | Node Max          | CRIT-019      | Node.js version exceeds maximum     |
| `ERROR-COMPAT-004` | COMPATIBILITY | OS Platform       | CRIT-005      | OS platform not supported           |
| `ERROR-COMPAT-005` | COMPATIBILITY | CPU Arch          | CRIT-005      | CPU architecture not supported      |
| `ERROR-COMPAT-006` | COMPATIBILITY | Plugin Dependency | CRIT-005      | Required plugin dependency missing  |

All errors include:

- **Error code** from specification Section 4
- **Specification reference** (CRIT/FR anchor)
- **Suggested resolution** text
- **Contextual data** (required, actual values)

---

## CLI Integration

### CompatCommandBridge

The `CompatCommandBridge` integrates the compatibility service with CLI
commands, providing:

- **Options parsing** from CLI arguments
- **Context extraction** from command metadata
- **Verdict logging** with structured evidence
- **Result formatting** for command responses

**Example Usage:**

```typescript
import { createCompatCommandBridge } from '@yellow-plugins/cli/lib/compatCommandBridge';
import { CompatibilityService } from '@yellow-plugins/domain';
import { createFingerprintProvider } from '@yellow-plugins/infrastructure';

const service = new CompatibilityService();
const fingerprint = createFingerprintProvider();
const bridge = createCompatCommandBridge(service, fingerprint);

// In install command handler
const result = bridge.checkCompatibility(
  {
    pluginId: options.plugin,
    version: options.version,
    compatibility: manifest.compatibility,
    skipClaudeCheck: options.skipClaudeCheck,
  },
  context
);

if (!result.success) {
  return result; // Bubble up compatibility failure
}
```

### Logged Evidence

The bridge logs detailed evidence for each check:

```json
{
  "timestamp": "2026-01-11T22:20:00.000Z",
  "level": "WARN",
  "command": "install",
  "correlationId": "abc123-def456",
  "message": "Node.js 16.0.0 below minimum 18.0.0",
  "data": {
    "checkId": "node-min",
    "checkType": "node-version",
    "required": ">=18.0.0",
    "actual": "16.0.0",
    "passed": false,
    "errorCode": "ERROR-COMPAT-003",
    "errorMessage": "Compatibility check failed for nodeMin: expected >=18.0.0, got 16.0.0",
    "specReference": "CRIT-005"
  }
}
```

---

## Testing Coverage

### Unit Tests

**Package:** `@yellow-plugins/domain` **Location:**
`src/compatibility/__tests__/compatibilityService.test.ts`

**Coverage:**

- ✅ Claude Code min/max version checks
- ✅ Node.js minimum version checks
- ✅ OS platform validation
- ✅ CPU architecture validation
- ✅ Plugin dependency conflicts
- ✅ Policy overrides (skip checks, allow conflicts)
- ✅ Combined multi-check scenarios
- ✅ Edge cases (exact versions, empty requirements)
- ✅ Error codes and specification references

**Package:** `@yellow-plugins/infrastructure` **Location:**
`src/system/__tests__/fingerprint.test.ts`

**Coverage:**

- ✅ Environment fingerprinting
- ✅ Caching behavior
- ✅ Plugin provider integration
- ✅ Factory function with env vars
- ✅ Offline-first operation

---

## Integration Examples

### Example 1: Basic Install Check

```typescript
import { CompatibilityService } from '@yellow-plugins/domain';
import { createFingerprintProvider } from '@yellow-plugins/infrastructure';

const service = new CompatibilityService();
const fingerprint = createFingerprintProvider();

const verdict = service.evaluateCompatibility(
  'my-plugin',
  '2.0.0',
  {
    claudeCodeMin: '1.5.0',
    nodeMin: '18.0.0',
    os: ['linux', 'darwin'],
  },
  fingerprint.getEnvironment()
);

console.log(verdict.summary);
// "Plugin my-plugin@2.0.0 is compatible with current environment (3 checks passed)"
```

### Example 2: Handling Conflicts with Override

```typescript
const verdict = service.evaluateCompatibility(
  'experimental-plugin',
  '0.1.0',
  {
    claudeCodeMin: '1.0.0',
    pluginDependencies: ['missing-plugin'],
  },
  fingerprint.getEnvironment(),
  undefined,
  { allowConflicts: true }
);

console.log(verdict.status); // 'warn'
console.log(verdict.summary);
// "Plugin experimental-plugin@0.1.0 has 1 warning(s) but can be installed"
```

### Example 3: Pre-Flight Validation

```typescript
function canInstallPlugin(manifest) {
  const verdict = service.evaluateCompatibility(
    manifest.id,
    manifest.version,
    manifest.compatibility,
    fingerprint.getEnvironment(),
    registry.getSnapshot()
  );

  if (verdict.status === 'block') {
    const errors = verdict.checks
      .filter((c) => !c.passed)
      .map((c) => c.error?.code);

    throw new InstallationError(
      `Cannot install ${manifest.id}: ${errors.join(', ')}`,
      errors
    );
  }

  return verdict;
}
```

---

## Appendix: Type Definitions

### PluginCompatibility

```typescript
interface PluginCompatibility {
  claudeCodeMin: string;
  claudeCodeMax?: string;
  nodeMin?: string;
  nodeMax?: string;
  os?: string[];
  arch?: string[];
  pluginDependencies?: string[];
}
```

### SystemEnvironment

```typescript
interface SystemEnvironment {
  claudeCodeVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  installedPlugins: string[];
}
```

### CompatibilityVerdict

```typescript
interface CompatibilityVerdict {
  status: 'compatible' | 'warn' | 'block';
  checks: CompatibilityCheck[];
  pluginId: string;
  version: string;
  evaluatedAt: Date;
  conflictingPlugins?: string[];
  summary: string;
}
```

### CompatibilityCheck

```typescript
interface CompatibilityCheck {
  id: string;
  type: 'claude-runtime' | 'node-version' | 'os' | 'arch' | 'plugin-conflict';
  passed: boolean;
  required: string;
  actual: string;
  message: string;
  error?: DomainValidationError;
}
```

---

## Revision History

| Version | Date       | Author     | Changes                                     |
| ------- | ---------- | ---------- | ------------------------------------------- |
| 1.0.0   | 2026-01-11 | Task I2.T1 | Initial compatibility engine implementation |

---

**Related Documentation:**

- [SPECIFICATION.md](../SPECIFICATION.md) - Full system specification
- [Error Catalog](../../packages/domain/src/validation/errorCatalog.ts) - Error
  code definitions
- [Validation Contracts](../../packages/domain/src/validation/types.ts) - Shared
  validation types
