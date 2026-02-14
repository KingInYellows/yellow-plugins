---
status: complete
priority: p3
issue_id: "058"
tags: [code-review, validation, quality]
dependencies: []
pr_number: 12
completed_date: "2026-02-13"
---

# 🔵 P3: Add Scanner Output JSON Schema Validation

## Problem Statement

The audit-synthesizer reads scanner outputs but doesn't validate them against the documented JSON schema. Malformed scanner output could crash synthesis or produce invalid todos.

## Findings

**Location**: `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md`

**Impact**: Synthesis failures from schema drift

**Source**: Architecture Strategist R1

## Proposed Solutions

### Solution 1: Add jq Schema Validation

```bash
# Validate scanner output
if ! jq -e '.schema_version == "1.0" and .status != null and .findings != null' "$scanner_file" >/dev/null; then
  printf '[synthesizer] ERROR: Invalid schema in %s\n' "$scanner_file" >&2
  continue
fi
```

**Effort**: Small (1 hour)

## Recommended Action

Add validation in synthesizer.

## Acceptance Criteria

- [x] Schema validation added for each scanner output
- [x] Malformed JSON logged and skipped
- [x] Synthesis continues with valid scanners

## Resources

- Architecture review: R1

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Completed
**By:** pr-comment-resolver
**Implementation:**
- Added jq schema validation in audit-synthesizer.md section 1
- Validation checks: schema_version == "1.0", status != null, findings != null
- Invalid schema files logged to stderr and skipped via continue
- Synthesis proceeds with valid scanner outputs only
