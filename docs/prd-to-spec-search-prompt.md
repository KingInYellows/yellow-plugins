# PRD to Specification Transformation Search Prompt
## Custom USACF Search for Plugin Marketplace Specification Generation

**Search ID**: prd-spec-transform-001
**Version**: 1.0.0
**Subject**: KingInYellows Personal Plugin Marketplace
**Subject Type**: Software System (Personal/Homelab Scale)
**Depth Level**: 3 (Deep Analysis - Critical for specification quality)

---

## PHASE 0: META-ANALYSIS & PREPARATION

### 0.1 Step-Back Prompting: Establish Principles

**Before diving into specification creation**, establish high-level guiding principles:

#### Fundamental Principles for Plugin Marketplace Specs

**Task**: Generate 5-7 core principles that define excellence in plugin marketplace specifications.

**Expected Output**:
```markdown
### Core Principles
1. **Simplicity First**: Personal-scale system, avoid enterprise over-engineering
2. **Reproducibility**: Deterministic installs, version pinning must work
3. **Developer Experience**: ≤2 min install time, ≤10 min publish time
4. **Failure Resilience**: Rollback paths, compatibility checks, graceful degradation
5. **Documentation by Default**: Every schema field self-documenting
6. **Schema Validation**: CI-enforced constraints prevent drift
7. **Future-Proof Modularity**: Easy to extend (e.g., multi-market support later)

### Evaluation Criteria
| Principle | Measurable Criteria | Target Threshold |
|-----------|--------------------|--------------------|
| Simplicity | Lines of config required | < 50 LOC for basic plugin |
| Reproducibility | Install success rate | 100% on clean env |
| Developer Experience | Time-to-publish | ≤ 10 minutes |
| Failure Resilience | Rollback success rate | 100% without manual cleanup |
| Schema Validation | CI failure on invalid schema | 100% enforcement |

### Anti-Patterns to Avoid
- ❌ Enterprise features for single-user system (YAGNI violation)
- ❌ Complex permission models without use cases
- ❌ Brittle schemas that break on minor changes
- ❌ Manual steps without automation paths
- ❌ Undocumented assumptions about Claude Code internals
```

**Store as**: `search/meta/principles`

---

### 0.2 Ambiguity Clarification Protocol

**Task**: Identify and resolve ambiguous terms in the PRD before specification.

#### Ambiguous Terms Analysis

**Input**: PRD.md (sections 1-10)

**Expected Output**:
```markdown
| Term | Interpretation A | Interpretation B | Clarification Needed |
|------|------------------|------------------|---------------------|
| "plugin.json" | Manifest in plugin root | Manifest in marketplace index | Yes - where stored? |
| "compatibility" | Claude Code version only | OS/arch/dependencies too | Yes - scope? |
| "permissions" | Declarative list | Runtime checks | Yes - enforcement? |
| "rollback" | Local cache | Fetch from git tag | Yes - implementation? |
| "marketplace index" | Single JSON file | Multi-file structure | Yes - format? |
| "install" | Copy files only | Run install scripts too | Yes - scope? |
| "simple publishing" | Manual PR | Automated CI/CD | Yes - automation level? |

### Provisional Assumptions (if clarification unavailable)
1. **plugin.json**: Lives in plugin root, referenced by marketplace index
   - Confidence: 85%
   - Risk if wrong: Medium (schema design impacts)

2. **compatibility**: Claude Code version + Node.js version minimum
   - Confidence: 70%
   - Risk if wrong: High (missing OS/arch constraints)

3. **permissions**: Declarative list displayed pre-install, no runtime enforcement (Phase 1)
   - Confidence: 90%
   - Risk if wrong: Low (can add enforcement later)

4. **rollback**: Local cache of previous version
   - Confidence: 75%
   - Risk if wrong: Medium (affects storage strategy)
```

**Store as**: `search/meta/ambiguities`

**Action**: Flag for user clarification before proceeding to Phase 1.

---

### 0.3 Self-Ask Decomposition

**Task**: Generate 15-20 essential questions about the specification before writing it.

#### Essential Specification Questions

**Expected Output**:
```markdown
### Structural Questions
1. What is the minimal valid marketplace.json schema?
2. What is the minimal valid plugin.json schema?
3. How are plugins identified uniquely (name, author, version tuple)?
4. What is the relationship between marketplace index and plugin manifests?
5. What fields are REQUIRED vs OPTIONAL vs RECOMMENDED?

### Functional Questions
6. What are all possible plugin install/update/rollback states?
7. How does version pinning interact with update notifications?
8. What compatibility checks run before install?
9. What happens if compatibility check fails?
10. How are permissions disclosed and confirmed?

### Contextual Questions
11. What are the constraints from Claude Code plugin system?
12. What npm/git conventions should we follow?
13. What schema validation tooling exists?
14. What CI/CD platforms are available (GitHub Actions assumed)?
15. What fallback behaviors exist if marketplace is unreachable?

### Meta Questions
16. What assumptions about Claude Code internals are safe?
17. Where might the spec be under-specified (ambiguity risks)?
18. What edge cases aren't covered in the PRD?
19. What would "future me" need to maintain this?
20. What could invalidate the entire specification approach?

### Answers (Initial Confidence)
- Q1: Minimal schema = array of {id, name, version, source_url, manifest_url}
  - Confidence: 70% (needs validation against Claude Code)

- Q3: Unique ID = `author/plugin-name@version` (npm-style)
  - Confidence: 85%

- Q6: States = {not_installed, installing, installed, updating, update_failed, rollback_available}
  - Confidence: 75%

- Q12: Follow npm conventions (package.json structure) + git tags for versions
  - Confidence: 90%
```

