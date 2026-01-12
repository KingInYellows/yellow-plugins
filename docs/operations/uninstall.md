# Uninstall Operations Guide

**Document Version**: 1.0.0
**Last Updated**: 2026-01-12
**Task Reference**: I3.T4 - Enhanced Uninstall Experience
**Specification Reference**: FR-010, FR-013, CRIT-004, CRIT-011, Section 6.3

---

## Overview

This guide covers plugin uninstallation operations in the Claude Code Plugin Marketplace, including lifecycle hook execution, cache retention policies, atomic symlink removal, and error recovery procedures.

### Key Features

- **Lifecycle Hooks**: Executes uninstall scripts with user consent
- **Cache Retention**: Configurable policies for keeping or purging cached versions
- **Atomic Operations**: Symlink removal and registry updates are atomic
- **Telemetry**: Full observability with transaction tracking
- **Error Recovery**: Detailed error codes with resolution guidance

---

## Basic Usage

### Simple Uninstall

Uninstall a plugin while keeping the last 3 cached versions (default behavior):

```bash
plugin uninstall <plugin-id>
```

**Example:**
```bash
plugin uninstall git-helper
```

This will:
1. Validate the plugin is installed
2. Display lifecycle uninstall scripts (if present)
3. Prompt for confirmation
4. Execute uninstall hooks in sandboxed environment
5. Remove symlink activation
6. Update registry atomically
7. Keep last 3 cached versions for potential rollback
8. Emit telemetry and create audit log

---

## Cache Retention Policies

### Policy Types

| Policy | Flag | Description | Use Case |
|--------|------|-------------|----------|
| `keep-last-n` | (default) | Keep N most recent cached versions | Balanced cleanup with rollback safety |
| `keep-all` | `--keep-cache` | Preserve all cached versions | Maximum rollback flexibility |
| `purge-all` | `--purge-cache` | Remove all cached versions | Free up maximum disk space |

### Keep Last N Versions (Default)

```bash
plugin uninstall <plugin-id>
# Keeps last 3 versions by default

plugin uninstall <plugin-id> --keep-last-n=5
# Keep last 5 versions
```

**When to use:**
- Standard uninstall scenario
- Want to free up some space while maintaining rollback capability
- Balancing disk usage with safety

**Result:**
- Registry entry removed
- Symlink removed
- Oldest cached versions purged (beyond N)
- Newest N versions retained
- Can reinstall/rollback to retained versions

### Keep All Cached Versions

```bash
plugin uninstall <plugin-id> --keep-cache
```

**When to use:**
- Temporary removal (planning to reinstall soon)
- Want maximum rollback flexibility
- Disk space is not a concern
- Preserving all versions for forensics/debugging

**Result:**
- Registry entry removed
- Symlink removed
- All cached versions retained
- Fastest uninstall (no cache cleanup)
- Can reinstall any previously cached version instantly

### Purge All Cached Versions

```bash
plugin uninstall <plugin-id> --purge-cache
```

**When to use:**
- Permanent removal with no intent to reinstall
- Need to free maximum disk space
- Security concern (remove all traces)
- Corrupted cache requiring full cleanup

**Result:**
- Registry entry removed
- Symlink removed
- All cached versions deleted
- Maximum disk space freed
- Cannot rollback (must re-download if reinstalling)

---

## Lifecycle Hooks

### Uninstall Scripts

Plugins may declare lifecycle uninstall scripts in their manifest:

```json
{
  "lifecycle": {
    "uninstall": "scripts/uninstall.sh"
  }
}
```

### Script Execution Flow

1. **Discovery**: CLI loads uninstall script from cached plugin directory
2. **Display**: Script contents displayed to user with syntax highlighting
3. **Consent**: User must explicitly confirm script execution
4. **Sandbox**: Script executes in sandboxed environment with limited permissions
5. **Capture**: Exit code, stdout, stderr captured for audit log
6. **Continue**: Uninstall continues even if script fails (non-blocking)

### Script Review Example

