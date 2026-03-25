# Plugin Validation Guide

**Version**: 1.0.0 **Last Updated**: 2026-03-19 **Schema Version**:
plugin.schema.json v1.0.0

---

## Overview

> Current script scope: `scripts/validate-plugin.js` validates manifest shape,
> directory-name consistency, semver formatting, short-description warnings,
> keyword types, `outputStyles`, and plugin-local hook script paths. It does
> not support `--skip-network` or perform separate runtime checks for
> compatibility ranges or URL reachability.

This guide explains how to validate Claude Code plugin manifests using the
`validate-plugin.js` script and JSON Schema validation.

**Validation Ensures**:

- Manifest complies with plugin.schema.json
- Plugin name matches the directory name
- Required fields (`name`, `description`, `author`) are present (the JSON Schema
  also requires `version`, enforced via AJV in CI)
- Versions use semver format
- Optional keywords are well-formed

---

## Quick Start

### Prerequisites

```bash
# Install AJV for JSON Schema validation
npm install -g ajv ajv-formats

# Or in plugin directory
npm install --save-dev ajv ajv-formats
```

### Basic Validation

```bash
# Validate all plugins
node scripts/validate-plugin.js

# Validate a single plugin directory
node scripts/validate-plugin.js plugins/yellow-core

# Validate using the CI-style manifest path
node scripts/validate-plugin.js --plugin plugins/yellow-core/.claude-plugin/plugin.json
```

### Expected Output

**✅ Success**:

```text
Validating plugin: yellow-core
✓ PASS: Version: 1.1.0
✓ PASS: Plugin "yellow-core" is valid
ℹ INFO:   Version: 1.1.0
ℹ INFO:   Author: KingInYellows
```

**❌ Failure**:

```text
Validating plugin: broken-plugin
✗ ERROR: Missing required field: "description"
✗ ERROR: Plugin name "wrong-name" does not match directory name "broken-plugin"
```

---

## Validation Rules

### Rule 1: Schema Compliance

**Check**: Manifest validates against plugin.schema.json

**Required Fields**:

- `name` (kebab-case, max 64 chars)
- `version` (semver: MAJOR.MINOR.PATCH)
- `description` (10-280 chars)
- `author` (`string` or object with `author.name`)

**Example Error**:

```json
{
  "rule": "SCHEMA_COMPLIANCE",
  "field": "version",
  "message": "must match pattern '^[0-9]+\\.[0-9]+\\.[0-9]+$'"
}
```

**Fix**:

```json
// ❌ Invalid
"version": "1.2"

// ✅ Valid
"version": "1.2.0"
```

---

### Rule 2: Name Consistency

**Check**: Plugin name must match directory name

**Example Error**:

```json
{
  "rule": "NAME_CONSISTENCY",
  "field": "name",
  "message": "Plugin name 'hookify' must match directory name 'hookify-old'"
}
```

**Fix**:

```bash
# Option 1: Rename directory
mv plugins/hookify-old plugins/hookify

# Option 2: Update manifest
# Change "name": "hookify-old" → "name": "hookify"
```

---

### Rule 3: Semantic Version Compliance

**Check**: Version must be valid semver (MAJOR.MINOR.PATCH)

**Example Error**:

```json
{
  "rule": "SEMANTIC_VERSION",
  "field": "version",
  "message": "Invalid semver format: 1.2.x. Must be MAJOR.MINOR.PATCH (e.g., 1.2.3)"
}
```

**Fix**:

```json
// ❌ Invalid
"version": "1.2.x"
"version": "v1.2.3"
"version": "latest"

// ✅ Valid
"version": "1.2.3"
"version": "0.0.1"
"version": "2.10.15"
```

---

### Rule 4: Description Quality Warning

**Check**: Very short descriptions emit a warning

**Example Warning**:

```text
⚠ WARNING: Description is very short (< 10 chars). Consider being more descriptive.
```

### Rule 5: Keywords Format

**Check**: `keywords`, when present, must be an array of strings

**Example Error**:

```json
{
  "field": "keywords",
  "message": "All keywords must be strings"
}
```

**Fix**:

```json
// ❌ Invalid
"keywords": ["review", 123]

// ✅ Valid
"keywords": ["review", "automation"]
```

---

## CI Integration

### GitHub Actions

