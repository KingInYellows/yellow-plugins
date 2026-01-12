# CLI Contracts - Automation Guide

This directory contains JSON Schema definitions for CLI command contracts, enabling deterministic automation and testing.

## Quick Start

### Schema Files

- `install.json` - Install command contract (request/response)
- `update.json` - Update command contract (request/response)
- `rollback.json` - Rollback command contract (request/response)

### Validation with AJV

Install AJV CLI globally:

```bash
npm install -g ajv-cli
```

Validate a request payload:

```bash
ajv validate -s api/cli-contracts/install.json -d my-install-request.json
```

## Automation Examples

### Example 1: Installing a Plugin from JSON

**Request file** (`install-request.json`):

```json
{
  "pluginId": "example-plugin",
  "version": "1.2.3",
  "force": false,
  "dryRun": false,
  "correlationId": "automation-001",
  "compatibilityIntent": {
    "nodeVersion": "20.10.0",
    "os": "linux",
    "arch": "x64"
  },
  "telemetryContext": {
    "tags": {
      "environment": "production",
      "automation": "true"
    }
  }
}
```

**Execute installation**:

```bash
pnpm cli install --input install-request.json --output install-result.json
```

**Inspect result**:

```bash
cat install-result.json | jq '.success'
```

### Example 2: Update All Plugins

**Request file** (`update-all-request.json`):

```json
{
  "all": true,
  "checkOnly": false,
  "dryRun": false,
  "correlationId": "update-all-20260111",
  "compatibilityIntent": {
    "nodeVersion": "20.10.0",
    "os": "linux",
    "arch": "x64"
  }
}
```

**Execute update**:

```bash
pnpm cli update --input update-all-request.json --output update-result.json
```

### Example 3: Rollback with Cache-Only Policy

**Request file** (`rollback-request.json`):

```json
{
  "pluginId": "example-plugin",
  "targetVersion": "1.2.0",
  "cachePreference": "cached-only",
  "confirmationToken": "user-confirmed-20260111",
  "correlationId": "rollback-001",
  "flagOverrides": {
    "enableRollback": true
  }
}
```

**Execute rollback**:

```bash
pnpm cli rollback --input rollback-request.json --output rollback-result.json
```

### Example 4: Dry-Run Installation

**Request file** (`dry-run-install.json`):

```json
{
  "pluginId": "new-plugin",
  "version": "latest",
  "dryRun": true,
  "correlationId": "dry-run-test",
  "compatibilityIntent": {
    "nodeVersion": "20.10.0",
    "os": "darwin",
    "arch": "arm64"
  }
}
```

**Execute dry run**:

```bash
pnpm cli install --input dry-run-install.json --output - | jq '.status'
# Expected output: "dry-run"
```

## Shell Script Automation

### Automated Install Script

**File**: `scripts/install-plugin.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="${1:?Plugin ID required}"
VERSION="${2:-latest}"
OUTPUT_FILE="${3:-install-result.json}"

# Generate request payload
cat > /tmp/install-request.json <<EOF
{
  "pluginId": "${PLUGIN_ID}",
  "version": "${VERSION}",
  "correlationId": "$(uuidgen)",
  "compatibilityIntent": {
    "nodeVersion": "$(node -v | sed 's/v//')",
    "os": "$(uname -s | tr '[:upper:]' '[:lower:]')",
    "arch": "$(uname -m)"
  },
  "telemetryContext": {
    "tags": {
      "script": "install-plugin.sh",
      "user": "${USER}"
    }
  }
}
EOF

# Validate request
echo "Validating install request..."
ajv validate -s api/cli-contracts/install.json -d /tmp/install-request.json

# Execute install
echo "Installing ${PLUGIN_ID}@${VERSION}..."
pnpm cli install --input /tmp/install-request.json --output "${OUTPUT_FILE}"

# Check success
if jq -e '.success == true' "${OUTPUT_FILE}" >/dev/null; then
  echo "✅ Installation successful"
  jq -r '.message' "${OUTPUT_FILE}"
  exit 0
else
  echo "❌ Installation failed"
  jq -r '.error.message' "${OUTPUT_FILE}"
  exit 1
fi
```

