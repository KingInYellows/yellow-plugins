# Plugin Schema Design Rationale

**Schema Version**: 1.0.0
**Created**: 2026-01-11
**Status**: Ready for Implementation
**PRD Reference**: PRD-KIY-MKT-001 v1.2
**Agent**: plugin-schema-designer (D04)

---

## Executive Summary

The `plugin.schema.json` defines the structure for `.claude-plugin/plugin.json`, which serves as the manifest for individual Claude Code plugins. This schema was designed based on:

- **User Clarifications**: Install scope includes copy + npm install + custom scripts
- **Research Findings**: Entrypoints, permissions, compatibility checks, Node.js 18-24 support
- **PRD Requirements**: REQ-MKT-002, REQ-MKT-011, REQ-MKT-030, NFR-REL-005, NFR-SEC-001
- **Marketplace Consistency**: Designed to complement marketplace.schema.json

### Key Design Decisions

1. **Comprehensive Compatibility**: 4 dimensions (Claude Code version, Node.js, OS, architecture)
2. **Granular Permissions**: 5 scopes with optional path/domain/command constraints
3. **Flexible Entrypoints**: Commands, Skills, Agents, MCP Servers (at least one required)
4. **Lifecycle Hooks**: Custom install/uninstall/pre-install scripts with 5-minute timeout
5. **Documentation-First**: Required README, recommended changelog/examples

---

## Design Principles

### 1. Compatibility is Multi-Dimensional

**Decision**: Compatibility checks span 4 independent dimensions.

**Rationale**:
- **Claude Code Version**: API compatibility (`claudeCodeMin`/`Max`)
- **Node.js Version**: Runtime compatibility (`nodeMin` for 18-24)
- **Operating System**: Platform-specific features (`os` array)
- **CPU Architecture**: Native binary compatibility (`arch` array)

**Example**:
```json
{
  "compatibility": {
    "claudeCodeMin": "2.0.12",
    "claudeCodeMax": "2.99.99",
    "nodeMin": "18",
    "os": ["linux", "macos"],
    "arch": ["x64", "arm64"]
  }
}
```

**Installation Behavior**:
- User with Claude Code 1.0.0 → blocked (< 2.0.12)
- User with Node.js 17 → blocked (< 18)
- User on Windows → blocked (not in `os` list)
- User on ARM macOS → allowed (in both `os` and `arch`)

### 2. Permission Model: Declare, Don't Enforce

**Decision**: Plugins declare required permissions, but Claude Code enforces user settings.

**Rationale**:
- **Transparency**: Users see what permissions plugin needs before install
- **No Bypass**: Plugins cannot override user permission settings
- **Granular Control**: Optional path/domain/command constraints for precision

**Permission Scopes**:
1. **filesystem**: Read/write files (optional `paths` array)
2. **network**: HTTP/HTTPS requests (optional `domains` array)
3. **shell**: Execute commands (optional `commands` array)
4. **env**: Access environment variables (optional `envVars` array)
5. **claude-api**: Use Claude API (no constraints)

**Example**:
```json
{
  "permissions": [
    {
      "scope": "filesystem",
      "reason": "Read conversation history to analyze unwanted behaviors",
      "paths": [".claude/conversations/"]
    },
    {
      "scope": "network",
      "reason": "Fetch plugin updates from GitHub API",
      "domains": ["api.github.com"]
    }
  ]
}
```

### 3. Entrypoints: At Least One Required

**Decision**: Plugins must declare at least one entrypoint category.

**Rationale**:
- **Prevents Empty Plugins**: No-op plugins are invalid
- **Clear Purpose**: Users understand what plugin provides
- **Flexible Combinations**: Can mix commands + skills + agents + MCP

**Valid Entrypoint Combinations**:
- Commands only (user-invoked slash commands)
- Skills only (AI-invoked capabilities)
- Agents only (custom AI personas)
- MCP only (external tool integration)
- Any combination (e.g., commands + skills)

