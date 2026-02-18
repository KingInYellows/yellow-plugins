# Pin Command Documentation

**Command:** `plugin pin` **Aliases:** `plugin lock` **Task Reference:** I3.T3 -
Pin management implementation **Functional Requirements:** FR-007 (Pin
management), CRIT-002 (Cache eviction protection)

---

## Overview

The `pin` command allows you to pin installed plugins to protect them from cache
eviction. Pinned plugins are prioritized during cache management operations and
will not be automatically removed even when cache limits are exceeded.

### Key Features

- **Cache Eviction Protection:** Pinned plugins survive automatic cache cleanup
- **Version-Specific Pinning:** Pin specific versions of a plugin
- **Idempotent Operations:** Pinning an already-pinned plugin succeeds silently
- **List Functionality:** View all currently pinned plugins
- **Registry Persistence:** Pin state is persisted across CLI sessions

---

## Usage

### Pin a Plugin

Pin the currently installed version of a plugin:

```bash
plugin pin <plugin-id>
```

Pin a specific version of a plugin:

```bash
plugin pin <plugin-id> --version <version>
```

**Example:**

```bash
# Pin the currently installed version of hookify
plugin pin hookify

# Pin a specific version
plugin pin hookify --version 1.2.3
```

### Unpin a Plugin

Remove pin protection to allow cache eviction:

```bash
plugin pin <plugin-id> --unpin
```

**Example:**

```bash
# Unpin hookify to allow cache eviction
plugin pin hookify --unpin
```

### List Pinned Plugins

Display all currently pinned plugins:

```bash
plugin pin --list
```

**Example Output:**

```json
{
  "success": true,
  "status": "success",
  "message": "Found 2 pinned plugin(s)",
  "data": {
    "action": "list",
    "pins": [
      {
        "pluginId": "hookify",
        "version": "1.2.3",
        "installedAt": "2026-01-11T09:15:30.456Z",
        "isCached": true,
        "cachePath": "/home/user/project/.claude-plugin/cache/hookify/1.2.3"
      },
      {
        "pluginId": "pr-review-toolkit",
        "version": "2.0.1",
        "installedAt": "2026-01-11T10:20:00.789Z",
        "isCached": true,
        "cachePath": "/home/user/project/.claude-plugin/cache/pr-review-toolkit/2.0.1"
      }
    ]
  }
}
```

---

## Command Options

| Option        | Alias | Type       | Description                                             |
| ------------- | ----- | ---------- | ------------------------------------------------------- |
| `<plugin-id>` | -     | positional | Plugin identifier to pin (required for pin/unpin)       |
| `--version`   | `-v`  | string     | Specific version to pin (defaults to installed version) |
| `--unpin`     | -     | boolean    | Remove pin protection                                   |
| `--list`      | `-l`  | boolean    | List all pinned plugins                                 |
| `--input`     | -     | string     | JSON input file path                                    |
| `--output`    | -     | string     | JSON output file path                                   |
| `--verbose`   | -     | boolean    | Enable verbose logging                                  |
| `--dry-run`   | -     | boolean    | Preview changes without executing                       |

---

## JSON Contract

### Pin Request

```json
{
  "pluginId": "hookify",
  "version": "1.2.3",
  "action": "pin",
  "correlationId": "req-123"
}
```

**Fields:**

- `pluginId` (string, required): Plugin identifier
- `version` (string, optional): Target version to pin
- `action` (enum, required): One of `"pin"`, `"unpin"`, or `"list"`
- `correlationId` (string, optional): Request correlation ID for tracing

### Pin Response

```json
{
  "success": true,
  "status": "success",
  "message": "Successfully pinned plugin hookify",
  "transactionId": "tx-1736590530-abc123",
  "correlationId": "req-123",
  "timestamp": "2026-01-12T10:00:00.000Z",
  "cliVersion": "1.1.0",
  "data": {
    "pluginId": "hookify",
    "version": "1.2.3",
    "action": "pin",
    "isPinned": true
  }
}
```

**Status Values:**