**Store as**: `search/meta/self-ask-questions`

---

### 0.4 ReWOO Planning: Research Plan

**Task**: Plan ALL specification generation tasks upfront.

#### Complete Research Plan

**Expected Output**:
```markdown
## PHASE 1: DISCOVERY (Schema Extraction)

| Task ID | Description | Agent | Dependencies | Estimated Effort |
|---------|-------------|-------|--------------|------------------|
| D01 | Extract PRD functional requirements | system-architect | None | 30 min |
| D02 | Map PRD to Part 1 schema fields | code-analyzer | D01 | 45 min |
| D03 | Identify Part 2 schema applicability | code-analyzer | D01 | 30 min |
| D04 | Research Claude Code plugin constraints | researcher | None | 1 hour |
| D05 | Define marketplace.json schema | backend-dev | D01, D04 | 45 min |
| D06 | Define plugin.json schema | backend-dev | D01, D04 | 45 min |
| D07 | Map NFRs to measurable criteria | perf-analyzer | D01 | 30 min |

## PHASE 2: ANALYSIS (Gap Analysis)

| Task ID | Description | Agent | Dependencies | Estimated Effort |
|---------|-------------|-------|--------------|------------------|
| A01 | Gap analysis: PRD vs schema template | gap-hunter | D01-D07 | 1 hour |
| A02 | Identify missing requirements | gap-hunter | A01 | 30 min |
| A03 | Analyze compatibility constraints | code-analyzer | D04, D06 | 45 min |
| A04 | Define error handling specifications | error-handling-architect | D01, A01 | 45 min |
| A05 | Validate schema completeness | reviewer | A01-A04 | 30 min |

## PHASE 3: SYNTHESIS (Spec Generation)

| Task ID | Description | Agent | Dependencies | Estimated Effort |
|---------|-------------|-------|--------------|------------------|
| S01 | Write Part 1: Project Overview | documenter | D01-D07 | 30 min |
| S02 | Write Part 1: Core Functionality | documenter | D01, A01 | 1 hour |
| S03 | Write Part 1: Data Models | documenter | D05, D06 | 1 hour |
| S04 | Write Part 1: Error Handling | documenter | A04 | 30 min |
| S05 | Write Part 2: NFRs | documenter | D07, A01 | 45 min |
| S06 | Write Part 2: Tech Constraints | architect | D04 | 30 min |
| S07 | Generate JSON schemas | coder | D05, D06 | 1 hour |

## PHASE 4: VALIDATION (Quality Gates)

| Task ID | Description | Agent | Dependencies | Estimated Effort |
|---------|-------------|-------|--------------|------------------|
| V01 | Schema validation test suite | tester | S07 | 45 min |
| V02 | Requirements traceability matrix | reviewer | S01-S07 | 30 min |
| V03 | Adversarial spec review | red-team-agent | S01-S07 | 1 hour |
| V04 | Final spec polish | documenter | V01-V03 | 30 min |

### Total Resource Estimate
- Total tasks: 23
- Sequential time: ~16 hours
- Parallel time: ~6 hours (parallelizing discovery + analysis)
- Total tokens: ~45,000 estimated
```

**Store as**: `search/meta/research-plan`

---

## PHASE 1: ENHANCED DISCOVERY

### 1.1 Multi-Agent PRD Analysis

**Orchestration**: Launch parallel discovery agents

#### Agent 1: Functional Requirements Extractor

**Agent**: `code-analyzer`
**Mission**: Extract ALL functional requirements from PRD sections 1.1 and 5.0

**Instructions**:
```markdown
## TASK
Extract every REQ-MKT-### requirement from PRD.md with full context.

## OUTPUT FORMAT
| Req ID | Priority | Description | Acceptance Criteria | Source Section |
|--------|----------|-------------|---------------------|----------------|
| REQ-MKT-001 | MUST | Marketplace index | Index validates against schema | 5.1 |
| ... | ... | ... | ... | ... |

## STORE AS
search/discovery/structural/functional-requirements
```

#### Agent 2: Data Model Extractor

**Agent**: `backend-dev`
**Mission**: Define marketplace.json and plugin.json schemas from PRD

