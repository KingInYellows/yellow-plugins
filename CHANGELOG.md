# Changelog

<!-- anchor: changelog-release-notes -->

All notable changes to the Yellow Plugins project will be documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-01-11

### Added

- **Domain Services**: Complete plugin lifecycle orchestration (FR-004, FR-007,
  FR-009)
  - Install transaction orchestrator with atomic operations (CRIT-001, CRIT-003)
  - Update pipeline with changelog awareness (FR-008)
  - Uninstall lifecycle with hook execution (FR-012)
  - Publish command with git integration and validation (FR-009, FR-011)
  - Pin management for version locking (FR-006)
- **Infrastructure Layer**: Comprehensive support services
  - Cache service with eviction policies and size management (NFR-PERF-002)
  - Registry service with transaction boundaries and atomic writes (CRIT-001)
  - Compatibility policy engine with 5-dimension validation (FR-005,
    NFR-REL-003)
  - Validation toolkit with JSON Schema harnesses (FR-001, FR-002)
  - Configuration provider with precedence rules (FR-012, Section 4)
- **CLI Interface**: User-facing commands and helpers
  - Manifest-driven command runner with typed contracts
  - CLI bootstrap with preflight banner showing config/flags
  - UI helper utilities for consistent formatting
- **Observability & Metrics**: Structured telemetry stack (Section 6)
  - Metrics exporter with KPI tracking (install success, rollback duration,
    cache size)
  - Prometheus-compatible metrics format with JSON logs
  - Transaction ID tracking across all lifecycle operations (Section 4)
- **CI/CD Automation**: GitHub Actions workflows
  - `validate-schemas.yml` - Schema validation with 10 marketplace + 12 plugin
    rules (< 1min)
  - `publish-release.yml` - Multi-stage release workflow with validation, SBOM,
    and artifact generation
  - Release workflow supports both tag-triggered and manual dispatch modes
- **Operational Documentation**: (Section 3.7, Section 3.16)
  - `docs/operations/feature-flags.md` - Feature flag governance and precedence
    rules
  - `docs/operations/ci.md` - CI specification and workflow documentation
  - `docs/operations/ci-pipeline.md` - Detailed pipeline architecture
  - `docs/operations/runbook.md` - Incident response procedures
  - `docs/operations/metrics.md` - KPI definitions and monitoring guide
  - `docs/operations/transaction-boundaries.md` - Atomic operation guarantees
  - `docs/operations/git-auth.md` - Git authentication handling
  - `docs/operations/uninstall.md` - Uninstall workflow documentation
  - `docs/operations/onboarding.md` - Developer onboarding guide
  - `docs/operations/postmortem-template.md` - Incident postmortem template

### Feature Flags (`.claude-plugin/flags.json`)

All flags default to **disabled** unless explicitly enabled (Section 4
directive):

- `enableBrowse`: false - Discovery features (FR-002)
- `enablePublish`: false - Publishing workflow (FR-009)
- `enableRollback`: false - Rollback functionality (FR-007)
- `enableVariants`: false - Alpha/beta channel switching (FR-006)
- `enableLifecycleHooks`: false - Install/uninstall script execution (FR-008)
- `enableCompatibilityChecks`: **true** - Safety-critical validation
  (NFR-REL-003)
- `enableCiValidation`: false - CI validation runner (FR-011)

### Architecture

- **Monorepo Structure**: pnpm workspaces with 3 packages
  - `@yellow-plugins/domain` - Business logic (zero external layer dependencies)
  - `@yellow-plugins/infrastructure` - External integrations and services
  - `@yellow-plugins/cli` - Command-line interface
- **Layer Boundaries**: ESLint enforces clean architecture (domain ←
  infrastructure ← cli)
- **Testing**: vitest framework, 76% automation coverage target (NFR-TEST-001)

### Performance & Reliability

- Install duration: ≤ 2 minutes (p95) - **PSM** (NFR-PERF-001)
- Publish duration: ≤ 10 minutes (Section 4, NFR-PERF-003)
- CI validation job: < 60 seconds median (Iteration 4 metrics target)
- Rollback duration: < 1 second via symlink swap (NFR-PERF-005)
- Cache management: 500MB default limit with automatic eviction (NFR-PERF-002)

### Security & Safety

- Permission disclosure before installation (FR-012, CRIT-005)
- Lifecycle script confirmation with typed consent (`"I TRUST THIS SCRIPT"`)
  (Section 4)
- Digest display for all downloaded artifacts (Section 4)
- Atomic persistence with temp file + rename semantics (Section 4, CRIT-001)
- Transaction IDs logged for all operations (Section 4)

### Requirements Traceability

This release addresses:

- **Functional Requirements**: FR-001 through FR-013 (all 13 requirements)
- **Non-Functional Requirements**: All 26 NFRs across 6 categories
- **Critical Corrections**: CRIT-001 through CRIT-005 from adversarial review
- **Iteration 4 Tasks**: I4.T1 (Publish), I4.T2 (CI Expansion), I4.T3 (Metrics),
  I4.T4 (Runbooks)

### Documentation

- Complete specification (29,000 words) in `docs/SPECIFICATION.md`
- Executive summary for stakeholders (5-minute read)
- Implementation guide (3-hour developer onboarding)
- 100% PRD coverage in traceability matrix
- 27 adversarial critiques addressed in v1.1

