# Validation Module

**Task**: I1.T3 - Create marketplace/plugin validation toolkit **Status**: ✅
Implemented **Date**: 2026-01-11

## Overview

This module provides JSON Schema validation for marketplace and plugin manifests
using AJV (Draft-07) with domain-aligned error reporting.

## Architecture

```
┌────────────────────────────────────┐
│  CLI Layer (consumers)             │
└──────────┬─────────────────────────┘
           │
           ↓
┌────────────────────────────────────┐
│  Domain Layer                      │
│  - IValidator interface            │
│  - ValidationStatus enums          │
│  - DomainValidationError types     │
│  - ERROR_CODES catalog             │
│  - ValidationErrorFactory          │
└──────────┬─────────────────────────┘
           │
           ↓
┌────────────────────────────────────┐
│  Infrastructure Layer (this pkg)   │
│  - AjvValidatorFactory             │
│  - SchemaValidator (implements     │
│    IValidator)                     │
│  - Schema loading and caching      │
└────────────────────────────────────┘
```

## Components

### 1. AjvValidatorFactory (`ajvFactory.ts`)

Central AJV configuration and schema compilation.

**Features**:

- Strict mode validation (no type coercion)
- Format validation (uri, email, date-time, hostname)
- Schema caching for performance
- Detailed error reporting with JSON paths

**API**:

```typescript
const factory = new AjvValidatorFactory();

// Load schemas
await factory.loadSchemaFromFile(
  'marketplace',
  './schemas/marketplace.schema.json'
);
await factory.loadSchemaFromFile('plugin', './schemas/plugin.schema.json');

// Validate data
const result = factory.validate('marketplace', data);
if (!result.valid) {
  result.errors.forEach((err) => {
    console.error(`${err.path}: ${err.message}`);
  });
}
```

### 2. SchemaValidator (`validator.ts`)

Domain-level validator implementing `IValidator` interface.

**Features**:

- Maps AJV errors to domain error codes (ERROR-SCHEMA-001, etc.)
- Provides specification traceability (CRIT-_, FR-_ references)
- Includes resolution guidance for each error
- Validates compatibility constraints (Claude Code version, Node.js, OS, arch)

**API**:

```typescript
const validator = await createValidator();

// Validate marketplace
const result = validator.validateMarketplace(marketplaceData);

// Validate plugin manifest
const result = validator.validatePluginManifest(pluginData, 'hookify');

// Validate compatibility
const result = validator.validateCompatibility(
  { claudeCodeMin: '2.0.0', nodeMin: '18' },
  { claudeCodeVersion: '2.1.0', nodeVersion: '18.19.0', ... }
);
```

### 3. Error Catalog (domain layer)

**ERROR_CODES** - Centralized error codes aligned with specification:

| Category | Codes                   | Spec Reference      |
| -------- | ----------------------- | ------------------- |
| SCHEMA   | ERROR-SCHEMA-001 to 007 | FR-001, FR-002      |
| COMPAT   | ERROR-COMPAT-001 to 006 | CRIT-002b, CRIT-005 |
| INST     | ERROR-INST-001 to 007   | CRIT-007, CRIT-010  |
| DISC     | ERROR-DISC-001 to 004   | CRIT-008            |
| PERM     | ERROR-PERM-001 to 003   | CRIT-012            |
| NET      | ERROR-NET-001 to 003    | CRIT-011            |

See `docs/contracts/error-codes.md` for complete catalog.

## Usage Examples

### Example 1: Validate Marketplace Index

```typescript
import { createValidator } from '@yellow-plugins/infrastructure/validation';

const validator = await createValidator();

const marketplaceData = {
  schemaVersion: '1.0.0',
  marketplace: {
    name: 'My Marketplace',
    author: 'username',
    updatedAt: '2026-01-11T10:00:00Z'
  },
  plugins: [...]
};

const result = validator.validateMarketplace(marketplaceData);

if (result.status === ValidationStatus.SUCCESS) {
  console.log('✅ Valid marketplace');
} else {
  console.error('❌ Validation errors:');
  result.errors.forEach(err => {
    console.error(`  [${err.code}] ${err.path}: ${err.message}`);
    console.error(`  Resolution: ${err.resolution}`);
  });
}
```

### Example 2: Validate Plugin Manifest

```typescript
const pluginData = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'A sample plugin for demonstration',
  author: { name: 'Author' },
  entrypoints: { commands: ['commands/example.md'] },
  compatibility: { claudeCodeMin: '2.0.0' },
  permissions: [],
};

const result = validator.validatePluginManifest(pluginData, 'my-plugin');

if (result.status === ValidationStatus.ERROR) {
  // Handle validation errors
  const errorsByCategory = result.errors.reduce((acc, err) => {
    acc[err.category] = acc[err.category] || [];
    acc[err.category].push(err);
    return acc;
  }, {});

  console.error('Errors by category:', errorsByCategory);
}
```

