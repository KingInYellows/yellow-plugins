# Marketplace Validation Guide

**Version**: 1.0.0 **Created**: 2026-01-11 **Compliance**: NFR-REL-004 (100%
validation coverage)

## Overview

The marketplace validation system ensures that `.claude-plugin/marketplace.json`
meets all schema and business rule requirements before publication.

## Quick Start

### Running Validation

```bash
# Validate default marketplace location
node scripts/validate-marketplace.js

# Validate specific file
node scripts/validate-marketplace.js --marketplace examples/marketplace.example.json
```

### CI Integration

```yaml
# .github/workflows/validate-marketplace.yml
name: Validate Marketplace

on:
  push:
    paths:
      - '.claude-plugin/marketplace.json'
      - 'plugins/**/.claude-plugin/plugin.json'
  pull_request:
    paths:
      - '.claude-plugin/marketplace.json'
      - 'plugins/**/.claude-plugin/plugin.json'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.22.0'
      - name: Validate marketplace schema
        run: node scripts/validate-marketplace.js
```

## Validation Rules

The validation script enforces 8 checks:

### 1. File Existence and Parse

**Rule**: Marketplace file must exist and be valid JSON.

**Error Example**:

```text
✗ ERROR: Marketplace file not found: .claude-plugin/marketplace.json
✗ ERROR: Failed to parse marketplace.json: Unexpected token
```

**Fix**: Ensure file exists and is valid JSON (use `jq` or JSON linter).

### 2. JSON Schema Compliance

**Rule**: Marketplace must have the required official root fields: `name` and
`plugins`. `owner` and `metadata` are optional but supported.

**Error Example**:

```text
✗ ERROR: Missing or invalid required field: "name" (string)
✗ ERROR: Missing or invalid required field: "plugins" (array)
```

**Fix**: Add missing fields per schema:

```json
{
  "name": "my-marketplace",
  "plugins": [ ... ]
}
```

### 3. Metadata Version Format

**Rule**: If `metadata.version` is present, it must be valid semver
(MAJOR.MINOR.PATCH).

**Error Example**:

```text
✗ ERROR: Invalid metadata.version format: 1.0 (must be semver)
```

**Fix**: Use three-part semver:

```json
{
  "metadata": { "version": "1.0.0" } // ✓ Correct
}
```

### 4. Plugin Name Uniqueness

**Rule**: All plugin `name` values must be unique within the marketplace.

**Error Example**:

```text
✗ ERROR: Duplicate plugin names: my-plugin
```

**Fix**: Ensure each plugin has a unique name:

```json
{
  "plugins": [
    { "name": "plugin-one", ... },
    { "name": "plugin-two", ... }
  ]
}
```

### 5. Source Path Existence

**Rule**: Each plugin's `source` directory must exist and contain
`.claude-plugin/plugin.json`.

**Error Example**:

```text
✗ ERROR: Plugin "my-plugin" source directory not found: plugins/my-plugin
✗ ERROR: Plugin "my-plugin" missing .claude-plugin/plugin.json at: plugins/my-plugin
```

**Fix**: Create the plugin directory and manifest at the expected path:

```bash
mkdir -p plugins/my-plugin/.claude-plugin
echo '{"name":"my-plugin","version":"1.0.0","description":"Example plugin","author":{"name":"you"}}' > plugins/my-plugin/.claude-plugin/plugin.json
```

### 6. Version Format

**Rule**: Marketplace plugin versions must use `MAJOR.MINOR.PATCH` semver.

**Error Example**:

```text
✗ ERROR: Plugin "my-plugin" invalid version format: 1.0 (must be semver X.Y.Z)
```

**Fix**: Synchronize versions:

```json
{
  "plugins": [
    { "name": "my-plugin", "version": "1.1.0", ... }
  ]
}
```

Cross-file version consistency is enforced separately by
`pnpm validate:versions`.

### 7. Version Presence

**Rule**: Local marketplace entries must declare a `version` field.

**Error Example**:

```text
✗ ERROR: Plugin "my-plugin" is missing a "version" field in marketplace.json.
```

**Fix**: Add a version field for each local plugin entry:

```json
{
  "plugins": [
    { "name": "my-plugin", "version": "1.1.0", ... }
  ]
}
```

### 8. Performance Check

**Rule**: Oversized marketplace files emit a warning once they exceed 100 KB.

**Warning Example**:

```text
⚠ WARNING: Marketplace file is large (101.24 KB). Consider optimizing.
```

**Fix**: Trim unused metadata or split large plugin inventories across smaller
marketplaces when possible.

`category` remains a schema-supported field, but category and tag conventions
are not enforced by `scripts/validate-marketplace.js`.

## Exit Codes

The validation script uses standard exit codes for CI integration:

- `0` - Validation passed (all checks successful)
- `1` - Validation failed (errors found)

**CI Usage**:

```bash
if node scripts/validate-marketplace.js; then
  echo "Validation passed!"
else
  echo "Validation failed - check errors above"
  exit 1
fi
```

## Common Workflows

### Publishing a New Plugin

```bash
# 1. Create plugin directory and manifest
mkdir -p plugins/my-new-plugin/.claude-plugin
cat > plugins/my-new-plugin/.claude-plugin/plugin.json << 'EOF'
{
  "name": "my-new-plugin",
  "version": "1.0.0",
  "description": "My new plugin",
  "author": {
    "name": "your-name"
  }
}
EOF

# 2. Add to marketplace.json
tmp=$(mktemp)
jq '.plugins += [{
  "name": "my-new-plugin",
  "version": "1.0.0",
  "description": "My new plugin",
  "source": "./plugins/my-new-plugin",
  "category": "development"
}]' .claude-plugin/marketplace.json > "$tmp" &&
  mv "$tmp" .claude-plugin/marketplace.json

# 3. Validate
node scripts/validate-marketplace.js

# 4. Commit and push
git add .
git commit -m "Add my-new-plugin v1.0.0"
```

### Updating a Plugin Version

```bash
# 1. Update plugin.json version
NEW_VERSION=1.1.0
tmp=$(mktemp)
jq --arg v "$NEW_VERSION" '.version = $v' \
  plugins/my-plugin/.claude-plugin/plugin.json > "$tmp" &&
  mv "$tmp" plugins/my-plugin/.claude-plugin/plugin.json

# 2. Update marketplace.json version
tmp=$(mktemp)
jq --arg name "my-plugin" --arg v "$NEW_VERSION" \
  '(.plugins[] | select(.name == $name) | .version) = $v' \
  .claude-plugin/marketplace.json > "$tmp" &&
  mv "$tmp" .claude-plugin/marketplace.json

# 3. Validate
node scripts/validate-marketplace.js

# 4. Commit
git commit -m "Update my-plugin to v1.1.0"
```

### Fixing Validation Errors

```bash
# Run validation and capture output
node scripts/validate-marketplace.js > validation-report.txt 2>&1

# Review errors
cat validation-report.txt | grep "ERROR"

# Fix errors one by one (see error examples above)

# Re-validate
node scripts/validate-marketplace.js
```

## Pre-commit Hook

Add validation to Git pre-commit hook:

```bash
# .git/hooks/pre-commit
#!/bin/bash

echo "Validating marketplace.json..."
if ! node scripts/validate-marketplace.js; then
  echo "Marketplace validation failed. Fix errors before committing."
  exit 1
fi

echo "Marketplace validation passed ✓"
```

```bash
# Make executable
chmod +x .git/hooks/pre-commit
```

## NFR Compliance Report

The validation script ensures:

### NFR-REL-004: 100% Validation Coverage

Validation includes 9 checks (8 blocking + 1 warning):

- ✓ File existence and parsing
- ✓ JSON Schema compliance
- ✓ Metadata version format
- ✓ Plugin name uniqueness
- ✓ Required plugin fields (`name`, `source`)
- ✓ Source path existence
- ✓ Version format
- ✓ Version presence
- ✓ Performance check (warning-only; does not fail validation)

**Coverage**: 9/9 checks covered; blocking enforcement on 8/9.

### NFR-PERF-003: Performance

Validation completes in < 1s for typical marketplaces:

- Example marketplace (5 plugins): ~50ms
- 100 plugins: ~200ms (estimated)

**Performance**: Well within 1s target

### NFR-MAINT-004: Maintainability

- Clear error messages with fix suggestions
- Color-coded output (errors red, warnings yellow, success green)
- Detailed validation summary
- Self-documenting code with comments

**Maintainability**: Self-service debugging enabled

## Troubleshooting

### "Module not found" Error

**Problem**: Missing Node.js modules.

**Fix**: Validation script uses only built-in modules (fs, path). No npm install
needed.

### "Permission denied" Error

**Problem**: Script not executable.

**Fix**:

```bash
chmod +x scripts/validate-marketplace.js
```

### "Invalid JSON" Error

**Problem**: Syntax error in marketplace.json.

**Fix**: Use JSON linter:

```bash
cat .claude-plugin/marketplace.json | jq .
```

### Validation Passes But CI Fails

**Problem**: Different working directory in CI.

**Fix**: Run from project root:

```bash
cd /path/to/project
node scripts/validate-marketplace.js
```

## Next Steps

1. **For CI Engineers**: Integrate validation into GitHub Actions workflow
2. **For Developers**: Add pre-commit hook for automatic validation
3. **For Maintainers**: Review validation report regularly for warnings
4. **For Plugin Authors**: Run validation before submitting plugins

## References

- Schema Definition: `/schemas/official-marketplace.schema.json`
- Example Marketplace: `/examples/marketplace.example.json`
- Validation Script: `/scripts/validate-marketplace.js`