### Known Limitations

- Permission enforcement is **disclosure-only** in Phase 1 (FR-012
  clarification)
- Marketplace discovery is git-native only (no centralized registry) (FR-003)
- Cache eviction is size-based only (no TTL expiration) (NFR-PERF-002)

---

## [1.0.0] - 2026-01-09

### Added

- **Core Specifications**: Complete requirements and design documents
  - Product Requirements Document (PRD) v1.2
  - Specification Part 1 (Essentials) - 14,500 words
  - Specification Part 2 (Advanced) - 15,000 words
  - Executive summary and implementation guide
- **Schemas**: Production-ready JSON Schema validation
  - `schemas/marketplace.schema.json` - Marketplace index validation (10 rules)
  - `schemas/plugin.schema.json` - Plugin manifest validation (12 rules)
  - Example files with passing validation
- **User Journeys**: 10 complete user workflows documented (Section 2.2)
  - Install plugin (12 steps with atomic transactions)
  - Update plugin with changelog awareness
  - Rollback to previous version
  - Browse marketplace
  - View plugin details
  - Variant switching (alpha/beta)
  - Publish plugin
  - Pin plugin version
  - Check for updates
  - Uninstall plugin
- **Error Scenarios**: 23 documented error cases with recovery paths (Section
  4.3)
- **Quality Assurance**:
  - Adversarial review with 27 critiques
  - Traceability matrix proving 100% PRD coverage
  - Quality score: 92/100 (exceeds 85 minimum)

### Architecture Decisions

- Git-native marketplace (no centralized server) (ADR implied in Section 8.1)
- Local-first caching with `.claude-plugin/` directory (ADR implied in Section
  3.2)
- Disclosure-only permission model for Phase 1 (CRIT-005 correction)
- Symlink-based rollback for instant recovery (Section 2.2.3)

### Documentation Structure

```
docs/
├── SPECIFICATION.md              # Complete merged spec (29K words)
├── EXECUTIVE-SUMMARY.md          # Stakeholder quick reference
├── IMPLEMENTATION-GUIDE.md       # Developer roadmap
├── SPECIFICATION-PART1-v1.1.md   # User journeys + data models
├── SPECIFICATION-PART2-v1.1.md   # NFRs + architecture + risks
├── traceability-matrix.md        # 100% coverage proof
├── ADVERSARIAL-REVIEW.md         # 27 critiques
└── CORRECTIONS-APPLIED.md        # v1.0 → v1.1 changelog
```

### Success Metrics

- **PSM**: Install plugin in ≤ 2 minutes (p95) with 4-dimension compatibility
  check
- **SSM-1**: 100% rollback success without manual cleanup
- **SSM-2**: Publish new plugin in ≤ 10 minutes from tag push to marketplace
  entry

### Known Issues Addressed in v1.1

- Added transaction boundaries for atomic operations (CRIT-001)
- Clarified permission model as disclosure-only (CRIT-005)
- Added nodeMax field to plugin schema (CRIT-002)
- Specified conflict resolution flow (CRIT-003)
- Enhanced cache management and eviction policy (CRIT-004)

---

## [Unreleased]

### Planned for v1.2.0

- Feature flag graduations based on testing outcomes
- Enhanced metrics dashboard with visualization
- Plugin conflict resolution improvements
- Cache TTL expiration (complement to size-based eviction)
- Plugin dependency graph visualization

### Under Consideration

- Web UI for marketplace browsing (alternative to CLI-only)
- Plugin sandboxing with permission enforcement (Phase 2)
- Multi-registry support for private/enterprise plugins
- Plugin analytics and usage tracking (opt-in)

---

## Release Notes Format

Each release entry includes:

1. **Added/Changed/Fixed/Removed** sections following Keep a Changelog format
2. **Feature Flags** with current states and requirement references
3. **Requirements Traceability** citing FR/NFR/CRIT identifiers
4. **Performance Metrics** with actual/target values
5. **Documentation Updates** listing new/modified docs
6. **Known Limitations** with transparency about scope

---

## Version History Summary

| Version | Date       | Highlights                                         | Requirements    | Quality   |
| ------- | ---------- | -------------------------------------------------- | --------------- | --------- |
| 1.1.0   | 2026-01-11 | Implementation foundation, CI/CD, operational docs | 13 FRs, 26 NFRs | 92/100    |
| 1.0.0   | 2026-01-09 | Specification, schemas, architecture               | 13 FRs, 21 NFRs | 75→92/100 |

---

## Contributing to Changelog

When creating a new release:

1. Update version heading with release date
2. Cite all FR/NFR/CRIT identifiers for traceability
3. Document feature flag states with defaults
4. Include performance metrics vs. targets
5. Reference Section 4 directives where applicable
6. List architectural changes with ADR citations
7. Update version history summary table

For changelog automation, the GitHub Actions workflow extracts release notes
using:

```bash
awk "/## \[?$VERSION\]?/,/## \[?[0-9]/" CHANGELOG.md
```

Ensure version headings follow the format: `## [X.Y.Z] - YYYY-MM-DD`

---

**Maintained by**: KingInYellows **Format**:
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) **Versioning**:
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) **Last Updated**:
2026-01-11
