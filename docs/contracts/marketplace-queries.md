# Marketplace Query Contracts

**Document Version**: 1.0.0
**Status**: Implementation Complete
**Created**: 2026-01-12
**Part of**: Task I3.T1 - Marketplace ingestion & caching

---

## Table of Contents

1. [Overview](#overview)
2. [Browse Contract](#browse-contract)
3. [Search Contract](#search-contract)
4. [Info Contract](#info-contract)
5. [Common Patterns](#common-patterns)
6. [Error Codes](#error-codes)
7. [Examples](#examples)

---

## Overview

This document specifies the command contracts for marketplace discovery operations (browse, search, info). These commands enable offline-first plugin discovery with deterministic ranking and cache validation.

**Key Features**:
- Offline-first: Commands work from cached marketplace index
- Deterministic ranking: category → name → version (descending)
- Stale index warnings: Alerts when index needs refresh
- Integrity validation: Detects content hash and signature mismatches
- JSON I/O support: Automation-friendly via `--input`/`--output`

**Specification References**:
- FR-001: Plugin discovery and browsing
- FR-002: Search and filtering
- Section 1.4: Key assumptions (deterministic ranking)
- Section 3: Behavior and communication contracts

---

## Browse Contract

Browse the marketplace with optional filters.

### Command Signature

```bash
plugin browse [options]
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--category, -c` | string | - | Filter by plugin category |
| `--tag, -t` | string | - | Filter by plugin tag |
| `--featured` | boolean | false | Show only featured plugins |
| `--verified` | boolean | false | Show only verified plugins |
| `--limit, -l` | number | 50 | Maximum results to return |
| `--input` | string | - | Load request from JSON file or stdin (`-`) |
| `--output` | string | - | Write response to JSON file or stdout (`-`) |

### Request Schema (JSON)

```typescript
interface BrowseRequest {
  category?: string;           // Filter by category
  tag?: string;                // Filter by tag
  featured?: boolean;          // Show only featured
  verified?: boolean;          // Show only verified
  limit?: number;              // Max results (default: 50)
  offset?: number;             // Pagination offset (default: 0)
  correlationId?: string;      // Optional correlation ID for tracking
}
```

### Response Schema (JSON)

```typescript
interface BrowseResponse {
  success: boolean;
  status: 'success' | 'error' | 'warning';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;           // ISO 8601
  cliVersion: string;

  data?: {
    plugins: PluginEntry[];    // Sorted by category → name → version
    totalCount: number;        // Total matches before pagination
    query: {
      category?: string;
      tag?: string;
      featured?: boolean;
      verified?: boolean;
      limit: number;
      offset: number;
    };
  };

  warnings?: string[];         // Stale index, integrity issues

  error?: {
    code: string;              // ERR-BROWSE-*, ERR-DISC-*
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
  };
}

interface PluginEntry {
  id: string;                  // Unique plugin identifier
  name: string;                // Display name
  version: string;             // Semantic version
  author?: string;             // Plugin author
  description?: string;        // Short description
  source: string;              // Relative path to plugin directory
  category: string;            // Primary category
  tags?: string[];             // Searchable tags
  featured?: boolean;          // Featured status
  verified?: boolean;          // Verified status
  downloads?: number;          // Optional download count
  updatedAt?: string;          // ISO 8601 timestamp
}
```

### Deterministic Sorting

All browse results are sorted using a three-level comparator:

1. **Primary**: Category (case-insensitive, ascending)
2. **Secondary**: Plugin name (case-insensitive, ascending)
3. **Tertiary**: Semantic version (descending, latest first)

This ordering is deterministic and logged for transparency (per architecture guidance).

### Example Usage

**CLI - Browse all plugins:**
```bash
plugin browse
```

**CLI - Browse by category:**
```bash
plugin browse --category development --limit 10
```

**Automation - JSON I/O:**
```bash
echo '{"category":"security","featured":true}' | plugin browse --input - --output -
```

---

## Search Contract

Search for plugins by text query.

### Command Signature

```bash
plugin search <query> [options]
```

### Positional Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | string | Yes | Search query string |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--exact` | boolean | false | Exact match only (no fuzzy search) |
| `--category, -c` | string | - | Filter by plugin category |
| `--tag, -t` | string | - | Filter by plugin tag |
| `--limit, -l` | number | 50 | Maximum results to return |
| `--input` | string | - | Load request from JSON file or stdin (`-`) |
| `--output` | string | - | Write response to JSON file or stdout (`-`) |

### Request Schema (JSON)

```typescript
interface SearchRequest {
  query: string;               // Required search query
  exact?: boolean;             // Exact match only (default: false)
  category?: string;           // Filter by category
  tag?: string;                // Filter by tag
  limit?: number;              // Max results (default: 50)
  offset?: number;             // Pagination offset (default: 0)
  correlationId?: string;      // Optional correlation ID
}
```

### Response Schema (JSON)

Same structure as `BrowseResponse`, with search-specific behavior:

- **Fuzzy matching** (default): Searches across `id`, `name`, `description`, and `tags` using substring matching
- **Exact matching** (`--exact`): Requires complete match in at least one field
- Results are sorted using the same deterministic comparator as browse

### Search Fields

The search query matches against:
- Plugin ID
- Plugin name
- Description text
- Tag values

All comparisons are case-insensitive.

### Example Usage

**CLI - Fuzzy search:**
```bash
plugin search "code review"
```

**CLI - Exact search with filters:**
```bash
plugin search linter --exact --category development
```

**Automation - JSON I/O:**
```bash
echo '{"query":"security","category":"security","exact":false}' | plugin search --input - --output -
```

---

## Info Contract

Display detailed information about a specific plugin.

### Command Signature

```bash
plugin info <plugin-id>
```

### Positional Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `plugin-id` | string | Yes | Unique plugin identifier |

### Options

| Option | Type | Description |
|--------|------|-------------|
| `--input` | string | Load request from JSON file or stdin (`-`) |
| `--output` | string | Write response to JSON file or stdout (`-`) |

### Request Schema (JSON)

```typescript
interface InfoRequest {
  pluginId: string;            // Required plugin identifier
  correlationId?: string;      // Optional correlation ID
}
```

### Response Schema (JSON)

```typescript
interface InfoResponse {
  success: boolean;
  status: 'success' | 'error' | 'warning';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;

  data?: {
    plugin: PluginEntry;       // Full plugin metadata
  };

  warnings?: string[];         // Stale index, integrity issues

  error?: {
    code: string;              // ERR-INFO-*, ERR-DISC-*
    message: string;
    severity: 'ERROR' | 'WARNING';
    category: string;
    specReference?: string;
    resolution?: string;
  };
}
```

### Example Usage

**CLI - Show plugin info:**
```bash
plugin info hookify
```

**Automation - JSON I/O:**
```bash
echo '{"pluginId":"pr-review-toolkit"}' | plugin info --input - --output -
```

---

## Common Patterns

### JSON Input/Output

All marketplace commands support automation via JSON I/O:

**Input sources** (priority order):
1. `--input <file>` - Read JSON from file
2. `--input -` - Read JSON from stdin
3. CLI arguments - Construct request from flags

**Output destinations** (when `--output` provided):
1. `--output <file>` - Write JSON to file (atomic write)
2. `--output -` - Write JSON to stdout

**Example automation workflow:**
```bash
# Generate request
echo '{"category":"security","limit":5}' > browse-request.json

# Execute command
plugin browse --input browse-request.json --output browse-response.json

# Process response
jq '.data.plugins[] | .id' browse-response.json
```

### Stale Index Warnings

Commands emit warnings when the marketplace index is stale (>24 hours old):

```json
{
  "warnings": [
    "Marketplace index is stale (48 hours old). Run marketplace generator to refresh."
  ]
}
```

**Resolution**: Run the marketplace generator to refresh the index from the git repository.

### Integrity Validation

Commands validate the cached marketplace using both the published content hash and optional signature:

```json
{
  "warnings": [
    "Marketplace index content hash mismatch detected. Regenerate marketplace.json to restore integrity.",
    "Marketplace index signature mismatch detected. Fetch the latest marketplace repo or rerun the generator to re-sign the index."
  ]
}
```

**Resolution**: Regenerate the marketplace index (or re-run the publish/generator flow) to refresh the hash and signature, or fetch the latest signed copy from the trusted git remote.

---

## Error Codes

### Discovery Errors (ERR-DISC-*)

| Code | Description | Resolution |
|------|-------------|------------|
| `ERR-DISC-001` | Marketplace index not found or unreadable | Run marketplace generator to create index |

### Browse Errors (ERR-BROWSE-*)

| Code | Description | Resolution |
|------|-------------|------------|
| `ERR-BROWSE-001` | Invalid browse parameters | Check filter values (category, tag) |
| `ERR-BROWSE-002` | Browse operation failed | Check logs for details |
| `ERR-BROWSE-999` | Unexpected browse error | Check error message and logs |

### Search Errors (ERR-SEARCH-*)

| Code | Description | Resolution |
|------|-------------|------------|
| `ERR-SEARCH-001` | Search query is required | Provide a search query string |
| `ERR-SEARCH-002` | Invalid search parameters | Check query and filter values |
| `ERR-SEARCH-999` | Unexpected search error | Check error message and logs |

### Info Errors (ERR-INFO-*)

| Code | Description | Resolution |
|------|-------------|------------|
| `ERR-INFO-001` | Plugin ID is required | Provide a valid plugin ID |
| `ERR-INFO-002` | Plugin not found | Check plugin ID, run "plugin browse" to see available plugins |
| `ERR-INFO-999` | Unexpected info error | Check error message and logs |

---

## Examples

### Example 1: Browse All Plugins

**Command:**
```bash
plugin browse --output -
```

**Response:**
```json
{
  "success": true,
  "status": "success",
  "message": "Found 5 plugin(s)",
  "transactionId": "txn_20260112_123456",
  "correlationId": "corr_abc123",
  "timestamp": "2026-01-12T10:30:00.000Z",
  "cliVersion": "1.0.0",
  "data": {
    "plugins": [
      {
        "id": "hookify",
        "name": "Hookify",
        "version": "1.0.0",
        "author": "kinginyellow",
        "description": "Create hooks to prevent unwanted AI behaviors",
        "source": "plugins/hookify",
        "category": "productivity",
        "tags": ["hooks", "behavior", "safety"],
        "featured": true,
        "verified": true
      }
    ],
    "totalCount": 5,
    "query": {
      "limit": 50,
      "offset": 0
    }
  }
}
```

### Example 2: Search with Filters

**Command:**
```bash
plugin search review --category development --output -
```

**Response:**
```json
{
  "success": true,
  "status": "success",
  "message": "Found 1 matching plugin(s)",
  "transactionId": "txn_20260112_123457",
  "correlationId": "corr_def456",
  "timestamp": "2026-01-12T10:31:00.000Z",
  "cliVersion": "1.0.0",
  "data": {
    "plugins": [
      {
        "id": "pr-review-toolkit",
        "name": "PR Review Toolkit",
        "version": "2.1.0",
        "author": "kinginyellow",
        "description": "Comprehensive PR review with specialized agents",
        "source": "plugins/pr-review-toolkit",
        "category": "development",
        "tags": ["code-review", "quality", "testing"],
        "featured": true,
        "verified": true,
        "downloads": 42
      }
    ],
    "totalCount": 1,
    "query": {
      "query": "review",
      "exact": false,
      "category": "development",
      "limit": 50,
      "offset": 0
    }
  }
}
```

### Example 3: Get Plugin Info

**Command:**
```bash
plugin info hookify --output -
```

**Response:**
```json
{
  "success": true,
  "status": "success",
  "message": "Plugin 'Hookify' (hookify)",
  "transactionId": "txn_20260112_123458",
  "correlationId": "corr_ghi789",
  "timestamp": "2026-01-12T10:32:00.000Z",
  "cliVersion": "1.0.0",
  "data": {
    "plugin": {
      "id": "hookify",
      "name": "Hookify",
      "version": "1.0.0",
      "author": "kinginyellow",
      "description": "Create hooks to prevent unwanted AI behaviors through conversation analysis or explicit instructions",
      "source": "plugins/hookify",
      "category": "productivity",
      "tags": ["hooks", "behavior", "safety", "ai-control"],
      "featured": true,
      "verified": true,
      "updatedAt": "2026-01-10T15:30:00Z"
    }
  }
}
```

### Example 4: Error Response

**Command:**
```bash
plugin info nonexistent-plugin --output -
```

**Response:**
```json
{
  "success": false,
  "status": "error",
  "message": "Plugin 'nonexistent-plugin' not found",
  "transactionId": "txn_20260112_123459",
  "correlationId": "corr_jkl012",
  "timestamp": "2026-01-12T10:33:00.000Z",
  "cliVersion": "1.0.0",
  "error": {
    "code": "ERR-INFO-002",
    "message": "Plugin 'nonexistent-plugin' not found in marketplace",
    "severity": "ERROR",
    "category": "DISCOVERY",
    "specReference": "FR-002",
    "resolution": "Check the plugin ID and try again, or run \"plugin browse\" to see available plugins"
  }
}
```

---

## Notes

- All timestamps use ISO 8601 format
- Plugin versions follow semantic versioning (semver)
- Categories are from the official enum (see marketplace.schema.json)
- Tags use kebab-case naming convention
- Responses include transactionId and correlationId for observability
- Commands work offline using cached marketplace.json
- Stale index threshold is 24 hours (configurable in domain service)

---

**References**:
- FR-001: Plugin discovery and browsing
- FR-002: Plugin search and information
- CRIT-006: CLI workflow control
- CRIT-007: Search and filtering capabilities
- Section 1.4: Key assumptions (deterministic ranking)
- Section 2: Data models (MarketplaceIndex, PluginEntry)
- Section 3: API style and contracts