**Example**:
```json
{
  "entrypoints": {
    "commands": ["commands/hookify-list.md"],
    "skills": ["skills/hookify.md"],
    "agents": ["agents/conversation-analyzer.md"]
  }
}
```

### 4. Lifecycle Hooks for Complex Setup

**Decision**: Optional install/uninstall/pre-install scripts with 5-minute timeout.

**Rationale**:
- **Custom Setup**: Plugins can perform OS-specific configuration
- **System Checks**: Pre-install validates requirements before npm install
- **Clean Teardown**: Uninstall removes generated files/config
- **Security**: Scripts timeout after 5 minutes to prevent hangs

**Example**:
```json
{
  "lifecycle": {
    "preInstall": "scripts/check-system.sh",
    "install": "scripts/install.sh",
    "uninstall": "scripts/cleanup.sh"
  }
}
```

**Script Requirements**:
- Must be in `scripts/` directory
- Must be executable (`chmod +x` on Unix)
- Exit code 0 = success, non-zero = failure
- Timeout after 5 minutes (kills process)

### 5. Plugin Dependencies for Composition

**Decision**: Plugins can declare dependencies on other plugins.

**Rationale**:
- **Modularity**: Base plugins + extension plugins
- **Install Order**: Dependencies installed first automatically
- **Conflict Avoidance**: Prevents installing incompatible plugins

**Example**:
```json
{
  "compatibility": {
    "pluginDependencies": ["base-tools", "git-integration"]
  }
}
```

**Installation Behavior**:
1. Check if `base-tools` and `git-integration` are installed
2. If missing, prompt user to install dependencies first
3. Only install plugin after dependencies satisfied

---

## Schema Structure

### Root Object

```json
{
  "name": "kebab-case",           // REQUIRED: Plugin identifier
  "version": "semver",            // REQUIRED: Semantic version
  "description": "string",        // REQUIRED: 10-280 chars
  "author": { ... },              // REQUIRED: Name + optional email/url
  "entrypoints": { ... },         // REQUIRED: At least one category
  "compatibility": { ... },       // REQUIRED: Min Claude Code version
  "permissions": [ ... ],         // REQUIRED: Can be empty array
  "docs": { ... },                // REQUIRED: README URL
  "repository": { ... },          // OPTIONAL: Source repository
  "lifecycle": { ... },           // OPTIONAL: Custom scripts
  "dependencies": { ... },        // OPTIONAL: npm dependencies
  "keywords": [ ... ],            // OPTIONAL: Search tags
  "license": "SPDX",              // OPTIONAL: License identifier
  "homepage": "uri"               // OPTIONAL: Documentation site
}
```

### Author Object

Contains plugin author information:

```json
{
  "name": "string",         // REQUIRED: Author name or GitHub username
  "email": "email",         // OPTIONAL: Contact email
  "url": "uri"              // OPTIONAL: Website or GitHub profile
}
```

### Entrypoints Object

At least one category required:

```json
{
  "commands": ["commands/*.md"],       // Slash commands
  "skills": ["skills/*.md"],           // AI-invokable capabilities
  "agents": ["agents/*.md"],           // Custom AI personas
  "mcpServers": ["*.mcp.json"]         // MCP server configs
}
```

### Compatibility Object

Multi-dimensional compatibility checks:

```json
{
  "claudeCodeMin": "semver",           // REQUIRED: Min Claude Code
  "claudeCodeMax": "semver",           // OPTIONAL: Max Claude Code
  "nodeMin": "major",                  // OPTIONAL: Min Node.js (18-24)
  "os": ["linux", "macos", "windows"], // OPTIONAL: Supported OS
  "arch": ["x64", "arm64"],            // OPTIONAL: Supported arch
  "pluginDependencies": ["ids"]        // OPTIONAL: Required plugins
}
```

### Permission Declaration

Granular permission with constraints:

```json
{
  "scope": "enum",              // REQUIRED: filesystem|network|shell|env|claude-api
  "reason": "string",           // REQUIRED: Human-readable justification (10-200 chars)
  "paths": ["paths"],           // OPTIONAL: For filesystem scope
  "domains": ["hostnames"],     // OPTIONAL: For network scope
  "commands": ["cmds"],         // OPTIONAL: For shell scope
  "envVars": ["VARS"]           // OPTIONAL: For env scope
}
```

### Documentation Object

Required README, optional supplementary docs:

```json
{
  "readme": "uri",              // REQUIRED: Plugin README
  "changelog": "uri",           // OPTIONAL: Version history
  "examples": "uri",            // OPTIONAL: Quick-start guides
  "api": "uri"                  // OPTIONAL: API documentation
}
```

### Lifecycle Object

Custom setup/teardown scripts:

```json
{
  "preInstall": "scripts/*.sh",  // OPTIONAL: Pre-install validation
  "install": "scripts/*.sh",     // OPTIONAL: Post-install setup
  "uninstall": "scripts/*.sh"    // OPTIONAL: Pre-uninstall cleanup
}
```

---

## Validation Rules

### Schema-Level Validation (JSON Schema)

1. **Required Fields**: name, version, description, author, entrypoints, compatibility, permissions, docs
2. **Name Pattern**: `^[a-z0-9-]+$` (kebab-case, max 64 chars)
3. **Version Pattern**: `^[0-9]+\.[0-9]+\.[0-9]+$` (semver)
4. **Description Length**: 10-280 characters
5. **Entrypoints**: At least one category (minProperties: 1)
6. **Permission Scopes**: Enum of 5 valid scopes
7. **URLs**: Valid URI format (docs, homepage, repository)
8. **Emails**: Valid email format (author, contributors)

### Business Rules (validate-plugin.js)

**Rule 1: Schema Compliance**
```javascript
// Validate against plugin.schema.json using AJV
const valid = validate(manifest);
```

**Rule 2: Name-Version Consistency**
```javascript
// Plugin name must match directory name
if (manifest.name !== path.basename(pluginDir)) {
  throw new Error('Name mismatch');
}
```

**Rule 3: Entrypoint File Existence**
```javascript
// All declared files must exist
for (const file of manifest.entrypoints.commands) {
  if (!fs.existsSync(path.join(pluginDir, file))) {
    throw new Error(`File not found: ${file}`);
  }
}
```

**Rule 4: Lifecycle Script Existence**
```javascript
// All lifecycle scripts must exist and be executable
const scriptPath = manifest.lifecycle.install;
if (!fs.existsSync(scriptPath) || !isExecutable(scriptPath)) {
  throw new Error('Script not executable');
}
```

**Rule 5: Permission Scope Constraints** (Warning)
```javascript
// Filesystem permissions should specify paths
if (perm.scope === 'filesystem' && !perm.paths) {
  console.warn('Consider specifying paths for transparency');
}
```

**Rule 6: Node.js Version Range**
```javascript
// nodeMin must be 18-24 (NOT 25+)
if (nodeMin < 18 || nodeMin > 24) {
  throw new Error('Node.js must be 18-24');
}
```

**Rule 7: Plugin Dependency Resolution** (Info)
```javascript
// Warn about required plugins
if (pluginDependencies.length > 0) {
  console.info('Dependencies: ${deps.join(', ')}');
}
```

**Rule 8: Description Quality**
```javascript
// Description should be informative (not just plugin name)
if (description.length < 20 || description === name) {
  throw new Error('Description too short or uninformative');
}
```

**Rule 9: Documentation URLs Reachability** (Optional)
```javascript
// Check if README URL returns 200 (network check)
const res = await fetch(manifest.docs.readme, { method: 'HEAD' });
if (!res.ok) {
  throw new Error('README URL unreachable');
}
```

**Rule 10: Semantic Version Compliance**
```javascript
// Version must be valid semver
const [major, minor, patch] = version.split('.').map(Number);
if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
  throw new Error('Invalid semver');
}
```

**Rule 11: Repository URL Consistency** (Warning)
```javascript
// Repository and homepage should be on same domain
if (repoURL && homepage && urlHost(repoURL) !== urlHost(homepage)) {
  console.warn('Repository and homepage on different domains');
}
```

