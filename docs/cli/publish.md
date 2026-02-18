# Publish Command

**Command**: `publish`
**Aliases**: `pub`
**Description**: Publish a plugin to the marketplace with manifest validation, git status checks, and optional push/tag actions

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Usage](#usage)
- [Prerequisites](#prerequisites)
- [Options](#options)
- [Non-Interactive Mode](#non-interactive-mode)
- [Examples](#examples)
  - [Validate Only (Dry Run)](#validate-only-dry-run)
  - [Publish and Push](#publish-and-push)
  - [Publish with Custom Commit Message](#publish-with-custom-commit-message)
  - [Publish with Tag](#publish-with-tag)
  - [JSON Output](#json-output)
- [Workflow Steps](#workflow-steps)
  - [1. Feature Flag Validation](#1-feature-flag-validation)
  - [2. Git Status Check](#2-git-status-check)
  - [3. Manifest Validation](#3-manifest-validation)
  - [4. Lifecycle Hooks (Pre-Publish)](#4-lifecycle-hooks-pre-publish)
  - [5. Commit and Push](#5-commit-and-push)
  - [6. Lifecycle Hooks (Post-Publish)](#6-lifecycle-hooks-post-publish)
- [Git Authentication](#git-authentication)
- [Manifest Validation Rules](#manifest-validation-rules)
- [Rollback and Recovery](#rollback-and-recovery)
- [Feature Flags](#feature-flags)
- [Error Codes](#error-codes)
- [Specification References](#specification-references)
- [See Also](#see-also)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## Usage

```bash
plugin publish [options]
```

Publish a plugin to the marketplace by validating manifests, checking git status, and optionally committing and pushing changes to the remote repository.

---

## Prerequisites

Before publishing, ensure you have:

1. **Git Repository**: The plugin must be in a git repository with a configured remote
2. **Git Authentication**: SSH keys or PAT (Personal Access Token) configured for push access (see [Git Authentication](#git-authentication))
3. **Valid Manifest**: `.claude-plugin/plugin.json` must validate against `schemas/plugin.schema.json`
4. **Marketplace Entry**: `marketplace.json` must include an entry for your plugin
5. **Feature Flag**: The `enablePublish` feature flag must be enabled in `.claude-plugin/flags.json`

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--push` | boolean | `false` | Commit and push changes to remote repository (requires typed `PUSH` confirmation or `PUBLISH_PUSH_CONFIRM=yes`) |
| `--message`, `-m` | string | auto-generated | Custom commit message for the publish operation |
| `--tag`, `-t` | string | - | Create and push a git tag (requires `--push`) |
| `--dry-run` | boolean | `false` | Validate manifests and check git status without making changes |
| `--json` | boolean | `false` | Output results in JSON format |
| `--non-interactive` | boolean | `false` | No prompts; set `PUBLISH_PUSH_CONFIRM` and `LIFECYCLE_CONSENT_DIGEST` env vars |

---

## Non-Interactive Mode

Use `--non-interactive` when running inside CI/CD or scripts where prompts are not allowed. The command reads confirmations from environment variables:

| Variable | Required When | Description |
|----------|---------------|-------------|
| `PUBLISH_PUSH_CONFIRM` | `--push` without `--dry-run` | Set to `yes`, `true`, or `1` to allow git pushes |
| `LIFECYCLE_CONSENT_DIGEST` | Lifecycle publish script detected (see [Lifecycle Hooks](#4-lifecycle-hooks-pre-publish)) | SHA-256 digest shown in the consent prompt, proving you reviewed the script |

If these variables are missing, the command fails with actionable errors referencing this section. Set them per invocation to avoid leaking secrets in shared shells.

---

## Examples

### Validate Only (Dry Run)

Validate manifests and check git status without making any changes:

```bash
plugin publish --dry-run
```

**Output**:
```
ℹ Starting publish operation for example-plugin
✔ Feature flag 'enablePublish' is enabled
✔ Git repository status retrieved
  - Branch: main
  - Remote: origin (https://github.com/user/example-plugin.git)
  - Status: clean (no uncommitted changes)
✔ Plugin manifest validated
  - Valid: true
  - Warnings: 0
✔ Marketplace index validated
  - Valid: true
  - Entry found for example-plugin@1.2.3

⚠ Dry-run mode: validation complete. No changes were made.
```

### Publish and Push

Publish the plugin and push changes to the remote repository:

```bash
plugin publish --push
```

**Output**:
```
ℹ Starting publish operation for example-plugin
✔ Feature flag 'enablePublish' is enabled
✔ Git repository status retrieved
✔ Plugin manifest validated
✔ Marketplace index validated
✔ Staging changes for commit
✔ Committing changes
  - Commit SHA: a1b2c3d4
  - Message: "chore(publish): publish example-plugin"
✔ Pushing changes to remote
  - Remote: origin/main
  - Status: successfully pushed

✅ Publish operation complete (2.3s)
```

### Publish with Custom Commit Message

Use a custom commit message:

```bash
plugin publish --push --message "Release v1.2.3 with new features"
```

### Publish with Tag

Create and push a git tag along with the commit:

```bash
plugin publish --push --tag v1.2.3
```

**Output**:
```
✔ Committing changes
  - Commit SHA: a1b2c3d4
✔ Creating tag: v1.2.3
  - Tag message: "Release v1.2.3"
✔ Pushing changes to remote
  - Remote: origin/main
  - Tags: v1.2.3
  - Status: successfully pushed
```

### JSON Output

Get structured JSON output for automation:

```bash
plugin publish --dry-run --json
```

**Output**:
```json
{
  "success": true,
  "status": "dry-run",
  "message": "Dry-run mode: validation complete. No changes were made.",
  "transactionId": "tx-pub-1704988800000-abc123",
  "correlationId": "corr-1704988800000-xyz789",
  "timestamp": "2026-01-12T10:00:00.000Z",
  "cliVersion": "0.1.0",
  "data": {
    "pluginId": "example-plugin",
    "gitProvenance": {
      "repoUrl": "https://github.com/user/example-plugin.git",
      "commitSha": "a1b2c3d4e5f6789",
      "branch": "main",
      "isDirty": false,
      "remoteName": "origin"
    },
    "manifestValidation": {
      "valid": true,
      "errors": [],
      "warnings": []
    }
  },
  "messages": [
    {
      "level": "info",
      "message": "Starting publish operation for example-plugin",
      "step": "VALIDATE_FLAGS"
    },
    {
      "level": "info",
      "message": "Dry-run mode: validation complete. No changes were made.",
      "step": "TELEMETRY"
    }
  ]
}
```

---

## Workflow Steps

The publish command executes the following steps in sequence:

### 1. Feature Flag Validation

- Checks that `enablePublish` is enabled in `.claude-plugin/flags.json`
- **Error Code**: `ERR-PUBLISH-001` if flag is disabled

### 2. Git Status Check

- Retrieves git provenance (repo URL, commit SHA, branch, remote tracking)
- Checks for uncommitted changes (warns if dirty, but does not block)
- Verifies remote is configured and accessible
- **Error Code**: `ERR-PUBLISH-002` if git provenance fails

### 3. Manifest Validation

- Validates `.claude-plugin/plugin.json` against `schemas/plugin.schema.json`
- Validates `marketplace.json` against `schemas/marketplace.schema.json`
- Reports errors and warnings
- **Error Code**: `ERR-SCHEMA-001` if validation fails

### 4. Lifecycle Hooks (Pre-Publish)

- Executes pre-publish lifecycle hooks if `enableLifecycleHooks` flag is enabled
- Displays script contents and requires typed consent: `"I TRUST THIS SCRIPT"`
- Records consent, exit codes, and execution duration
- Non-interactive mode: set `LIFECYCLE_CONSENT_DIGEST` to the shown SHA-256 digest to bypass prompts
- **Note**: Lifecycle hooks are optional and only run if configured in the plugin manifest

### 5. Commit and Push

- Stages manifest files (`.claude-plugin/plugin.json`, `marketplace.json`)
- Creates commit with custom or auto-generated message
- Optionally creates git tag
- Pushes changes and tags to remote after typed `PUSH` confirmation (or `PUBLISH_PUSH_CONFIRM=yes`)
- **Note**: Only executes if `--push` flag is provided

### 6. Lifecycle Hooks (Post-Publish)

- Executes post-publish lifecycle hooks if enabled
- Similar consent and tracking as pre-publish hooks

---

## Git Authentication

The publish command relies on your existing git credentials for authentication. No credentials are stored by the system.

### SSH Authentication

If using SSH, ensure your SSH key is configured:

```bash
# Test SSH connection
ssh -T git@github.com

# Expected output
Hi username! You've successfully authenticated...
```

If not configured, see [Git Authentication Guide](../operations/git-auth.md#ssh-keys).

### HTTPS with Personal Access Token (PAT)

If using HTTPS, configure a PAT:

```bash
# Configure PAT as credential helper
git config --global credential.helper store

# Push once to cache credentials
git push origin main
```

See [Git Authentication Guide](../operations/git-auth.md#personal-access-tokens) for detailed PAT setup.

### Authentication Errors

If git authentication fails, you'll see:

```
✗ Failed to push changes to remote
  Error: Authentication failed for 'https://github.com/user/repo.git'

  Resolution:
  - Ensure you have push access to the remote repository
  - For SSH: Check your SSH keys with 'ssh -T git@github.com'
  - For HTTPS: Configure a Personal Access Token (PAT)
  - See: docs/operations/git-auth.md
```

**Error Code**: `ERR-PUBLISH-002` (git operation failure)

---

## Manifest Validation Rules

The publish command validates two manifest files:

### Plugin Manifest (`.claude-plugin/plugin.json`)

- Must conform to `schemas/plugin.schema.json` (Draft-07)
- Required fields: `name`, `version`, `description`, `author`, `entrypoints`, `compatibility`, `permissions`
- Semantic version format: `MAJOR.MINOR.PATCH`
- Permission declarations must include `reason` strings

### Marketplace Index (`marketplace.json`)

- Must conform to `schemas/marketplace.schema.json`
- Must contain an entry matching the plugin `name` and `version`
- Entry must include `checksum`, `latestVersion`, and `manifestPath`

### Validation Errors vs Warnings

- **Errors**: Block the publish operation (manifest is invalid)
- **Warnings**: Do not block but are reported (e.g., missing optional fields)

---

## Rollback and Recovery

### Failed Push Scenarios

If push fails after commit:

1. **Local Commit Exists**: Your changes are committed locally but not pushed
2. **Manual Retry**: Use `git push origin <branch>` to retry manually
3. **Rollback**: Use `git reset --soft HEAD~1` to undo the commit (preserves changes)

### Audit Trail

Every publish operation is logged with:

- Transaction ID (e.g., `tx-pub-1704988800000-abc123`)
- Correlation ID for tracing
- Git provenance (commit SHA, branch, remote)
- Validation results
- Lifecycle script execution records

Audit logs are stored per transaction at `.claude-plugin/audit/publish-<transactionId>.json`, capturing consent evidence and git provenance for FR-008 audits.

---

## Feature Flags

The publish command requires the following feature flag:

| Flag | Default | Description |
|------|---------|-------------|
| `enablePublish` | `false` | Enable the publish command |
| `enableLifecycleHooks` | `false` | Enable pre/post-publish lifecycle hooks |

To enable:

```json
{
  "enablePublish": true,
  "enableLifecycleHooks": true
}
```

File: `.claude-plugin/flags.json`

---

## Error Codes

| Code | Description | Resolution |
|------|-------------|------------|
| `ERR-PUBLISH-001` | Feature flag disabled | Enable `enablePublish` in `.claude-plugin/flags.json` |
| `ERR-PUBLISH-002` | Git operation failed | Check git authentication and remote access |
| `ERR-PUBLISH-003` | Lifecycle publish script missing/inaccessible | Verify `lifecycle.prePublish` path exists inside the repo |
| `ERR-SCHEMA-001` | Manifest validation failed | Fix validation errors in manifest files |
| `ERR-PUBLISH-CONSENT` | Lifecycle consent missing or digest mismatch | Review script contents and type `"I TRUST THIS SCRIPT"` (or set `LIFECYCLE_CONSENT_DIGEST`) |
| `ERR-PUBLISH-999` | Unexpected error | Check logs for details; report if persistent |
| `ERR-PUBLISH-CLI` | CLI wrapper failure | Inspect CLI logs/output; rerun with `--verbose` |

---

## Specification References

**FR-008**: [Update Notifications](../SPECIFICATION.md#fr-008) - Publish integration with update workflows

**CRIT-005**: [Publish Workflow](../SPECIFICATION.md#crit-005) - Validation and consent requirements

**Section 3.0**: [API Design & Communication](../plan/03_Behavior_and_Communication.md#3-0-proposed-architecture-behavioral-view) - Git-native publish workflow

**Assumption 2**: [Git Authentication](../plan/01_Plan_Overview_and_Setup.md#6-0-safety-net) - Developer credentials assumption

---

## See Also

- [Git Authentication Guide](../operations/git-auth.md) - Detailed PAT and SSH setup
- [Feature Flags Documentation](../operations/feature-flags.md) - Flag configuration
- [Schema Validation](../operations/validation.md) - Manifest schema details
- [Update Command](./update.md) - Updating installed plugins
