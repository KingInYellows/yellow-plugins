---
status: pending
priority: p3
issue_id: "013"
tags: [code-review, performance, optimization]
dependencies: []
---

# Consolidate Redundant jq Invocations in PostToolUse Hook

## Problem Statement

PostToolUse parses the same JSON input 3 times per Edit/Write call via separate jq invocations. Each jq spawn costs ~5-8ms, adding 15-24ms per tool use. At 100 edits/session, that's 2s cumulative overhead.

## Findings

- **Performance Oracle (#3):** 3 jq invocations per call, 2.4x speedup possible with consolidation

## Proposed Solutions

Parse once, extract all fields in single jq call using `@sh` output.

**Effort:** Small (30 min) | **Risk:** Low

## Acceptance Criteria

- [ ] Single jq invocation per PostToolUse call
- [ ] All fields extracted in one parse

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Performance-oracle #3 |

## Resources

- PR: #10
