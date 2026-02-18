# Feature Flags and Configuration

**Document Version**: 1.0.0 **Last Updated**: 2026-01-11 **Part of**: Task
I1.T2 - Configuration and feature-flag system

---

## Overview

The Yellow Plugins marketplace uses a comprehensive configuration and
feature-flag system to manage settings and control the rollout of new or
high-risk functionality. This document explains the precedence rules, available
flags, and operational procedures.

## Configuration Precedence

Configuration values are resolved using a strict precedence order, from highest
to lowest priority:

1. **CLI Flags** (highest priority) - Command-line arguments passed to the CLI
2. **Environment Variables** - System environment variables prefixed with
   `YELLOW_PLUGINS_`
3. **Configuration Files** - JSON files in `.claude-plugin/` directory
4. **Default Values** (lowest priority) - Hardcoded defaults in the domain layer

### Example Precedence Resolution

If the same configuration key is set in multiple sources:

```bash
# Default value
pluginDir: ".claude-plugin"

# File: .claude-plugin/config.json
{ "pluginDir": "my-plugins" }

# Environment variable
export YELLOW_PLUGINS_PLUGIN_DIR="env-plugins"

# CLI flag
yellow-plugins install --plugin-dir="cli-plugins"

# Final resolved value: "cli-plugins" (CLI flag wins)
```

---

## Configuration Options

### Available Configuration Keys

| Key                  | Type    | Default           | Description                                            |
| -------------------- | ------- | ----------------- | ------------------------------------------------------ |
| `pluginDir`          | string  | `.claude-plugin`  | Root directory for plugin data, caches, and metadata   |
| `installDir`         | string  | `.claude/plugins` | Directory where plugins are installed                  |
| `maxCacheSizeMb`     | number  | 500               | Maximum cache size in MB before eviction               |
| `telemetryEnabled`   | boolean | false             | Enable structured telemetry and audit logging          |
| `lifecycleTimeoutMs` | number  | 30000             | Timeout in milliseconds for lifecycle script execution |

### Configuration File Format

Create `.claude-plugin/config.json` in your workspace root:

```json
{
  "$schema": "../schemas/config.schema.json",
  "pluginDir": ".claude-plugin",
  "installDir": ".claude/plugins",
  "maxCacheSizeMb": 500,
  "telemetryEnabled": false,
  "lifecycleTimeoutMs": 30000
}
```

### Environment Variable Format

Environment variables follow the pattern `YELLOW_PLUGINS_{KEY_NAME}` where
`{KEY_NAME}` is the config key in SCREAMING_SNAKE_CASE:

```bash
export YELLOW_PLUGINS_PLUGIN_DIR=".claude-plugin"
export YELLOW_PLUGINS_INSTALL_DIR=".claude/plugins"
export YELLOW_PLUGINS_MAX_CACHE_SIZE_MB="500"
export YELLOW_PLUGINS_TELEMETRY_ENABLED="false"
export YELLOW_PLUGINS_LIFECYCLE_TIMEOUT_MS="30000"
```

**Boolean Values**: Accepted values for boolean environment variables:

- True: `true`, `TRUE`, `1`, `yes`, `YES`
- False: `false`, `FALSE`, `0`, `no`, `NO`, or any other value

---

## Feature Flags

Feature flags control the availability of experimental, high-risk, or
iteratively released features. All flags default to `false` (disabled) unless
explicitly enabled, following a safe-by-default philosophy.

### Available Feature Flags

| Flag                        | Default | Related Requirements | Description                                                       |
| --------------------------- | ------- | -------------------- | ----------------------------------------------------------------- |
| `enableBrowse`              | false   | FR-002               | Enable the 'browse' command for discovering plugins               |
| `enablePublish`             | false   | FR-005               | Enable the 'publish' command for publishing plugins               |
| `enableRollback`            | false   | FR-004               | Enable rollback functionality for reverting plugin versions       |
| `enableVariants`            | false   | FR-006               | Enable variant switching (alpha/beta channels)                    |
| `enableLifecycleHooks`      | false   | FR-008               | Enable lifecycle hooks (install/uninstall scripts)                |
| `enableCompatibilityChecks` | true    | NFR-001              | Enable compatibility checks before installation (safety-critical) |
| `enableCiValidation`        | false   | FR-011               | Enable the CI validation runner                                   |

### Feature Flag File Format

Create `.claude-plugin/flags.json` in your workspace root:

```json
{
  "$schema": "../schemas/flags.schema.json",
  "enableBrowse": false,
  "enablePublish": false,
  "enableRollback": false,
  "enableVariants": false,
  "enableLifecycleHooks": false,
  "enableCompatibilityChecks": true,
  "enableCiValidation": false
}
```

### Enabling Flags via Environment Variables

Feature flags can also be controlled via environment variables:

```bash
export YELLOW_PLUGINS_ENABLE_BROWSE="true"
export YELLOW_PLUGINS_ENABLE_PUBLISH="true"
export YELLOW_PLUGINS_ENABLE_ROLLBACK="false"
```

**Note**: Unlike config values, feature flags do NOT support CLI flag overrides.
This is intentional to prevent accidental enabling of high-risk features during
command execution.

---

## CLI Preflight Banner

When the CLI is executed, it displays a preflight banner showing the current
configuration and feature flag states. This ensures users are aware of the
active settings before any command runs.

### Example Output