```bash
plugin uninstall database-connector

# Output:
┌─────────────────────────────────────────────────────────────┐
│ Lifecycle Uninstall Script                                  │
├─────────────────────────────────────────────────────────────┤
│ Plugin: database-connector                                  │
│ Script: scripts/uninstall.sh                                │
│ SHA-256: a3f5b9c2e1d4f7a8b6c3e9f1d2a4b5c6d7e8f9a0b1c2d3e4  │
├─────────────────────────────────────────────────────────────┤
│ #!/bin/bash                                                 │
│ echo "Removing database connection configs..."             │
│ rm -f ~/.db-connector/config.json                          │
│ echo "Cleanup complete"                                     │
└─────────────────────────────────────────────────────────────┘

This script will:
- Remove database connection configuration files
- Clean up user-level settings

Permissions required: filesystem (write ~/.db-connector)

Do you consent to running this script? (yes/no): yes
```

### Force Mode (Skip Consent)

```bash
plugin uninstall <plugin-id> --force
```

**Warning:** Use with caution. Skips:
- Lifecycle script review
- Confirmation prompts
- Interactive consent checks

**When to use:**
- Automation/CI scripts
- Known-safe plugins
- Batch uninstall operations
- Broken installation requiring force removal

### Lifecycle Consent Workflow

1. CLI reads uninstall script from cache, computes SHA-256 digest, and displays a preview.
2. User must type `yes` to consent; digest is passed to the domain service as `scriptReviewDigest`.
3. If script changes, uninstall aborts with `ERROR-INST-008` (see `docs/contracts/error-codes.md#ERROR-INST-008`).
4. `--force` bypasses the prompt but should only be used when scripts have already been reviewed in automation.

**Tip:** Consent prompts satisfy CRIT-004 requirements and provide traceability across audit logs.

---

## Atomic Operations

### Symlink Removal

Uninstall removes the activation symlink atomically to prevent broken states:

```
Before:
  ~/.config/claude-code/plugins/<plugin-id> -> <cache-path>

After:
  (symlink removed)
```

**Guarantees:**
- No partial symlink states
- No dangling references
- Registry and filesystem stay in sync

### Registry Updates

Registry modifications use atomic temp-rename pattern:

1. Load current registry: `installed.json`
2. Write updated registry: `installed.json.tmp`
3. Atomic rename: `installed.json.tmp` → `installed.json`
4. Backup previous: `installed.json.backup`

**Benefits:**
- Crash-safe updates
- Rollback capability
- No corruption on failure

---

## Error Scenarios and Resolution

### ERR-UNINSTALL-001: Plugin Not Installed

**Cause:** Attempting to uninstall a plugin that is not in the registry.

**Resolution:**
```bash
# Verify installed plugins
plugin list

# Check if plugin was already uninstalled
plugin info <plugin-id>
```

**Related Error Codes:**
- See `docs/contracts/error-codes.md` - ERROR-INST-001

---

### ERR-UNINSTALL-002: Registry Update Failed

**Cause:** Failed to remove plugin entry from registry (file permissions, corruption, disk full).

**Resolution:**

1. **Check disk space:**
   ```bash
   df -h ~/.config/claude-code
   ```

2. **Check file permissions:**
   ```bash
   ls -la ~/.config/claude-code/registry/installed.json
   chmod 644 ~/.config/claude-code/registry/installed.json
   ```

3. **Validate registry:**
   ```bash
   plugin validate-registry
   ```

4. **Restore from backup (if corrupted):**
   ```bash
   cp ~/.config/claude-code/registry/installed.json.backup \
      ~/.config/claude-code/registry/installed.json
   ```

**Related Error Codes:**
- See `docs/contracts/error-codes.md` - FR-010

---

### CRIT-011: Lifecycle Script Failure

**Cause:** Uninstall script exited with non-zero code.

**Behavior:**
- Uninstall continues (non-blocking)
- Failure logged to audit trail
- Warning displayed to user

**Resolution:**

1. **Review audit log:**
   ```bash
   cat .claude-plugin/audit/uninstall-<transaction-id>.json
   ```

