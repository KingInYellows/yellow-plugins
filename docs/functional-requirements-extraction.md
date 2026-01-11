# Functional Requirements Extraction - KingInYellows Plugin Marketplace

**Document Version**: 1.0  
**Created**: 2026-01-11  
**Agent**: gap-hunter (Discovery Phase, Agent #1)  
**Source**: PRD.md v1.2  
**Context**: Phase 1 Discovery → Specification Writing  
**Next Agents**: risk-analyst (NFRs), researcher (Claude Code integration), coder (schemas)

---

## Executive Summary

**Total Requirements Extracted**: 12 functional requirements  
**Extraction Confidence**: 95%  
**PRD Source Sections**: 5.1-5.4  
**Ambiguity Resolutions Applied**: User clarifications on manifest structure, install scope, compatibility checks, rollback mechanism

### Key Clarifications from User
1. **Manifest Structure**: Each plugin has `.claude-plugin/plugin.json` in its directory; marketplace has `.claude-plugin/marketplace.json` at repo root
2. **Install Scope**: Copy files + npm install + support for custom scripts
3. **Compatibility**: Check Claude Code version, Node.js version, OS/arch, plugin dependencies
4. **Rollback**: Local cache mechanism for previous versions

---

## Functional Requirements by Category

### Category 1: Marketplace & Metadata Requirements (3 requirements)

| Req ID | Priority | Requirement | Description | Acceptance Criteria | Source | Dependencies | Validation |
|--------|----------|-------------|-------------|---------------------|--------|--------------|------------|
| REQ-MKT-001 | MUST | Marketplace index schema | Expose machine-readable `.claude-plugin/marketplace.json` listing plugins and key metadata | Index validates against schema; invalid entries fail CI | Section 5.1 | None | JSON Schema validation + CI gate |
| REQ-MKT-002 | MUST | Standard plugin manifest | Each plugin MUST include `.claude-plugin/plugin.json` containing: name, version, description, entrypoints, compatibility, permissions, docs link | Missing required fields blocks publishing | Section 5.1 | REQ-MKT-001 | JSON Schema validation + CI gate |
| REQ-MKT-003 | SHOULD | Plugin detail view | Provide CLI detail view showing docs, versions, permissions, compatibility for a plugin | Single command (e.g., `/plugin info plugin@author`) displays complete plugin details | Section 5.1 | REQ-MKT-001, REQ-MKT-002 | Manual CLI test |

**Category Insights**:
- These are foundational requirements enabling all other functionality
- Schema validation is critical for preventing marketplace corruption
- CLI detail view essential for solo developer workflow (no web UI yet)

**Specification Impact**:
- Requires detailed JSON Schema definitions for both marketplace.json and plugin.json
- Must define all required/optional fields (name, version, description, entrypoints, compatibility, permissions, docs)
- Compatibility field must support: Claude Code version range, Node.js version range, OS/arch constraints, plugin dependencies

---

### Category 2: Install/Update/Rollback Requirements (5 requirements)

| Req ID | Priority | Requirement | Description | Acceptance Criteria | Source | Dependencies | Validation |
|--------|----------|-------------|-------------|---------------------|--------|--------------|------------|
| REQ-MKT-010 | MUST | One-command install | Install plugin via `/plugin install plugin@author` command | Succeeds on clean environment given valid plugin; copies files, runs npm install, executes custom scripts | Section 5.2 | REQ-MKT-001, REQ-MKT-002, REQ-MKT-011 | Integration test on clean environment |
| REQ-MKT-011 | MUST | Compatibility enforcement | Block install/update if Claude Code version, Node.js version, OS, or dependencies don't meet plugin requirements | Installation fails with clear error showing current vs required versions for each compatibility dimension | Section 5.2 | REQ-MKT-002 | Unit tests for version comparison logic |
| REQ-MKT-012 | MUST | Version pinning | Allow locking plugin versions to prevent accidental breaking updates | Pinned plugin stays pinned unless explicitly changed via `/plugin update --force` or similar | Section 5.2 | REQ-MKT-010 | Integration test: pin, attempt update, verify no change |
| REQ-MKT-013 | MUST | Rollback capability | Provide rollback path to prior known-good version via local cache | After update, `/plugin rollback plugin@author` restores prior version without manual cleanup; local cache maintains last N versions | Section 5.2 | REQ-MKT-010 | Integration test: install, update, rollback, verify functionality |
| REQ-MKT-014 | SHOULD | Update notifications | Surface available updates for installed plugins | `/plugin list --updates` or similar shows which plugins have updates available with version numbers | Section 5.2 | REQ-MKT-001, REQ-MKT-010 | Manual CLI test |

**Category Insights**:
- Install workflow is core user experience (PSM: ≤ 2 minutes end-to-end)
- Compatibility enforcement prevents "works on my machine" issues
- Rollback is critical risk mitigation for RISK-01 (update breaks workflow)
- Version pinning enables stable production workflows

**Specification Impact**:
- Install command must handle: fetching from marketplace, copying files to plugin directory, running npm install in plugin directory, executing custom install scripts
- Compatibility check must validate: Claude Code version (semver range), Node.js version (semver range), OS (linux/darwin/win32), arch (x64/arm64), plugin dependencies (version ranges)
- Rollback requires local cache strategy: directory structure, cache size limits (suggest last 3 versions), cleanup policy
- Update notifications require comparing installed vs marketplace versions for all installed plugins

**Error Handling Requirements for error-handling-architect**:
- REQ-MKT-011 errors: InvalidClaudeCodeVersion, InvalidNodeVersion, UnsupportedOS, UnsupportedArch, MissingPluginDependency
- REQ-MKT-013 errors: RollbackCacheMissing, RollbackCorrupted, RollbackIncompatible

---

### Category 3: Publishing Workflow Requirements (3 requirements)

| Req ID | Priority | Requirement | Description | Acceptance Criteria | Source | Dependencies | Validation |
|--------|----------|-------------|-------------|---------------------|--------|--------------|------------|
| REQ-MKT-020 | MUST | Simple publishing | Publishing via updating plugin folder + manifest + version and merging to main | One PR/merge to main branch results in updated marketplace entry; CI auto-updates marketplace.json | Section 5.3 | REQ-MKT-001, REQ-MKT-002, REQ-MKT-021 | CI/CD test: merge PR, verify marketplace.json updated |
| REQ-MKT-021 | MUST | Semantic versioning | Use semver for all plugin versions | CI blocks non-semver versions; all version fields must match semver pattern | Section 5.3 | None | CI validation + unit tests |
| REQ-MKT-022 | SHOULD | Release automation | Auto-tag releases and optionally link changelog notes | New version produces git tag (e.g., plugin@author-v1.2.3) and GitHub release with changelog link | Section 5.3 | REQ-MKT-020, REQ-MKT-021 | CI/CD test: publish, verify tag + release created |

**Category Insights**:
- Publishing optimized for solo developer (no approval workflows)
- Automation reduces maintenance overhead (target: ≤ 10 minutes to publish)
- Git-based workflow leverages existing GitHub infrastructure

**Specification Impact**:
- CI workflow must: detect plugin.json changes, validate semver, update marketplace.json, create git tags, create GitHub releases
- Marketplace.json update logic: parse all plugin.json files, merge into marketplace index, validate schema
- Release automation requires: changelog generation strategy (conventional commits?), release notes template

---

### Category 4: Permission Requirements (2 requirements)

| Req ID | Priority | Requirement | Description | Acceptance Criteria | Source | Dependencies | Validation |
|--------|----------|-------------|-------------|---------------------|--------|--------------|------------|
| REQ-MKT-030 | MUST | Permission disclosure | Display declared permissions prior to install/update | Installation prompts with permissions list; user must acknowledge before proceeding | Section 5.4 | REQ-MKT-002, REQ-MKT-010 | Integration test: install, verify permissions displayed |
| REQ-MKT-031 | MAY | Basic scanning | Lightweight lint/test/dependency audit in CI | If enabled, CI fails on critical issues (high/critical CVEs, lint errors, test failures) per configured thresholds | Section 5.4 | REQ-MKT-020 | CI test: introduce vulnerability, verify failure |

**Category Insights**:
- Permission disclosure is minimal security requirement (transparency)
- Scanning is optional but recommended for "Future Me" maintainer persona
- No enterprise-level security (formal audits, penetration testing) in scope

**Specification Impact**:
- Permission model required: define permission types (filesystem, network, system, claude-api, etc.)
- Permission display format: CLI rendering of permission list with descriptions
- Scanning integration: npm audit, eslint, jest (all optional, configurable)

---

## Requirements Summary Statistics

### By Priority
- **MUST**: 9 requirements (75%) - Core functionality blocking launch
- **SHOULD**: 2 requirements (17%) - Quality-of-life improvements for Phase 1
- **MAY**: 1 requirement (8%) - Optional Phase 2 enhancement

### By Category
- **Marketplace/Metadata**: 3 requirements (25%)
- **Install/Update/Rollback**: 5 requirements (42%) - Largest category, core UX
- **Publishing**: 3 requirements (25%)
- **Permissions**: 2 requirements (17%)

### Dependency Graph
```
Foundation Layer (no dependencies):
  - REQ-MKT-001 (marketplace index)
  - REQ-MKT-021 (semver)

Schema Layer (depends on foundation):
  - REQ-MKT-002 (plugin manifest) → depends on REQ-MKT-001

Workflow Layer (depends on schema):
  - REQ-MKT-003 (detail view) → depends on REQ-MKT-001, REQ-MKT-002
  - REQ-MKT-011 (compatibility) → depends on REQ-MKT-002
  - REQ-MKT-010 (install) → depends on REQ-MKT-001, REQ-MKT-002, REQ-MKT-011
  - REQ-MKT-020 (publishing) → depends on REQ-MKT-001, REQ-MKT-002, REQ-MKT-021
  - REQ-MKT-030 (permissions) → depends on REQ-MKT-002, REQ-MKT-010

Advanced Layer (depends on workflow):
  - REQ-MKT-012 (version pinning) → depends on REQ-MKT-010
  - REQ-MKT-013 (rollback) → depends on REQ-MKT-010
  - REQ-MKT-014 (update notifications) → depends on REQ-MKT-001, REQ-MKT-010
  - REQ-MKT-022 (release automation) → depends on REQ-MKT-020, REQ-MKT-021
  - REQ-MKT-031 (scanning) → depends on REQ-MKT-020
```

---

## Traceability to PRD Success Metrics

### Primary Success Metric (PSM)
**PSM**: Time-to-install plugin on fresh machine ≤ 2 minutes

**Requirements Enabling PSM**:
- REQ-MKT-001: Fast marketplace index parsing
- REQ-MKT-010: One-command install (no manual steps)
- REQ-MKT-011: Immediate compatibility feedback (no failed installs)
- Related NFR: NFR-PERF-001 (manifest parse time p95 < 1s)

### Secondary Success Metric 1
**SSM1**: Update confidence (rollback + version pinning works)

**Requirements Enabling SSM1**:
- REQ-MKT-012: Version pinning prevents unwanted updates
- REQ-MKT-013: Rollback restores prior version
- Related Risk: RISK-01 mitigation

### Secondary Success Metric 2
**SSM2**: Maintenance overhead ≤ 10 minutes to publish new plugin version

**Requirements Enabling SSM2**:
- REQ-MKT-020: Simple publishing (PR/merge workflow)
- REQ-MKT-021: Semver enforcement (automated validation)
- REQ-MKT-022: Release automation (no manual tagging)
- Related NFR: NFR-MAINT-001 (low operational overhead)

---

## Guidance for Downstream Agents

### For risk-analyst (Agent #2: NFR Extraction)

**Focus Areas**:
1. **Performance Requirements**:
   - Install time target: ≤ 2 minutes (tied to PSM)
   - Manifest parse time: p95 < 1s (NFR-PERF-001)
   - Update check time for `/plugin list --updates`
   
2. **Reliability Requirements**:
   - Deterministic installs (NFR-REL-001): Same versions → same result
   - Rollback success rate: 100% for cached versions
   - Compatibility check accuracy: 100% (no false positives/negatives)

3. **Maintainability Requirements**:
   - Publishing time: ≤ 10 minutes (NFR-MAINT-001)
   - CI execution time: < 5 minutes (CI feedback loop)
   - Schema evolution: backward compatibility for marketplace.json

4. **Usability Requirements**:
   - CLI output clarity for errors (REQ-MKT-011, REQ-MKT-030)
   - Permission disclosure readability
   - Update notification clarity

**Risk Connections**:
- RISK-01 (update breaks workflow) → REQ-MKT-012, REQ-MKT-013, rollback reliability NFR
- RISK-02 (manifest drift) → REQ-MKT-001, REQ-MKT-002, schema validation NFR
- RISK-03 (future maintainability) → REQ-MKT-003, REQ-MKT-020, documentation NFR

### For researcher (Agent #3: Claude Code Integration Research)

**Research Questions from Requirements**:
1. **REQ-MKT-002**: What plugin metadata fields does Claude Code currently support? (name, version, entrypoints, permissions?)
2. **REQ-MKT-010**: What is the Claude Code plugin installation API? (file structure, hooks, initialization?)
3. **REQ-MKT-011**: How to query current Claude Code version from within CLI?
4. **REQ-MKT-012**: Does Claude Code have existing version pinning mechanism?
5. **REQ-MKT-030**: What permission model does Claude Code use? (filesystem, network, API?)

**Integration Points to Validate**:
- Plugin directory structure (where plugins install to)
- Plugin entrypoint registration (how Claude Code discovers/loads plugins)
- Permission enforcement (declarative vs runtime checks)
- Compatibility checks (version comparison utilities available?)

### For coder (Agent #4: Schema Design)

**Schemas Required from Requirements**:

1. **marketplace.json Schema** (REQ-MKT-001):
   ```json
   {
     "version": "1.0.0",
     "plugins": [
       {
         "id": "plugin-name@author",
         "name": "Plugin Display Name",
         "author": "author-name",
         "version": "1.2.3",
         "description": "Short description",
         "source": "./plugins/plugin-name",
         "compatibility": { /* see plugin.json */ },
         "tags": ["category1", "category2"]
       }
     ]
   }
   ```

2. **plugin.json Schema** (REQ-MKT-002):
   ```json
   {
     "$schema": "https://schema.url/plugin.schema.json",
     "name": "plugin-name",
     "version": "1.2.3",
     "description": "Detailed description",
     "author": "author-name",
     "entrypoints": {
       "main": "./src/index.js",
       "commands": ["./commands/*.js"]
     },
     "compatibility": {
       "claudeCode": ">=1.0.0 <2.0.0",
       "node": ">=18.0.0",
       "os": ["linux", "darwin", "win32"],
       "arch": ["x64", "arm64"],
       "plugins": {
         "dependency-plugin@author": "^1.0.0"
       }
     },
     "permissions": [
       { "type": "filesystem", "path": "~/.config", "access": "read" },
       { "type": "network", "domains": ["api.example.com"], "access": "request" },
       { "type": "claude-api", "scopes": ["read-conversations"] }
     ],
     "docs": "https://github.com/author/plugin-name/blob/main/README.md",
     "repository": "https://github.com/author/plugin-name",
     "license": "MIT",
     "install": {
       "preInstall": "./scripts/pre-install.sh",
       "postInstall": "./scripts/post-install.sh"
     }
   }
   ```

**Schema Validation Requirements**:
- Required fields: name, version, description, author, entrypoints, compatibility, permissions, docs
- Semver validation for all version fields (REQ-MKT-021)
- Compatibility.claudeCode must be valid semver range
- Permissions array must match defined permission types

### For error-handling-architect (Future Agent)

**Error Scenarios from Requirements**:

1. **REQ-MKT-001/002 Validation Errors**:
   - `InvalidMarketplaceSchema`: marketplace.json doesn't validate
   - `InvalidPluginSchema`: plugin.json doesn't validate
   - `MissingRequiredField`: Required field absent in manifest

2. **REQ-MKT-010 Install Errors**:
   - `PluginNotFound`: Plugin ID not in marketplace
   - `DownloadFailed`: Network/fetch error
   - `InstallScriptFailed`: postInstall script returned non-zero
   - `FileSystemError`: Permission denied / disk full

3. **REQ-MKT-011 Compatibility Errors**:
   - `IncompatibleClaudeCodeVersion`: Current version doesn't match range
   - `IncompatibleNodeVersion`: Node.js version too old/new
   - `UnsupportedPlatform`: OS or architecture not supported
   - `MissingPluginDependency`: Required plugin not installed
   - `ConflictingPluginVersion`: Dependency version conflict

4. **REQ-MKT-012/013 Version Management Errors**:
   - `PinnedVersionUnavailable`: Pinned version no longer in marketplace
   - `RollbackCacheMissing`: No cached version to rollback to
   - `RollbackFailed`: Rollback process failed mid-operation

5. **REQ-MKT-020/021 Publishing Errors**:
   - `InvalidSemanticVersion`: Version string not valid semver
   - `DuplicateVersion`: Version already published
   - `MarketplaceUpdateFailed`: CI couldn't update marketplace.json

**Error Handling Principles**:
- Always show current vs required for compatibility errors (REQ-MKT-011 AC)
- Provide actionable remediation steps
- Never leave system in inconsistent state (rollback on failure)
- Log all errors for debugging (support "Future Me" persona)

---

## Open Questions for Specification Phase

These questions emerged during requirements extraction and need resolution during specification research:

**Q-SPEC-01**: What is the exact directory structure for plugin installation?
- Current assumption: `~/.claude-code/plugins/plugin-name@author/`
- Needs validation from Claude Code documentation

**Q-SPEC-02**: How should marketplace.json reference plugins?
- Option A: Relative paths within repo (`./plugins/plugin-name`)
- Option B: Git submodules
- Option C: Package URLs (npm, GitHub releases)
- **User clarification**: Relative paths initially

**Q-SPEC-03**: What is the rollback cache size/retention policy?
- Recommendation: Last 3 versions per plugin
- Needs storage impact analysis

**Q-SPEC-04**: Should permissions be enforced or purely informational?
- REQ-MKT-030 says "display" but doesn't mention enforcement
- Enforcement would require Claude Code integration
- **Assumption for Phase 1**: Informational only

**Q-SPEC-05**: What custom install scripts are supported?
- User mentioned "custom scripts support"
- Need to define: shell scripts only? Node.js scripts? Sandboxing?
- **Recommendation**: Bash/shell scripts with timeout, no sandboxing (personal use)

**Q-SPEC-06**: How to handle marketplace.json updates in CI?
- Manual update in PR? Auto-generate from plugin.json files?
- **Recommendation**: Auto-generate (REQ-MKT-020 implies automation)

---

## Extraction Methodology

### Sources Analyzed
1. PRD.md Section 5 (Functional Requirements): Primary source
2. PRD.md Section 1.2 (Success Metrics): Traced to requirements
3. PRD.md Section 7 (Risks): Linked to mitigation requirements
4. PRD.md Section 8 (Open Questions): Converted to specification questions
5. User clarifications: Integrated into requirement details

### Extraction Confidence: 95%

**High Confidence (100%)**: 10 requirements
- REQ-MKT-001, 002, 010, 011, 012, 013, 020, 021, 030 clearly stated in PRD

**Medium Confidence (85%)**: 2 requirements
- REQ-MKT-003: PRD says "SHOULD provide detail view" but doesn't specify CLI vs web
- REQ-MKT-031: PRD says "MAY run checks" but doesn't detail which checks

**Validation Needed**: 0 requirements
- All requirements have clear acceptance criteria
- User clarifications resolved ambiguities

### Excluded from Extraction
- Non-functional requirements (delegated to risk-analyst)
- Implementation details (reserved for architecture phase)
- Test strategies (TDD phase)
- UI/UX specifications (CLI-first approach, minimal UX requirements)

---

## Next Steps for Discovery Phase

1. **risk-analyst**: Extract NFRs from PRD Section 6 + success metrics
2. **researcher**: Research Claude Code plugin architecture + APIs
3. **coder**: Design JSON schemas based on REQ-MKT-001/002
4. **Parallel**: All agents can work concurrently (no blocking dependencies)

---

## Appendix: Requirement-to-PRD Traceability Matrix

| Requirement | PRD Section | Line Numbers | User Clarifications Applied |
|-------------|-------------|--------------|----------------------------|
| REQ-MKT-001 | 5.1 | 121-126 | Manifest location: `.claude-plugin/marketplace.json` |
| REQ-MKT-002 | 5.1 | 128-132 | Manifest location: `.claude-plugin/plugin.json`; Required fields clarified |
| REQ-MKT-003 | 5.1 | 134-138 | CLI detail view (no web UI initially) |
| REQ-MKT-010 | 5.2 | 142-146 | Install scope: copy files + npm install + custom scripts |
| REQ-MKT-011 | 5.2 | 148-152 | Compatibility: Claude Code, Node.js, OS/arch, plugin deps |
| REQ-MKT-012 | 5.2 | 154-158 | Version pinning mechanism |
| REQ-MKT-013 | 5.2 | 160-164 | Rollback: local cache mechanism |
| REQ-MKT-014 | 5.2 | 166-170 | Update notifications via CLI command |
| REQ-MKT-020 | 5.3 | 174-178 | Publishing: PR/merge workflow, CI automation |
| REQ-MKT-021 | 5.3 | 180-184 | Semantic versioning enforcement |
| REQ-MKT-022 | 5.3 | 186-190 | Release automation: git tags + GitHub releases |
| REQ-MKT-030 | 5.4 | 194-198 | Permission disclosure before install |
| REQ-MKT-031 | 5.4 | 200-204 | Optional scanning: lint/test/audit |

---

**Document Status**: COMPLETE  
**Confidence**: 95%  
**Blockers**: None  
**Ready for Handoff**: YES

**Memory Storage Key**: `search/discovery/functional-requirements`