- `"success"`: Operation completed successfully
- `"no-op"`: Plugin was already in the desired state
- `"error"`: Operation failed (see error field)

---

## Pin Management Workflows

### Workflow 1: Pin After Installation

```bash
# Install a plugin
plugin install hookify

# Pin it to protect from eviction
plugin pin hookify
```

**When to use:** When you have plugins you use frequently and want to ensure
they remain cached.

### Workflow 2: Pin Specific Version

```bash
# Install and pin a specific version
plugin install hookify --version 1.2.3
plugin pin hookify --version 1.2.3
```

**When to use:** When you need to maintain a specific version for compatibility
or testing.

### Workflow 3: Unpin for Updates

```bash
# Unpin before updating
plugin pin hookify --unpin
plugin update hookify
plugin pin hookify
```

**When to use:** When you want to update a pinned plugin and then re-pin the new
version.

### Workflow 4: Audit Pinned Plugins

```bash
# List all pins to review what's protected
plugin pin --list

# Unpin unused plugins
plugin pin old-plugin --unpin
```

**When to use:** During cache maintenance or when cleaning up unused plugins.

---

## Cache Eviction Behavior

### How Pins Affect Cache Eviction

The cache manager enforces the following rules:

1. **Pinned Plugins Are Protected:** Pinned plugin versions are never evicted
2. **Version Retention:** Last 3 versions per plugin are retained (including
   pins)
3. **Size Limit:** 500 MB total cache size (pinned plugins count toward this)
4. **LRU Eviction:** Unpinned versions are evicted using Least Recently Used
   policy

### Eviction Priority (Lowest to Highest)

1. **Pinned Versions:** Never evicted
2. **Current/Active Version:** Protected during normal eviction
3. **Recent Versions:** Last 3 versions per plugin retained
4. **Older Versions:** Evicted using LRU when cache is full

### Example Scenario

Given a cache with:

- `hookify@1.2.3` (pinned)
- `hookify@1.2.2`
- `hookify@1.2.1`
- `hookify@1.2.0`

When cache limit is reached:

1. `hookify@1.2.3` is **protected** (pinned)
2. `hookify@1.2.2` is **protected** (recent version)
3. `hookify@1.2.1` is **protected** (recent version)
4. `hookify@1.2.0` is **evicted** (exceeds retention limit)

---

## Error Handling

### Common Errors

#### ERR-PIN-001: Missing Plugin ID

**Message:** "Missing required argument: plugin"

**Resolution:** Provide a plugin identifier:

```bash
plugin pin hookify
```

#### ERR-PIN-002: Plugin Not Found

**Message:** "Plugin {pluginId} not found in registry"

**Resolution:** Install the plugin first:

```bash
plugin install hookify
plugin pin hookify
```

#### ERR-PIN-002: Version Not Cached

**Message:** "Version {version} of plugin {pluginId} is not cached"

**Resolution:** Install the specific version:

```bash
plugin install hookify --version 1.2.3
plugin pin hookify --version 1.2.3
```

#### ERR-PIN-003: Internal Error

**Message:** "Pin command failed: {error details}"

**Resolution:** Check logs and file permissions, ensure `.claude-plugin/`
directory is writable

---

## Registry & Cache Integration

### Registry Changes

When you pin a plugin, the following changes occur in
`.claude-plugin/registry.json`:

1. Plugin ID is added to `activePins` array
2. Plugin record's `pinned` field is set to `true`
3. Registry `lastUpdated` timestamp is updated

**Example Registry State:**

```json
{
  "metadata": {
    "registryVersion": "1.0",
    "lastUpdated": "2026-01-12T10:00:00.000Z"
  },
  "plugins": [
    {
      "pluginId": "hookify",
      "version": "1.2.3",
      "pinned": true,
      "installState": "INSTALLED"
    }
  ],
  "activePins": ["hookify"]
}
```

### Cache Changes

When you pin a plugin, the cache index (`.claude-plugin/cache/index.json`) is
updated:

1. Cache entry's `pinned` field is set to `true`
2. Entry is protected from eviction algorithms
3. Eviction log records pin protection events