**Instructions**:
```markdown
## TASK
Based on PRD sections 5.1 and 5.2, define complete JSON schemas.

## MARKETPLACE.JSON SCHEMA
\`\`\`json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["version", "plugins"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$",
      "description": "Marketplace schema version (semver)"
    },
    "plugins": {
      "type": "array",
      "items": { "$ref": "#/definitions/MarketplacePluginEntry" }
    }
  },
  "definitions": {
    "MarketplacePluginEntry": {
      "type": "object",
      "required": ["id", "name", "version", "author", "manifest_url"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$",
          "description": "Unique plugin identifier (kebab-case)"
        },
        "name": {
          "type": "string",
          "description": "Human-readable plugin name"
        },
        "version": {
          "type": "string",
          "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
        },
        "author": {
          "type": "string",
          "description": "Author name or GitHub username"
        },
        "manifest_url": {
          "type": "string",
          "format": "uri",
          "description": "URL to plugin.json manifest"
        },
        "tags": {
          "type": "array",
          "items": { "type": "string" }
        }
      }
    }
  }
}
\`\`\`

## PLUGIN.JSON SCHEMA
\`\`\`json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["name", "version", "description", "entrypoint", "compatibility"],
  "properties": {
    "name": { "type": "string" },
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+$"
    },
    "description": { "type": "string", "maxLength": 280 },
    "author": { "type": "string" },
    "entrypoint": {
      "type": "string",
      "description": "Main skill file path"
    },
    "compatibility": {
      "type": "object",
      "required": ["claude_code_min"],
      "properties": {
        "claude_code_min": { "type": "string" },
        "claude_code_max": { "type": "string" },
        "node_min": { "type": "string" }
      }
    },
    "permissions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["scope", "reason"],
        "properties": {
          "scope": {
            "type": "string",
            "enum": ["filesystem", "network", "shell", "env", "claude-api"]
          },
          "reason": { "type": "string" }
        }
      }
    },
    "docs_url": { "type": "string", "format": "uri" }
  }
}
\`\`\`

## STORE AS
- search/discovery/structural/marketplace-schema
- search/discovery/structural/plugin-schema
```

#### Agent 3: NFR Analyzer

**Agent**: `perf-analyzer`
**Mission**: Extract and quantify non-functional requirements

**Instructions**:
```markdown
## TASK
Convert PRD success metrics and NFRs into measurable specifications.

## OUTPUT FORMAT
| NFR ID | Category | Requirement | Metric | Acceptance Criteria | Source |
|--------|----------|-------------|--------|---------------------|--------|
| NFR-PERF-001 | Performance | Install time | Time-to-install | p95 ≤ 2 minutes | 1.2 PSM |
| NFR-MAINT-001 | Maintainability | Publish time | Time-to-publish | p95 ≤ 10 minutes | 1.2 SSM |
| NFR-REL-001 | Reliability | Rollback success | Success rate | 100% without manual cleanup | REQ-MKT-013 |
| NFR-PERF-002 | Performance | Manifest parse | Parse time | p95 < 1s | Section 7 |
| NFR-REL-002 | Reliability | Deterministic installs | Reproducibility | 100% given version pin | Section 7 |
| NFR-ACC-001 | Accuracy | Schema validation | CI enforcement | 100% invalid schemas blocked | REQ-MKT-001 |

## STORE AS
search/discovery/structural/nfrs
```

---

### 1.2 Constraint Research

#### Agent 4: Claude Code Plugin System Research

**Agent**: `researcher`
**Mission**: Research Claude Code plugin constraints (if not documented)

**Instructions**:
```markdown
## TASK
Investigate Claude Code plugin system to answer:
1. What is the official plugin.json schema (if exists)?
2. How are plugins installed/registered?
3. What permission model exists?
4. What compatibility checks are performed?
5. What hooks/extension points exist?

## RESEARCH SOURCES
1. Search: "Claude Code plugin manifest schema"
2. Search: "Claude Code skills directory structure"
3. Search: "Claude Code plugin installation process"
4. Search: "/plugin install implementation"
5. Examine: .claude/skills/ directory structure (if accessible)

## OUTPUT FORMAT
### Findings
1. **Official Schema**: [Found/Not Found] - [Details or recommendation]
2. **Installation Process**: [Description]
3. **Permission Model**: [Description]
4. **Compatibility Checks**: [Description]
5. **Extension Points**: [List]

### Constraints for Specification
- MUST: [List hard constraints]
- SHOULD: [List soft constraints]
- MAY: [List optional features]

### Confidence Levels
- Overall confidence: X%
- Low confidence areas: [List]
- Assumptions made: [List]

## STORE AS
search/discovery/constraints/claude-code-system
```

---

## PHASE 2: GAP ANALYSIS

### 2.1 PRD Coverage Analysis

**Agent**: `gap-hunter`
**Mission**: Identify gaps between PRD and specification schema

