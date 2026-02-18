# Update Command

**Command**: `update` **Aliases**: `up`, `upgrade` **Description**: Update
installed plugins to latest versions

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
  - [Update Specific Plugin](#update-specific-plugin)
  - [Update All Plugins](#update-all-plugins)
  - [Check for Updates Only](#check-for-updates-only)
  - [Update with Pinned Plugin](#update-with-pinned-plugin)
  - [Force Update Pinned Plugin](#force-update-pinned-plugin)
  - [Skip Changelog Fetching](#skip-changelog-fetching)
  - [Dry Run](#dry-run)
  - [JSON Output](#json-output)
- [Changelog Awareness](#changelog-awareness)
  - [Changelog Fetch Process](#changelog-fetch-process)
  - [Changelog Status Indicators](#changelog-status-indicators)
  - [Changelog Caching](#changelog-caching)
  - [Changelog Fallback Behavior](#changelog-fallback-behavior)
  - [Skipping Changelogs](#skipping-changelogs)
- [Pin Awareness](#pin-awareness)
  - [Pin Behavior](#pin-behavior)
  - [Pin Status in Output](#pin-status-in-output)
  - [Updating Pinned Plugins](#updating-pinned-plugins)
- [Breaking Change Detection](#breaking-change-detection)
  - [Major Version Detection](#major-version-detection)
  - [Migration Guides](#migration-guides)
  - [Rollback Safety Net](#rollback-safety-net)
- [Performance & Timeouts](#performance--timeouts)
  - [Performance Targets](#performance-targets)
  - [Timeout Settings](#timeout-settings)
  - [Exponential Backoff](#exponential-backoff)
  - [Concurrency](#concurrency)
- [Feature Flags](#feature-flags)
- [Error Codes](#error-codes)
- [Specification References](#specification-references)
- [Accessibility Notes](#accessibility-notes)
- [See Also](#see-also)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## Usage

```bash
plugin update [plugin-id] [options]
```

Update one or all installed plugins to their latest compatible versions, with
changelog awareness and pin management.

---

## Options

| Option              | Type    | Default | Description                                       |
| ------------------- | ------- | ------- | ------------------------------------------------- |
| `[plugin-id]`       | string  | -       | Specific plugin to update (omit for `--all` mode) |
| `--all`             | boolean | `false` | Update all installed plugins                      |
| `--check-only`      | boolean | `false` | Check for updates without installing              |
| `--skip-changelog`  | boolean | `false` | Skip fetching changelogs (faster updates)         |
| `--force`           | boolean | `false` | Force update even if pinned                       |
| `--dry-run`         | boolean | `false` | Simulate update without making changes            |
| `--json`            | boolean | `false` | Output results in JSON format                     |
| `--non-interactive` | boolean | `false` | No prompts; read from environment/flags           |

---

## Examples

### Update Specific Plugin

Update a single plugin to the latest version:

```bash
plugin update example-plugin
```

**Output**:

```
⠋ Checking for updates to example-plugin...
ℹ Current version: 1.2.3
ℹ Latest version: 1.3.0

⠋ Fetching changelog...
✔ Changelog retrieved (500ms)

┌─ Changelog: example-plugin v1.2.3 → v1.3.0 ─────────────────────┐
│                                                                   │
│  ### Features                                                     │
│  - Add support for TypeScript 5.3                                │
│  - Improve error messages with context                           │
│                                                                   │
│  ### Bug Fixes                                                    │
│  - Fix memory leak in watcher (#123)                             │
│  - Resolve race condition during init (#145)                     │
│                                                                   │
│  Full changelog:                                                  │
│  https://github.com/example/example-plugin/releases/tag/v1.3.0   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

Update example-plugin from 1.2.3 to 1.3.0? [yes/no]:yes

⠋ Downloading example-plugin@1.3.0...
✔ Downloaded 2.8MB (1.5s)

⠋ Running lifecycle scripts...
  preUpdate: Backing up configuration...
  postUpdate: Migrating settings...
✔ Lifecycle scripts completed (2.1s)

✔ Successfully updated example-plugin from 1.2.3 to 1.3.0 (Transaction txn-123)

Next steps:
  • Run tests to verify compatibility
  • Pin this version: plugin pin example-plugin
  • View full changelog: plugin info example-plugin --changelog
```

### Update All Plugins

Update all installed plugins:

```bash
plugin update --all
```

**Output**:

```
⠋ Checking for updates to 5 installed plugins...

┌─ Update Summary ─────────────────────────────────────────────────┐
│                                                                   │
│  ✔ 2 plugins with available updates                              │
│  ✔ 2 plugins already up-to-date                                  │
│  ⚠ 1 plugin pinned (skipped)                                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

Updates Available:
  1. example-plugin: 1.2.3 → 1.3.0 (patch: bug fixes)
  2. another-plugin: 2.0.0 → 3.0.0 (major: breaking changes ⚠)

Already Up-to-Date:
  • stable-plugin: 1.5.0
  • current-tool: 0.8.2

Pinned (Skipped):
  • important-plugin: 1.0.0 (pinned)
    Use --force to update pinned plugins

Proceed with 2 updates? [yes/no]:yes

⠋ Updating example-plugin...
✔ Successfully updated example-plugin (1.3s)

⠋ Updating another-plugin...
⚠ Major version update detected (2.x → 3.x)
  Review breaking changes: https://github.com/example/another-plugin/blob/main/BREAKING.md

Continue with another-plugin update? [yes/no]:yes
✔ Successfully updated another-plugin (2.5s)

✔ Updated 2/2 plugins successfully (Transaction txn-456)

Next steps:
  • Run integration tests to verify compatibility
  • Review breaking changes for another-plugin
  • Consider pinning: plugin pin another-plugin
```

### Check for Updates Only

Check which plugins have updates without installing:

```bash
plugin update --all --check-only
```

**Output**:

```
⠋ Checking for updates to 5 installed plugins...
✔ Check complete (1.2s)

┌─ Available Updates ──────────────────────────────────────────────┐
│                                                                   │
│  example-plugin                                                   │
│    Current: 1.2.3                                                 │
│    Latest: 1.3.0 (patch release)                                  │
│    Changelog: Available ✔                                         │
│                                                                   │
│  another-plugin                                                   │
│    Current: 2.0.0                                                 │
│    Latest: 3.0.0 (major release ⚠ breaking changes)              │
│    Changelog: Available ✔                                         │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘

2 plugins with available updates
2 plugins already up-to-date
1 plugin pinned

Run 'plugin update --all' to install updates.
Run 'plugin update <plugin-id>' to update individually.
```

### Update with Pinned Plugin

Attempt to update a pinned plugin:

```bash
plugin update pinned-plugin
```

**Output**:

```
✖ Cannot update pinned-plugin: Plugin is pinned to version 1.0.0

Pinned plugins are protected from automatic updates to ensure stability.

Options:
  1. Unpin first: plugin pin pinned-plugin --unpin
  2. Force update: plugin update pinned-plugin --force

See: https://yellow-plugins.dev/docs/cli/pin
```

### Force Update Pinned Plugin

Override pin protection:

```bash
plugin update pinned-plugin --force
```

**Output**:

```
⚠ WARNING: Forcing update of pinned plugin

Plugin 'pinned-plugin' is currently pinned to version 1.0.0.
Updating will remove the pin and install version 1.2.5.

This may break workflows that depend on pinned version behavior.

Type 'FORCE UPDATE' to confirm:FORCE UPDATE

⠋ Updating pinned-plugin...
ℹ Removing pin for pinned-plugin@1.0.0
✔ Successfully updated pinned-plugin from 1.0.0 to 1.2.5

⚠ Note: Plugin is no longer pinned. Use 'plugin pin pinned-plugin' to re-pin.
```

### Skip Changelog Fetching

Update faster by skipping changelog retrieval:

```bash
plugin update example-plugin --skip-changelog
```

**Output**:

```
⠋ Checking for updates to example-plugin...
ℹ Current version: 1.2.3
ℹ Latest version: 1.3.0

ℹ Changelog fetch skipped (--skip-changelog flag)
  View later: plugin info example-plugin --changelog

Update example-plugin from 1.2.3 to 1.3.0? [yes/no]:yes

⠋ Updating example-plugin...
✔ Successfully updated example-plugin from 1.2.3 to 1.3.0 (1.8s)
```

### Dry Run

Simulate update without making changes:

```bash
plugin update --all --dry-run
```

**Output**:

```
⠋ Dry run: Simulating update (no changes will be made)

✔ Would update 2 plugins:
  • example-plugin: 1.2.3 → 1.3.0
  • another-plugin: 2.0.0 → 3.0.0

✔ Would skip 2 plugins:
  • stable-plugin: already up-to-date (1.5.0)
  • pinned-plugin: pinned (1.0.0)

No changes made (dry run).
Run without --dry-run to apply updates.
```

### JSON Output

Get machine-readable results:

```bash
plugin update --all --check-only --json
```

**Output**:

```json
{
  "success": true,
  "status": "success",
  "data": {
    "availableUpdates": [
      {
        "pluginId": "example-plugin",
        "currentVersion": "1.2.3",
        "latestVersion": "1.3.0",
        "changelogUrl": "https://github.com/example/example-plugin/releases/tag/v1.3.0",
        "changelogStatus": "success",
        "changelogMessage": "### Features\n- Add TypeScript 5.3 support\n### Bug Fixes\n- Fix memory leak",
        "changelogFetchDurationMs": 487,
        "releaseType": "patch",
        "pinned": false
      },
      {
        "pluginId": "another-plugin",
        "currentVersion": "2.0.0",
        "latestVersion": "3.0.0",
        "changelogUrl": "https://github.com/example/another-plugin/blob/main/CHANGELOG.md",
        "changelogStatus": "success",
        "changelogFetchDurationMs": 623,
        "releaseType": "major",
        "breaking": true,
        "pinned": false
      }
    ],
    "upToDate": ["stable-plugin", "current-tool"],
    "pinned": ["pinned-plugin"]
  },
  "timestamp": "2026-01-12T11:00:00.123Z"
}
```

---

## Changelog Awareness

<!-- anchor: changelog-awareness -->

The `update` command fetches and displays changelogs to help you make informed
update decisions.

### Changelog Fetch Process

1. **Metadata Retrieval**: Extract changelog URL from plugin manifest
2. **Network Fetch**: Download changelog with 15-second timeout
3. **Parsing**: Extract relevant sections (version-specific changes)
4. **Display**: Show formatted changelog in terminal

### Changelog Status Indicators

| Status          | Description                               | Output                             |
| --------------- | ----------------------------------------- | ---------------------------------- |
| `success`       | Changelog fetched and parsed              | ✔ Changelog retrieved              |
| `cached`        | Using previously fetched changelog        | ✔ Changelog (cached)               |
| `not-provided`  | Plugin manifest doesn't specify changelog | ℹ No changelog available           |
| `timeout`       | Fetch exceeded 15-second timeout          | ⚠ Changelog fetch timed out        |
| `not-found`     | Changelog URL returned 404                | ⚠ Changelog not found              |
| `server-error`  | Remote server error (5xx)                 | ⚠ Changelog server error           |
| `network-error` | Network connectivity issue                | ⚠ Network error fetching changelog |

### Changelog Caching

Fetched changelogs are cached to improve performance:

- **Cache Location**: `.claude-plugin/cache/changelogs/<plugin-id>-<version>.md`
- **Cache TTL**: 7 days
- **Cache Key**: `${pluginId}@${fromVersion}→${toVersion}`

### Changelog Fallback Behavior

When changelog fetch fails:

```
⚠ Changelog fetch timed out (15s limit exceeded)

Update available: example-plugin 1.2.3 → 1.3.0
Release notes unavailable. Proceed with caution.

View online: https://github.com/example/example-plugin/releases/tag/v1.3.0

Continue with update? [yes/no]:
```

### Skipping Changelogs

Use `--skip-changelog` to bypass changelog fetching:

- **Performance**: Reduces update time by ~1-2 seconds per plugin
- **Use Cases**: CI/CD automation, bulk updates, known-safe updates
- **Trade-off**: Miss important breaking change notices

**Specification References**: FR-002,
[Iteration 3 Exit Criteria](../plan/02_Iteration_I3.md#iteration-3-validation),
[Iteration 3 Risks & Mitigations](../plan/02_Iteration_I3.md#iteration-3-validation)

---

## Pin Awareness

<!-- anchor: pin-awareness -->

The `update` command respects plugin pins to prevent unintended updates.

### Pin Behavior

- **Pinned plugins skipped**: Update commands skip pinned plugins by default
- **Explicit notification**: CLI notifies when plugins are skipped due to pins
- **Force override**: Use `--force` to update pinned plugins (removes pin)

### Pin Status in Output

```
Pinned (Skipped):
  • important-plugin: 1.0.0 (pinned)
    Use --force to update pinned plugins
```

### Updating Pinned Plugins

To update a pinned plugin:

1. **Unpin first** (recommended):

   ```bash
   plugin pin important-plugin --unpin
   plugin update important-plugin
   ```

2. **Force update** (removes pin):
   ```bash
   plugin update important-plugin --force
   ```

After force update, plugin is no longer pinned. Re-pin with:

```bash
plugin pin important-plugin
```

**Specification References**: FR-008,
CRIT-008,
[Iteration 3 Exit Criteria](../plan/02_Iteration_I3.md#iteration-3-validation)

---

## Breaking Change Detection

<!-- anchor: breaking-changes -->

The CLI automatically detects major version updates and warns about potential
breaking changes.

### Major Version Detection

When updating across major versions (e.g., 2.x → 3.x):

```
⚠ Major version update detected (2.x → 3.x)

Breaking changes may affect your workflows. Review carefully:
  https://github.com/example/plugin/blob/main/BREAKING.md

Major version updates may require:
  • Configuration changes
  • API migration
  • Workflow adjustments

Continue with update? [yes/no]:
```

### Migration Guides

Plugins following best practices include migration guides:

- `BREAKING.md`: Breaking changes by version
- `MIGRATION.md`: Step-by-step migration instructions
- `CHANGELOG.md`: Detailed version history

The CLI attempts to extract and display relevant migration guidance.

### Rollback Safety Net

If an update causes issues, rollback to previous version:

```bash
plugin rollback example-plugin
```

See [`rollback` command documentation](./rollback.md) for details.

---

## Performance & Timeouts

<!-- anchor: performance-timeouts -->

### Performance Targets

- **Single plugin update**: < 10 seconds (including changelog fetch)
- **`--all` with 10 plugins**: < 30 seconds (parallel where possible)
- **`--check-only`**: < 5 seconds per 10 plugins

### Timeout Settings

| Operation        | Timeout     | Behavior on Timeout             |
| ---------------- | ----------- | ------------------------------- |
| Changelog fetch  | 15 seconds  | Continue update with warning    |
| Metadata fetch   | 10 seconds  | Fail with error                 |
| Download         | 60 seconds  | Fail with error, suggest retry  |
| Lifecycle script | 120 seconds | Fail with error, offer rollback |

### Exponential Backoff

Network failures trigger exponential backoff retry:

1. First retry: 1 second delay
2. Second retry: 2 seconds delay
3. Third retry: 4 seconds delay
4. Maximum retries: 3

### Concurrency

`update --all` processes plugins in parallel where possible:

- **Max concurrent updates**: 3 plugins
- **Lifecycle scripts**: Run sequentially per plugin
- **Changelog fetches**: Run in parallel (separate pool)

---

## Feature Flags

<!-- anchor: feature-flags -->

| Flag                   | Type    | Default | Description                           |
| ---------------------- | ------- | ------- | ------------------------------------- |
| `enableUpdate`         | boolean | `true`  | Enable update functionality           |
| `enableChangelogFetch` | boolean | `true`  | Allow changelog fetching              |
| `strictCompatibility`  | boolean | `true`  | Enforce compatibility checks          |
| `parallelUpdates`      | boolean | `true`  | Process multiple updates concurrently |

Configure in `.claude-plugin/flags.json`:

```json
{
  "enableUpdate": true,
  "enableChangelogFetch": true,
  "strictCompatibility": true,
  "parallelUpdates": true
}
```

**Specification Reference**:
[Feature Flag Governance](../operations/feature-flags.md),
CRIT-004

---

## Error Codes

<!-- anchor: error-codes -->

| Code             | Severity | Description                | Resolution                                                    |
| ---------------- | -------- | -------------------------- | ------------------------------------------------------------- |
| `ERR-UPDATE-001` | ERROR    | Plugin not installed       | Install plugin first: `plugin install <plugin-id>`            |
| `ERR-UPDATE-002` | ERROR    | No update available        | Plugin already at latest version                              |
| `ERR-UPDATE-003` | ERROR    | Compatibility check failed | Review compatibility requirements in error message            |
| `ERR-UPDATE-004` | ERROR    | Download failed            | Check network; retry with `plugin update <plugin-id>`         |
| `ERR-UPDATE-005` | ERROR    | Lifecycle script failed    | Review script output; consider `--skip-lifecycle` or rollback |
| `ERR-UPDATE-006` | WARNING  | Plugin pinned              | Unpin with `plugin pin <plugin-id> --unpin` or use `--force`  |
| `ERR-UPDATE-007` | WARNING  | Changelog fetch failed     | Update proceeds; view changelog manually                      |
| `ERR-UPDATE-008` | ERROR    | Metadata fetch failed      | Check network; verify plugin exists in marketplace            |

**Example Error Output**:

```
✖ Compatibility check failed (ERR-UPDATE-003)

Plugin 'example-plugin' v1.5.0 requires Node.js >= 20.0.0
Current Node.js version: 18.16.0

Resolution:
  • Upgrade Node.js to v20.0.0 or later
  • Check plugin docs for compatibility matrix
  • Consider staying on current version (1.2.3)

Compatibility details:
  Required: Node.js >= 20.0.0, Claude >= 2.5.0
  Current: Node.js 18.16.0, Claude 2.4.0

See: https://yellow-plugins.dev/docs/errors#err-update-003
```

**Cross-Reference**: [Error Codes Reference](../errors.md),
CRIT-007

---

## Specification References

<!-- anchor: spec-references -->

This command implements the following specification requirements:

- **FR-002**: Update installed plugins to latest
  versions
- **FR-008**: Pin management integration
- **FR-009**: Check for available updates
- **CRIT-002**: Compatibility validation during
  updates
- **CRIT-008**: Pin awareness and override
  behavior
- **[3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)**:
  CLI interaction patterns
- **[6-1-progress-feedback](../architecture/06_UI_UX_Architecture.md#6-1-progress-feedback)**:
  Progress indicators and status messaging
- **[Iteration 3 Exit Criteria](../plan/02_Iteration_I3.md#iteration-3-validation)**:
  Changelog-aware update flow

---

## Accessibility Notes

<!-- anchor: accessibility -->

- **Screen Readers**: Changelogs include structured headings for navigation
- **Color Independence**: Status indicators (`✔ ✖ ⚠ ℹ`) paired with textual
  prefixes
- **ANSI Fallback**: Color accents degrade to `[OK]/[WARN]` prefixes per
  [UI Style Guide §3](../ui/style-guide.md#3-ansi-fallback)
- **Keyboard Navigation**: Fully keyboard-accessible; no mouse required
- **Non-Interactive Mode**: Use `--non-interactive` for automation without
  prompts
- **Contrast**: All color combinations meet WCAG 2.1 AA standards (see
  [UI Style Guide](../ui/style-guide.md#1-6-accessibility-design-system))

---

## See Also

- [`install`](./install.md) - Install plugins
- [`pin`](./pin.md) - Pin plugins to specific versions
- [`rollback`](./rollback.md) - Rollback to previous versions
- [`check-updates`](./check-updates.md) - Check for available updates
- [CLI Contracts - Update](../contracts/cli-contracts.md#update-contract)
- [UI Style Guide](../ui/style-guide.md)

---

**Last Updated**: 2026-01-12 **Version**: 1.0.0 **Maintained by**: Claude Code
Plugin Marketplace Team
