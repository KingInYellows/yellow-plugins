# Browse Command

**Command**: `browse`
**Aliases**: `list`, `ls`
**Description**: Browse available plugins in the marketplace

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Usage](#usage)
- [Options](#options)
- [Examples](#examples)
  - [Basic Browse](#basic-browse)
  - [Filter by Category](#filter-by-category)
  - [Filter by Tag](#filter-by-tag)
  - [Multiple Tags](#multiple-tags)
  - [Offline Mode](#offline-mode)
  - [Sort by Downloads](#sort-by-downloads)
  - [Sort by Recently Updated](#sort-by-recently-updated)
  - [JSON Output](#json-output)
  - [Verbose Mode](#verbose-mode)
- [Ranking & Sorting Logic](#ranking--sorting-logic)
  - [Default Relevance Ranking](#default-relevance-ranking)
  - [Download-Based Sorting](#download-based-sorting)
  - [Update-Based Sorting](#update-based-sorting)
  - [Name-Based Sorting](#name-based-sorting)
- [Caching & Performance](#caching--performance)
  - [Cache Behavior](#cache-behavior)
  - [Performance Targets](#performance-targets)
  - [Cache Status Indicators](#cache-status-indicators)
  - [Cache Health Metrics](#cache-health-metrics)
- [Feature Flags](#feature-flags)
- [Error Codes](#error-codes)
- [Specification References](#specification-references)
- [Accessibility Notes](#accessibility-notes)
- [See Also](#see-also)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## Usage

```bash
plugin browse [options]
```

Browse and discover plugins in the Yellow Plugins marketplace with support for filtering by category, tags, and offline operation.

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--category <cat>` | string | - | Filter plugins by category |
| `--tag <tag>` | string | - | Filter plugins by tag (can be specified multiple times) |
| `--limit <n>` | number | `50` | Limit number of results |
| `--offset <n>` | number | `0` | Skip first N results (pagination) |
| `--sort <field>` | string | `relevance` | Sort by: `relevance`, `downloads`, `updated`, `name` |
| `--order <dir>` | string | `desc` | Sort order: `asc`, `desc` |
| `--offline` | boolean | `false` | Use cached marketplace index only (no network fetch) |
| `--json` | boolean | `false` | Output results in JSON format |
| `--verbose` | boolean | `false` | Show detailed plugin information |

---

## Examples

### Basic Browse

List all available plugins (default view):

```bash
plugin browse
```

**Output**:
```
⠋ Fetching marketplace index... (cached 2h ago)
✔ Found 147 plugins

┌─ Productivity (12 plugins) ──────────────────────────────────────┐
│  example-plugin                                   v1.2.3  12k ⬇  │
│  Code formatter with automatic style detection                   │
│                                                                   │
│  another-productivity-tool                        v2.1.0  8.5k ⬇ │
│  Task automation and workflow orchestration                      │
└──────────────────────────────────────────────────────────────────┘

┌─ Development Tools (8 plugins) ──────────────────────────────────┐
│  dev-assistant                                    v0.5.0  3.2k ⬇ │
│  AI-powered code suggestions and completions                     │
└──────────────────────────────────────────────────────────────────┘

Showing 20/147 plugins. Use --limit and --offset for pagination.
Run 'plugin search <query>' to find specific plugins.
```

### Filter by Category

Browse plugins in a specific category:

```bash
plugin browse --category productivity
```

**Output**:
```
✔ Found 12 plugins in category 'productivity'

  1. example-plugin                     v1.2.3    12k downloads
     Code formatter with automatic style detection
     Tags: formatting, linting, automation

  2. another-productivity-tool          v2.1.0    8.5k downloads
     Task automation and workflow orchestration
     Tags: automation, tasks, productivity

  ...

Run 'plugin info <plugin-id>' for detailed information.
```

### Filter by Tag

Browse plugins with a specific tag, limited to 10 results:

```bash
plugin browse --tag ai --limit 10
```

**Output**:
```
✔ Found 23 plugins tagged 'ai' (showing 10)

  1. ai-code-assistant                  v3.0.1    45k downloads
     AI-powered code generation and refactoring

  2. smart-documentation                v1.5.2    18k downloads
     Automatic documentation generation using AI

  ...

Use --offset 10 to see more results.
```

### Multiple Tags

Browse plugins matching multiple tags:

```bash
plugin browse --tag ai --tag productivity --limit 5
```

Plugins must match ALL specified tags.

### Offline Mode

Use cached marketplace index without network fetch:

```bash
plugin browse --offline
```

**Output**:
```
ℹ Using cached marketplace index (age: 2h 15m)
  Run without --offline to refresh from remote

✔ Found 147 plugins in cache

...
```

Useful for:
* Working without internet connection
* Faster browsing when cache is fresh
* CI/CD pipelines with pre-populated cache

### Sort by Downloads

View most popular plugins:

```bash
plugin browse --sort downloads --limit 10
```

**Output**:
```
✔ Top 10 most downloaded plugins

  1. popular-formatter                  v2.5.0    125k downloads
  2. essential-linter                   v3.1.2    98k downloads
  3. productivity-suite                 v1.8.0    87k downloads
  ...
```

### Sort by Recently Updated

View recently updated plugins:

```bash
plugin browse --sort updated --limit 10
```

**Output**:
```
✔ 10 most recently updated plugins

  1. fresh-plugin                       v0.2.0    Updated 2 hours ago
  2. active-development                 v1.9.5    Updated 1 day ago
  ...
```

### JSON Output

Get machine-readable output for automation:

```bash
plugin browse --category productivity --json
```

**Output**:
```json
{
  "success": true,
  "status": "success",
  "data": {
    "plugins": [
      {
        "id": "example-plugin",
        "name": "Example Plugin",
        "version": "1.2.3",
        "description": "Code formatter with automatic style detection",
        "author": "example-author",
        "category": "productivity",
        "tags": ["formatting", "linting", "automation"],
        "downloads": 12000,
        "updatedAt": "2026-01-10T14:30:00Z",
        "repository": "https://github.com/example/example-plugin",
        "homepage": "https://example-plugin.dev"
      }
    ],
    "total": 12,
    "limit": 50,
    "offset": 0,
    "filters": {
      "category": "productivity"
    },
    "cacheStatus": "cached",
    "cacheAge": "2h"
  },
  "timestamp": "2026-01-12T10:45:30.123Z"
}
```

### Verbose Mode

Show detailed information for each plugin:

```bash
plugin browse --verbose --limit 5
```

**Output**:
```
Plugin: example-plugin (v1.2.3)
Description: Code formatter with automatic style detection
Author: example-author
Category: productivity
Tags: formatting, linting, automation
Downloads: 12,000
Last Updated: 2026-01-10 (2 days ago)
Repository: https://github.com/example/example-plugin
Homepage: https://example-plugin.dev
Compatibility: Node.js >= 18.0.0
License: MIT

---

Plugin: another-productivity-tool (v2.1.0)
...
```

---

## Ranking & Sorting Logic

<!-- anchor: ranking-logic -->

The `browse` command uses deterministic ranking algorithms to ensure consistent, reproducible results.

### Default Relevance Ranking

When `--sort relevance` (default), plugins are ranked by:

1. **Category Match** (if `--category` specified): Exact category matches ranked higher
2. **Tag Match Score** (if `--tag` specified): Number of matching tags
3. **Popularity Score**: Weighted combination of:
   * Downloads (40%)
   * Stars/favorites (30%)
   * Recent update activity (20%)
   * Install success rate (10%)
4. **Alphabetical Tiebreaker**: Plugin ID (case-insensitive)

### Download-Based Sorting

When `--sort downloads`:

* Primary: Total download count (descending)
* Tiebreaker: Plugin ID (alphabetical)

### Update-Based Sorting

When `--sort updated`:

* Primary: Last updated timestamp (most recent first)
* Tiebreaker: Plugin ID (alphabetical)

### Name-Based Sorting

When `--sort name`:

* Primary: Plugin ID (case-insensitive alphabetical)
* Order controlled by `--order asc|desc`

**Specification References**: [FR-006](../SPECIFICATION.md#fr-006), [CRIT-006](../SPECIFICATION.md#crit-006), [Iteration 3 Validation](../plan/02_Iteration_I3.md#iteration-3-validation)

---

## Caching & Performance

<!-- anchor: caching-performance -->

The `browse` command leverages marketplace index caching for optimal performance:

### Cache Behavior

* **Cache Location**: `.claude-plugin/cache/marketplace-index.json`
* **Cache TTL**: 3 hours (configurable via `MARKETPLACE_CACHE_TTL_HOURS`)
* **Automatic Refresh**: Index refreshed if cache older than TTL
* **Manual Refresh**: Use `plugin cache clear marketplace` to force refresh

### Performance Targets

* **With cached index**: < 3 seconds (target from Iteration 3)
* **With network fetch**: < 15 seconds (includes index download + parsing)
* **Offline mode**: < 1 second (pure cache read)

### Cache Status Indicators

The CLI indicates cache status in output:

```
⠋ Fetching marketplace index... (cached 2h ago)     # Using cache
⠋ Fetching marketplace index... (refreshing)        # Downloading
ℹ Using cached marketplace index (age: 2h 15m)     # Offline mode
⚠ Cache stale (age: 4h), but using offline mode     # Stale cache warning
```

### Cache Health Metrics

Run `plugin cache status` to view cache health:

```bash
plugin cache status
```

**Output**:
```
Marketplace Cache
  Status: FRESH
  Age: 2h 15m
  Size: 1.2 MB
  Last Updated: 2026-01-12T08:30:00Z
  Next Refresh: in 45m

Plugin Cache
  Total Plugins: 5
  Total Size: 45 MB
  Oldest Entry: example-plugin@1.0.0 (30 days ago)
```

**Specification References**: [Iteration 3 Metrics Targets](../plan/02_Iteration_I3.md#iteration-3-validation), [Iteration 3 Tooling Follow-Ups](../plan/02_Iteration_I3.md#iteration-3-validation)

---

## Feature Flags

<!-- anchor: feature-flags -->

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `enableBrowse` | boolean | `true` | Enable browse functionality |
| `enableOfflineMode` | boolean | `true` | Allow `--offline` flag |
| `enableMarketplaceCache` | boolean | `true` | Enable index caching |

Configure in `.claude-plugin/flags.json`:

```json
{
  "enableBrowse": true,
  "enableOfflineMode": true,
  "enableMarketplaceCache": true
}
```

**Specification Reference**: [Feature Flag Governance](../operations/feature-flags.md), [CRIT-004](../SPECIFICATION.md#crit-004)

---

## Error Codes

<!-- anchor: error-codes -->

| Code | Severity | Description | Resolution |
|------|----------|-------------|------------|
| `ERR-BROWSE-001` | ERROR | Marketplace index fetch failed | Check network connection; try `--offline` flag |
| `ERR-BROWSE-002` | ERROR | Invalid filter parameters | Verify category/tag values match marketplace schema |
| `ERR-BROWSE-003` | WARNING | Cache stale but offline mode active | Use without `--offline` to refresh cache |
| `ERR-BROWSE-004` | ERROR | Cache corrupted or unreadable | Run `plugin cache clear marketplace` |
| `ERR-BROWSE-005` | ERROR | Invalid sort/order parameters | Use valid values: sort=(relevance\|downloads\|updated\|name), order=(asc\|desc) |

**Example Error Output**:

```
✖ Marketplace index fetch failed (ERR-BROWSE-001)

Network timeout while downloading marketplace index from
https://marketplace.yellow-plugins.dev/index.json

Resolution:
  • Check your internet connection
  • Use --offline flag to browse cached results
  • Verify firewall/proxy settings

See: https://yellow-plugins.dev/docs/errors#err-browse-001
```

**Cross-Reference**: [Error Codes Reference](../errors.md), [CRIT-007](../SPECIFICATION.md#crit-007)

---

## Specification References

<!-- anchor: spec-references -->

This command implements the following specification requirements:

* **[FR-006](../SPECIFICATION.md#fr-006)**: Plugin Discovery - Browse marketplace and list available plugins
* **[CRIT-006](../SPECIFICATION.md#crit-006)**: Browse UX - Deterministic ranking with offline support
* **[3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)**: CLI interaction patterns and workflow control
* **[6-1-progress-feedback](../architecture/06_UI_UX_Architecture.md#6-1-progress-feedback)**: Progress indicators and status messaging
* **[Iteration 3 Exit Criteria](../plan/02_Iteration_I3.md#iteration-3-validation)**: Browse command executable end-to-end with caching

---

## Accessibility Notes

<!-- anchor: accessibility -->

* **Screen Readers**: Plugin lists include textual descriptions, not just visual formatting
* **Color Independence**: Status indicators (`✔ ✖ ⚠ ℹ`) paired with textual prefixes (`SUCCESS`, `ERROR`, `WARNING`, `INFO`)
* **ANSI Fallback**: Icons degrade to `[OK]/[WARN]` with high-contrast colors per [UI Style Guide §3](../ui/style-guide.md#3-ansi-fallback)
* **Keyboard Navigation**: Fully keyboard-accessible; no mouse required
* **Non-Interactive Mode**: Use `--json` output for programmatic access in automation
* **Contrast**: All color combinations meet WCAG 2.1 AA standards (see [UI Style Guide](../ui/style-guide.md#1-6-accessibility-design-system))

---

## See Also

* [`search`](./search.md) - Search for plugins by query
* [`info`](./info.md) - View detailed plugin information
* [`install`](./install.md) - Install a plugin
* [`cache`](./cache.md) - Manage marketplace and plugin cache
* [CLI Contracts - Browse](../contracts/cli-contracts.md#browse-contract)
* [UI Style Guide](../ui/style-guide.md)

---

**Last Updated**: 2026-01-12
**Version**: 1.0.0
**Maintained by**: Claude Code Plugin Marketplace Team
