# Error Codes Reference

**Document Version**: 1.0.0
**Last Updated**: 2026-01-11
**Specification Reference**: Section 4.0 Essential Error Handling, Appendix F
**Source**: `packages/domain/src/validation/errorCatalog.ts`

---

## Overview

This document provides a comprehensive catalog of all error codes used in the Claude Code Plugin Marketplace. Each error code maps directly to specification requirements (FR-* and CRIT-* identifiers) ensuring traceability and consistent error handling across the system.

### Error Code Format

Error codes follow the pattern: `ERROR-{CATEGORY}-{NUMBER}`

- **CATEGORY**: Error domain (SCHEMA, COMPAT, INST, DISC, PERM, NET)
- **NUMBER**: Sequential identifier within category (001-999)

### Error Categories

| Category | Description | Specification Reference |
|----------|-------------|------------------------|
| `SCHEMA` | JSON Schema validation failures | FR-001, FR-002 |
| `COMPAT` | Compatibility and dependency issues | CRIT-002b, CRIT-005 |
| `INST` | Installation and lifecycle errors | CRIT-007, CRIT-010 |
| `DISC` | Discovery and marketplace errors | CRIT-008 |
| `PERM` | Permission and security errors | CRIT-012 |
| `NET` | Network and connectivity errors | CRIT-011 |

---

## Schema Validation Errors (SCHEMA)

### ERROR-SCHEMA-001: Invalid JSON

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
The provided data is not valid JSON and cannot be parsed.

**Common Causes**:
- Malformed JSON syntax (missing quotes, brackets, commas)
- Invalid UTF-8 encoding
- Trailing commas in JSON (not allowed in strict mode)

**Resolution**:
- Validate JSON syntax using a linter (e.g., `jsonlint`, VSCode JSON validation)
- Ensure file encoding is UTF-8
- Remove trailing commas

**Example**:
```json
{
  "name": "test-plugin",
  "version": "1.0.0",  // Trailing comma error
}
```

---

### ERROR-SCHEMA-002: Missing Required Field

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
A required field is missing from the manifest or marketplace file.

**Common Causes**:
- Omitted mandatory fields (e.g., `name`, `version`, `description`)
- Typo in field name
- Field present but value is `null` or `undefined`

**Resolution**:
- Add the required field to your manifest file
- Verify field name spelling matches schema exactly
- Ensure field has a non-null value

**Example Error**:
```
Path: /
Message: must have required property 'version'
```

**Fix**:
```json
{
  "name": "my-plugin",
  "version": "1.0.0"  // ← Added missing version
}
```

---

### ERROR-SCHEMA-003: Invalid Format

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
A field value does not match the expected format (e.g., URI, email, date-time, semver).

**Common Causes**:
- Invalid semantic version (e.g., `1.0` instead of `1.0.0`)
- Malformed URI (missing protocol)
- Invalid email format
- Incorrect date-time format (must be ISO 8601)
- Invalid kebab-case identifier (uppercase or spaces)

**Resolution**:
- **Semver**: Use three-part versioning (MAJOR.MINOR.PATCH, e.g., `1.2.3`)
- **URI**: Include protocol (e.g., `https://github.com/user/repo`)
- **Email**: Follow RFC 5322 format (e.g., `user@example.com`)
- **Date-time**: Use ISO 8601 format (e.g., `2026-01-11T10:00:00Z`)
- **Identifiers**: Use lowercase letters, numbers, and hyphens only (e.g., `my-plugin`)

**Examples**:
```json
// ❌ Invalid
{
  "version": "1.0",              // Missing patch version
  "url": "github.com/user/repo", // Missing protocol
  "updatedAt": "2026-01-11"      // Missing time
}

// ✅ Valid
{
  "version": "1.0.0",
  "url": "https://github.com/user/repo",
  "updatedAt": "2026-01-11T10:00:00Z"
}
```

---