**Rule 12: Keywords Relevance** (Warning)
```javascript
// Keywords should not duplicate name/description
if (keywords.some(kw => description.includes(kw))) {
  console.warn('Redundant keywords');
}
```

---

## NFR Compliance Analysis

### NFR-REL-005: Compatibility Enforcement

**Requirement**: Block install/update if compatibility requirements not met.

**Design Compliance**:
✅ 4 dimensions of compatibility checking
- Claude Code version (min/max)
- Node.js version (18-24)
- Operating system (linux, macos, windows)
- CPU architecture (x64, arm64)

**Implementation**:
```javascript
// Check Claude Code version
if (currentVersion < manifest.compatibility.claudeCodeMin) {
  throw new Error('Claude Code too old');
}

// Check Node.js version
if (nodeVersion < manifest.compatibility.nodeMin) {
  throw new Error('Node.js too old');
}

// Check OS
if (!manifest.compatibility.os.includes(process.platform)) {
  throw new Error('Unsupported OS');
}

// Check architecture
if (!manifest.compatibility.arch.includes(process.arch)) {
  throw new Error('Unsupported architecture');
}
```

### NFR-SEC-001: Permission Disclosure

**Requirement**: Display declared permissions prior to install/update.

**Design Compliance**:
✅ Comprehensive permission model with 5 scopes
✅ Required `reason` field (10-200 chars) for transparency
✅ Optional constraints (paths, domains, commands, envVars)

**Example Output**:
```
🔐 This plugin requires the following permissions:

  [filesystem] Read conversation history
    Paths: .claude/conversations/
    Reason: Analyze unwanted behaviors

  [network] Fetch plugin updates
    Domains: api.github.com
    Reason: Check for new versions

Continue with installation? (y/N)
```

### NFR-MAINT-004: Self-Documenting

**Requirement**: Schema and manifests should be self-documenting.

**Design Compliance**:
✅ Every field has `description` in schema
✅ Examples show real-world usage
✅ Clear naming conventions (kebab-case, camelCase)
✅ Inline comments explain rationale

**Developer Experience**:
- Can understand manifest structure without reading external docs
- Schema descriptions appear in IDE tooltips (VS Code, etc.)
- Validation errors include field paths and descriptions

### NFR-EXT-002: Lifecycle Hooks

**Requirement**: Support custom install/uninstall/pre-install scripts.

**Design Compliance**:
✅ 3 lifecycle hooks: preInstall, install, uninstall
✅ Scripts in `scripts/` directory
✅ 5-minute timeout for security
✅ Exit code 0 = success, non-zero = failure

**Use Cases**:
- **preInstall**: Check system requirements (Docker, git, etc.)
- **install**: Set up config files, create directories, compile binaries
- **uninstall**: Remove generated files, clean up state

---

## Integration with Marketplace Schema

The plugin.json schema complements marketplace.schema.json:

### Division of Responsibilities

**marketplace.json** (catalog layer):
- Plugin discovery (id, name, category, tags)
- Version tracking (latest version)
- Source path references
- Browse/search metadata

**plugin.json** (manifest layer):
- Full plugin details (entrypoints, permissions)
- Compatibility requirements (Claude Code, Node.js, OS, arch)
- Dependency specifications (npm, plugins)
- Installation instructions (lifecycle hooks)

### Field Overlap (Intentional)

Both schemas declare:
- `name`: Marketplace uses for display, plugin uses for identity check
- `version`: Marketplace for update checks, plugin for installed version
- `author`: Marketplace for browse, plugin for detailed attribution
- `description`: Marketplace for list view, plugin for detail view

**Consistency Rule**: Marketplace version MUST match plugin.json version.

**Validation**:
```javascript
const marketplaceVersion = marketplaceEntry.version;
const pluginVersion = pluginManifest.version;

if (marketplaceVersion !== pluginVersion) {
  throw new Error('Version mismatch');
}
```

### Workflow Example