2. **Check script output:**
   ```json
   {
     "lifecycle": {
       "uninstall": {
         "exitCode": 1,
         "stderr": "Error: Missing cleanup dependency"
       }
     }
   }
   ```

3. **Manual cleanup (if needed):**
   - Review plugin documentation for manual cleanup steps
   - Check for leftover configuration files
   - Verify permissions issues

4. **Report to plugin maintainer:**
   - Include transaction ID
   - Attach audit log
   - Describe environment (OS, permissions)

**Related Error Codes:**
- `docs/contracts/error-codes.md#ERROR-INST-006`
- `docs/contracts/error-codes.md#ERROR-INST-008`

---

### FR-010: Cache Purge Errors

**Cause:** Failed to remove cached artifacts (permissions, disk I/O errors).

**Behavior:**
- Registry update succeeds (plugin considered uninstalled)
- Cache cleanup partially fails
- Orphaned cache directories may remain

**Resolution:**

1. **Manual cache cleanup:**
   ```bash
   rm -rf ~/.config/claude-code/cache/<plugin-id>
   ```

2. **Rebuild cache index:**
   ```bash
   plugin cache rebuild-index
   ```

3. **Run cache validation:**
   ```bash
   plugin cache validate
   ```

4. **Run orphan cleanup:**
   ```bash
   plugin cache cleanup-orphans
   ```

**Prevention:**
- Ensure sufficient permissions: `chmod -R u+w ~/.config/claude-code/cache`
- Monitor disk space before uninstall
- Run periodic cache validation

**Related Error Codes:**
- `docs/contracts/error-codes.md#ERROR-INST-009`

---

## Advanced Usage

### Dry-Run Mode

Preview uninstall without making changes:

```bash
plugin uninstall <plugin-id> --dry-run
```

**Output:**
- Transaction plan
- Files to be removed
- Cache retention simulation
- Lifecycle scripts that would execute
- No actual modifications

### Batch Uninstall

```bash
# Uninstall multiple plugins
for plugin in plugin-a plugin-b plugin-c; do
  plugin uninstall "$plugin" --force --keep-cache
done
```

### Uninstall with Custom Retention

```bash
# Keep last 10 versions
plugin uninstall <plugin-id> --keep-last-n=10

# Keep only last 1 version (minimal rollback)
plugin uninstall <plugin-id> --keep-last-n=1
```

---

## Telemetry and Audit

### Transaction Logs

Every uninstall generates a transaction log in `.claude-plugin/audit/`:

**File:** `.claude-plugin/audit/uninstall-<transaction-id>.json`

**Contents:**
```json
{
  "transactionId": "tx-uninstall-1736704200000-abc123",
  "operation": "uninstall",
  "pluginId": "example-plugin",
  "timestamp": "2026-01-12T10:30:00.000Z",
  "durationMs": 142,
  "success": true,
  "steps": [
    {
      "phase": "VALIDATE",
      "status": "success",
      "durationMs": 5
    },
    {
      "phase": "LIFECYCLE",
      "status": "success",
      "durationMs": 85,
      "details": {
        "scriptPath": "scripts/uninstall.sh",
        "exitCode": 0,
        "consented": true
      }
    },
    {
      "phase": "DEACTIVATE",
      "status": "success",
      "durationMs": 8
    },
    {
      "phase": "REGISTRY_UPDATE",
      "status": "success",
      "durationMs": 12
    },
    {
      "phase": "CACHE_CLEANUP",
      "status": "success",
      "durationMs": 30,
      "details": {
        "policy": "keep-last-n",
        "versionsRemoved": 2,
        "versionsRetained": 3,
        "freedMb": 12.4
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
    "removed": ["example-plugin"]
  }
}
```

### Telemetry Events

Uninstall operations emit structured telemetry:

**Event:** `plugin.uninstall.completed`

**Metadata:**
- Transaction ID
- Plugin ID
- Duration
- Cache retention policy
- Lifecycle script execution status
- Error codes (if failed)

