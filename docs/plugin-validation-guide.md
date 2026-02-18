# Plugin Validation Guide

**Version**: 1.0.0 **Last Updated**: 2026-01-11 **Schema Version**:
plugin.schema.json v1.0.0

---

## Overview

This guide explains how to validate Claude Code plugin manifests using the
`validate-plugin.js` script and JSON Schema validation.

**Validation Ensures**:

- Manifest complies with plugin.schema.json
- All declared files actually exist
- Lifecycle scripts are executable
- Permissions are properly declared
- Node.js/Claude Code versions are compatible

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
# Validate single plugin
node scripts/validate-plugin.js plugins/hookify

# Validate all plugins
for plugin in plugins/*; do
  node scripts/validate-plugin.js "$plugin"
done

# Skip network checks (faster, for CI)
node scripts/validate-plugin.js plugins/hookify --skip-network
```

### Expected Output

**✅ Success**:

```
🔍 Validating plugin: hookify

✅ Validation PASSED
   Plugin: hookify v1.2.3
   Author: kinginyellow
   Entrypoints: commands, skills, agents
```

**❌ Failure**:

```
🔍 Validating plugin: broken-plugin

❌ Validation FAILED

   [SCHEMA_COMPLIANCE] name
      must match pattern "^[a-z0-9-]+$"

   [ENTRYPOINT_EXISTS] entrypoints.commands
      Entrypoint file not found: commands/missing.md

   [NODE_VERSION_RANGE] compatibility.nodeMin
      Node.js version must be 18-24 (got 25)
```

---

## Validation Rules

### Rule 1: Schema Compliance

**Check**: Manifest validates against plugin.schema.json

**Required Fields**:

- `name` (kebab-case, max 64 chars)
- `version` (semver: MAJOR.MINOR.PATCH)
- `description` (10-280 chars)
- `author.name`
- `entrypoints` (at least one category)
- `compatibility.claudeCodeMin` (semver)
- `permissions` (can be empty array)
- `docs.readme` (valid URI)

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

### Rule 2: Name-Version Consistency

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

### Rule 3: Entrypoint File Existence

**Check**: All declared entrypoint files must exist

**Example Error**:

```json
{
  "rule": "ENTRYPOINT_EXISTS",
  "field": "entrypoints.commands",
  "message": "Entrypoint file not found: commands/missing.md"
}
```

**Fix**:

```bash
# Option 1: Create missing file
mkdir -p plugins/hookify/commands
touch plugins/hookify/commands/missing.md

# Option 2: Remove from manifest
# Delete "commands/missing.md" from entrypoints.commands array
```

---

### Rule 4: Lifecycle Script Existence

**Check**: All lifecycle scripts must exist and be executable

**Example Error**:

```json
{
  "rule": "LIFECYCLE_SCRIPT_NOT_EXECUTABLE",
  "field": "lifecycle.install",
  "message": "Lifecycle script not executable: scripts/install.sh. Run: chmod +x scripts/install.sh"
}
```

**Fix**:

```bash
# Make script executable
chmod +x plugins/hookify/scripts/install.sh

# Verify
ls -la plugins/hookify/scripts/install.sh
# -rwxr-xr-x ... install.sh  ← Note the 'x' flags
```

---

### Rule 5: Permission Scope Constraints (Warning)

**Check**: Permissions should specify paths/domains/commands for transparency

**Example Warning**:

```
⚠️  Permission Transparency Warnings:
   - Filesystem permission should specify paths for transparency (or omit for unrestricted)
   - Network permission should specify domains for transparency (or omit for unrestricted)
```

**Fix (Optional)**:

```json
// ❌ Unrestricted (works but less transparent)
{
  "scope": "filesystem",
  "reason": "Read and write files"
}

// ✅ Restricted (better transparency)
{
  "scope": "filesystem",
  "reason": "Read conversation history",
  "paths": [".claude/conversations/"]
}
```

---

### Rule 6: Node.js Version Range

**Check**: nodeMin must be 18-24 (Claude Code does NOT support Node.js 25+)

**Example Error**:

```json
{
  "rule": "NODE_VERSION_RANGE",
  "field": "compatibility.nodeMin",
  "message": "Node.js version must be 18-24 (got 25). Claude Code does NOT support Node.js 25+."
}
```

**Fix**:

```json
// ❌ Invalid
"compatibility": {
  "nodeMin": "25"
}

// ✅ Valid
"compatibility": {
  "nodeMin": "18"
}
```

---

### Rule 7: Plugin Dependency Resolution (Info)

**Check**: Display required plugin dependencies

**Example Info**:

```
ℹ️  Plugin Dependencies: base-tools, git-integration
   These plugins must be installed first. Installation will prompt if missing.
```

**No Action Required**: Informational only.

---

### Rule 8: Description Quality

**Check**: Description should be informative (not just plugin name, min 20
chars)

**Example Error**:

```json
{
  "rule": "DESCRIPTION_QUALITY",
  "field": "description",
  "message": "Description should be informative and at least 20 characters. Avoid just repeating the plugin name."
}
```

**Fix**:

```json
// ❌ Invalid
"description": "Hookify plugin"  // Too short, repeats name

// ✅ Valid
"description": "Create hooks to prevent unwanted AI behaviors through conversation analysis"
```

---

### Rule 9: Documentation URLs Reachability (Optional)

**Check**: README URL returns 200 OK (network check, skippable)

**Example Error**:

```json
{
  "rule": "DOCUMENTATION_REACHABILITY",
  "field": "docs.readme",
  "message": "README URL returned 404: https://github.com/user/repo/README.md"
}
```

**Fix**:

```bash
# Verify URL in browser
curl -I https://github.com/kinginyellow/yellow-plugins/tree/main/plugins/hookify/README.md

# Fix broken URL in manifest
```

**Skip in CI**:

```bash
node scripts/validate-plugin.js plugins/hookify --skip-network
```

---

### Rule 10: Semantic Version Compliance

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

### Rule 11: Repository URL Consistency (Warning)

**Check**: Repository and homepage should be on same domain

**Example Warning**:

```
⚠️  Repository and homepage on different domains: github.com vs kingin-yellows.dev
```

**Fix (Optional)**:

```json
// Better: Both on same domain
"repository": {
  "url": "https://github.com/kinginyellow/yellow-plugins.git"
},
"homepage": "https://github.com/kinginyellow/yellow-plugins"

// Or: Homepage points to docs subdomain
"homepage": "https://docs.kingin-yellows.dev/plugins/hookify"
```

---

### Rule 12: Keywords Relevance (Warning)

**Check**: Keywords should not duplicate words from name/description

**Example Warning**:

```
⚠️  Redundant keywords (already in name/description): hookify, unwanted
```

**Fix (Optional)**:

```json
// ❌ Redundant
"name": "hookify",
"description": "Create hooks to prevent unwanted behaviors",
"keywords": ["hookify", "unwanted", "behaviors"]  // All already in name/description

// ✅ Relevant
"keywords": ["safety", "ai-control", "conversation-analysis"]  // New information
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
          node-version: '18'

      - name: Install dependencies
        run: |
          npm install -g ajv ajv-cli ajv-formats

      - name: Validate all plugins
        run: |
          set -e
          for plugin in plugins/*; do
            if [ -d "$plugin" ]; then
              echo "Validating $plugin..."
              node scripts/validate-plugin.js "$plugin" --skip-network
            fi
          done

      - name: Check version consistency
        run: |
          node scripts/check-marketplace-consistency.js
```

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Validate modified plugin manifests
git diff --cached --name-only | grep 'plugins/.*/\.claude-plugin/plugin\.json' | while read file; do
  plugin_dir=$(dirname $(dirname "$file"))
  echo "Validating $plugin_dir..."
  node scripts/validate-plugin.js "$plugin_dir" --skip-network || exit 1
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

