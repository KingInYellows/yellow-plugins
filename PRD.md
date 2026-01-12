# PRD v1.2 — KingInYellows Personal Plugin Marketplace (Updated)

KingInYellows Plugin Marketplace — Product Requirements Document

PRD ID: PRD-KIY-MKT-001
Version: 1.2 (Personal/Homelab Scope Update)
Status: Draft → Ready for Spec Research
Owner: Solo developer (you)
Created: 2026-01-11
Last Updated: 2026-01-11
Product Type: Personal plugin registry/marketplace (curated, small scale)

## 1. Executive Summary and Strategic Context

### 1.1 Vision Statement

A simple, reliable way for me to publish, discover, install, and update my Claude Code plugins from a single place—without friction.

### 1.2 What "Success" Means (No Download Goals)

This is not an ecosystem growth play initially. Success is measured by my own workflow reliability and ease of maintenance.

Primary Success Metric (PSM):

Time-to-install a plugin on a fresh machine (target: ≤ 2 minutes end-to-end)

Secondary Success Metrics:

Update confidence: I can update plugins without breaking my setup (target: rollback available + version pinning works)

Maintenance overhead: Adding a new plugin requires minimal manual steps (target: ≤ 10 minutes to publish a new plugin version)

Future note: If this becomes public later, we can add adoption/download goals and broader trust signals then.

## 1. Users and Stakeholders

### 1.1 Personas (Reduced)

P1: Solo Developer (You)

Goal: quickly install and manage your own plugins across machines/environments

Needs: consistent plugin metadata, predictable updates, simple publishing pipeline

P2: "Future Me" Maintainer

Goal: avoid brittle systems and forgotten conventions 3–6 months later

Needs: automation, clear structure, guardrails, docs-by-default

Removed for now: enterprise admin/security personas.

## 1. Problem Space

### 1.1 Problem Definition

When plugins live across repos and ad-hoc install steps, it's easy to:

forget how to install/configure them

lose track of versions

break working setups during updates

waste time redoing "known steps" on new devices

### 1.2 Solution Approach

A small curated marketplace (GitHub-backed initially) that provides:

a single marketplace index (marketplace.json)

standardized plugin manifests (plugin.json)

a clean install/update experience via Claude Code commands

basic guardrails (schema validation, compatibility checks, permission disclosure)

## 1. Scope

### 1.1 In Scope (Phase 1: Personal MVP)

Marketplace index + schema validation

Browse/list plugins and view details (CLI-first is acceptable)

Install plugin from marketplace

Update plugin + version pinning + rollback

Compatibility enforcement (Claude Code version / plugin version constraints)

"Docs-first" plugin detail fields (even if only you read them)

### 1.2 In Scope (Phase 2: Quality-of-life)

Search + tags/categories

Simple release automation (tagging, changelog link)

Optional basic scanning in CI (dependency audit / lint / tests)

### 1.3 Out of Scope (Explicit)

Enterprise governance: org allowlists, audit logs for teams, admin consoles

Paid marketplace, licensing/billing

Public moderation workflows, ranking algorithms, review systems

Strong security guarantees / formal audits (beyond personal guardrails)

Multi-tenant hosting / SaaS marketplace

## 1. Functional Requirements (Updated)

Convention: REQ-MKT-### with priority MUST/SHOULD/MAY.

### 1.1 Marketplace Index + Metadata

REQ-MKT-001 (MUST): Marketplace index

The marketplace MUST expose a machine-readable marketplace.json listing plugins and key metadata.

AC: Index validates against schema; invalid entries fail CI.

REQ-MKT-002 (MUST): Standard

Each plugin MUST include a plugin.json containing: name, version, description, entrypoints, compatibility, permissions, and docs link.

AC: Missing required fields blocks publishing.

REQ-MKT-003 (SHOULD): Detail view

SHOULD provide a detail view (CLI output is fine) showing docs, versions, permissions, compatibility.

AC: A single command displays details for a plugin.

### 1.2 Install / Update / Rollback

REQ-MKT-010 (MUST): One-command install

MUST support installing a plugin via /plugin install plugin@kingin-yellows.

AC: Installs successfully on a clean environment given valid plugin.

REQ-MKT-011 (MUST): Compatibility enforcement

MUST block install/update if Claude Code version doesn't meet plugin requirements.

AC: Error shows current vs required versions.

REQ-MKT-012 (MUST): Version pinning

MUST allow pinning plugin versions to prevent accidental breaking updates.

AC: Pinned plugin stays pinned unless explicitly changed.

REQ-MKT-013 (MUST): Rollback

MUST provide a rollback path to a prior known-good version.