```yaml
name: Validate Plugin Manifests

on:
  pull_request:
    paths:
      - 'plugins/**'
      - 'schemas/**'
      - 'scripts/validate-plugin.js'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22.22.0'

      - name: Install dependencies
        run: |
          npm install -g ajv ajv-cli ajv-formats

      - name: Validate all plugins
        run: |
          set -e
          for plugin in plugins/*; do
            if [ -d "$plugin" ]; then
              echo "Validating $plugin..."
              node scripts/validate-plugin.js "$plugin"
            fi
          done

```

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Validate modified plugin manifests
git diff --cached --name-only | grep 'plugins/.*/\.claude-plugin/plugin\.json' | while read file; do
  plugin_dir=$(dirname $(dirname "$file"))
  echo "Validating $plugin_dir..."
  node scripts/validate-plugin.js "$plugin_dir" || exit 1
done

echo "✅ All plugin manifests valid"
```

---

## Common Errors and Solutions

### Error: "must have required property 'name'"

**Cause**: Missing required field

**Solution**:

```json
{
  "name": "my-plugin", // Add this
  "version": "1.0.0"
  // ...
}
```

---

### Error: "must match pattern '^[a-z0-9-]+$'"

**Cause**: Plugin name contains uppercase, spaces, or special chars

**Solution**:

```json
// ❌ Invalid
"name": "My Plugin!"
"name": "my_plugin"
"name": "MyPlugin"

// ✅ Valid
"name": "my-plugin"
"name": "myplugin"
"name": "my-plugin-v2"
```

---

### Error: "must be >= 10 characters"

**Cause**: Description too short

**Solution**:

```json
// ❌ Invalid
"description": "Plugin"  // Only 6 chars

// ✅ Valid
"description": "A simple plugin for testing purposes"  // 42 chars
```

---

### Error: "keywords must be an array"

**Cause**: `keywords` is not an array

**Solution**:

```json
// ❌ Invalid
"keywords": "review"

// ✅ Valid
"keywords": ["review", "automation"]
```

---

### Error: "must match format 'email'"

**Cause**: Invalid email address

**Solution**:

```json
// ❌ Invalid
"author": {
  "email": "not-an-email"
}

// ✅ Valid
"author": {
  "email": "dev@example.com"
}
```

---

### Error: "must be equal to one of the allowed values"

**Cause**: Permission scope not in enum (filesystem, network, shell, env,
claude-api)

**Solution**:

```json
// ❌ Invalid
{
  "scope": "database"  // Not in enum
}

// ✅ Valid
{
  "scope": "filesystem"
}
```

---

## Secrets & Environment Variables

Best practices for handling credentials, API keys, and environment variables in
plugins.

### Prefer OAuth over API keys

Claude Code handles the full OAuth lifecycle (token storage in system keychain,
automatic refresh, revocation via `/mcp`) for HTTP MCP servers. Users don't need
to manage any files or environment variables.

Use OAuth when your MCP server supports it (see yellow-linear, yellow-chatprd
for examples).

### For env-var-based auth

When a plugin requires API keys or tokens (e.g., for REST API calls via curl):

1. **Document the required env var** in the plugin's `README.md` under
   "Prerequisites" — within the first 3 lines of the section
2. **Validate at entry points** — check the variable is set, validate its
   format, and show the setup URL on failure:

   ```bash
   if [ -z "$MY_API_TOKEN" ]; then
     printf 'ERROR: MY_API_TOKEN not set\n' >&2
     printf 'Get your token: https://example.com/settings/api\n' >&2
     printf 'Then: export MY_API_TOKEN="your_token_here"\n' >&2
     exit 1
   fi
   ```

3. **Never echo or log token values** in error messages or debug output
4. **Use `env` field in plugin.json** for non-secret config (paths, feature
   flags) — not for credentials:

   ```json
   "mcpServers": {
     "my-server": {
       "command": "npx",
       "args": ["my-mcp-server"],
       "env": {
         "STORAGE_PATH": "${PWD}/.my-server/"
       }
     }
   }
   ```

5. **Use `${VAR}` expansion** in `.mcp.json` for secrets that come from the
   user's shell environment:

   ```json
   {
     "my-server": {
       "type": "http",
       "url": "https://api.example.com/mcp",
       "headers": {
         "Authorization": "Bearer ${MY_API_TOKEN}"
       }
     }
   }
   ```

### No `.env` file convention

Plugins should NOT require users to create `.env` files. Instead:

- **MCP servers**: use OAuth or `${VAR}` expansion in `.mcp.json`
- **Shell commands**: read from the user's shell environment (`$VAR`)
- **Rationale**: avoids the "which `.env` file?" confusion across projects and
  worktrees

### Never store secrets in plugin code

- No hardcoded tokens or API keys in any plugin file
- No `.env` files committed to the repository
- The `.gitignore` already excludes `.env`, `.env.local`, and `.env.*.local`

---

## Validation Checklist

Before publishing plugin:

- [ ] Run `node scripts/validate-plugin.js plugins/<name>`
- [ ] Required fields are present in `.claude-plugin/plugin.json`
- [ ] Plugin name matches the directory name
- [ ] Version is valid semver (e.g., 1.2.3)
- [ ] Description is not trivially short
- [ ] `keywords`, if present, is an array of strings
- [ ] `outputStyles`, if present, points to a plugin-local directory with `.md`
  files
- [ ] Inline hook scripts, if present, resolve inside the plugin and are
  readable/executable

---

## Advanced Validation

### Custom Validation Rules

```javascript
// scripts/custom-validate.js
const { validatePlugin } = require('./validate-plugin');