### ERROR-SCHEMA-004: Invalid Type

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
A field value has the wrong data type (e.g., string instead of number).

**Common Causes**:
- Quoted numbers (`"123"` instead of `123`)
- String instead of array
- Object instead of string

**Resolution**:
- Verify expected type in schema documentation
- Remove quotes from numeric values
- Use correct JSON data type for field

**Examples**:
```json
// ❌ Invalid
{
  "downloads": "500",      // Should be number
  "tags": "testing",       // Should be array
  "featured": "true"       // Should be boolean
}

// ✅ Valid
{
  "downloads": 500,
  "tags": ["testing"],
  "featured": true
}
```

---

### ERROR-SCHEMA-005: Constraint Violation

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
A field value violates schema constraints (minLength, maxLength, minimum, maximum, etc.).

**Common Causes**:
- String too short or too long
- Number below minimum or above maximum
- Array has too few or too many items

**Resolution**:
- Check schema constraints for the field
- Adjust value to meet requirements
- Review specification for acceptable ranges

**Examples**:
```json
// ❌ Invalid
{
  "description": "Short",  // minLength: 10 characters
  "name": "x",             // minLength: 1, maxLength: 64
  "tags": ["tag1", "tag2", ..., "tag12"]  // maxItems: 10
}

// ✅ Valid
{
  "description": "This is a proper description with enough characters",
  "name": "valid-plugin-name",
  "tags": ["tag1", "tag2", "tag3"]
}
```

---

### ERROR-SCHEMA-006: Additional Property Not Allowed

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
The manifest contains fields not defined in the schema (`additionalProperties: false`).

**Common Causes**:
- Typo in field name
- Using deprecated field
- Adding custom fields not in schema

**Resolution**:
- Remove the unexpected field
- Check for typos in field names
- Review schema for correct field names

**Example**:
```json
// ❌ Invalid
{
  "name": "my-plugin",
  "version": "1.0.0",
  "customField": "value"  // ← Not in schema
}

// ✅ Valid
{
  "name": "my-plugin",
  "version": "1.0.0"
}
```

---

### ERROR-SCHEMA-007: Enum Value Mismatch

**Severity**: ERROR
**Category**: SCHEMA_VALIDATION
**Spec Reference**: FR-001, FR-002

**Description**:
A field value is not one of the allowed enumeration values.

**Common Causes**:
- Using invalid category (must be one of: development, productivity, security, learning, testing, design, database, deployment, monitoring)
- Invalid permission scope
- Invalid install state

**Resolution**:
- Use only values from the allowed enumeration
- Check specification for valid values
- Verify spelling and case sensitivity

**Examples**:
```json
// ❌ Invalid
{
  "category": "dev"  // Must be "development"
}

// ✅ Valid
{
  "category": "development"
}
```

**Allowed Categories**:
- `development`
- `productivity`
- `security`
- `learning`
- `testing`
- `design`
- `database`
- `deployment`
- `monitoring`

---

## Compatibility Errors (COMPAT)

### ERROR-COMPAT-001: Claude Code Version Too Low

**Severity**: ERROR
**Category**: COMPATIBILITY
**Spec Reference**: CRIT-002b

**Description**:
The plugin requires a newer version of Claude Code than currently installed.

**Resolution**:
- Update Claude Code to version >= `claudeCodeMin`
- Or choose a different plugin version compatible with your Claude Code version

**Example**:
```
Plugin requires: Claude Code >= 2.1.0
Your version: 2.0.12
```

---

### ERROR-COMPAT-002: Claude Code Version Too High

**Severity**: ERROR
**Category**: COMPATIBILITY
**Spec Reference**: CRIT-002b

**Description**:
The plugin does not support your Claude Code version (uses deprecated APIs).

**Resolution**:
- Downgrade Claude Code to version <= `claudeCodeMax`
- Or contact plugin maintainer for updated version
- Or choose a different plugin

**Example**:
```
Plugin supports: Claude Code <= 2.5.0
Your version: 3.0.0
```