AC: After update, rollback restores prior version without manual cleanup.

REQ-MKT-014 (SHOULD): Update notifications

SHOULD surface updates for installed plugins.

AC: Command shows which plugins have updates available.

### 1.3 Publishing Workflow (Solo-dev friendly)

REQ-MKT-020 (MUST): Simple publishing

MUST support publishing by updating plugin folder + manifest + version and merging to main.

AC: One PR/merge results in updated marketplace entry.

REQ-MKT-021 (MUST): Semantic versioning

MUST use semver.

AC: CI blocks non-semver versions.

REQ-MKT-022 (SHOULD): Release automation

SHOULD auto-tag releases and optionally link changelog notes.

AC: A new version produces a consistent release artifact or tag.

### 1.4 Permissions (Lightweight, Non-enterprise)

REQ-MKT-030 (MUST): Permission disclosure

MUST display declared permissions prior to install/update.

AC: Output includes permissions list.

REQ-MKT-031 (MAY): Basic scanning

MAY run lightweight checks (lint/tests/dependency audit).

AC: If enabled, CI must fail on critical issues per your config.

Removed: enterprise allowlists, audit log exports, incident response workflows, formal security review gates.

## 1. Non-Functional Requirements (Adjusted for personal use)

NFR-PERF-001: Manifest read/parse time

SHOULD load and parse marketplace index quickly on a typical home connection (target p95 < 1s).

NFR-REL-001: Deterministic installs

MUST be reproducible given the same versions (marketplace index + plugin version pin).

NFR-MAINT-001: Low operational overhead

SHOULD minimize manual steps for publishing and updating (targets reflected in Success Metrics).

## 1. Risks and Mitigations (Simplified)

RISK-01: Update breaks workflow

Mitigation: version pinning + rollback (REQ-MKT-012/013)

RISK-02: Manifest drift / inconsistent structure

Mitigation: schema validation + CI gate (REQ-MKT-001/002)

RISK-03: "Future me" can't remember how it works

Mitigation: docs fields required + consistent commands (REQ-MKT-003/020)

## 1. Open Questions (Refocused)

Q-01: What is the minimum required plugin.json schema for Claude Code compatibility?
Q-02: How should rollback be implemented (cache old versions locally vs fetch by tag)?
Q-03: What should the marketplace index contain vs each plugin manifest?
Q-04: Do you want the marketplace to be CLI-only initially, or include a simple web README/catalog view?
Q-05: Should Phase 2 include multi-market support (e.g., personal + experimental)?

## 1. Assumptions (Updated)

A-01: Marketplace is personal-only initially; no public submission workflow required.
A-02: GitHub repository is the initial source of truth for index + plugin contents.
A-03: Claude Code plugin system supports a permission declaration model (at least displayable).

## 8. Technical Constraints

### 8.1 Core Technology Stack

| Technology | Version | Purpose | Justification |
|------------|---------|---------|---------------|
| **Git** | 2.30+ | Version control and plugin distribution | Industry standard, required for git-native architecture |
| **Node.js** | **18 LTS or 20 LTS** | Runtime for Claude Code plugins | Compatible with Claude Code 2.0.12+. **NOT 25+** due to API removal that breaks Claude Code compatibility |
| **JSON Schema** | Draft-07 | Schema validation format | Stable, widely supported, AJV compatibility |
| **GitHub** | N/A (SaaS) | Repository hosting | Free, integrated with git, supports Actions CI/CD |

**Critical Constraint**: Node.js 25+ is **NOT** supported due to Claude Code API incompatibility.

### 8.2 Libraries & Dependencies

| Library | Version | Purpose | Integration Point |
|---------|---------|---------|-------------------|
| **AJV** | 8.12+ | JSON Schema validation | CI validation scripts (marketplace + plugin schemas) |
| **semver** | 7.5+ | Version comparison and ranges | Compatibility checking (claudeCodeMin/Max) |
| **Git CLI** | 2.30+ | Repository operations | Plugin download, version checkout, rollback |
| **npm** | 9+ (bundled with Node.js) | Dependency management | Plugin installation (npm install), package.json support |

**Installation Commands**:
```bash
# Global tools for CI/CD
npm install -g ajv-cli@5.0.0

# Local development dependencies
npm install --save-dev ajv@8.12.0 semver@7.5.3
```

### 8.3 File System Conventions