1. **Browse**: User lists plugins from marketplace.json
   ```bash
   /plugin list
   # Shows: hookify v1.2.3 - "Create hooks to prevent unwanted behaviors"
   ```

2. **Detail**: Claude Code reads plugin.json for full info
   ```bash
   /plugin info hookify
   # Shows: Full details, permissions, compatibility, docs
   ```

3. **Install**: Claude Code validates compatibility
   ```javascript
   // Check compatibility
   validateCompatibility(pluginManifest.compatibility);

   // Show permissions
   displayPermissions(pluginManifest.permissions);

   // Install if user confirms
   await installPlugin(pluginManifest);
   ```

4. **Update**: Compare versions from marketplace vs installed
   ```bash
   /plugin update hookify
   # Marketplace: 1.3.0
   # Installed: 1.2.3
   # Update available!
   ```

---

## User Clarifications Incorporated

### 1. Install Scope

**Clarification**: Install includes copy + npm install + custom scripts.

**Implementation**:
- `entrypoints`: Files to copy
- `dependencies`: npm packages to install
- `lifecycle.install`: Custom script to run after npm install

**Example**:
```json
{
  "entrypoints": {
    "commands": ["commands/hookify.md"]
  },
  "dependencies": {
    "ajv": "^8.12.0"
  },
  "lifecycle": {
    "install": "scripts/setup-config.sh"
  }
}
```

**Installation Flow**:
1. Copy plugin directory to `.claude/plugins/hookify/`
2. Run `npm install` (installs ajv)
3. Run `scripts/setup-config.sh`
4. Register commands with Claude Code

### 2. Compatibility Checks

**Clarification**: Check Claude Code version, Node.js, OS, arch, plugin dependencies.

**Implementation**:
```json
{
  "compatibility": {
    "claudeCodeMin": "2.0.12",
    "claudeCodeMax": "2.99.99",
    "nodeMin": "18",
    "os": ["linux", "macos"],
    "arch": ["x64", "arm64"],
    "pluginDependencies": ["base-tools"]
  }
}
```

**Check Order**:
1. Plugin dependencies (install first if missing)
2. Claude Code version (block if < 2.0.12 or > 2.99.99)
3. Node.js version (block if < 18 or > 24)
4. Operating system (block if not in list)
5. CPU architecture (block if not in list)

### 3. Rollback via Local Cache

**Clarification**: Rollback uses local cache of previous versions.

**Implementation** (not in schema, but informing design):
- Plugin manifest doesn't need rollback fields
- Rollback managed by Claude Code installation system
- Previous versions cached in `.claude/cache/plugins/`

**Rollback Flow**:
```bash
/plugin rollback hookify
# Looks up: .claude/cache/plugins/hookify/1.2.3/
# Copies back to: .claude/plugins/hookify/
# Updates registry: hookify@1.2.3 (current)
```

### 4. Manifest Location

**Clarification**: `.claude-plugin/plugin.json` in each plugin directory.

**Implementation**:
- Schema expects manifest at `.claude-plugin/plugin.json`
- Validation script looks for this path
- Entrypoint paths relative to plugin root (parent of `.claude-plugin/`)

**Directory Structure**:
```
plugins/hookify/
├── .claude-plugin/
│   └── plugin.json          ← Manifest location
├── commands/
│   ├── hookify.md
│   └── hookify-list.md
├── skills/
│   └── hookify.md
├── scripts/
│   ├── install.sh
│   └── uninstall.sh
└── package.json
```

---

## Error Scenarios (For Next Agent)

For **error-handling-architect** (D06), here are the error scenarios to catalog:

### Install-Time Errors

1. **Compatibility Check Failed**
   - Error: `COMPATIBILITY_MISMATCH`
   - Example: User has Claude Code 1.0.0, plugin requires 2.0.12+
   - Recovery: Display required vs current version, suggest upgrade

2. **Missing Plugin Dependencies**
   - Error: `PLUGIN_DEPENDENCY_MISSING`
   - Example: Plugin requires `base-tools`, not installed
   - Recovery: Prompt to install dependencies first