**Usage**:

```bash
chmod +x scripts/install-plugin.sh
./scripts/install-plugin.sh example-plugin 1.2.3
```

### Batch Update Script

**File**: `scripts/update-all.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Generate update request
cat > /tmp/update-request.json <<EOF
{
  "all": true,
  "checkOnly": false,
  "correlationId": "batch-update-$(date +%Y%m%d-%H%M%S)",
  "compatibilityIntent": {
    "nodeVersion": "$(node -v | sed 's/v//')",
    "os": "$(uname -s | tr '[:upper:]' '[:lower:]')",
    "arch": "$(uname -m)"
  }
}
EOF

# Execute update
echo "Updating all plugins..."
pnpm cli update --input /tmp/update-request.json --output update-result.json

# Report results
UPDATED_COUNT=$(jq '.data.updated | length' update-result.json)
UP_TO_DATE_COUNT=$(jq '.data.upToDate | length' update-result.json)
SKIPPED_COUNT=$(jq '.data.skipped | length' update-result.json)

echo "📊 Update Summary:"
echo "  - Updated: ${UPDATED_COUNT}"
echo "  - Already up-to-date: ${UP_TO_DATE_COUNT}"
echo "  - Skipped: ${SKIPPED_COUNT}"

if [ "${SKIPPED_COUNT}" -gt 0 ]; then
  echo ""
  echo "⚠️  Skipped plugins:"
  jq -r '.data.skipped[] | "  - \(.pluginId): \(.reason)"' update-result.json
fi
```

## CI/CD Integration

### GitHub Actions Workflow

**File**: `.github/workflows/install-plugin.yml`

```yaml
name: Install Plugin

on:
  workflow_dispatch:
    inputs:
      plugin_id:
        description: 'Plugin ID'
        required: true
        type: string
      version:
        description: 'Version (default: latest)'
        required: false
        type: string
        default: 'latest'

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Install AJV
        run: npm install -g ajv-cli

      - name: Generate Install Request
        run: |
          cat > install-request.json <<EOF
          {
            "pluginId": "${{ inputs.plugin_id }}",
            "version": "${{ inputs.version }}",
            "correlationId": "${{ github.run_id }}-${{ github.run_number }}",
            "compatibilityIntent": {
              "nodeVersion": "$(node -v | sed 's/v//')",
              "os": "linux",
              "arch": "x64"
            },
            "telemetryContext": {
              "sessionId": "${{ github.run_id }}",
              "gitCommit": "${{ github.sha }}",
              "tags": {
                "environment": "ci",
                "workflow": "${{ github.workflow }}",
                "actor": "${{ github.actor }}"
              }
            }
          }
          EOF

      - name: Validate Request Schema
        run: ajv validate -s api/cli-contracts/install.json -d install-request.json

      - name: Install Plugin
        run: pnpm cli install --input install-request.json --output install-result.json

      - name: Validate Response Schema
        run: ajv validate -s api/cli-contracts/install.json -d install-result.json

      - name: Check Installation Success
        run: |
          if jq -e '.success == true' install-result.json >/dev/null; then
            echo "✅ Installation successful"
            jq -r '.message' install-result.json
          else
            echo "❌ Installation failed"
            jq -r '.error.message' install-result.json
            exit 1
          fi

      - name: Upload Results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: install-results
          path: |
            install-request.json
            install-result.json
```

### GitLab CI Pipeline

**File**: `.gitlab-ci.yml`