| Path | Purpose | Structure |
|------|---------|-----------|
| `~/.claude/plugins/cache/` | Downloaded plugin storage | `{pluginId}/{version}/` subdirectories |
| `~/.claude/plugins/installed/` | Active plugin symlinks | Symlinks to cache versions |
| `~/.claude/plugins/config.json` | Installed plugin registry | JSON file tracking versions and pins |
| `.claude-plugin/marketplace.json` | Marketplace index (repo root) | Single file, statically served |
| `.claude-plugin/plugin.json` | Plugin manifest (plugin dir) | Per-plugin metadata |

**Cache Structure Example**:
```
~/.claude/plugins/
├── cache/
│   ├── hookify/
│   │   ├── 1.0.0/  (rollback version)
│   │   └── 1.2.3/  (current version)
│   └── pr-review-toolkit/
│       └── 2.1.0/
├── installed/
│   ├── hookify -> ../cache/hookify/1.2.3
│   └── pr-review-toolkit -> ../cache/pr-review-toolkit/2.1.0
└── config.json
```

**Rationale**: Symlink approach enables instant rollback (< 1s, change symlink target)

### 8.4 Architectural Principles

1. **Git-Native Architecture**: System uses git as source of truth for all plugins
2. **Statically Hostable**: marketplace.json servable as static file (no server-side logic)
3. **Atomic Operations**: All install/update/rollback operations are atomic (all-or-nothing)
4. **Schema Validation in CI**: Invalid marketplace.json or plugin.json blocks PR
5. **Local-First with Network Fallback**: Cache enables offline browsing of installed plugins
6. **Immutable Versions**: Published plugin versions are immutable (no editing post-publish)
7. **Explicit Dependencies**: Plugin dependencies declared in plugin.json, circular dependencies rejected

### 8.5 CI/CD Workflow

**GitHub Actions Workflow** (`.github/workflows/validate-marketplace.yml`):

```yaml
name: Validate Marketplace
on:
  pull_request:
    paths:
      - '.claude-plugin/marketplace.json'
      - 'plugins/*/.claude-plugin/plugin.json'
  push:
    branches: [main]

jobs:
  validate-schemas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'  # Use Node.js 20 LTS for CI

      - name: Install validation tools
        run: npm install -g ajv-cli@5.0.0

      - name: Validate marketplace.json
        run: ajv validate -s schemas/marketplace.schema.json -d .claude-plugin/marketplace.json

      - name: Validate all plugin.json files
        run: |
          find plugins -name 'plugin.json' -path '*/.claude-plugin/plugin.json' | \
          xargs -I {} ajv validate -s schemas/plugin.schema.json -d {}

      - name: Check plugin source paths exist
        run: node scripts/validate-marketplace.js
```

**Validation Rules**:
1. marketplace.json validates against schema (AJV)
2. All plugin.json files validate against schema (AJV)
3. All `source` paths exist in repository
4. All plugin IDs are unique
5. marketplace.json versions match plugin.json versions
6. All version fields are valid semver
7. All category values are in enum
8. All permission scopes are valid

**CI Performance Target**: Complete in < 5 minutes (NFR-MAINT-002)

### 8.6 Technology Decision Rationale

**Why Node.js 18-20 LTS?**
- Compatibility with Claude Code 2.0.12+ (requires Node.js 18-24)
- Stability through LTS support
- Exclusion of Node.js 25+ due to API removal that breaks Claude Code

**Why AJV for JSON Schema?**
- Performance: Fastest JSON Schema validator (10x faster than alternatives)
- Compliance: 100% JSON Schema Draft-07 support
- Ecosystem: Most widely used (10M+ weekly downloads), well-documented
- CLI: ajv-cli enables CI validation without custom code

**Why Local Cache at ~/.claude/plugins/cache/?**
- Fast Rollback: Instant symlink swap (< 1s, meets NFR-PERF-005)
- Offline Capability: Browse/rollback without network
- Standard Location: Follows XDG conventions
- Disk Efficiency: Multiple versions cached, only one symlinked

**Why Symlinks for Installed Plugins?**
- Atomic Rollback: Change symlink target atomically
- Disk Efficiency: No file duplication
- Crash Safety: Incomplete operations leave symlink unchanged
- Transparency: Users can inspect actual installed version

### 8.7 NFR Compliance

This technology stack satisfies:
- ✅ NFR-PERF-001: Parse < 1s (AJV is fast, validates in < 50ms)
- ✅ NFR-REL-001: Deterministic (exact versions specified)
- ✅ NFR-MAINT-001: Low overhead (GitHub Actions + schema validation)
- ✅ NFR-MAINT-002: CI < 5 min (simple validation workflow, typically ~1 min)

**Full specification**: See [docs/technology-stack-complete.md](/home/kinginyellow/projects/yellow-plugins/docs/technology-stack-complete.md)