---

## Traceability

This command implements the following requirements:

### Functional Requirements

- **FR-007:** Pin management for version control
  - Allows users to pin plugins to specific versions
  - Prevents automatic updates of pinned plugins
  - Provides visibility into pin states

### Critical Requirements

- **CRIT-002:** Cache eviction policy with pin protection
  - Pinned plugins are excluded from eviction
  - Pin state persists across CLI restarts
  - Eviction respects both size limits and pin priorities

### Architecture References

- **Section 3.4:** Data Persistence & Cache Layout
  - Atomic registry updates
  - Cache index synchronization
  - Pin state persistence

---

## Best Practices

### When to Pin Plugins

- Plugins you use daily or frequently
- Plugins required for critical workflows
- Specific versions required for compatibility
- Plugins that are expensive to re-download

### When NOT to Pin Plugins

- Plugins you rarely use
- Plugins you're actively testing (frequent reinstalls)
- When you want to allow automatic cache cleanup
- Temporary or experimental plugins

### Pin Hygiene

1. **Regular Audits:** Use `plugin pin --list` to review pinned plugins monthly
2. **Unpin Unused:** Remove pins from plugins you no longer use actively
3. **Version Management:** Unpin before updating, then re-pin new version
4. **Cache Monitoring:** Check cache stats with `plugin cache stats` to ensure
   pins don't exhaust cache

---

## Examples

### Example 1: Pin Development Plugin

```bash
# Pin a plugin you're actively developing
plugin install my-dev-plugin --source ./local/path
plugin pin my-dev-plugin
```

### Example 2: Pin Production Dependencies

```bash
# Pin all production plugins
plugin install hookify pr-review-toolkit ci-integration
plugin pin hookify
plugin pin pr-review-toolkit
plugin pin ci-integration

# Verify pins
plugin pin --list
```

### Example 3: Temporary Pin for Testing

```bash
# Pin for a test run
plugin pin test-plugin

# Run tests...

# Unpin after testing
plugin pin test-plugin --unpin
```

### Example 4: JSON Workflow

```bash
# Create pin request
cat > pin-request.json <<EOF
{
  "pluginId": "hookify",
  "action": "pin"
}
EOF

# Execute pin via JSON
plugin pin --input pin-request.json --output pin-response.json

# Review response
cat pin-response.json
```

---

## Related Commands

- `plugin install` - Install plugins before pinning
- `plugin uninstall` - Remove plugins (auto-unpins)
- `plugin update` - Update plugins (respects pins)
- `plugin cache` - View cache statistics and eviction logs

---

## Troubleshooting

### Pin Not Persisting

**Symptom:** Pin state is lost after CLI restart

**Diagnosis:**

```bash
# Check registry integrity
cat .claude-plugin/registry.json | jq '.activePins'

# Validate registry
plugin validate --registry
```

**Fix:** Ensure registry file is not corrupted and has write permissions

### Cache Still Evicting Pinned Plugin

**Symptom:** Pinned plugin is removed from cache

**Diagnosis:**

```bash
# Check cache index
cat .claude-plugin/cache/index.json | jq '.entries.hookify[] | select(.pinned == true)'

# Review eviction log
cat .claude-plugin/cache/index.json | jq '.evictionLog | .[] | select(.wasPinned == true)'
```

**Fix:** This should never happen. Report as a bug if eviction log shows
`wasPinned: true`

### Pin Command Fails with Permission Error

**Symptom:** "EACCES: permission denied"

**Diagnosis:**

```bash
ls -la .claude-plugin/
```

**Fix:** Ensure `.claude-plugin/` directory and files are writable

---

## Changelog

### Version 1.0 (2026-01-12)

- Initial pin command implementation
- Pin/unpin/list operations
- Registry and cache integration
- Cache eviction protection
- JSON contract support

---

## References

- **Contracts:** `docs/contracts/registry-format.md` (activePins semantics)
- **API Schema:** `api/cli-contracts/pin.json` (JSON schema)
- **Error Catalog:** `docs/error-catalog.md` (ERR-PIN-\* codes)