```
Yellow Plugins CLI v1.1.0
Plugin marketplace for Claude Code

Configuration:
  Plugin directory: .claude-plugin
  Install directory: .claude/plugins
  Max cache size: 500 MB
  Telemetry: disabled

Feature Flags:
  ✗ Browse marketplace: disabled
  ✗ Publish plugins: disabled
  ✗ Rollback versions: disabled
  ✗ Variant switching: disabled
  ✗ Lifecycle hooks: disabled
  ✓ Compatibility checks: enabled
  ✗ CI validation: disabled
```

### Debug Mode

For troubleshooting precedence issues, enable debug mode to see the source of
each configuration value:

```bash
# Future implementation - not yet available
yellow-plugins --debug
```

This will display:

```
Yellow Plugins CLI v1.1.0 - DEBUG MODE
Plugin marketplace for Claude Code

Configuration (with sources):
  pluginDir: .claude-plugin [DEFAULT]
  installDir: .claude/plugins [FILE]
  maxCacheSizeMb: 1000 [ENV]
  telemetryEnabled: true [CLI]
  lifecycleTimeoutMs: 30000 [DEFAULT]

Feature Flags (with sources):
  enableBrowse: true [ENV]
  enablePublish: false [DEFAULT]
  ...
```

---

## Governance and Best Practices

### Flag Lifecycle

1. **New Feature Development**: All new features MUST be implemented behind a
   feature flag, defaulting to `false`.
2. **ADR Requirement**: Before enabling a flag in production, a corresponding
   Architecture Decision Record (ADR) must exist documenting the feature's
   design and risk assessment.
3. **Semantic Versioning**: Flag states may be tied to semantic version tags
   (e.g., enable `enableBrowse` in v1.2.0+).
4. **Preflight Evaluation**: Flags are evaluated during command preflight, not
   at runtime, so downstream services never need to branch on flag state.

### Safety-Critical Flags

The `enableCompatibilityChecks` flag defaults to `true` because it is
safety-critical. Disabling it could lead to incompatible plugin installations.
Only disable this flag for testing or when explicitly overriding compatibility
enforcement.

### Configuration Validation

- **Schema Validation**: All `.claude-plugin/{config,flags}.json` files SHOULD
  reference their JSON schemas for IDE validation.
- **Type Safety**: The TypeScript `Config` and `FeatureFlags` interfaces in
  `@yellow-plugins/domain` provide compile-time type checking.
- **Runtime Validation**: Future iterations may add JSON Schema validation at
  runtime (see I1.T1 for schema harnesses).

---

## Testing

### Unit Tests

The configuration provider includes comprehensive unit tests simulating all
precedence scenarios:

```bash
# Run config provider tests
pnpm test packages/infrastructure/src/config/configProvider.test.ts

# Run CLI bootstrap tests
pnpm test packages/cli/src/bootstrap/flags.test.ts
```

### Manual Testing

To manually verify precedence:

1. Create `.claude-plugin/config.json` with custom values
2. Set environment variables with different values
3. Pass CLI flags (when implemented) with different values
4. Run the CLI and verify the preflight banner shows the correct resolved values

---

## Troubleshooting

### Config Not Loading

**Problem**: Configuration values are not being read from
`.claude-plugin/config.json`

**Solutions**:

- Verify the file exists in the workspace root (not a subdirectory)
- Check file permissions (must be readable)
- Validate JSON syntax (use `jq` or an IDE with JSON validation)
- Check for BOM or encoding issues (file must be UTF-8)

### Environment Variables Not Working

**Problem**: Environment variables are not overriding file values

**Solutions**:

- Verify variable names follow the `YELLOW_PLUGINS_{KEY}` pattern
- Ensure keys are in SCREAMING_SNAKE_CASE (e.g., `MAX_CACHE_SIZE_MB`)
- Check that variables are exported in the current shell session
- Restart the terminal/shell if variables were set in a different session

### Precedence Confusion

**Problem**: Unsure which source is providing a value

**Solutions**:

- Use the debug banner (when implemented) to see source metadata
- Check the `getConfigMetadata()` and `getFlagMetadata()` APIs in code
- Remember the order: CLI > ENV > FILE > DEFAULT

---

## API Reference

### ConfigProvider Class

```typescript
import { ConfigProvider } from '@yellow-plugins/infrastructure';

const provider = new ConfigProvider({
  workspaceRoot: '/path/to/workspace',
  cliFlags: { pluginDir: 'custom-dir' },
  env: process.env,
});

const config = provider.getConfig();
const flags = provider.getFeatureFlags();

// Get metadata about sources
const metadata = provider.getConfigMetadata('pluginDir');
console.log(metadata.source); // 'cli' | 'env' | 'file' | 'default'
```

### Global Provider Singleton

```typescript
import {
  getConfigProvider,
  resetConfigProvider,
} from '@yellow-plugins/infrastructure';

// Get or create the global instance
const provider = getConfigProvider();

// Reset the global instance (useful for testing)
resetConfigProvider();
```

---

## Related Documents

- **Schema**: `schemas/config.schema.json`, `schemas/flags.schema.json` (to be
  implemented in future tasks)
- **ADRs**: Future ADRs will document decisions to enable specific feature flags

---

## Requirements Traceability

This feature-flag system satisfies the following requirements:

- **FR-012**: Configuration Management - Typed accessors with precedence rules
- **NFR-005**: Feature Flags - Config-driven flags with documented ownership
- **NFR-015**: Architecture Compliance - Clean separation of
  domain/infrastructure layers

All flags reference their associated functional requirements (FR-XXX) in the
table above.