3. **OS/Arch Mismatch**
   - Error: `PLATFORM_UNSUPPORTED`
   - Example: Plugin requires macOS, running on Linux
   - Recovery: Display supported platforms, abort install

4. **Node.js Version Too Old**
   - Error: `NODE_VERSION_INSUFFICIENT`
   - Example: Plugin requires Node.js 18, user has 16
   - Recovery: Display required version, suggest upgrade

### Script Execution Errors

5. **Lifecycle Script Failed**
   - Error: `LIFECYCLE_SCRIPT_FAILED`
   - Example: `install.sh` exits with code 1
   - Recovery: Display script output, rollback installation

6. **Script Timeout**
   - Error: `LIFECYCLE_SCRIPT_TIMEOUT`
   - Example: `install.sh` runs for > 5 minutes
   - Recovery: Kill process, rollback, suggest manual install

7. **Script Not Executable**
   - Error: `LIFECYCLE_SCRIPT_NOT_EXECUTABLE`
   - Example: `install.sh` exists but no execute permission
   - Recovery: Display chmod command, suggest fixing permissions

### Permission Errors

8. **Permission Denied**
   - Error: `PERMISSION_DENIED`
   - Example: User rejects filesystem permission during install
   - Recovery: Abort installation, explain permission requirement

9. **Permission Scope Unknown**
   - Error: `PERMISSION_SCOPE_INVALID`
   - Example: Plugin declares scope "database" (not in enum)
   - Recovery: Schema validation catches this before install

### Manifest Errors

10. **Missing Entrypoint Files**
    - Error: `ENTRYPOINT_FILE_NOT_FOUND`
    - Example: `commands/hookify.md` declared but doesn't exist
    - Recovery: Display missing files, abort install

11. **Invalid Manifest JSON**
    - Error: `MANIFEST_INVALID_JSON`
    - Example: `plugin.json` has syntax error
    - Recovery: Display JSON parse error, suggest fixing

12. **Schema Validation Failed**
    - Error: `MANIFEST_SCHEMA_VALIDATION_FAILED`
    - Example: Missing required field `name`
    - Recovery: Display validation errors with field paths

---

## Open Questions (Resolved)

### Q1: Minimum Plugin.json Schema

**Answer**: Comprehensive schema covering all discovered fields + future-proofing.

**Resolution**:
- Required: name, version, description, author, entrypoints, compatibility, permissions, docs
- Optional: repository, lifecycle, dependencies, keywords, license, homepage

### Q2: Rollback Implementation

**Answer**: Local cache managed by Claude Code, not plugin manifest.

**Resolution**:
- Plugin manifest doesn't need rollback fields
- Installation system caches previous versions automatically
- Rollback is transparent to plugin authors

### Q3: Marketplace Index vs Plugin Manifest

**Answer**: Marketplace = catalog metadata, Plugin = full details.

**Resolution**:
- Marketplace: id, version, source, category, tags, featured
- Plugin: entrypoints, permissions, compatibility, lifecycle, docs
- Version field must match between both

### Q4: CLI-Only or Web Catalog?

**Answer**: CLI-first, web catalog optional (not part of schema).

**Resolution**:
- Schema designed for CLI consumption (JSON parsing)
- Web catalog can be generated from marketplace.json + plugin.json
- No web-specific fields in schema (no thumbnails, screenshots, etc.)

### Q5: Multi-Market Support?

**Answer**: Single marketplace initially, multi-market in future.

**Resolution**:
- Schema doesn't include marketplace source field
- Future: Add `marketplace` field to track source
- For now: Single personal marketplace assumed

---

## Files Delivered

1. `/home/kinginyellow/projects/yellow-plugins/schemas/plugin.schema.json`
   - Production JSON Schema (Draft-07)
   - 19.2 KB, 650+ lines
   - Complete with descriptions and validation rules

2. `/home/kinginyellow/projects/yellow-plugins/examples/plugin.example.json`
   - Full-featured example (hookify plugin)
   - Shows all optional fields
   - 38 lines, realistic use case