**Instructions**:
```markdown
## TASK
Compare PRD requirements against project-specification-schema template.

## GAP CATEGORIES
1. **Missing in PRD**: Schema fields not addressed in PRD
2. **Ambiguous in PRD**: Requirements needing clarification
3. **Over-specified in PRD**: Details better left to implementation
4. **Schema limitations**: Template fields not applicable to this project

## OUTPUT FORMAT
### Part 1 Schema Coverage

| Schema Section | PRD Coverage | Gap Severity | Missing Elements | Recommendation |
|----------------|--------------|--------------|------------------|----------------|
| 1.0 Project Overview | 100% | None | - | Use PRD section 1.1 |
| 2.0 Core Functionality | 90% | Low | Error states not detailed | Add from section 6 |
| 3.0 Data Models | 60% | High | Schema validation rules missing | Generate from D05/D06 |
| 4.0 Error Handling | 40% | Critical | Only 3 scenarios covered | Expand to 10+ |

### Part 2 Schema Coverage

| Schema Section | PRD Coverage | Gap Severity | Missing Elements | Recommendation |
|----------------|--------------|--------------|------------------|----------------|
| 5.0 Formal Controls | 0% | Medium | No doc control | Add version/status |
| 6.0 Traceable Reqs | 100% | None | REQ-MKT format exists | Convert to FR-### |
| 7.0 NFRs | 70% | Low | Some NFRs implicit | Extract from analysis |
| 8.0 Tech Constraints | 30% | Medium | GitHub assumed, not mandated | Make explicit |
| 9.0 Risks | 60% | Low | 3 risks listed | Expand from FMEA |

### Critical Gaps (MUST Address)
1. **Schema validation rules**: How are schemas validated? (AJV? Custom?)
2. **Install script specification**: What happens during install beyond file copy?
3. **Conflict resolution**: What if two plugins conflict?
4. **Marketplace update mechanism**: How does index get updated?
5. **Offline mode**: What works without internet?

### Recommendations
- MUST: Define install/update state machine
- MUST: Specify schema validation tooling
- SHOULD: Add rollback implementation detail
- MAY: Add multi-market support (out of scope phase 1)

## STORE AS
search/gaps/comprehensive/prd-schema-gaps
```

---

### 2.2 Error Scenario Analysis

**Agent**: `error-handling-architect`
**Mission**: Comprehensive error scenario specification

**Instructions**:
```markdown
## TASK
Expand "Essential Error Handling" to cover plugin marketplace scenarios.

## ERROR SCENARIOS TO DEFINE

### Install Errors
1. **Marketplace unreachable**: App MUST show offline message + retry option
2. **Plugin not found**: App MUST show "Plugin X not found" + suggest search
3. **Incompatible version**: App MUST show current vs required versions + link to compatible version
4. **Permission denied**: App MUST display required permissions + allow cancel
5. **Download failure**: App MUST retry 3x with exponential backoff, then fail gracefully
6. **Install script failure**: App MUST rollback partial install + preserve logs
7. **Conflict with existing plugin**: App MUST show conflict details + resolution options

### Update Errors
8. **Update breaks compatibility**: App MUST block update + show why
9. **Update fails mid-process**: App MUST auto-rollback to previous version
10. **Changelog unavailable**: App SHOULD show warning but allow update

### Validation Errors
11. **Invalid marketplace.json**: App MUST reject + show validation errors
12. **Invalid plugin.json**: App MUST reject install + show field errors
13. **Missing required fields**: App MUST list missing fields
14. **Version conflict**: App MUST show version resolution options

### Runtime Errors
15. **Plugin crash on load**: App MUST disable plugin + show error + offer uninstall
16. **Permission violation detected**: App MUST disable plugin + warn user + offer removal

## OUTPUT FORMAT
| Error ID | Scenario | App Behavior (MUST/SHOULD/MAY) | User-Visible Message | Recovery Path |
|----------|----------|----------------------------------|----------------------|---------------|
| ERR-001 | Marketplace unreachable | MUST show offline message | "Cannot reach marketplace. Check connection." | Retry / Cancel |
| ... | ... | ... | ... | ... |

## STORE AS
search/gaps/errors/comprehensive-error-spec
```

---

## PHASE 3: SYNTHESIS

### 3.1 Specification Generation

**Orchestration**: Sequential specification writing

#### Agent S1: Part 1 Generator (Project Overview)

**Agent**: `documenter`
**Mission**: Write Part 1 sections 1.0-4.0 of specification