### Error: "must have minProperties 1"

**Cause**: Entrypoints object is empty

**Solution**:

```json
// ❌ Invalid
"entrypoints": {}

// ✅ Valid (at least one category)
"entrypoints": {
  "commands": ["commands/hello.md"]
}
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
- [ ] All entrypoint files exist
- [ ] Lifecycle scripts are executable (`chmod +x`)
- [ ] Description is informative (20+ chars)
- [ ] Version is valid semver (e.g., 1.2.3)
- [ ] Node.js version is 18-24 (if dependencies)
- [ ] README URL is reachable
- [ ] No duplicate keywords
- [ ] Permission reasons are clear (10-200 chars)
- [ ] Plugin name matches directory name

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
const result = await validatePlugin('plugins/hookify', {
  skipNetwork: true, // Skip README URL check
});

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

### Network timeout on README check

**Solution**:

```bash
# Skip network checks
node scripts/validate-plugin.js plugins/hookify --skip-network

# Or increase timeout in validate-plugin.js
// Change: timeout: 5000
// To:     timeout: 10000
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

Validation ensures plugin quality and compatibility:

1. **Schema Compliance**: All required fields, correct formats
2. **File Existence**: Entrypoints and scripts actually exist
3. **Executability**: Lifecycle scripts have execute permission
4. **Compatibility**: Node.js 18-24, valid Claude Code versions
5. **Documentation**: README accessible, description informative
6. **Permissions**: Transparently declared with justification

**Golden Rule**: Validate before every publish/commit!

```bash
node scripts/validate-plugin.js plugins/<name>
```