---

### ERROR-COMPAT-003: Node.js Version Too Low

**Severity**: ERROR
**Category**: COMPATIBILITY
**Spec Reference**: CRIT-005

**Description**:
The plugin requires a newer Node.js version than currently installed.

**Resolution**:
- Install Node.js version >= `nodeMin`
- Use a version manager (nvm, fnm) to switch Node versions
- Verify plugin requirements before installation

**Example**:
```
Plugin requires: Node.js >= 20
Your version: 18.19.0
```

---

### ERROR-COMPAT-004: Platform Not Supported

**Severity**: ERROR
**Category**: COMPATIBILITY
**Spec Reference**: CRIT-005

**Description**:
The plugin does not support your operating system.

**Resolution**:
- Use a supported platform (check `compatibility.os` in manifest)
- Contact plugin maintainer to request platform support
- Find alternative plugin with same functionality

**Example**:
```
Plugin supports: linux, macos
Your platform: windows
```

---

### ERROR-COMPAT-005: Architecture Not Supported

**Severity**: ERROR
**Category**: COMPATIBILITY
**Spec Reference**: CRIT-005

**Description**:
The plugin does not support your CPU architecture.

**Resolution**:
- Use a supported architecture (check `compatibility.arch` in manifest)
- Contact plugin maintainer for architecture support
- Use emulation/compatibility layer (if available)

**Example**:
```
Plugin supports: x64
Your architecture: arm64
```

---

### ERROR-COMPAT-006: Plugin Dependency Missing

**Severity**: ERROR
**Category**: COMPATIBILITY
**Spec Reference**: CRIT-005

**Description**:
The plugin requires other plugins to be installed first.

**Resolution**:
- Install required plugin dependencies first
- Use `/plugin install <dependency-id>` for each dependency
- Review dependency tree before installation

**Example**:
```
Plugin requires: base-tools, git-integration
Missing: git-integration
```

---

## Installation Errors (INST)

### ERROR-INST-001: Plugin Not Found

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-007

**Description**:
The requested plugin ID does not exist in the marketplace.

**Resolution**:
- Verify plugin ID spelling (case-sensitive, kebab-case)
- Use `/plugin list` to browse available plugins
- Check if plugin has been deprecated or removed
- Ensure marketplace index is up to date

**Example**:
```
Requested plugin: "hookfy"
Did you mean: "hookify"?
```

---

### ERROR-INST-002: Version Not Found

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-007

**Description**:
The requested plugin version does not exist.

**Resolution**:
- Use `/plugin info <id>` to see available versions
- Omit version to install latest
- Check changelog for version history

**Example**:
```
Requested: hookify@2.0.0
Available: 1.0.0, 1.1.0, 1.2.3
```

---

### ERROR-INST-003: Already Installed

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-007

**Description**:
The plugin is already installed.

**Resolution**:
- Use `/plugin update <id>` to upgrade
- Use `/plugin uninstall <id>` then reinstall
- Use `--force` flag to reinstall (if supported)

---

### ERROR-INST-004: Download Failed

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-007, CRIT-011

**Description**:
Failed to download plugin files from source.

**Resolution**:
- Check network connectivity
- Verify repository URL is accessible
- Check firewall/proxy settings
- Retry installation

**Common Causes**:
- Network timeout
- Repository moved/deleted
- Authentication required
- Firewall blocking Git

---

### ERROR-INST-005: Checksum Mismatch

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-007

**Description**:
Downloaded plugin files do not match expected checksum (security risk).

**Resolution**:
- **DO NOT IGNORE THIS ERROR** (potential tampering)
- Re-download the plugin
- Verify marketplace integrity
- Report to marketplace maintainer

---

### ERROR-INST-006: Lifecycle Script Failed

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-010

**Description**:
A lifecycle script (preInstall, install, postInstall) failed during execution.

