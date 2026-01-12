# NFR Quick Reference

**Status**: Ready for downstream agents
**Source**: D02-NFR-Extraction.md (full analysis)
**Memory Key**: `search/discovery/nfrs`

---

## 21 NFRs by Priority

### MUST (13 NFRs) - Phase 1 Critical Path

| ID | Requirement | Target | Source |
|----|-------------|--------|--------|
| **NFR-PERF-001** | Install time | p95 ≤ 2 min | PSM |
| **NFR-REL-001** | Deterministic installs | 100% reproducible | Section 7 |
| **NFR-REL-002** | Rollback success | 100% no manual cleanup | SSM1 |
| **NFR-REL-004** | Schema validation | 100% invalid blocked | REQ-MKT-001 |
| **NFR-REL-005** | Compatibility check | 100% incompatible blocked | REQ-MKT-011 |
| **NFR-REL-006** | Version pin stability | 100% pins persist | REQ-MKT-012 |
| **NFR-MAINT-003** | Breaking changes | Zero per minor version | REQ-MKT-021 |
| **NFR-MAINT-004** | Documentation coverage | 100% required fields | REQ-MKT-002 |
| **NFR-SEC-001** | Permission disclosure | 100% before install | REQ-MKT-030 |
| **NFR-USE-001** | Error message clarity | 100% actionable | Persona P1 |
| **NFR-EXT-003** | Schema versioning | Forward/backward compatible | RISK-02 |

---

### SHOULD (7 NFRs) - Phase 2 Quality-of-Life

| ID | Requirement | Target | Source |
|----|-------------|--------|--------|
| **NFR-PERF-002** | Publish time | ≤ 10 min | SSM2 |
| **NFR-PERF-003** | Manifest parse | p95 < 1s | Section 7 |
| **NFR-PERF-004** | Update check | p95 < 3s | REQ-MKT-014 |
| **NFR-PERF-005** | CLI response | p95 < 5s | Baseline |
| **NFR-MAINT-001** | Publish overhead | ≤ 2 manual steps | SSM2 |
| **NFR-MAINT-002** | CI execution | < 5 min | Derived |
| **NFR-MAINT-005** | Error actionability | 100% fix guidance | Persona P2 |
| **NFR-USE-002** | Command simplicity | ≤ 5 commands | Baseline |
| **NFR-USE-003** | Output formatting | 100% consistent | Baseline |
| **NFR-USE-004** | Detail completeness | 100% metadata visible | REQ-MKT-003 |
| **NFR-EXT-001** | Multi-market | ≥1, expandable | Q-05 |
| **NFR-EXT-002** | Plugin hooks | ≥4 lifecycle hooks | Derived |
| **NFR-SEC-003** | Manifest integrity | 100% tamper detected | RISK-02 |

---

### MAY (1 NFR) - Optional Enhancement

| ID | Requirement | Target | Source |
|----|-------------|--------|--------|
| **NFR-SEC-002** | Dependency audit | 0 critical CVEs | REQ-MKT-031 |

---

## Success Metric Mapping

**PSM (Install ≤ 2 min)** → NFR-PERF-001, NFR-PERF-003, NFR-PERF-004, NFR-REL-003, NFR-REL-005

**SSM1 (Update confidence)** → NFR-REL-002, NFR-REL-006, NFR-REL-004, NFR-MAINT-003

**SSM2 (Publish ≤ 10 min)** → NFR-PERF-002, NFR-MAINT-001, NFR-MAINT-002, NFR-MAINT-004

---

## High-Risk NFRs (RPN ≥ 200)

1. **NFR-REL-002** (Rollback) - RPN 252 → Atomic rollback strategy required
2. **NFR-PERF-001** (Install time) - RPN 240 → Local caching + parallel downloads
3. **NFR-REL-004** (Schema validation) - RPN 120 → JSON Schema strict mode

---

## For Schema Designer (Coder)

**NFR-driven schema requirements**:
- NFR-PERF-003: Flat structure, no deep nesting (fast parsing)
- NFR-REL-004: JSON Schema with required fields + format validators
- NFR-MAINT-004: Every field needs description + examples
- NFR-EXT-003: Include `$schema` version field, design for additive changes

---

## For Error Handler

**NFR-USE-001**: All errors MUST include:
- WHAT: What went wrong
- WHY: Reason for failure
- HOW: Steps to fix

Example:
```
ERROR: Cannot install plugin "example@2.0.0"
REASON: Requires Claude Code ≥2.0.0, current version 1.5.3
FIX: npx @claude/code upgrade OR install example@1.9.0
```