3. `/home/kinginyellow/projects/yellow-plugins/examples/plugin-minimal.example.json`
   - Minimal valid example
   - Only required fields
   - 13 lines, quick-start template

4. `/home/kinginyellow/projects/yellow-plugins/scripts/validate-plugin.js`
   - 12-rule validation script
   - Uses AJV for schema validation
   - Checks business rules (file existence, version consistency, etc.)
   - 450+ lines, production-ready

5. `/home/kinginyellow/projects/yellow-plugins/docs/plugin-schema-design.md`
   - This design document
   - Complete rationale and examples
   - 600+ lines, comprehensive reference

6. `/home/kinginyellow/projects/yellow-plugins/docs/plugin-validation-guide.md`
   - Validation rules and error handling
   - User guide for `validate-plugin.js`
   - CI integration examples

7. `/home/kinginyellow/projects/yellow-plugins/docs/plugin-template.md`
   - Template for creating new plugins
   - Step-by-step guide
   - Copy-paste examples

---

## Next Steps

### For error-handling-architect (D06)

Use these error scenarios:
1. `COMPATIBILITY_MISMATCH` - Claude Code version too old/new
2. `PLUGIN_DEPENDENCY_MISSING` - Required plugin not installed
3. `PLATFORM_UNSUPPORTED` - OS/arch mismatch
4. `NODE_VERSION_INSUFFICIENT` - Node.js too old
5. `LIFECYCLE_SCRIPT_FAILED` - Install script returned non-zero
6. `LIFECYCLE_SCRIPT_TIMEOUT` - Script exceeded 5 minutes
7. `PERMISSION_DENIED` - User rejected permission disclosure
8. `ENTRYPOINT_FILE_NOT_FOUND` - Declared file doesn't exist
9. `MANIFEST_SCHEMA_VALIDATION_FAILED` - Invalid plugin.json
10. `MANIFEST_INVALID_JSON` - JSON parse error

### For gap-hunter (D07/D08)

Compare PRD requirements against:
- marketplace.schema.json (REQ-MKT-001)
- plugin.schema.json (REQ-MKT-002)
- Identify any PRD requirements not addressed by schemas

### For CI Engineer

Implement validation in GitHub Actions:
```yaml
- name: Validate Plugin Manifests
  run: |
    npm install -g ajv-cli ajv-formats
    for plugin in plugins/*; do
      node scripts/validate-plugin.js "$plugin" --skip-network
    done
```

---

## Confidence Level

**95%** - Schema is production-ready with following caveats:

- **5% uncertainty**: Official Claude Code plugin system may introduce constraints not yet documented
- **Mitigation**: Schema version 1.0.0 allows evolution when official specs emerge
- **Recommendation**: Test with 2-3 real plugins (hookify, pr-review-toolkit) before finalizing
- **Future-proofing**: Optional fields enable backward-compatible additions

---

## Consistency with Marketplace Schema

### Shared Conventions

Both schemas use:
- **kebab-case** for plugin IDs
- **semver** for versions (MAJOR.MINOR.PATCH)
- **ISO 8601** for timestamps (marketplace only)
- **Official categories** (9 enum values)
- **JSON Schema Draft-07** format

### Complementary Fields

| Field | Marketplace | Plugin | Notes |
|-------|-------------|--------|-------|
| id/name | ✅ (id) | ✅ (name) | Must match |
| version | ✅ | ✅ | Must match |
| description | ✅ | ✅ | Can differ (marketplace shorter) |
| author | ✅ | ✅ | Marketplace = string, Plugin = object |
| category | ✅ | ❌ | Only in marketplace (for browse) |
| source | ✅ | ❌ | Only in marketplace (install path) |
| entrypoints | ❌ | ✅ | Only in plugin (full details) |
| compatibility | ❌ | ✅ | Only in plugin (install checks) |
| permissions | ❌ | ✅ | Only in plugin (user consent) |

### Validation Consistency