**Instructions**:
```markdown
## TASK
Generate complete Part 1 specification from:
- search/discovery/structural/functional-requirements
- search/discovery/structural/*-schema
- search/gaps/errors/comprehensive-error-spec

## OUTPUT FORMAT (Markdown)

### Part 1: The Essentials

#### 1.0 Project Overview
- 1.1 Project Name: KingInYellows Personal Plugin Marketplace
- 1.2 Project Goal: [From PRD 1.1]
- 1.3 Target Audience: Solo developer (personal/homelab use)

#### 2.0 Core Functionality & User Journeys
[Convert REQ-MKT-### to user journeys with MUST/SHOULD/MAY keywords]

Example:
**2.1 Core Features List**:
- Plugin Discovery (browse/search)
- Plugin Installation (one-command)
- Plugin Updates (with version pinning)
- Plugin Rollback (to previous version)
- Compatibility Enforcement
- Permission Disclosure

**2.2 User Journeys**:
1. **Install Plugin**:
   - User runs `/plugin install hookify` → app **MUST** fetch manifest
   - App reads compatibility constraints → app **MUST** check Claude Code version
   - App displays permissions → app **MUST** show permission list + ask confirmation
   - User confirms → app **MUST** download plugin files + register entrypoint
   - Success → app **MUST** show "Plugin hookify@1.0.0 installed" + usage instructions

2. **Update Plugin**:
   - User runs `/plugin update hookify` → app **MUST** check for updates
   - Update available → app **MUST** show new version + changelog link
   - User confirms → app **MUST** backup current version locally
   - App installs update → **IF** failure → app **MUST** auto-rollback + preserve error log
   - Success → app **MUST** show "Updated to hookify@1.2.0"

[Continue for all core features...]

#### 3.0 Data Models
**Format**: `Entity: field (keyword, [constraints])`

**MarketplaceIndex**:
- `version` (REQUIRED, semver format "1.0.0")
- `updated_at` (REQUIRED, ISO 8601 timestamp)
- `plugins` (REQUIRED, array of PluginEntry)

**PluginEntry**:
- `id` (REQUIRED, kebab-case, unique, matches `^[a-z0-9-]+$`)
- `name` (REQUIRED, max 100 chars)
- `version` (REQUIRED, semver)
- `author` (REQUIRED, string)
- `description` (REQUIRED, max 280 chars)
- `manifest_url` (REQUIRED, valid HTTPS URL)
- `tags` (OPTIONAL, array of strings)
- `featured` (OPTIONAL, boolean, default false)

**PluginManifest**:
- `name` (REQUIRED, matches marketplace entry)
- `version` (REQUIRED, semver)
- `description` (REQUIRED, max 280 chars)
- `author` (REQUIRED)
- `entrypoint` (REQUIRED, path to main skill file)
- `compatibility.claude_code_min` (REQUIRED, semver)
- `compatibility.claude_code_max` (OPTIONAL, semver)
- `compatibility.node_min` (OPTIONAL, semver)
- `permissions` (REQUIRED, array of PermissionDeclaration)
- `docs_url` (REQUIRED, valid URL)
- `changelog_url` (OPTIONAL, valid URL)
- `dependencies` (OPTIONAL, array of plugin IDs)

**PermissionDeclaration**:
- `scope` (REQUIRED, enum: ["filesystem", "network", "shell", "env", "claude-api"])
- `reason` (REQUIRED, human-readable justification)

#### 4.0 Essential Error Handling
[Import from search/gaps/errors/comprehensive-error-spec, format as Part 1 requires]

## VALIDATION
- Every field has keyword (REQUIRED/OPTIONAL/RECOMMENDED)
- Every constraint is testable
- Every error scenario has MUST/SHOULD behavior
- Every user journey has clear outcome

## STORE AS
docs/specification-part1.md
```

#### Agent S2: Part 2 Generator (Advanced Specifications)

**Agent**: `documenter`
**Mission**: Write Part 2 sections 5.0-9.0