**Resolution**:
- Review lifecycle script logs
- Check script requirements (system dependencies)
- Verify script permissions
- Contact plugin maintainer if issue persists

**Example**:
```
Script: scripts/install.sh
Exit code: 1
Output: "Error: Missing dependency 'jq'"
```

---

### ERROR-INST-007: Invalid Manifest

**Severity**: ERROR
**Category**: INSTALLATION
**Spec Reference**: CRIT-007

**Description**:
The plugin manifest file (plugin.json) is invalid or corrupted.

**Resolution**:
- Report to plugin maintainer
- Verify marketplace entry points to correct manifest
- Re-download plugin
- Check for JSON syntax errors

---

## Discovery Errors (DISC)

### ERROR-DISC-001: Marketplace Not Found

**Severity**: ERROR
**Category**: DISCOVERY
**Spec Reference**: CRIT-008

**Description**:
The marketplace.json file does not exist or is not accessible.

**Resolution**:
- Initialize marketplace: `/plugin marketplace init`
- Verify file path: `.claude-plugin/marketplace.json`
- Check file permissions
- Pull latest from Git remote

---

### ERROR-DISC-002: Marketplace Invalid

**Severity**: ERROR
**Category**: DISCOVERY
**Spec Reference**: CRIT-008

**Description**:
The marketplace.json file fails schema validation.

**Resolution**:
- Review marketplace.json against schema
- Fix validation errors (see SCHEMA errors above)
- Regenerate marketplace index
- Restore from Git backup

---

### ERROR-DISC-003: Plugin Reference Broken

**Severity**: ERROR
**Category**: DISCOVERY
**Spec Reference**: CRIT-008

**Description**:
A plugin entry in marketplace.json points to a non-existent manifest.

**Resolution**:
- Verify plugin source path exists
- Check if plugin was moved/deleted
- Update marketplace.json to fix path
- Remove broken entry from marketplace

**Example**:
```
Plugin ID: hookify
Source path: plugins/hookify
Manifest: plugins/hookify/plugin.json (NOT FOUND)
```

---

### ERROR-DISC-004: Changelog Unavailable

**Severity**: WARNING (non-blocking)
**Category**: DISCOVERY
**Spec Reference**: CRIT-008

**Description**:
The plugin's changelog URL is unreachable or returns an error.

**Resolution**:
- Installation can proceed (warning only)
- Contact plugin maintainer about broken link
- Check plugin repository directly for changelog

---

## Permission Errors (PERM)

### ERROR-PERM-001: Missing Permission Declaration

**Severity**: ERROR
**Category**: PERMISSION
**Spec Reference**: CRIT-012

**Description**:
Plugin attempts to access resources without declaring required permissions.

**Resolution**:
- Contact plugin maintainer to add permission declarations
- Review plugin source code for security concerns
- Do not install until permissions are properly declared

---

### ERROR-PERM-002: Invalid Permission Scope

**Severity**: ERROR
**Category**: PERMISSION
**Spec Reference**: CRIT-012

**Description**:
Permission scope is not one of the allowed values.

**Allowed Scopes**:
- `filesystem`
- `network`
- `shell`
- `env`
- `claude-api`

**Resolution**:
- Contact plugin maintainer to fix permission scope
- Review schema documentation

---

### ERROR-PERM-003: Consent Required

**Severity**: ERROR
**Category**: PERMISSION
**Spec Reference**: CRIT-012

**Description**:
User must explicitly consent to plugin permissions before installation.

**Resolution**:
- Review requested permissions carefully
- Grant consent if permissions are acceptable
- Deny installation if permissions are excessive

---

## Network Errors (NET)

### ERROR-NET-001: Fetch Failed

**Severity**: ERROR
**Category**: NETWORK
**Spec Reference**: CRIT-011

**Description**:
Failed to fetch data from network (marketplace, plugin, changelog).

**Resolution**:
- Check network connectivity
- Verify URL is accessible
- Check firewall/proxy settings
- Retry operation