```yaml
install-plugin:
  stage: install
  image: node:20
  variables:
    PLUGIN_ID: "example-plugin"
    VERSION: "latest"
  before_script:
    - npm install -g pnpm ajv-cli
    - pnpm install
  script:
    # Generate request
    - |
      cat > install-request.json <<EOF
      {
        "pluginId": "${PLUGIN_ID}",
        "version": "${VERSION}",
        "correlationId": "${CI_PIPELINE_ID}-${CI_JOB_ID}",
        "compatibilityIntent": {
          "nodeVersion": "$(node -v | sed 's/v//')",
          "os": "linux",
          "arch": "x64"
        },
        "telemetryContext": {
          "sessionId": "${CI_PIPELINE_ID}",
          "gitCommit": "${CI_COMMIT_SHA}",
          "tags": {
            "environment": "ci",
            "pipeline": "${CI_PIPELINE_ID}"
          }
        }
      }
      EOF
    # Validate & execute
    - ajv validate -s api/cli-contracts/install.json -d install-request.json
    - pnpm cli install --input install-request.json --output install-result.json
    # Check result
    - jq '.success' install-result.json | grep -q true
  artifacts:
    paths:
      - install-request.json
      - install-result.json
    expire_in: 1 week
```

## Testing & Validation

### Validate All Schemas

```bash
# Validate install schema is valid JSON Schema
ajv compile -s api/cli-contracts/install.json

# Validate update schema
ajv compile -s api/cli-contracts/update.json

# Validate rollback schema
ajv compile -s api/cli-contracts/rollback.json
```

### Test Request Payloads

Create test fixtures in `tests/fixtures/`:

```bash
# Validate test install request
ajv validate -s api/cli-contracts/install.json -d tests/fixtures/install-valid.json

# Validate should fail for invalid request
ajv validate -s api/cli-contracts/install.json -d tests/fixtures/install-invalid.json
# Expected: validation errors
```

### Integration Test Script

**File**: `scripts/test-contracts.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Testing CLI Contracts..."

# Test install contract
echo "Testing install contract..."
pnpm cli install --input tests/fixtures/install-request.json --output /tmp/install-result.json --dry-run
ajv validate -s api/cli-contracts/install.json -d /tmp/install-result.json
echo "✅ Install contract test passed"

# Test update contract
echo "Testing update contract..."
pnpm cli update --input tests/fixtures/update-request.json --output /tmp/update-result.json --dry-run
ajv validate -s api/cli-contracts/update.json -d /tmp/update-result.json
echo "✅ Update contract test passed"

# Test rollback contract (requires flag)
echo "Testing rollback contract..."
pnpm cli rollback --input tests/fixtures/rollback-request.json --output /tmp/rollback-result.json --dry-run
ajv validate -s api/cli-contracts/rollback.json -d /tmp/rollback-result.json
echo "✅ Rollback contract test passed"

echo ""
echo "🎉 All contract tests passed!"
```

## Troubleshooting

### Common Issues

#### Invalid JSON

```bash
# Error: Unexpected token in JSON
# Solution: Validate JSON syntax
cat request.json | jq .
```

#### Schema Validation Failure

```bash
# Error: data must have required property 'pluginId'
# Solution: Check required fields in schema
ajv validate -s api/cli-contracts/install.json -d request.json --errors=text
```

#### CLI Not Accepting Input

```bash
# Error: Failed to load JSON input
# Solution: Check file path and permissions
ls -la install-request.json
cat install-request.json | pnpm cli install --input -
```

## Package.json Scripts

Add these scripts to `package.json` for convenience:

```json
{
  "scripts": {
    "validate:contracts": "ajv compile -s 'api/cli-contracts/*.json'",
    "validate:install": "ajv validate -s api/cli-contracts/install.json -d",
    "validate:update": "ajv validate -s api/cli-contracts/update.json -d",
    "validate:rollback": "ajv validate -s api/cli-contracts/rollback.json -d",
    "test:contracts": "bash scripts/test-contracts.sh"
  }
}
```

**Usage**:

```bash
# Validate all schemas
pnpm validate:contracts

# Validate specific request
pnpm validate:install install-request.json

# Run contract integration tests
pnpm test:contracts
```

## Additional Resources

- [Main Contract Documentation](../docs/contracts/cli-contracts.md)
- [Error Codes Reference](../docs/contracts/error-codes.md)
- [JSON Schema Specification](https://json-schema.org/draft-07/schema)
- [AJV Documentation](https://ajv.js.org/)

---

**Last Updated**: 2026-01-11
**Version**: 1.0.0
**Specification**: Task I2.T4 - CLI Contract Catalog