**Instructions**:
```markdown
## TASK
Generate Part 2 advanced specifications.

## OUTPUT FORMAT (Markdown)

### Part 2: Advanced Specifications

#### 5.0 Formal Project Controls & Scope
**5.1 Document Control**:
- Version: 1.0.0
- Status: Draft
- Date: [Current date]
- Owner: Solo developer
- Approval Required: Self-review + validation gate pass

**5.2 Detailed Scope**:
*In Scope (Phase 1)*:
- [From PRD 4.1]

*Out of Scope (Explicit)*:
- [From PRD 4.3]

**5.3 Glossary**:
| Term | Definition |
|------|------------|
| Marketplace Index | Central registry file (marketplace.json) listing all available plugins |
| Plugin Manifest | Plugin-specific metadata file (plugin.json) in each plugin repository |
| Semver | Semantic Versioning (MAJOR.MINOR.PATCH format) |
| Compatibility Constraint | Version requirements for Claude Code, Node.js, or dependencies |
| Entrypoint | Main skill YAML file that Claude Code loads |

#### 6.0 Granular & Traceable Requirements
[Convert REQ-MKT-### to FR-### format with traceability]

| ID | Requirement Name | Description | Priority | AC |
|----|------------------|-------------|----------|-----|
| FR-001 | Marketplace Index Validation | The marketplace.json file MUST validate against JSON schema | Critical | CI blocks invalid index |
| FR-002 | Plugin Manifest Validation | Each plugin.json MUST validate against schema | Critical | Invalid manifests rejected |
| FR-003 | One-Command Install | User MUST be able to install plugin via single command | High | `/plugin install X` succeeds |
| ... | ... | ... | ... | ... |

#### 7.0 Measurable Non-Functional Requirements
[Import from search/discovery/structural/nfrs]

| ID | Category | Requirement | Metric / Acceptance Criteria |
|----|----------|-------------|------------------------------|
| NFR-PERF-001 | Performance | Install Time | p95 ≤ 2 minutes (including download) |
| NFR-PERF-002 | Performance | Manifest Parse Time | p95 < 1 second for marketplace.json |
| NFR-REL-001 | Reliability | Install Reproducibility | 100% success rate given same versions |
| NFR-REL-002 | Reliability | Rollback Success | 100% without manual intervention |
| NFR-MAINT-001 | Maintainability | Publish Overhead | ≤ 10 minutes from commit to marketplace |
| NFR-SEC-001 | Security | Permission Disclosure | 100% of permissions shown pre-install |
| NFR-ACC-001 | Accuracy | Schema Validation | 100% of invalid schemas rejected by CI |

#### 8.0 Technical & Architectural Constraints
**8.1 Technology Stack**:
- Marketplace Index: Static JSON file in Git repository
- Schema Validation: JSON Schema (draft-07) + AJV validator
- Distribution: GitHub repository with tags for versions
- Installation: Claude Code native plugin system
- CI/CD: GitHub Actions

**8.2 Architectural Principles**:
- The system MUST be git-native (no external databases)
- The marketplace index MUST be statically hostable
- Plugin installations MUST be atomic (all-or-nothing)
- Rollback MUST preserve previous version locally
- Schema validation MUST run in CI before merge

**8.3 Deployment Environment**:
- Marketplace: GitHub repository (public or private)
- Plugins: Distributed via git tags
- Local Cache: ~/.claude/plugins/cache/ (or similar)

#### 9.0 Assumptions, Dependencies & Risks
**9.1 Assumptions**:
1. Claude Code supports plugin.json manifests (or we define the format)
2. Claude Code has a plugin installation API or CLI command
3. Plugins are distributed as git repositories or tarballs
4. Users have git installed for version management

**9.2 Dependencies**:
1. Claude Code plugin system stability (external)
2. GitHub availability for marketplace hosting
3. npm conventions for semantic versioning

**9.3 Risks**:
| Risk ID | Risk | Likelihood | Impact | Mitigation |
|---------|------|------------|--------|------------|
| RISK-01 | Update breaks workflow | Medium | High | Version pinning + rollback (FR-012/013) |
| RISK-02 | Schema drift | Low | Medium | CI validation + schema versioning |
| RISK-03 | Marketplace unavailable | Low | High | Local cache + offline mode fallback |
| RISK-04 | Plugin conflict | Medium | Medium | Dependency resolution + conflict detection |
| RISK-05 | Permission creep | Low | High | Mandatory permission disclosure + audit trail |

## STORE AS
docs/specification-part2.md
```

#### Agent S3: JSON Schema Artifacts

**Agent**: `coder`
**Mission**: Generate validation schemas

**Instructions**:
```markdown
## TASK
Create production-ready JSON schemas with validation.

## OUTPUT FILES

### 1. schemas/marketplace.schema.json
[Full AJV-compatible JSON schema from discovery phase]

### 2. schemas/plugin.schema.json
[Full AJV-compatible JSON schema from discovery phase]

### 3. schemas/package.json (for npm tooling)
\`\`\`json
{
  "name": "@kingin-yellows/marketplace-schemas",
  "version": "1.0.0",
  "description": "JSON schemas for plugin marketplace",
  "main": "index.js",
  "scripts": {
    "validate:marketplace": "ajv validate -s marketplace.schema.json -d ../marketplace.json",
    "validate:plugin": "ajv validate -s plugin.schema.json -d '../plugins/*/plugin.json'",
    "test": "npm run validate:marketplace && npm run validate:plugin"
  },
  "devDependencies": {
    "ajv": "^8.12.0",
    "ajv-cli": "^5.0.0"
  }
}
\`\`\`

### 4. .github/workflows/validate-schemas.yml
\`\`\`yaml
name: Validate Marketplace Schemas

on:
  pull_request:
    paths:
      - 'marketplace.json'
      - 'plugins/**/plugin.json'
      - 'schemas/*.schema.json'
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd schemas && npm install
      - run: cd schemas && npm test
\`\`\`

## STORE AS
schemas/* (create directory structure)
```

---

## PHASE 4: VALIDATION & REFINEMENT

### 4.1 Requirements Traceability

**Agent**: `reviewer`
**Mission**: Ensure every PRD requirement is addressed in specification