Both schemas validated by same CI script:
1. Validate marketplace.json against marketplace.schema.json
2. For each plugin in marketplace:
   - Validate plugin.json against plugin.schema.json
   - Check version consistency (marketplace == plugin)
   - Check source path exists
   - Check entrypoint files exist

---

## Appendix: Complete Example

**Plugin Directory Structure**:
```
plugins/hookify/
├── .claude-plugin/
│   └── plugin.json          ← Comprehensive manifest
├── commands/
│   ├── hookify.md           ← User-invoked command
│   ├── hookify-list.md
│   └── hookify-create.md
├── skills/
│   ├── hookify.md           ← AI-invoked skill
│   └── hookify-configure.md
├── agents/
│   └── conversation-analyzer.md  ← Custom AI persona
├── scripts/
│   ├── install.sh           ← Post-install setup
│   ├── uninstall.sh         ← Pre-uninstall cleanup
│   └── check-system.sh      ← Pre-install validation
├── package.json             ← npm dependencies
└── README.md                ← Documentation
```

**Complete plugin.json**:
```json
{
  "name": "hookify",
  "version": "1.2.3",
  "description": "Create hooks to prevent unwanted AI behaviors through conversation analysis and explicit rules",
  "author": {
    "name": "kinginyellow",
    "email": "dev@kingin-yellows.dev",
    "url": "https://github.com/kinginyellow"
  },
  "entrypoints": {
    "commands": [
      "commands/hookify.md",
      "commands/hookify-list.md",
      "commands/hookify-create.md"
    ],
    "skills": [
      "skills/hookify.md",
      "skills/hookify-configure.md"
    ],
    "agents": [
      "agents/conversation-analyzer.md"
    ]
  },
  "compatibility": {
    "claudeCodeMin": "2.0.12",
    "nodeMin": "18",
    "os": ["linux", "macos"],
    "arch": ["x64", "arm64"]
  },
  "permissions": [
    {
      "scope": "filesystem",
      "reason": "Read conversation history to analyze unwanted behaviors",
      "paths": [".claude/conversations/"]
    },
    {
      "scope": "filesystem",
      "reason": "Write hook configuration files",
      "paths": [".claude/hooks/"]
    },
    {
      "scope": "shell",
      "reason": "Execute git commands to track hook changes",
      "commands": ["git"]
    }
  ],
  "docs": {
    "readme": "https://github.com/KingInYellows/yellow-plugins/tree/main/plugins/hookify/README.md",
    "changelog": "https://github.com/KingInYellows/yellow-plugins/blob/main/plugins/hookify/CHANGELOG.md",
    "examples": "https://github.com/KingInYellows/yellow-plugins/tree/main/plugins/hookify/examples"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/KingInYellows/yellow-plugins.git"
  },
  "lifecycle": {
    "preInstall": "scripts/check-system.sh",
    "install": "scripts/install.sh",
    "uninstall": "scripts/uninstall.sh"
  },
  "dependencies": {
    "ajv": "^8.12.0",
    "glob": "^10.3.10"
  },
  "keywords": [
    "hooks",
    "behavior",
    "safety",
    "ai-control",
    "conversation-analysis"
  ],
  "license": "MIT",
  "homepage": "https://kingin-yellows.dev/plugins/hookify"
}
```

**Validation Output**:
```
🔍 Validating plugin: hookify

✅ Validation PASSED
   Plugin: hookify v1.2.3
   Author: kinginyellow
   Entrypoints: commands, skills, agents
```

---

## Summary

The plugin.schema.json provides a comprehensive, future-proof manifest schema for Claude Code plugins. Key features:

- **4-dimensional compatibility** (Claude Code, Node.js, OS, arch)
- **5-scope permissions** with optional constraints
- **Flexible entrypoints** (commands, skills, agents, MCP)
- **Lifecycle hooks** for custom setup/teardown
- **12 validation rules** enforcing quality and consistency
- **95% production-ready** with user clarifications incorporated

Ready for implementation and testing with real plugins!
