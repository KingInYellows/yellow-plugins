# Yellow Plugins Onboarding Guide

**Document Version**: 1.0.0
**Last Updated**: 2026-01-12
**Audience**: New users, contributors, operators
**Status**: Active

<!-- anchor: onboarding-guide -->

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [1. Welcome to Yellow Plugins](#1-welcome-to-yellow-plugins)
  - [What are Yellow Plugins?](#what-are-yellow-plugins)
- [2. Quick Start](#2-quick-start)
  - [Prerequisites](#prerequisites)
  - [First Steps](#first-steps)
- [3. Core Workflows](#3-core-workflows)
  - [3.1 Discovery: Finding Plugins](#31-discovery-finding-plugins)
  - [3.2 Installation: Adding Plugins](#32-installation-adding-plugins)
    - [Lifecycle Script Consent](#lifecycle-script-consent)
  - [3.3 Updates: Keeping Plugins Current](#33-updates-keeping-plugins-current)
    - [Changelog Awareness](#changelog-awareness)
  - [3.4 Version Management: Pins & Rollbacks](#34-version-management-pins--rollbacks)
    - [Pinning Plugins](#pinning-plugins)
    - [Rolling Back](#rolling-back)
  - [3.5 Uninstallation: Removing Plugins](#35-uninstallation-removing-plugins)
    - [Uninstall Lifecycle Hooks](#uninstall-lifecycle-hooks)
- [4. Advanced Features](#4-advanced-features)
  - [4.1 Offline Mode](#41-offline-mode)
  - [4.2 JSON Output for Automation](#42-json-output-for-automation)
  - [4.3 Non-Interactive Mode](#43-non-interactive-mode)
- [5. Accessibility Features](#5-accessibility-features)
  - [5.1 Screen Reader Support](#51-screen-reader-support)
  - [5.2 Color Independence](#52-color-independence)
  - [5.3 Keyboard-Only Navigation](#53-keyboard-only-navigation)
  - [5.4 Terminal Compatibility](#54-terminal-compatibility)
- [6. Troubleshooting](#6-troubleshooting)
  - [6.1 Common Issues](#61-common-issues)
    - [Issue: "Plugin not found in marketplace"](#issue-plugin-not-found-in-marketplace)
    - [Issue: "Lifecycle script failed"](#issue-lifecycle-script-failed)
    - [Issue: "Cache corrupted"](#issue-cache-corrupted)
  - [6.2 Getting Help](#62-getting-help)
- [7. Best Practices](#7-best-practices)
  - [7.1 Plugin Management](#71-plugin-management)
  - [7.2 Security](#72-security)
  - [7.3 Performance](#73-performance)
  - [7.4 Workflow Integration](#74-workflow-integration)
- [8. Next Steps](#8-next-steps)
  - [Learning Resources](#learning-resources)
- [9. Walkthroughs](#9-walkthroughs)
  - [9.1 Walkthrough: Install and Browse](#91-walkthrough-install-and-browse)
  - [9.2 Walkthrough: Update and Pin](#92-walkthrough-update-and-pin)
  - [9.3 Walkthrough: Rollback and Recovery](#93-walkthrough-rollback-and-recovery)
- [10. Glossary & Terminology](#10-glossary--terminology)
- [11. Version History](#11-version-history)
- [12. Related Documentation](#12-related-documentation)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## 1. Welcome to Yellow Plugins

<!-- anchor: 1-welcome -->

Welcome to the Yellow Plugins marketplace for Claude Code! This guide will help you get started with discovering, installing, and managing plugins to extend your Claude Code experience.

### What are Yellow Plugins?

Yellow Plugins are modular extensions that add new capabilities to Claude Code:

* **Browse & Discover**: Explore a curated marketplace of plugins
* **Install & Update**: Easily manage plugin lifecycle with CLI commands
* **Safe Execution**: Lifecycle scripts with consent-based security
* **Version Control**: Pin, rollback, and manage plugin versions
* **Offline Support**: Work without internet using cached content

---

## 2. Quick Start

<!-- anchor: 2-quick-start -->

### Prerequisites

Before using Yellow Plugins, ensure you have:

* **Node.js** >= 18.0.0 ([download](https://nodejs.org/))
* **Claude Code** >= 2.4.0 (comes with Yellow Plugins CLI)
* **Terminal** with ANSI color support (optional but recommended)

### First Steps

1. **Check CLI availability**:
   ```bash
   plugin --version
   ```

   Expected output:
   ```
   Yellow Plugins CLI v1.0.0
   ```

2. **Browse available plugins**:
   ```bash
   plugin browse --limit 10
   ```

3. **Install your first plugin**:
   ```bash
   plugin install example-plugin
   ```

4. **Verify installation**:
   ```bash
   plugin list
   ```

Congratulations! You've installed your first plugin. 🎉

---

## 3. Core Workflows

<!-- anchor: 3-core-workflows -->

### 3.1 Discovery: Finding Plugins

<!-- anchor: 3-1-discovery -->

**Browse by category**:
```bash
plugin browse --category productivity
```

**Search by keyword**:
```bash
plugin search "code formatter"
```

**View plugin details**:
```bash
plugin info example-plugin
```

**Key Accessibility Notes**:
* All commands are fully keyboard-accessible
* Screen readers will announce progress states
* Color-coded output includes textual prefixes (`✔ SUCCESS`, `⚠ WARNING`)

**Related Docs**: [Browse Command](../cli/browse.md), [Search Command](../cli/search.md)

---

### 3.2 Installation: Adding Plugins

<!-- anchor: 3-2-installation -->

**Install latest version**:
```bash
plugin install example-plugin
```

**Install specific version**:
```bash
plugin install example-plugin --version 1.2.3
```

**Dry run (preview changes)**:
```bash
plugin install example-plugin --dry-run
```

#### Lifecycle Script Consent

Some plugins run scripts during installation. You'll be prompted to review and consent:

```
⚠ Lifecycle script detected

The plugin 'example-plugin' defines installation scripts:
  • postInstall: scripts/post-install.sh
    Purpose: Configure plugin settings
    Digest: sha256:abc123...

Review script:
  cat .claude-plugin/cache/example-plugin-1.2.3/scripts/post-install.sh

To proceed, type exactly: I TRUST THIS SCRIPT
>
```

**Security Best Practices**:
* Always review lifecycle scripts before consenting
* Verify script digest matches expected value
* Report suspicious scripts to marketplace maintainers

**Related Docs**: [Install Command](../cli/install.md), [CRIT-004 Security](../SPECIFICATION.md#crit-004)

---

### 3.3 Updates: Keeping Plugins Current

<!-- anchor: 3-3-updates -->

**Check for updates**:
```bash
plugin check-updates
```

**Update specific plugin**:
```bash
plugin update example-plugin
```

**Update all plugins**:
```bash
plugin update --all
```

#### Changelog Awareness

The CLI automatically fetches and displays changelogs:

```
┌─ Changelog: example-plugin v1.2.3 → v1.3.0 ─────────────────────┐
│                                                                   │
│  ### Features                                                     │
│  - Add support for TypeScript 5.3                                │
│                                                                   │
│  ### Bug Fixes                                                    │
│  - Fix memory leak in watcher (#123)                             │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Skip changelogs** for faster updates:
```bash
plugin update example-plugin --skip-changelog
```

**Related Docs**: [Update Command](../cli/update.md), [Changelog Awareness](../cli/update.md#changelog-awareness)

---

### 3.4 Version Management: Pins & Rollbacks

<!-- anchor: 3-4-version-management -->

#### Pinning Plugins

**Pin to current version** (prevent auto-updates):
```bash
plugin pin example-plugin
```

**Pin to specific version**:
```bash
plugin pin example-plugin --version 1.2.3
```

**Unpin plugin**:
```bash
plugin pin example-plugin --unpin
```

#### Rolling Back

**Rollback to previous version** (interactive):
```bash
plugin rollback example-plugin
```

**Rollback to specific cached version**:
```bash
plugin rollback example-plugin --version 1.2.0
```

**List available rollback targets**:
```bash
plugin rollback example-plugin --list-targets
```

**Related Docs**: [Pin Command](../cli/pin.md), [Rollback Command](../cli/rollback.md)

---

### 3.5 Uninstallation: Removing Plugins

<!-- anchor: 3-5-uninstallation -->

**Uninstall plugin** (with confirmation):
```bash
plugin uninstall example-plugin
```

**Keep cached versions** (for potential reinstall):
```bash
plugin uninstall example-plugin --keep-cache
```

**Force uninstall** (skip prompts):
```bash
plugin uninstall example-plugin --force
```

#### Uninstall Lifecycle Hooks

Plugins may define cleanup scripts that run during uninstall:

* **preUninstall**: Backup user data
* **uninstall**: Custom removal logic
* **postUninstall**: Final cleanup

You'll be prompted to consent to running these scripts (similar to installation).

**Related Docs**: [Uninstall Command](../cli/uninstall.md), [Lifecycle Hooks](../cli/uninstall.md#lifecycle-hooks)

---

## 4. Advanced Features

<!-- anchor: 4-advanced-features -->

### 4.1 Offline Mode

<!-- anchor: 4-1-offline-mode -->

Work without internet by using cached marketplace index:

```bash
# Browse offline
plugin browse --offline

# Search offline
plugin search "formatter" --offline

# Install from cache
plugin install example-plugin --offline
```

**Cache Management**:
```bash
# View cache status
plugin cache status

# Clear stale cache
plugin cache clean --stale

# Force refresh marketplace index
plugin cache clear marketplace
```

**Related Docs**: [Browse Command - Offline Mode](../cli/browse.md#offline-mode)

---

### 4.2 JSON Output for Automation

<!-- anchor: 4-2-json-output -->

All commands support `--json` for CI/CD integration:

```bash
# Get JSON output
plugin browse --json > plugins.json

# Parse with jq
plugin list --json | jq '.data.plugins[] | .id'

# Use in scripts
if plugin update --dry-run --json | jq -e '.data.updated | length > 0'; then
  echo "Updates available"
fi
```

**Related Docs**: [CLI Contracts Catalog](../contracts/cli-contracts.md), [Automation Integration](../contracts/cli-contracts.md#automation-integration)

---

### 4.3 Non-Interactive Mode

<!-- anchor: 4-3-non-interactive-mode -->

For automation and CI/CD pipelines:

```bash
# Install without prompts
LIFECYCLE_CONSENT_DIGEST=sha256:abc123... \
plugin install example-plugin --non-interactive

# Uninstall without confirmation
UNINSTALL_CONFIRM=yes \
plugin uninstall example-plugin --non-interactive

# Update all plugins silently
plugin update --all --non-interactive --quiet
```

**Environment Variables**:

| Variable | Values | Description |
|----------|--------|-------------|
| `LIFECYCLE_CONSENT_DIGEST` | `sha256:...` | Pre-consent to lifecycle script |
| `UNINSTALL_CONFIRM` | `yes`\|`no` | Confirm uninstall action |
| `SKIP_LIFECYCLE` | `yes`\|`no` | Skip lifecycle scripts |
| `KEEP_CACHE` | `yes`\|`no` | Retain cached versions |

**Related Docs**: [Non-Interactive Mode](../cli/update.md#non-interactive-mode), [CI/CD Integration](../contracts/cli-contracts.md#cicd-pipeline-examples)

---

## 5. Accessibility Features

<!-- anchor: 5-accessibility -->

Yellow Plugins CLI is designed for universal accessibility:

### 5.1 Screen Reader Support

* Progress indicators include textual step counts
* All status messages vocalize clearly
* ANSI codes gracefully degrade to plain text

**Test with screen reader**:
```bash
# Generate accessible transcript
plugin install example-plugin 2>&1 | node scripts/assistive-announcer.js
```

### 5.2 Color Independence

* Never relies solely on color to convey meaning
* Status icons paired with textual labels:
  * `✔ SUCCESS` (green) or `[OK]` (no color)
  * `⚠ WARNING` (yellow) or `[WARN]` (no color)
  * `✖ ERROR` (red) or `[ERR]` (no color)
  * `ℹ INFO` (blue) or `[INFO]` (no color)

### 5.3 Keyboard-Only Navigation

* All commands fully functional via keyboard
* No mouse or pointing device required
* Interactive prompts support arrow keys, tab navigation

### 5.4 Terminal Compatibility

The CLI adapts to your terminal's capabilities:

* **256-color terminals**: Full design system colors
* **16-color terminals**: High-contrast fallback palette
* **No color support**: Plain text with `[STATUS]` prefixes
* **Non-TTY (pipes)**: Machine-readable output

**Force compatibility modes** for testing:
```bash
# Force no color
NO_COLOR=1 plugin browse

# Force ASCII-only (no Unicode)
TERM=dumb plugin browse

# Force 16-color mode
TERM=xterm plugin browse
```

**Related Docs**: [UI Style Guide - Accessibility](../ui/style-guide.md#1-6-accessibility-design-system), [Accessibility Checklist](../ui/style-guide.md#5-accessibility-checklist)

---

## 6. Troubleshooting

<!-- anchor: 6-troubleshooting -->

### 6.1 Common Issues

#### Issue: "Plugin not found in marketplace"

**Symptoms**: `ERR-BROWSE-001` or `ERR-INSTALL-001`

**Resolution**:
1. Verify plugin ID spelling: `plugin search <partial-name>`
2. Refresh marketplace cache: `plugin cache clear marketplace`
3. Check network connection
4. Try offline mode if plugin cached: `plugin install <plugin-id> --offline`

#### Issue: "Lifecycle script failed"

**Symptoms**: `ERR-INSTALL-003` or `ERR-UNINSTALL-003`

**Resolution**:
1. Review script output for specific error
2. Check file permissions
3. Skip lifecycle temporarily: `--skip-lifecycle`
4. Report issue to plugin maintainer

#### Issue: "Cache corrupted"

**Symptoms**: `ERR-BROWSE-004`, `ERR-CACHE-001`

**Resolution**:
```bash
# Clear all cache
plugin cache clean --all

# Rebuild marketplace index
plugin browse  # Auto-refreshes

# Verify cache health
plugin cache status
```

### 6.2 Getting Help

**Built-in help**:
```bash
# General help
plugin --help

# Command-specific help
plugin install --help

# View error details
plugin info <error-code>  # Coming in v1.1
```

**Documentation**:
* [CLI Reference](../cli/help-baseline.md)
* [Error Codes](../errors.md)
* [Specification](../SPECIFICATION.md)

**Community Support**:
* GitHub Issues: https://github.com/claude-code/yellow-plugins/issues
* Documentation: https://yellow-plugins.dev/docs

**Related Docs**: [Error Codes Reference](../errors.md), [Troubleshooting Guide](./troubleshooting.md)

---

## 7. Best Practices

<!-- anchor: 7-best-practices -->

### 7.1 Plugin Management

* **Pin production plugins**: Prevent unexpected breaking changes
* **Test updates locally**: Use `--dry-run` before applying
* **Review changelogs**: Understand what's changing before updating
* **Keep cache clean**: Run `plugin cache clean --stale` periodically

### 7.2 Security

* **Always review lifecycle scripts**: Never blindly consent
* **Verify plugin sources**: Check repository and author reputation
* **Use version pinning**: Lock critical plugins to known-good versions
* **Monitor audit logs**: Review `.claude-plugin/audit/` periodically

### 7.3 Performance

* **Use offline mode**: When network is slow or unavailable
* **Enable caching**: Default behavior, but verify cache health
* **Batch updates**: Use `plugin update --all` instead of individual updates
* **Skip changelogs**: When updating many plugins: `--skip-changelog`

### 7.4 Workflow Integration

* **Commit `.claude-plugin/registry.json`**: Track installed plugins in git
* **Ignore cache in VCS**: Add `.claude-plugin/cache/` to `.gitignore`
* **Document plugin dependencies**: List required plugins in project README
* **Use JSON output**: Integrate CLI into CI/CD pipelines

**Related Docs**: [Feature Flag Governance](./feature-flags.md), [Security Guidelines](../SPECIFICATION.md#crit-004)

---

## 8. Next Steps

<!-- anchor: 8-next-steps -->

Now that you're onboarded, explore advanced topics:

1. **Publishing Plugins**: Learn to [publish your own plugins](../cli/publish.md)
2. **Contract-Driven Automation**: Use [CLI contracts](../contracts/cli-contracts.md) for CI/CD
3. **Metrics & Observability**: Configure [telemetry](./metrics.md) for monitoring
4. **Feature Flags**: Customize CLI behavior with [feature flags](./feature-flags.md)
5. **Contributing**: Read the [contribution guide](../../CONTRIBUTING.md)

### Learning Resources

* **Video Walkthrough**: Coming soon
* **Interactive Tutorial**: https://yellow-plugins.dev/tutorial
* **Example Plugins**: https://github.com/claude-code/yellow-plugins-examples
* **API Documentation**: https://yellow-plugins.dev/api

---

## 9. Walkthroughs

<!-- anchor: 9-walkthroughs -->

### 9.1 Walkthrough: Install and Browse

<!-- anchor: 9-1-walkthrough-install-browse -->

**Objective**: Install a plugin and explore the marketplace

**Steps**:

1. **List installed plugins**:
   ```bash
   plugin list
   ```
   *Expected*: Empty list (fresh install) or existing plugins

2. **Browse marketplace**:
   ```bash
   plugin browse --category productivity --limit 5
   ```
   *Expected*: 5 productivity plugins with descriptions

3. **Search for specific plugin**:
   ```bash
   plugin search "code formatter"
   ```
   *Expected*: Plugins matching "formatter" keyword

4. **View plugin details**:
   ```bash
   plugin info example-plugin
   ```
   *Expected*: Full metadata, compatibility, versions

5. **Install plugin**:
   ```bash
   plugin install example-plugin
   ```
   *Expected*: Download progress, lifecycle consent (if applicable), success message

6. **Verify installation**:
   ```bash
   plugin list
   ```
   *Expected*: `example-plugin` appears in list with version

**Duration**: ~5 minutes
**Prerequisites**: Internet connection, Node.js >= 18.0.0

---

### 9.2 Walkthrough: Update and Pin

<!-- anchor: 9-2-walkthrough-update-pin -->

**Objective**: Update a plugin, review changelog, and pin version

**Steps**:

1. **Check for updates**:
   ```bash
   plugin check-updates
   ```
   *Expected*: List of plugins with available updates

2. **Update with changelog**:
   ```bash
   plugin update example-plugin
   ```
   *Expected*: Changelog display, confirmation prompt, update progress

3. **Verify update**:
   ```bash
   plugin list
   ```
   *Expected*: Updated version shown

4. **Pin to current version**:
   ```bash
   plugin pin example-plugin
   ```
   *Expected*: Confirmation message with pinned version

5. **Attempt update (should skip)**:
   ```bash
   plugin update example-plugin
   ```
   *Expected*: "Plugin is pinned" warning

6. **Unpin plugin**:
   ```bash
   plugin pin example-plugin --unpin
   ```
   *Expected*: Confirmation message, pin removed

**Duration**: ~7 minutes
**Prerequisites**: Plugin already installed from previous walkthrough

---

### 9.3 Walkthrough: Rollback and Recovery

<!-- anchor: 9-3-walkthrough-rollback-recovery -->

**Objective**: Rollback to previous version after problematic update

**Steps**:

1. **Check current version**:
   ```bash
   plugin info example-plugin
   ```
   *Expected*: Current version displayed

2. **List rollback targets**:
   ```bash
   plugin rollback example-plugin --list-targets
   ```
   *Expected*: Available cached versions

3. **Rollback to previous version**:
   ```bash
   plugin rollback example-plugin --version 1.2.0
   ```
   *Expected*: Confirmation prompt, rollback progress, success

4. **Verify rollback**:
   ```bash
   plugin list
   ```
   *Expected*: Reverted to version 1.2.0

5. **Update to latest again**:
   ```bash
   plugin update example-plugin
   ```
   *Expected*: Update back to latest version

**Duration**: ~5 minutes
**Prerequisites**: Plugin with cached previous versions

---

## 10. Glossary & Terminology

<!-- anchor: 10-glossary -->

| Term | Definition | Reference |
|------|------------|-----------|
| Marketplace Index (FR-001) | Signed catalog of all plugin metadata; validated before browse/search commands run | [SPEC PART2 §FR-001](../SPECIFICATION-PART2.md#fr-001), [UI Style Guide](../ui/style-guide.md#1-design-system-specification) |
| Lifecycle Script Consent (CRIT-004) | Typed confirmation plus digest logging before executing install/uninstall scripts | [Specification §CRIT-004](../SPECIFICATION.md#crit-004), [Uninstall Command](../cli/uninstall.md#lifecycle-hooks) |
| Semantic Versioning (FR-010) | `MAJOR.MINOR.PATCH` numbering enforced for installs, updates, and registry commits | [Specification §FR-010](../SPECIFICATION-PART2.md#fr-010), [Update Command](../cli/update.md#performance-timeouts) |

For the full glossary curated by Ops, see [PRD Blueprint §16.1 - Glossary](../PRD_Blueprint.md#161-glossary) and the [Traceability Matrix appendix](../traceability-matrix.md#appendix-a-requirements-cross-reference).

---

## 11. Version History

<!-- anchor: version-history -->

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2026-01-12 | Initial onboarding guide with walkthroughs (I3.T5 deliverable) | Claude Sonnet 4.5 |

---

## 12. Related Documentation

<!-- anchor: related-docs -->

* [CLI Command Reference](../cli/help-baseline.md)
* [UI Style Guide](../ui/style-guide.md)
* [CLI Contracts Catalog](../contracts/cli-contracts.md)
* [Error Codes Reference](../errors.md)
* [Specification](../SPECIFICATION.md)
* [Contributing Guide](../../CONTRIBUTING.md)

---

**Maintained by**: Claude Code Plugin Marketplace Team
**Contact**: See repository README for contribution guidelines
**License**: See LICENSE file in repository root