**Instructions**:
```markdown
## TASK
Create traceability matrix linking PRD to specification.

## OUTPUT FORMAT

| PRD Req | Spec Section | Spec Req ID | Coverage | Notes |
|---------|--------------|-------------|----------|-------|
| REQ-MKT-001 | 3.0 Data Models | FR-001 | 100% | marketplace.json schema defined |
| REQ-MKT-002 | 3.0 Data Models | FR-002 | 100% | plugin.json schema defined |
| REQ-MKT-003 | 2.2 User Journeys | FR-003 | 90% | Detail view in CLI (not GUI) |
| ... | ... | ... | ... | ... |

### Coverage Summary
- Total PRD requirements: N
- Fully covered: M (X%)
- Partially covered: P (Y%)
- Not covered: Q (Z%)

### Coverage Gaps (if any)
1. [Gap description] → Recommendation: [Add to spec section X]

## VALIDATION GATE
- Coverage ≥ 95% → PASS
- Coverage < 95% → FAIL (iterate on specification)

## STORE AS
docs/traceability-matrix.md
```

---

### 4.2 Adversarial Specification Review

**Agent**: `red-team-agent`
**Mission**: Challenge specification completeness and correctness

**Instructions**:
```markdown
## TASK
Red team critique of complete specification.

## CRITIQUE CATEGORIES

### 1. Ambiguity Detection
**Question**: Are all terms precisely defined?
- [ ] Check glossary coverage
- [ ] Check for vague keywords ("simple", "fast", "easy")
- [ ] Check for undefined behaviors

**Findings**:
- Issue: "Simple publishing" not quantified
  - Recommendation: Add acceptance criteria (X steps max)

### 2. Completeness Gaps
**Question**: What scenarios are not handled?
- [ ] Plugin conflict resolution
- [ ] Marketplace version migration
- [ ] Orphaned plugins (removed from marketplace)
- [ ] Multi-architecture support (ARM vs x64)

**Findings**:
[List gaps with severity]

### 3. Inconsistency Detection
**Question**: Do requirements contradict?
- [ ] Version pinning vs update notifications
- [ ] Rollback vs local cache limits
- [ ] Permission disclosure vs runtime enforcement

**Findings**:
[List conflicts]

### 4. Testability Analysis
**Question**: Can every requirement be tested?
- [ ] All MUST requirements have AC
- [ ] All NFRs have metrics
- [ ] All error scenarios have expected outcomes

**Findings**:
[List untestable requirements]

### 5. Implementation Feasibility
**Question**: Are requirements implementable?
- [ ] Claude Code API constraints
- [ ] Git/GitHub limitations
- [ ] Complexity vs Phase 1 scope

**Findings**:
[List infeasible requirements]

## OUTPUT FORMAT
| Critique ID | Category | Severity | Finding | Recommendation | Confidence |
|-------------|----------|----------|---------|----------------|------------|
| CRIT-001 | Ambiguity | High | "Simple" undefined | Add quantitative criteria | 95% |
| ... | ... | ... | ... | ... | ... |

## STORE AS
docs/adversarial-review.md
```

---

### 4.3 Final Specification Assembly

**Agent**: `documenter`
**Mission**: Assemble and polish final specification document

**Instructions**:
```markdown
## TASK
Merge all specification components into final deliverable.

## OUTPUT STRUCTURE

\`\`\`
docs/
├── SPECIFICATION.md (Complete specification)
│   ├── Part 1: Essentials
│   └── Part 2: Advanced
├── specification-part1.md (backup)
├── specification-part2.md (backup)
├── traceability-matrix.md
├── adversarial-review.md
├── schemas/
│   ├── marketplace.schema.json
│   ├── plugin.schema.json
│   └── package.json
└── examples/
    ├── marketplace.example.json
    └── plugin.example.json
\`\`\`

## FINAL SPECIFICATION CHECKLIST
- [ ] All sections complete
- [ ] All requirements have IDs
- [ ] All NFRs have metrics
- [ ] All error scenarios defined
- [ ] Schemas validate
- [ ] Examples validate against schemas
- [ ] Traceability ≥95%
- [ ] Adversarial critiques addressed
- [ ] Version and status set
- [ ] Ready for implementation

## STORE AS
docs/SPECIFICATION.md (master document)
```

---

## EXECUTION SUMMARY

### Sequential Execution Plan

**Message 1: Phase 0 (Meta-Analysis)**
```bash
Task("meta-learning-agent", "Execute Section 0.1: Step-Back Prompting")
Task("adaptive-coordinator", "Execute Section 0.2: Ambiguity Clarification")
Task("meta-learning-agent", "Execute Section 0.3: Self-Ask Decomposition")
Task("adaptive-coordinator", "Execute Section 0.4: ReWOO Planning")

TodoWrite({ todos: [
  {id: "1", content: "Complete Phase 0 meta-analysis", status: "in_progress"},
  {id: "2", content: "Resolve ambiguities with user", status: "pending"},
  {id: "3", content: "Execute Phase 1 discovery", status: "pending"},
  {id: "4", content: "Execute Phase 2 gap analysis", status: "pending"},
  {id: "5", content: "Execute Phase 3 synthesis", status: "pending"},
  {id: "6", content: "Execute Phase 4 validation", status: "pending"},
  {id: "7", content: "Deliver final specification", status: "pending"}
]})
```