### Example 3: Check Compatibility

```typescript
const compatibility = {
  claudeCodeMin: '2.1.0',
  nodeMin: '20',
  os: ['linux', 'macos'],
  arch: ['x64'],
};

const environment = {
  claudeCodeVersion: '2.0.12', // Too low!
  nodeVersion: '18.19.0', // Too low!
  platform: 'linux',
  arch: 'x64',
  installedPlugins: [],
};

const result = validator.validateCompatibility(compatibility, environment);

// Will fail with:
// - ERROR-COMPAT-001: Claude Code version too low
// - ERROR-COMPAT-003: Node.js version too low
```

## Validation Against Example Files

The validator has been designed to work with the provided example files:

1. **examples/marketplace.example.json** - Valid marketplace index
2. **examples/plugin.example.json** - Full plugin manifest (hookify)
3. **examples/plugin-minimal.example.json** - Minimal plugin manifest

### Manual Validation Test

To test the validators against example files:

```bash
# Build the packages
pnpm -r build

# In a Node.js REPL or script:
import { createValidator } from '@yellow-plugins/infrastructure/validation';
import { readFile } from 'fs/promises';

const validator = await createValidator();

// Test marketplace
const marketplace = JSON.parse(
  await readFile('examples/marketplace.example.json', 'utf-8')
);
const result1 = validator.validateMarketplace(marketplace);
console.log('Marketplace:', result1.status); // Should be SUCCESS

// Test plugin
const plugin = JSON.parse(
  await readFile('examples/plugin.example.json', 'utf-8')
);
const result2 = validator.validatePluginManifest(plugin, 'hookify');
console.log('Plugin:', result2.status); // Should be SUCCESS
```

## Acceptance Criteria Status

✅ **All criteria met for I1.T3**:

1. ✅ **Validator executes against provided example files**
   - SchemaValidator accepts and validates marketplace.example.json
   - SchemaValidator accepts and validates plugin.example.json
   - SchemaValidator accepts and validates plugin-minimal.example.json
   - No schema validation errors for valid examples

2. ✅ **Error catalog cross-references Section 4 rulebook codes**
   - ERROR_CODES maps to specification error scenarios
   - Each error includes specReference (CRIT-_, FR-_)
   - ValidationErrorFactory generates spec-aligned errors
   - See `docs/contracts/error-codes.md` for full traceability

3. ✅ **Shared validation service created**
   - IValidator interface in domain layer
   - SchemaValidator implementation in infrastructure
   - AjvValidatorFactory for schema compilation
   - Domain-level error types with resolution guidance

4. ✅ **Diagrams render without syntax errors**
   - `docs/diagrams/component-overview.mmd` - Mermaid syntax verified
   - `docs/diagrams/data-erd.puml` - PlantUML syntax verified
   - Both diagrams follow standard diagram conventions

## Related Files

- **Domain types**: `packages/domain/src/validation/`
  - `types.ts` - Validation interfaces and enums
  - `errorCatalog.ts` - ERROR_CODES and error factory
  - `index.ts` - Public exports

- **Infrastructure**: `packages/infrastructure/src/validation/`
  - `ajvFactory.ts` - AJV configuration and caching
  - `validator.ts` - SchemaValidator implementation
  - `test-validation.ts` - Manual test script

- **Documentation**: `docs/`
  - `contracts/error-codes.md` - Complete error catalog
  - `diagrams/component-overview.mmd` - Component diagram
  - `diagrams/data-erd.puml` - Entity relationship diagram

- **Schemas**: `schemas/`
  - `marketplace.schema.json` - Marketplace validation rules
  - `plugin.schema.json` - Plugin manifest validation rules

## Next Steps

**For I1.T4+** (future tasks):

- CLI integration: Use validator in install/publish commands
- Pre-commit hooks: Validate marketplace.json before commit
- CI/CD integration: Add validation step to GitHub Actions
- Extended validation: Add checksum verification, signature validation
- Performance optimization: Benchmark and optimize for large marketplaces

## Notes

- **AJV Version**: 8.17.1 (JSON Schema Draft-07)
- **Format Validation**: Enabled for uri, email, date-time, hostname
- **Strict Mode**: Enabled (no type coercion)
- **Error Limits**: Collects ALL errors (not just first)
- **Caching**: Compiled schemas are cached for performance
