# Marketplace Schema Design Rationale

**Schema Version**: 1.0.0
**Created**: 2026-01-11
**Status**: Ready for Implementation
**PRD Reference**: PRD-KIY-MKT-001 v1.2

## Overview

The `marketplace.schema.json` defines the structure for `.claude-plugin/marketplace.json`, which serves as the index/catalog for a personal Claude Code plugin marketplace. This schema was designed based on:

- User clarifications (marketplace at repo root, references plugin directories)
- Research findings (no official Claude Code marketplace schema exists)
- PRD requirements (REQ-MKT-001, REQ-MKT-002, NFR-REL-004, NFR-PERF-003)
- 9 official Claude Code plugin categories discovered in research

## Design Principles

### 1. Reference Architecture (Not Embedded)

**Decision**: The marketplace.json contains **plugin references** (id, version, source path), not full plugin manifests.

**Rationale**:
- Each plugin has its own `plugin.json` in its source directory
- Marketplace acts as an index/catalog layer
- Prevents duplication and sync issues between marketplace and plugin manifests
- Faster parsing (NFR-PERF-003: p95 < 1s)
- Enables lazy loading of full plugin details

**Example**:
```json
{
  "id": "hookify",
  "version": "1.0.0",
  "source": "plugins/hookify"  // Points to directory with plugin.json
}
```

### 2. Schema Versioning

**Decision**: Mandatory `schemaVersion` field at root level (semver format).

**Rationale**:
- NFR-EXT-001: Enables schema evolution without breaking changes
- Clients can detect schema version and adapt parsing logic
- Current version: 1.0.0 (initial release)
- Future versions can add optional fields while maintaining backward compatibility

**Evolution Example**:
- v1.0.0: Initial schema
- v1.1.0: Add optional "license" field (backward compatible)
- v2.0.0: Change required fields (breaking, clients can detect and warn)

### 3. Official Category Taxonomy

**Decision**: Restrict `category` to 9 official Claude Code categories (enum).

**Rationale**:
- Research found these 9 categories in Claude Code documentation/examples:
  - development, productivity, security, learning, testing
  - design, database, deployment, monitoring
- Strict validation prevents typos/inconsistency (NFR-REL-004)
- Enables consistent filtering/browsing across marketplaces
- Can extend via `tags` for custom categorization

### 4. Flexible Tagging System

**Decision**: Optional `tags` array (kebab-case strings, max 10).

**Rationale**:
- Supplements strict categories with flexible discovery
- Enables search by technology, use case, workflow
- Personal marketplaces can use custom tags
- Max 10 prevents tag spam while allowing useful cross-references

**Examples**:
```json
"tags": ["code-review", "quality", "testing", "ci-cd"]
"tags": ["hooks", "behavior", "safety", "ai-control"]
```

### 5. Metadata for Discovery

**Decision**: Include optional `featured`, `verified`, `downloads` fields.

**Rationale**:
- **featured**: For personal marketplaces, highlights most-used/important plugins
- **verified**: Indicates production-ready status (self-verification for personal use)
- **downloads**: Optional analytics tracking (can be omitted initially)
- All optional to minimize friction for simple personal marketplaces

### 6. Timestamp Strategy

**Decision**: ISO 8601 timestamps for `updatedAt` fields (marketplace + plugins).

**Rationale**:
- Machine-readable, timezone-aware
- Enables "show updates" feature (REQ-MKT-014)
- Can be auto-generated in CI from git commit timestamps
- Format: `2026-01-11T10:00:00Z`

## Schema Structure

### Root Object

```json
{
  "schemaVersion": "1.0.0",        // REQUIRED: Schema evolution
  "marketplace": { ... },          // REQUIRED: Marketplace metadata
  "plugins": [ ... ]               // REQUIRED: Plugin references (can be empty array)
}
```

### Marketplace Object

Contains metadata about the marketplace itself (not individual plugins):

```json
{
  "name": "string",           // REQUIRED: Display name
  "author": "string",         // REQUIRED: Maintainer
  "description": "string",    // OPTIONAL: Purpose/scope
  "url": "uri",               // OPTIONAL: Homepage
  "updatedAt": "date-time"    // REQUIRED: Last update
}
```

### Plugin Reference Object