See `.claude-plugin/telemetry/` for event logs.

---

## Best Practices

### Pre-Uninstall Checklist

1. **Verify plugin identity:**
   ```bash
   plugin info <plugin-id>
   ```

2. **Check dependencies (manual):**
   - Review if other plugins depend on this one
   - Consult plugin documentation

3. **Decide on cache retention:**
   - Default: Keep last 3 (balanced)
   - Temporary removal: Use `--keep-cache`
   - Permanent: Use `--purge-cache`

4. **Backup critical data (if plugin stores data):**
   - Export configurations
   - Save generated artifacts
   - Document custom settings

### Post-Uninstall Verification

1. **Confirm removal:**
   ```bash
   plugin list | grep <plugin-id>
   # (should return nothing)
   ```

2. **Check symlink removed:**
   ```bash
   ls -la ~/.config/claude-code/plugins/<plugin-id>
   # (should not exist)
   ```

3. **Verify cache state:**
   ```bash
   plugin cache list <plugin-id>
   # (shows retained versions based on policy)
   ```

4. **Review audit log:**
   ```bash
   cat .claude-plugin/audit/uninstall-<transaction-id>.json
   ```

### Automation Best Practices

```bash
#!/bin/bash
# Safe automated uninstall script

PLUGIN_ID="$1"
KEEP_LAST="${2:-3}"

# Validate plugin exists
if ! plugin list | grep -q "$PLUGIN_ID"; then
  echo "Plugin $PLUGIN_ID is not installed"
  exit 1
fi

# Uninstall with transaction logging
plugin uninstall "$PLUGIN_ID" \
  --force \
  --keep-last-n="$KEEP_LAST" \
  --verbose

# Verify success
if [ $? -eq 0 ]; then
  echo "Successfully uninstalled $PLUGIN_ID"
  plugin cache list "$PLUGIN_ID"
else
  echo "Failed to uninstall $PLUGIN_ID"
  exit 1
fi
```

---

## Rollback After Uninstall

If you uninstalled a plugin but kept cached versions, you can reinstall quickly:

### Reinstall from Cache

```bash
# Reinstall latest cached version
plugin install <plugin-id>

# Reinstall specific cached version
plugin install <plugin-id>@<version>
```

**Speed:** Near-instant (no download required)

**Limitations:**
- Only works if cache was retained during uninstall
- If cache was purged, must download from marketplace

---

## Troubleshooting

### Issue: "Permission denied" during uninstall

**Cause:** Insufficient permissions to modify registry or cache.

**Fix:**
```bash
# Check ownership
ls -la ~/.config/claude-code

# Fix permissions
chmod -R u+w ~/.config/claude-code/registry
chmod -R u+w ~/.config/claude-code/cache
```

### Issue: Lifecycle script hangs

**Cause:** Script waiting for input or has infinite loop.

**Fix:**
- Use `--force` to skip lifecycle scripts
- Contact plugin maintainer to fix script
- Manual cleanup may be required

### Issue: Cache cleanup fails but uninstall succeeds

**Cause:** Partial cache removal failure (non-critical).

**Fix:**
```bash
# Manual cache cleanup
rm -rf ~/.config/claude-code/cache/<plugin-id>/<version>

# Rebuild cache index
plugin cache rebuild-index
```

---

## Related Documentation

- **Error Codes:** `docs/contracts/error-codes.md`
- **Install Operations:** `docs/operations/install.md`
- **Rollback Guide:** `docs/operations/rollback.md`
- **Cache Management:** `docs/operations/cache.md`
- **Audit Logs:** `.claude-plugin/audit/README.md`
- **Architecture:** `docs/ARCHITECTURE.md` (Section 3.10, 6.3)
- **Specification:** `docs/SPECIFICATION.md` (FR-010, FR-013, CRIT-004, CRIT-011)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-12 | Initial uninstall documentation (I3.T4) |

---

**For Support:** File issues at the plugin marketplace repository or consult the plugin maintainer's documentation.