**Message 2: Ambiguity Resolution (WAIT for user input)**
```
AskUserQuestion([
  {
    question: "Where should plugin.json be stored?",
    header: "Schema Location",
    options: [
      {label: "In plugin root directory", description: "Each plugin repo has plugin.json at root"},
      {label: "In marketplace index", description: "All manifests embedded in marketplace.json"}
    ]
  },
  // ... more questions from 0.2
])
```

**Message 3: Phase 1 (Discovery - Parallel Agents)**
```bash
# Launch all discovery agents in parallel
Task("code-analyzer", "Section 1.1 Agent 1: Functional Requirements Extractor")
Task("backend-dev", "Section 1.1 Agent 2: Data Model Extractor")
Task("perf-analyzer", "Section 1.1 Agent 3: NFR Analyzer")
Task("researcher", "Section 1.2 Agent 4: Claude Code Plugin System Research")

TodoWrite({ todos: [mark phase 0 complete, phase 1 in_progress] })
```

**Message 4: Phase 2 (Gap Analysis - Sequential)**
```bash
# Wait for phase 1 completion, then execute
Task("gap-hunter", "Section 2.1: PRD Coverage Analysis")
Task("error-handling-architect", "Section 2.2: Error Scenario Analysis")

TodoWrite({ todos: [mark phase 1 complete, phase 2 in_progress] })
```

**Message 5: Phase 3 (Synthesis - Sequential)**
```bash
Task("documenter", "Section 3.1 Agent S1: Part 1 Generator")
Task("documenter", "Section 3.1 Agent S2: Part 2 Generator")
Task("coder", "Section 3.1 Agent S3: JSON Schema Artifacts")

TodoWrite({ todos: [mark phase 2 complete, phase 3 in_progress] })
```

**Message 6: Phase 4 (Validation - Sequential)**
```bash
Task("reviewer", "Section 4.1: Requirements Traceability")
Task("red-team-agent", "Section 4.2: Adversarial Specification Review")
Task("documenter", "Section 4.3: Final Specification Assembly")

TodoWrite({ todos: [mark phase 3 complete, phase 4 in_progress] })
```

**Message 7: Delivery**
```bash
# Present final deliverables
# Generate executive summary
# Store in memory for future reference
```

---

## SUCCESS CRITERIA

### Specification Quality Gates

**Gate 1: Completeness**
- [ ] All PRD requirements addressed (traceability ≥95%)
- [ ] All Part 1 sections complete
- [ ] Part 2 sections complete for complex areas (NFRs, schemas)

**Gate 2: Clarity**
- [ ] All terms in glossary
- [ ] All requirements have MUST/SHOULD/MAY
- [ ] All NFRs have metrics
- [ ] All error scenarios have behaviors

**Gate 3: Testability**
- [ ] Every requirement has acceptance criteria
- [ ] JSON schemas validate example files
- [ ] NFR metrics are measurable

**Gate 4: Implementability**
- [ ] No contradictions between requirements
- [ ] Constraints from Claude Code identified
- [ ] Dependencies documented
- [ ] Risks mitigated

**Gate 5: Maintainability**
- [ ] Document control metadata complete
- [ ] Versioning strategy defined
- [ ] Examples provided
- [ ] CI validation configured

---

## MEMORY STORAGE STRATEGY

### Key Memory Namespaces

```bash
# Store final deliverables
npx claude-flow memory store "specification" '{
  "path": "docs/SPECIFICATION.md",
  "version": "1.0.0",
  "sections": {
    "part1": "docs/specification-part1.md",
    "part2": "docs/specification-part2.md"
  },
  "schemas": "schemas/",
  "status": "ready-for-review"
}' --namespace "project/specs"

# Store schemas for future validation
npx claude-flow memory store "marketplace-schema" '{...schema content...}' --namespace "project/schemas"
npx claude-flow memory store "plugin-schema" '{...schema content...}' --namespace "project/schemas"

# Store traceability for future reference
npx claude-flow memory store "requirements-trace" '{...matrix...}' --namespace "project/traceability"
```

---

## FINAL DELIVERABLES

1. **docs/SPECIFICATION.md** - Complete specification (Part 1 + Part 2)
2. **schemas/marketplace.schema.json** - Marketplace index JSON schema
3. **schemas/plugin.schema.json** - Plugin manifest JSON schema
4. **docs/traceability-matrix.md** - PRD to spec mapping
5. **docs/adversarial-review.md** - Red team critique + resolutions
6. **examples/marketplace.example.json** - Valid example
7. **examples/plugin.example.json** - Valid example
8. **.github/workflows/validate-schemas.yml** - CI automation

---

**END OF SEARCH PROMPT**

*This prompt applies USACF techniques: Step-Back Prompting, Self-Ask Decomposition, ReWOO Planning, Multi-Agent Decomposition, Gap Analysis, Uncertainty Quantification, Multi-Perspective Analysis, Adversarial Review, Version Control, and Progressive Summarization.*
