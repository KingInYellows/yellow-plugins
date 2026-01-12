# Yellow Plugins CLI - Command Reference

> Auto-generated from command metadata. Do not edit manually.

This document provides comprehensive help for all CLI commands in the Yellow Plugins marketplace.

## Table of Contents

- [Plugin Lifecycle](#plugin-lifecycle)
  - [`install`](#install)
  - [`update`](#update)
  - [`uninstall`](#uninstall)
- [Plugin Discovery](#plugin-discovery)
  - [`browse`](#browse)
  - [`search`](#search)
- [Version Management](#version-management)
  - [`rollback`](#rollback)
  - [`pin`](#pin)
  - [`check-updates`](#check-updates)
- [Publishing](#publishing)
  - [`publish`](#publish)

---

## Plugin Lifecycle

### `install`

**Aliases:** `i`, `add`

Install a plugin from the marketplace

**Usage:**

```bash
plugin install <plugin-id> [--version <version>] [--force]
```

**Examples:**

```bash
plugin install example-plugin
```

Install the latest version of example-plugin

```bash
plugin install example-plugin --version 1.2.3
```

Install a specific version

```bash
plugin install example-plugin --force
```

Force reinstall even if already installed

**Specification References:** `FR-001`, `CRIT-001`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-INSTALL-001`, `ERR-INSTALL-002`, `ERR-COMPAT-001`

---

### `update`

**Aliases:** `up`, `upgrade`

Update installed plugins to latest versions

**Usage:**

```bash
plugin update [plugin-id] [--all]
```

**Examples:**

```bash
plugin update example-plugin
```

Update a specific plugin to the latest version

```bash
plugin update --all
```

Update all installed plugins

**Specification References:** `FR-002`, `CRIT-002`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-UPDATE-001`, `ERR-UPDATE-002`, `ERR-COMPAT-001`

---

### `uninstall`

**Aliases:** `rm`, `remove`

Uninstall a plugin

**Usage:**

```bash
plugin uninstall <plugin-id> [--force] [--keep-cache]
```

**Examples:**

```bash
plugin uninstall example-plugin
```

Uninstall a plugin

```bash
plugin uninstall example-plugin --keep-cache
```

Uninstall but keep cached versions for rollback

```bash
plugin uninstall example-plugin --force
```

Force uninstall without confirmation

**Specification References:** `FR-004`, `CRIT-004`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-UNINSTALL-001`, `ERR-UNINSTALL-002`

---

## Plugin Discovery

### `browse`

**Aliases:** `list`, `ls`

Browse available plugins in the marketplace

**Usage:**

```bash
plugin browse [--category <cat>] [--tag <tag>] [--limit <n>]
```

**Required Feature Flags:**

- `enableBrowse`

**Examples:**

```bash
plugin browse
```

List all available plugins

```bash
plugin browse --category productivity
```

Browse plugins in a specific category

```bash
plugin browse --tag ai --limit 10
```

Browse plugins with a specific tag, limited to 10 results

**Specification References:** `FR-006`, `CRIT-006`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-BROWSE-001`, `ERR-BROWSE-002`

---

### `search`

**Aliases:** `find`

Search for plugins in the marketplace

**Usage:**

```bash
plugin search <query> [--exact]
```

**Examples:**

```bash
plugin search "code formatter"
```

Search for plugins matching the query

```bash
plugin search linter --exact
```

Search for exact matches only

**Specification References:** `FR-007`, `CRIT-007`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-SEARCH-001`, `ERR-SEARCH-002`

---

## Version Management

### `rollback`

**Aliases:** `rb`, `revert`

Rollback a plugin to a previous version

**Usage:**

```bash
plugin rollback <plugin-id> [--version <version>]
```

**Required Feature Flags:**

- `enableRollback`

**Examples:**

```bash
plugin rollback example-plugin
```

Interactive rollback to a previous cached version

```bash
plugin rollback example-plugin --version 1.0.0
```

Rollback to a specific cached version

**Specification References:** `FR-003`, `CRIT-018`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-ROLLBACK-001`, `ERR-ROLLBACK-002`, `ERR-CACHE-001`

---

### `pin`

**Aliases:** `lock`

Pin a plugin to a specific version

**Usage:**

```bash
plugin pin <plugin-id> [--version <version>] [--unpin]
```

**Examples:**

```bash
plugin pin example-plugin
```

Pin plugin to current version

```bash
plugin pin example-plugin --version 1.2.3
```

Pin plugin to a specific version

```bash
plugin pin example-plugin --unpin
```

Unpin plugin to allow updates

**Specification References:** `FR-008`, `CRIT-008`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-PIN-001`, `ERR-PIN-002`

---

### `check-updates`

**Aliases:** `cu`, `outdated`

Check for available plugin updates

**Usage:**

```bash
plugin check-updates [plugin-id] [--json]
```

**Examples:**

```bash
plugin check-updates
```

Check all installed plugins for updates

```bash
plugin check-updates example-plugin
```

Check a specific plugin for updates

```bash
plugin check-updates --json
```

Output results in JSON format

**Specification References:** `FR-009`, `CRIT-009`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-CHECK-001`, `ERR-CHECK-002`

---

## Publishing

### `publish`

**Aliases:** `pub`

Publish a plugin to the marketplace

**Usage:**

```bash
plugin publish [--push] [--message <msg>]
```

**Required Feature Flags:**

- `enablePublish`

**Examples:**

```bash
plugin publish
```

Stage and validate plugin for publishing

```bash
plugin publish --push
```

Publish and push to remote repository

```bash
plugin publish --push --message "Release v1.2.3"
```

Publish with a custom commit message

**Specification References:** `FR-005`, `CRIT-005`, `3-3-cli-workflow-control`

**Error Codes:** `ERR-PUBLISH-001`, `ERR-PUBLISH-002`, `ERR-SCHEMA-001`

---

---

## Global Options

The following options are available for all commands:

| Option | Description | Type | Alias |
|--------|-------------|------|-------|
| `--config` | Path to config file | string | - |
| `--flags` | Path to feature flags file | string | - |
| `--input` | Input file or data | string | `-i` |
| `--output` | Output file or destination | string | `-o` |
| `--verbose` | Enable verbose output | boolean | - |
| `--dry-run` | Simulate without making changes | boolean | - |
| `--help` | Show help | - | `-h` |
| `--version` | Show version | - | `-v` |

## Feature Flags

Some commands require specific feature flags to be enabled. Configure these in `.claude-plugin/flags.json`:

| Command | Required Flag | Description |
|---------|---------------|-------------|
| `browse` | `enableBrowse` | Enable browse functionality |
| `rollback` | `enableRollback` | Enable rollback functionality |
| `publish` | `enablePublish` | Enable publish functionality |

## Error Codes

Commands may emit structured error codes for troubleshooting:

| Command | Error Codes | Description |
|---------|-------------|-------------|
| `install` | `ERR-INSTALL-001`, `ERR-INSTALL-002`, `ERR-COMPAT-001` | See specification for details |
| `update` | `ERR-UPDATE-001`, `ERR-UPDATE-002`, `ERR-COMPAT-001` | See specification for details |
| `uninstall` | `ERR-UNINSTALL-001`, `ERR-UNINSTALL-002` | See specification for details |
| `browse` | `ERR-BROWSE-001`, `ERR-BROWSE-002` | See specification for details |
| `search` | `ERR-SEARCH-001`, `ERR-SEARCH-002` | See specification for details |
| `rollback` | `ERR-ROLLBACK-001`, `ERR-ROLLBACK-002`, `ERR-CACHE-001` | See specification for details |
| `pin` | `ERR-PIN-001`, `ERR-PIN-002` | See specification for details |
| `check-updates` | `ERR-CHECK-001`, `ERR-CHECK-002` | See specification for details |
| `publish` | `ERR-PUBLISH-001`, `ERR-PUBLISH-002`, `ERR-SCHEMA-001` | See specification for details |

## Specification References

Commands reference specific sections of the technical specification:

| Command | Spec Anchors |
|---------|--------------|
| `install` | `FR-001`, `CRIT-001`, `3-3-cli-workflow-control` |
| `update` | `FR-002`, `CRIT-002`, `3-3-cli-workflow-control` |
| `uninstall` | `FR-004`, `CRIT-004`, `3-3-cli-workflow-control` |
| `browse` | `FR-006`, `CRIT-006`, `3-3-cli-workflow-control` |
| `search` | `FR-007`, `CRIT-007`, `3-3-cli-workflow-control` |
| `rollback` | `FR-003`, `CRIT-018`, `3-3-cli-workflow-control` |
| `pin` | `FR-008`, `CRIT-008`, `3-3-cli-workflow-control` |
| `check-updates` | `FR-009`, `CRIT-009`, `3-3-cli-workflow-control` |
| `publish` | `FR-005`, `CRIT-005`, `3-3-cli-workflow-control` |

---

*Generated by Yellow Plugins CLI*