---

### ERROR-NET-002: Timeout

**Severity**: ERROR
**Category**: NETWORK
**Spec Reference**: CRIT-011

**Description**:
Network request exceeded timeout limit.

**Resolution**:
- Check network speed
- Retry with better connection
- Increase timeout (if configurable)

---

### ERROR-NET-003: Parse Failed

**Severity**: ERROR
**Category**: NETWORK
**Spec Reference**: CRIT-011

**Description**:
Downloaded data could not be parsed (invalid JSON, corrupted data).

**Resolution**:
- Verify source data integrity
- Re-download data
- Report to maintainer if issue persists

---

## Error Handling Best Practices

### For CLI Users

1. **Read Error Messages**: Error messages include resolution guidance
2. **Check Error Codes**: Use this reference for detailed explanations
3. **Review Logs**: Enable verbose logging for debugging
4. **Report Issues**: Contact plugin maintainer or file bug report

### For Plugin Developers

1. **Validate Manifests**: Use `/plugin validate` before publishing
2. **Test Compatibility**: Verify across Claude Code versions, Node versions, platforms
3. **Document Permissions**: Clearly explain why permissions are needed
4. **Handle Errors Gracefully**: Provide helpful error messages in lifecycle scripts
5. **Keep Changelogs Updated**: Ensure changelog URLs are accessible

### For Marketplace Maintainers

1. **Validate Before Publish**: Run schema validation on all entries
2. **Monitor Broken Links**: Periodically check plugin references
3. **Sign Marketplace**: Use cryptographic signatures for integrity
4. **Version Control**: Keep marketplace.json in Git for rollback

---

## Specification Traceability

### Functional Requirements (FR)

| Error Category | FR Reference | Description |
|----------------|--------------|-------------|
| SCHEMA | FR-001 | Schema-driven validation |
| SCHEMA | FR-002 | Marketplace index validation |
| COMPAT | FR-003 | Compatibility checking |
| INST | FR-004 | Plugin installation |
| PERM | FR-012 | Permission declarations |

### Critical Fixes (CRIT)

| Error Code | CRIT Reference | Correction Applied |
|------------|----------------|-------------------|
| COMPAT-001/002 | CRIT-002b | Claude Code version constraints |
| COMPAT-003/004/005/006 | CRIT-005 | Platform/dependency validation |
| INST-001/002/003/004/005/006/007 | CRIT-007 | Installation error handling |
| DISC-004 | CRIT-008 | Changelog fallback logic |
| INST-006 | CRIT-010 | Lifecycle script execution |
| NET-001/002/003 | CRIT-011 | Network retry logic |
| PERM-001/002/003 | CRIT-012 | Permission consent flow |

---

## Appendix: Error Response Format

All validation errors return structured responses:

```typescript
interface DomainValidationError {
  code: string;              // e.g., "ERROR-SCHEMA-002"
  message: string;           // Human-readable message
  path: string;              // JSON path (e.g., "/plugins/0/version")
  severity: "ERROR" | "WARNING";
  category: string;          // e.g., "SCHEMA_VALIDATION"
  context?: object;          // Additional debugging context
  specReference?: string;    // e.g., "CRIT-007, FR-004"
  resolution?: string;       // Suggested fix
}
```

**Example**:
```json
{
  "code": "ERROR-SCHEMA-002",
  "message": "must have required property 'version'",
  "path": "/",
  "severity": "ERROR",
  "category": "SCHEMA_VALIDATION",
  "context": {
    "keyword": "required",
    "missingProperty": "version"
  },
  "specReference": "FR-001, FR-002",
  "resolution": "Add the required field to your manifest file"
}
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-11 | Initial error catalog (I1.T3 deliverable) |

---

**For Updates**: This document is generated from `packages/domain/src/validation/errorCatalog.ts`.
**Spec Reference**: docs/SPECIFICATION.md (Section 4.0, Appendix F)