async function customValidation(pluginDir) {
  // Run standard validation
  const result = await validatePlugin(pluginDir);

  // Add custom checks
  const manifest = JSON.parse(
    fs.readFileSync(`${pluginDir}/.claude-plugin/plugin.json`)
  );

  // Example: Check license exists
  if (!manifest.license) {
    console.warn('⚠️  No license specified');
  }

  // Example: Check changelog for version
  if (manifest.docs.changelog) {
    const changelog = await fetch(manifest.docs.changelog).then((r) =>
      r.text()
    );
    if (!changelog.includes(manifest.version)) {
      console.warn(`⚠️  Changelog missing version ${manifest.version}`);
    }
  }

  return result;
}
```

### Programmatic Validation

```javascript
const { validatePlugin } = require('./scripts/validate-plugin');

// Validate in Node.js
const result = validatePlugin('plugins/hookify');

if (result.valid) {
  console.log('✅ Plugin valid');
} else {
  console.error('❌ Validation failed');
  process.exit(result.exitCode);
}
```

---

## Troubleshooting

### "Cannot find module 'ajv'"

**Solution**:

```bash
npm install -g ajv ajv-formats
# Or in plugin directory
cd plugins/hookify
npm install --save-dev ajv ajv-formats
```

---

### "EACCES: permission denied"

**Solution**:

```bash
# Make validation script executable
chmod +x scripts/validate-plugin.js

# Or run with node explicitly
node scripts/validate-plugin.js plugins/hookify
```

---

### "plugin.json not found"

**Solution**:

```bash
# Check manifest location
ls -la plugins/hookify/.claude-plugin/plugin.json

# Create directory if missing
mkdir -p plugins/hookify/.claude-plugin
```

---

### Unsupported `--skip-network` flag

**Solution**:

```bash
# The current validator does not support --skip-network.
# Run the script directly against the plugin directory instead.
node scripts/validate-plugin.js plugins/hookify
```

---

## Exit Codes

| Code | Meaning   | Description                                |
| ---- | --------- | ------------------------------------------ |
| 0    | Success   | Plugin manifest is valid                   |
| 1    | Invalid   | Validation errors (schema, business rules) |
| 2    | Not Found | Manifest file not found or unreadable      |

**Usage in Scripts**:

```bash
node scripts/validate-plugin.js plugins/hookify
if [ $? -eq 0 ]; then
  echo "✅ Valid, proceeding with install"
else
  echo "❌ Invalid, aborting"
  exit 1
fi
```

---

## Summary

Validation ensures plugin manifest integrity:

1. **Schema Compliance**: Required fields and JSON schema shape are valid
2. **Name Consistency**: Plugin name matches the directory name
3. **Version Quality**: Versions are valid semver strings
4. **Description Quality**: Very short descriptions are flagged
5. **Optional Field Hygiene**: `keywords`, `outputStyles`, and inline hook
   scripts are validated when present

**Golden Rule**: Validate before every publish/commit!

```bash
node scripts/validate-plugin.js plugins/<name>
```
