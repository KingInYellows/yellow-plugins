# Uninstall Command

**Command**: `uninstall`
**Aliases**: `rm`, `remove`
**Description**: Uninstall a plugin with lifecycle hook execution and cache management

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
  - [Basic Uninstall](#basic-uninstall)
  - [Uninstall with Cache Retention](#uninstall-with-cache-retention)
  - [Force Uninstall (Skip Confirmation)](#force-uninstall-skip-confirmation)
  - [Skip Lifecycle Scripts](#skip-lifecycle-scripts)
  - [Dry Run](#dry-run)
  - [JSON Output](#json-output)
  - [Non-Interactive Mode](#non-interactive-mode)
- [Lifecycle Hooks](#lifecycle-hooks)
  - [Hook Execution Order](#hook-execution-order)
  - [Script Detection](#script-detection)
  - [Script Permissions & Security](#script-permissions--security)
  - [Consent Flow](#consent-flow)
- [Cache Management](#cache-management)
  - [Default Behavior (Clear Cache)](#default-behavior-clear-cache)
  - [Retain Cache (`--keep-cache`)](#retain-cache---keep-cache)
  - [Manual Cache Cleanup](#manual-cache-cleanup)
  - [Cache Retention Policy](#cache-retention-policy)
- [Audit Logging](#audit-logging)
  - [Audit Log Location](#audit-log-location)
  - [Audit Log Contents](#audit-log-contents)
  - [Viewing Audit Logs](#viewing-audit-logs)
  - [Audit Log Retention](#audit-log-retention)
- [Uninstall Recovery](#uninstall-recovery)
  - [Reinstalling After Uninstall](#reinstalling-after-uninstall)
  - [Recovering from Failed Uninstall](#recovering-from-failed-uninstall)
  - [Manual Cleanup Guide](#manual-cleanup-guide)
- [Feature Flags](#feature-flags)
- [Error Codes](#error-codes)
- [Specification References](#specification-references)
- [Accessibility Notes](#accessibility-notes)
- [See Also](#see-also)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## Usage

```bash
plugin uninstall <plugin-id> [options]
```

Remove an installed plugin from the system, with support for lifecycle scripts, cache retention, and audit logging.

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `<plugin-id>` | string | **required** | Plugin identifier to uninstall |
| `--force` | boolean | `false` | Skip confirmation prompts |
| `--keep-cache` | boolean | `false` | Retain cached versions for rollback |
| `--skip-lifecycle` | boolean | `false` | Skip lifecycle scripts (preUninstall, uninstall, postUninstall) |
| `--dry-run` | boolean | `false` | Simulate uninstall without making changes |
| `--json` | boolean | `false` | Output results in JSON format |
| `--non-interactive` | boolean | `false` | No prompts; read from environment/flags |

---

## Examples

### Basic Uninstall

Uninstall a plugin with confirmation:

```bash
plugin uninstall example-plugin
```

**Output**:
```
⠋ Loading plugin metadata for example-plugin...
✔ Found example-plugin@1.2.3 (installed)

┌─ Uninstall Summary ──────────────────────────────────────────────┐
│                                                                   │
│  Plugin: example-plugin                                           │
│  Version: 1.2.3                                                   │
│  Installed: 15 days ago                                           │
│  Size: 4.5 MB                                                     │
│                                                                   │
│  Actions:                                                         │
│    ✔ Run preUninstall lifecycle script                           │
│    ✔ Remove plugin files                                         │
│    ✔ Remove symlink                                              │
│    ✔ Update registry                                             │
│    ✔ Clear cached versions (2 versions, 9 MB total)             │
│    ✔ Run postUninstall cleanup                                   │
│                                                                   │
│  ⚠ This action cannot be undone without reinstalling.            │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

Type 'uninstall' to confirm, 'cancel' to abort:uninstall

⠋ Running preUninstall script...
  Backing up user settings...
  Cleaning up temporary files...
✔ preUninstall completed (1.2s)

⠋ Removing plugin files...
  Removing .claude-plugin/plugins/example-plugin
✔ Plugin files removed (0.3s)

⠋ Updating registry...
✔ Registry updated (0.1s)

⠋ Clearing cached versions...
  Removing .claude-plugin/cache/example-plugin-1.2.3
  Removing .claude-plugin/cache/example-plugin-1.1.0
✔ Cleared 9 MB cache (0.5s)

⠋ Running postUninstall script...
  Finalizing cleanup...
✔ postUninstall completed (0.8s)

✔ Successfully uninstalled example-plugin@1.2.3 (Transaction txn-789)

Audit logged to: .claude-plugin/audit/uninstall-20260112-110530.json

To reinstall: plugin install example-plugin
```

### Uninstall with Cache Retention

Keep cached versions for potential rollback:

```bash
plugin uninstall example-plugin --keep-cache
```

**Output**:
```
...

⠋ Updating cache retention policy...
  Retaining .claude-plugin/cache/example-plugin-* (2 versions, 9 MB)
✔ Cache retained (0.1s)

✔ Successfully uninstalled example-plugin@1.2.3

ℹ Cached versions retained for potential rollback:
  • example-plugin@1.2.3 (4.5 MB)
  • example-plugin@1.1.0 (4.5 MB)

To remove cache: plugin cache clean example-plugin
To reinstall: plugin install example-plugin
```

### Force Uninstall (Skip Confirmation)

Bypass confirmation prompts:

```bash
plugin uninstall example-plugin --force
```

**Output**:
```
ℹ Force mode: skipping confirmation prompts

⠋ Uninstalling example-plugin@1.2.3...
✔ Successfully uninstalled example-plugin@1.2.3 (3.1s)
```

**Warning**: Use `--force` with caution. Lifecycle scripts still run unless `--skip-lifecycle` also specified.

### Skip Lifecycle Scripts

Uninstall without running lifecycle hooks:

```bash
plugin uninstall example-plugin --skip-lifecycle
```

**Output**:
```
⚠ Skipping lifecycle scripts (--skip-lifecycle flag)

Lifecycle scripts that will NOT run:
  • preUninstall: Backup and preparation
  • uninstall: Custom uninstallation logic
  • postUninstall: Cleanup and finalization

This may leave residual files or configurations.

Continue without lifecycle scripts? [yes/no]:yes

⠋ Removing plugin files...
✔ Plugin files removed

⠋ Updating registry...
✔ Registry updated

✔ Successfully uninstalled example-plugin@1.2.3 (0.8s)

⚠ Note: Manual cleanup may be required for:
  • User-specific configuration files
  • Temporary data directories
  • Integration settings
```

### Dry Run

Simulate uninstall without making changes:

```bash
plugin uninstall example-plugin --dry-run
```

**Output**:
```
⠋ Dry run: Simulating uninstall (no changes will be made)

┌─ Simulated Uninstall Actions ────────────────────────────────────┐
│                                                                   │
│  Would execute:                                                   │
│    ✔ Run preUninstall script                                     │
│    ✔ Remove 147 files (4.5 MB)                                   │
│    ✔ Remove symlink: .claude-plugin/plugins/example-plugin       │
│    ✔ Update registry (remove 1 entry)                            │
│    ✔ Clear 2 cached versions (9 MB)                              │
│    ✔ Run postUninstall script                                    │
│                                                                   │
│  Audit log entry would be created:                               │
│    uninstall-20260112-110530.json                                │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

No changes made (dry run).
Run without --dry-run to execute uninstall.
```

### JSON Output

Get machine-readable output:

```bash
plugin uninstall example-plugin --force --json
```

**Output**:
```json
{
  "success": true,
  "status": "success",
  "message": "Successfully uninstalled example-plugin@1.2.3",
  "transactionId": "txn-20260112-110530",
  "timestamp": "2026-01-12T11:05:30.456Z",
  "data": {
    "pluginId": "example-plugin",
    "version": "1.2.3",
    "filesRemoved": 147,
    "bytesFreed": 4718592,
    "cacheCleared": true,
    "cachedVersionsRemoved": 2,
    "cacheBytesFreed": 9437184,
    "lifecycleScripts": [
      {
        "scriptType": "preUninstall",
        "exitCode": 0,
        "durationMs": 1234
      },
      {
        "scriptType": "postUninstall",
        "exitCode": 0,
        "durationMs": 876
      }
    ],
    "registryDelta": {
      "removed": ["example-plugin"]
    },
    "auditLogPath": ".claude-plugin/audit/uninstall-20260112-110530.json"
  },
  "telemetry": {
    "durationMs": 3145,
    "lifecycleScriptsRun": 2,
    "registryMutations": 1
  }
}
```

### Non-Interactive Mode

For CI/CD automation:

```bash
UNINSTALL_CONFIRM=yes \
SKIP_LIFECYCLE=no \
plugin uninstall example-plugin --non-interactive
```

**Environment Variables**:

| Variable | Type | Description |
|----------|------|-------------|
| `UNINSTALL_CONFIRM` | `yes`\|`no` | Confirm uninstall action |
| `SKIP_LIFECYCLE` | `yes`\|`no` | Skip lifecycle scripts |
| `KEEP_CACHE` | `yes`\|`no` | Retain cached versions |

---

## Lifecycle Hooks

<!-- anchor: lifecycle-hooks -->

The `uninstall` command executes up to three lifecycle scripts during the uninstall process:

### Hook Execution Order

1. **preUninstall**: Runs before any file removal
   * **Purpose**: Backup user data, prepare for uninstallation
   * **Working Directory**: Current plugin directory
   * **Failure Behavior**: Aborts uninstall; prompts for `--skip-lifecycle`

2. **uninstall**: Runs during file removal
   * **Purpose**: Custom uninstallation logic (e.g., database cleanup)
   * **Working Directory**: Current plugin directory
   * **Failure Behavior**: Warns but continues; logs failure

3. **postUninstall**: Runs after file removal
   * **Purpose**: Final cleanup, remove integration hooks
   * **Working Directory**: Plugin cache directory (if `--keep-cache`)
   * **Failure Behavior**: Warns; uninstall considered successful

### Script Detection

Lifecycle scripts defined in plugin manifest (`plugin.yaml`):

```yaml
name: example-plugin
version: 1.2.3
lifecycle:
  preUninstall: scripts/pre-uninstall.sh
  uninstall: scripts/uninstall.sh
  postUninstall: scripts/post-uninstall.sh
```

### Script Permissions & Security

* **Explicit Consent**: On first uninstall, user must review and consent to script execution
* **Script Digest**: Scripts identified by SHA-256 hash for integrity verification
* **Audit Logging**: All script executions logged with exit codes and duration
* **Timeout**: Scripts terminated after 120 seconds

### Consent Flow

```
⚠ Lifecycle scripts detected

The plugin 'example-plugin' defines uninstall scripts:
  • preUninstall: scripts/pre-uninstall.sh
    Purpose: Backup user settings and temporary files
    Digest: sha256:abc123...

Review script:
  cat .claude-plugin/plugins/example-plugin/scripts/pre-uninstall.sh

To proceed, type exactly: I TRUST THIS SCRIPT
>
```

**Specification Reference**: [CRIT-004](../SPECIFICATION.md#crit-004), [CRIT-010](../SPECIFICATION.md#crit-010)

---

## Cache Management

<!-- anchor: cache-management -->

The `uninstall` command can clear or retain cached plugin versions.

### Default Behavior (Clear Cache)

By default, uninstall removes all cached versions:

```
⠋ Clearing cached versions...
  Removing .claude-plugin/cache/example-plugin-1.2.3 (4.5 MB)
  Removing .claude-plugin/cache/example-plugin-1.1.0 (4.5 MB)
✔ Cleared 9 MB cache
```

This frees disk space but prevents rollback to previous versions.

### Retain Cache (`--keep-cache`)

Preserve cached versions for potential reinstallation or rollback:

```bash
plugin uninstall example-plugin --keep-cache
```

**Benefits**:
* **Fast Reinstall**: No network download required
* **Rollback Capability**: Can install specific previous versions
* **Offline Access**: Works without internet connection

**Trade-offs**:
* **Disk Usage**: Cached versions consume space
* **Cache Staleness**: Old versions may accumulate

### Manual Cache Cleanup

Remove cached versions after uninstall:

```bash
# Remove all cached versions of a plugin
plugin cache clean example-plugin

# Remove specific version
plugin cache clean example-plugin --version 1.2.3

# Remove all stale cache (uninstalled plugins)
plugin cache clean --stale
```

### Cache Retention Policy

After uninstall with `--keep-cache`:

* **Retention Period**: Indefinite (until manual cleanup or cache eviction)
* **Cache Limit**: Subject to global cache size limit (default: 500 MB)
* **Eviction**: Oldest uninstalled plugins evicted first when cache full

**Specification Reference**: [Iteration 3 Exit Criteria](../plan/02_Iteration_I3.md#iteration-3-validation), [Uninstall Cache Retention](../operations/uninstall.md)

---

## Audit Logging

<!-- anchor: audit-logging -->

Every uninstall operation is logged for traceability and compliance.

### Audit Log Location

`.claude-plugin/audit/uninstall-<timestamp>.json`

Example: `.claude-plugin/audit/uninstall-20260112-110530.json`

### Audit Log Contents

```json
{
  "event": "plugin.uninstalled",
  "timestamp": "2026-01-12T11:05:30.456Z",
  "transactionId": "txn-20260112-110530",
  "correlationId": "req-cli-uninstall-001",
  "pluginId": "example-plugin",
  "version": "1.2.3",
  "user": {
    "username": "developer",
    "sessionId": "sess-12345"
  },
  "actions": {
    "lifecycleScriptsRun": [
      {
        "scriptType": "preUninstall",
        "scriptPath": "scripts/pre-uninstall.sh",
        "digest": "sha256:abc123...",
        "exitCode": 0,
        "durationMs": 1234,
        "output": "Backup completed successfully"
      },
      {
        "scriptType": "postUninstall",
        "scriptPath": "scripts/post-uninstall.sh",
        "digest": "sha256:def456...",
        "exitCode": 0,
        "durationMs": 876,
        "output": "Cleanup finalized"
      }
    ],
    "filesRemoved": 147,
    "bytesFreed": 4718592,
    "symlinksRemoved": ["/.claude-plugin/plugins/example-plugin"],
    "registryEntriesRemoved": ["example-plugin"],
    "cacheCleared": true,
    "cachedVersionsRemoved": ["1.2.3", "1.1.0"],
    "cacheBytesFreed": 9437184
  },
  "options": {
    "force": false,
    "keepCache": false,
    "skipLifecycle": false,
    "dryRun": false
  },
  "telemetry": {
    "totalDurationMs": 3145,
    "networkRequests": 0,
    "cacheHits": 0
  },
  "consent": {
    "lifecycleScriptsConsented": true,
    "consentTimestamp": "2026-01-12T11:05:15.123Z",
    "consentMethod": "typed-phrase"
  }
}
```

### Viewing Audit Logs

```bash
# View recent uninstall logs
plugin audit uninstall --limit 10

# View logs for specific plugin
plugin audit uninstall --plugin example-plugin

# Export audit logs
plugin audit export --format json --output audit-report.json
```

### Audit Log Retention

* **Retention Period**: 90 days (configurable)
* **Rotation**: Old logs archived after 90 days
* **Privacy**: PII redacted according to privacy policy

**Specification Reference**: [CRIT-010](../SPECIFICATION.md#crit-010), [Section 4 Security & Observability](../architecture/04_Operational_Architecture.md)

---

## Uninstall Recovery

<!-- anchor: uninstall-recovery -->

### Reinstalling After Uninstall

To reinstall a plugin after uninstall:

```bash
# Reinstall latest version
plugin install example-plugin

# Reinstall specific version
plugin install example-plugin --version 1.2.3
```

If cache was retained (`--keep-cache`), reinstall is faster (no download).

### Recovering from Failed Uninstall

If uninstall fails mid-process:

```
✖ Uninstall failed (ERR-UNINSTALL-003)

Lifecycle script 'preUninstall' failed with exit code 1.
Plugin may be in inconsistent state.

Recovery options:
  1. Retry with --skip-lifecycle: plugin uninstall example-plugin --skip-lifecycle
  2. Force removal: plugin uninstall example-plugin --force --skip-lifecycle
  3. Manual cleanup: rm -rf .claude-plugin/plugins/example-plugin

See: https://yellow-plugins.dev/docs/errors#err-uninstall-003
```

### Manual Cleanup Guide

If automated uninstall fails, manual cleanup steps:

1. **Remove plugin directory**:
   ```bash
   rm -rf .claude-plugin/plugins/example-plugin
   ```

2. **Remove symlink**:
   ```bash
   rm -f .claude-plugin/plugins/example-plugin
   ```

3. **Update registry manually**:
   ```bash
   plugin registry remove example-plugin
   ```

4. **Clear cache** (optional):
   ```bash
   plugin cache clean example-plugin
   ```

5. **Verify cleanup**:
   ```bash
   plugin list  # Should not show example-plugin
   ```

**Specification Reference**: [Uninstall Runbook](../operations/uninstall.md), [Iteration 3 Readiness Review](../plan/02_Iteration_I3.md#iteration-3-validation)

---

## Feature Flags

<!-- anchor: feature-flags -->

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `enableUninstall` | boolean | `true` | Enable uninstall functionality |
| `requireUninstallConsent` | boolean | `true` | Require typed confirmation for uninstall |
| `lifecycleScriptConsent` | boolean | `true` | Require consent for lifecycle scripts |
| `auditUninstall` | boolean | `true` | Log uninstall operations to audit log |

Configure in `.claude-plugin/flags.json`:

```json
{
  "enableUninstall": true,
  "requireUninstallConsent": true,
  "lifecycleScriptConsent": true,
  "auditUninstall": true
}
```

**Specification Reference**: [Feature Flag Governance](../operations/feature-flags.md), [CRIT-004](../SPECIFICATION.md#crit-004)

---

## Error Codes

<!-- anchor: error-codes -->

| Code | Severity | Description | Resolution |
|------|----------|-------------|------------|
| `ERR-UNINSTALL-001` | ERROR | Plugin not installed | Verify plugin ID: `plugin list` |
| `ERR-UNINSTALL-002` | ERROR | Plugin not found in registry | Registry may be corrupted; run `plugin registry repair` |
| `ERR-UNINSTALL-003` | ERROR | Lifecycle script failed | Review script output; retry with `--skip-lifecycle` |
| `ERR-UNINSTALL-004` | ERROR | Permission denied removing files | Run with elevated permissions or check file ownership |
| `ERR-UNINSTALL-005` | ERROR | Registry update failed | Transaction rolled back; check registry lock |
| `ERR-UNINSTALL-006` | WARNING | Cache cleanup failed | Uninstall succeeded; manually clean cache |
| `ERR-UNINSTALL-007` | ERROR | Audit log write failed | Uninstall succeeded but not logged; check audit directory permissions |

**Example Error Output**:

```
✖ Lifecycle script failed (ERR-UNINSTALL-003)

preUninstall script exited with code 1:

  Error: Cannot backup settings directory (permission denied)
  Path: /home/user/.config/example-plugin

Script output:
  Attempting backup of settings...
  mkdir: cannot create directory '/backup': Permission denied

Resolution:
  1. Fix permissions: chmod +w /home/user/.config/example-plugin
  2. Skip lifecycle: plugin uninstall example-plugin --skip-lifecycle
  3. Force removal: plugin uninstall example-plugin --force --skip-lifecycle

Warning: Skipping lifecycle scripts may leave residual files.

See: https://yellow-plugins.dev/docs/errors#err-uninstall-003
```

**Cross-Reference**: [Error Codes Reference](../errors.md), [CRIT-007](../SPECIFICATION.md#crit-007)

---

## Specification References

<!-- anchor: spec-references -->

This command implements the following specification requirements:

* **[FR-004](../SPECIFICATION.md#fr-004)**: Uninstall plugins with lifecycle hook execution
* **[CRIT-004](../SPECIFICATION.md#crit-004)**: Lifecycle script consent and security
* **[CRIT-010](../SPECIFICATION.md#crit-010)**: Audit logging and observability
* **[3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)**: CLI interaction patterns
* **[6-2-input-patterns](../architecture/06_UI_UX_Architecture.md#6-2-input-patterns)**: Typed phrase confirmation
* **[Iteration 3 Exit Criteria](../plan/02_Iteration_I3.md#iteration-3-validation)**: Uninstall lifecycle consent and telemetry

---

## Accessibility Notes

<!-- anchor: accessibility -->

* **Screen Readers**: Progress messages include textual step descriptions
* **Color Independence**: Status indicators (`✔ ✖ ⚠ ℹ`) paired with textual prefixes
* **ANSI Fallback**: Text degrades to `[OK]/[WARN]/[ERR]` prefixes with monochrome safety per [UI Style Guide §3](../ui/style-guide.md#3-ansi-fallback)
* **Keyboard Navigation**: Fully keyboard-accessible; no mouse required
* **Non-Interactive Mode**: Use `--non-interactive` for automation without prompts
* **Typed Confirmation**: Prevents accidental uninstalls; accommodates deliberate user input
* **Contrast**: All color combinations meet WCAG 2.1 AA standards (see [UI Style Guide](../ui/style-guide.md#1-6-accessibility-design-system))

---

## See Also

* [`install`](./install.md) - Install plugins
* [`rollback`](./rollback.md) - Rollback to previous versions
* [`cache`](./cache.md) - Manage plugin cache
* [`audit`](./audit.md) - View audit logs
* [CLI Contracts - Uninstall](../contracts/cli-contracts.md#uninstall-contract)
* [Uninstall Operations Guide](../operations/uninstall.md)
* [UI Style Guide](../ui/style-guide.md)

---

**Last Updated**: 2026-01-12
**Version**: 1.0.0
**Maintained by**: Claude Code Plugin Marketplace Team