Minimal reference to a plugin directory:

```json
{
  "id": "kebab-case",         // REQUIRED: Unique identifier
  "name": "Display Name",     // REQUIRED: Human-readable
  "version": "semver",        // REQUIRED: Latest version
  "source": "path/to/plugin", // REQUIRED: Relative path
  "category": "enum",         // REQUIRED: Official category
  "author": "string",         // OPTIONAL: Plugin author
  "description": "string",    // OPTIONAL: Short description
  "tags": ["kebab-case"],     // OPTIONAL: Discovery tags
  "featured": boolean,        // OPTIONAL: Highlight in UI
  "verified": boolean,        // OPTIONAL: Production-ready
  "downloads": integer,       // OPTIONAL: Install count
  "updatedAt": "date-time"    // OPTIONAL: Last update
}
```

## Validation Rules (CI Implementation)

The following validation rules should be enforced in CI to meet NFR-REL-004 (100% validation):

### 1. Schema Compliance
```bash
# Validate marketplace.json against marketplace.schema.json
ajv validate -s schemas/marketplace.schema.json -d .claude-plugin/marketplace.json
```

### 2. Plugin ID Uniqueness
```javascript
// Check for duplicate plugin IDs
const ids = marketplace.plugins.map(p => p.id);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length > 0) {
  throw new Error(`Duplicate plugin IDs: ${duplicates.join(', ')}`);
}
```

### 3. Source Path Existence
```javascript
// Verify each plugin's source directory exists and contains plugin.json
for (const plugin of marketplace.plugins) {
  const pluginPath = path.join(marketplaceRoot, plugin.source);
  if (!fs.existsSync(path.join(pluginPath, 'plugin.json'))) {
    throw new Error(`Missing plugin.json for ${plugin.id} at ${plugin.source}`);
  }
}
```

### 4. Version Consistency
```javascript
// MUST: Marketplace version matches plugin.json version
const marketplaceVersion = plugin.version;
const manifestVersion = JSON.parse(fs.readFileSync(
  path.join(plugin.source, 'plugin.json')
)).version;

if (marketplaceVersion !== manifestVersion) {
  throw new Error(
    `Version mismatch for ${plugin.id}: ` +
    `marketplace=${marketplaceVersion}, manifest=${manifestVersion}`
  );
}
```

### 5. Timestamp Format
```javascript
// Validate ISO 8601 format
const timestamp = marketplace.marketplace.updatedAt;
if (isNaN(Date.parse(timestamp))) {
  throw new Error(`Invalid timestamp format: ${timestamp}`);
}
```

### 6. Category Validation
```javascript
// Already enforced by JSON Schema enum, but double-check
const validCategories = [
  'development', 'productivity', 'security', 'learning', 'testing',
  'design', 'database', 'deployment', 'monitoring'
];
for (const plugin of marketplace.plugins) {
  if (!validCategories.includes(plugin.category)) {
    throw new Error(`Invalid category for ${plugin.id}: ${plugin.category}`);
  }
}
```

## NFR Compliance Analysis

### NFR-PERF-003: Parse Time < 1s (p95)

**Design Choices**:
- Flat structure (no deep nesting)
- Plugin references (not full manifests)
- Minimal required fields
- Example marketplace with 5 plugins: ~2KB JSON file

**Expected Performance**:
- Parse time: < 50ms on modern hardware
- Network transfer: < 100ms on typical home connection
- Total time to marketplace load: < 200ms (well under 1s target)

### NFR-REL-004: 100% Validation

**Design Choices**:
- JSON Schema Draft-07 for machine validation
- Required fields clearly marked
- Pattern validation for ids, versions, paths
- Enum validation for categories
- Format validation for URIs and timestamps

**Validation Coverage**: 100% (all fields have validation rules)

### NFR-MAINT-004: Self-Documenting

**Design Choices**:
- Every field has a `description` in schema
- Examples show real-world usage
- Clear naming conventions (kebab-case for ids/tags)
- Comments explain rationale

**Developer Experience**: Can understand schema without external docs

### NFR-EXT-003: Schema Evolution

**Design Choices**:
- `schemaVersion` enables detection of schema changes
- `additionalProperties: false` prevents accidental field addition
- Optional fields enable backward-compatible additions
- Breaking changes increment major version

