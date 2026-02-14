---
status: complete
priority: p3
issue_id: "016"
tags: [code-review, data-integrity, forward-compatibility]
dependencies: []
---

# Add Schema Version to JSONL Queue Entries

## Problem Statement

Queue entries have no schema version. Future format changes (e.g., adding `git_hash` field) could break older queue entries if the new version requires fields that don't exist.

## Findings

- **Data Integrity Guardian (Schema Migration):** No migration strategy documented

## Proposed Solutions

Add `"schema": "1"` field to all queue entries. Process entries by schema version in session-start.sh.

**Effort:** Small (30 min) | **Risk:** None

## Acceptance Criteria

- [ ] All new queue entries include schema version
- [ ] Session-start.sh handles entries with and without schema field

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Data-integrity schema migration |

## Resources

- PR: #10
