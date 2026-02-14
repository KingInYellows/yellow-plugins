---
status: pending
priority: p3
issue_id: "015"
tags: [code-review, documentation, comments]
dependencies: []
---

# Minor Comment and Documentation Accuracy Improvements

## Problem Statement

7 minor documentation inaccuracies found: "first 200 chars" vs bytes, "<3s budget" vs "3s budget", undocumented 1500ms budget split, unexplained 20-entry cap, empty Priority 3 block, non-idiomatic `: # success`, and index command ambiguity about re-indexing behavior.

## Findings

- **Comment Analyzer:** 7 improvement opportunities, zero critical inaccuracies

## Proposed Solutions

Fix all 7 in one pass:
1. `post-tool-use.sh:71` — Change "first 200 chars" to "first 200 bytes"
2. `CLAUDE.md:47` — Change "<3s" to "3s budget"
3. `session-start.sh:91` — Add budget split comment
4. `session-start.sh:50` — Explain why 20 entries
5. `session-start.sh:118` — Remove or explain empty Priority 3 block
6. `install.sh:98` — Replace `: # success` with `true`
7. `index.md:5-6` — Clarify initial vs incremental indexing

**Effort:** Small (30 min) | **Risk:** None

## Acceptance Criteria

- [ ] All 7 comments updated to match actual behavior

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Comment-analyzer report |

## Resources

- PR: #10