**Future-Proofing**: Can evolve without breaking existing marketplaces

## Consistency with Claude Code Conventions

### Naming Patterns
- **Plugin IDs**: kebab-case (matches Claude Code skill naming)
- **Categories**: lowercase (matches research findings)
- **Paths**: Forward slashes (matches Unix conventions)

### Version Format
- **Semantic Versioning**: MAJOR.MINOR.PATCH (matches Claude Code expectations)
- **Pattern**: `^[0-9]+\.[0-9]+\.[0-9]+$`

### Timestamps
- **ISO 8601**: YYYY-MM-DDTHH:mm:ssZ (standard, timezone-aware)

## Example Usage

### Minimal Personal Marketplace
```json
{
  "schemaVersion": "1.0.0",
  "marketplace": {
    "name": "My Plugins",
    "author": "developer",
    "updatedAt": "2026-01-11T10:00:00Z"
  },
  "plugins": [
    {
      "id": "my-first-plugin",
      "name": "My First Plugin",
      "version": "1.0.0",
      "source": "plugins/my-first-plugin",
      "category": "development"
    }
  ]
}
```

### Full-Featured Entry
```json
{
  "id": "pr-review-toolkit",
  "name": "PR Review Toolkit",
  "version": "2.1.0",
  "author": "kinginyellow",
  "description": "Comprehensive PR review with specialized agents",
  "source": "plugins/pr-review-toolkit",
  "category": "development",
  "tags": ["code-review", "quality", "testing", "ci-cd"],
  "featured": true,
  "verified": true,
  "downloads": 42,
  "updatedAt": "2026-01-09T12:00:00Z"
}
```

## Integration with plugin.json Schema

The marketplace schema is designed to work seamlessly with the plugin.json schema:

### Division of Responsibilities

**marketplace.json** (index/catalog layer):
- Plugin discovery metadata
- Version tracking for updates
- Categories/tags for browsing
- Source path references

**plugin.json** (plugin manifest):
- Full plugin details (entrypoints, permissions, compatibility)
- Command definitions
- Dependency specifications
- Installation instructions

### Workflow Example

1. User browses marketplace.json → finds "hookify" plugin
2. Claude Code reads `plugins/hookify/plugin.json` → gets full details
3. User installs → Claude Code validates compatibility/permissions
4. Update check → compares installed version vs marketplace.json version

## Open Questions for Next Agent (Plugin Schema Designer)

1. **Compatibility Field**: How should `plugin.json` express Claude Code version requirements? (e.g., `"claudeCode": ">=1.0.0 <2.0.0"`)

2. **Permission Granularity**: What permission categories should plugin.json declare? (file-read, file-write, network, shell-exec, etc.)

3. **Entrypoint Format**: How should plugin.json specify command entrypoints? (slash commands, skill names, etc.)

4. **Dependency Format**: If plugins can depend on other plugins, what schema for dependencies?

5. **Field Overlap**: Which fields from marketplace.json should be duplicated in plugin.json (name, version, author, description) for standalone plugin use?

## Files Delivered

1. `/home/kinginyellow/projects/yellow-plugins/schemas/marketplace.schema.json` - Production JSON Schema
2. `/home/kinginyellow/projects/yellow-plugins/examples/marketplace.example.json` - Valid example with 5 plugins
3. `/home/kinginyellow/projects/yellow-plugins/docs/marketplace-schema-design.md` - This design document

## Next Steps

1. **For Coder (plugin.json schema)**:
   - Review this schema for consistency
   - Design plugin.json with compatible naming/versioning
   - Ensure field overlap (name, version) is intentional and documented

2. **For CI Engineer**:
   - Implement validation rules in GitHub Actions
   - Set up pre-commit hooks for schema validation
   - Create test fixtures for edge cases

3. **For Documentation**:
   - Create marketplace.json quickstart guide
   - Document publishing workflow
   - Provide migration guide from ad-hoc plugin repos

## Confidence Level

**95%** - Schema is production-ready with following caveats:
- 5% uncertainty: Official Claude Code plugin system may introduce constraints not yet documented
- Mitigation: Schema version 1.0.0 allows evolution when official specs emerge
- Recommendation: Test with 2-3 real plugins before finalizing
