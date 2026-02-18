---
status: complete
priority: p3
issue_id: "082"
tags: [code-review, yellow-ci, quality]
dependencies: []
---

# Agent Line Length Over 120

## Problem Statement

Project convention requires agent `.md` files to stay under 120 lines to avoid duplicating LLM training data. The `failure-analyst.md` agent exceeds this limit at 131 lines (11 lines over).

## Findings

- **File**: `plugins/yellow-ci/agents/ci/failure-analyst.md`
- **Current length**: 131 lines (11 over limit)
- **Near-limit file**: `plugins/yellow-ci/agents/ci/workflow-optimizer.md` at 118 lines (close to limit but acceptable)

The security rules section in `failure-analyst.md` could be shortened by referencing the `ci-conventions` skill instead of inlining detailed security patterns.

## Proposed Solutions

Move security rules to a reference to the `ci-conventions` skill, which already contains these patterns:
- Replace inline security rules with "See ci-conventions skill for security patterns"
- Maintain trigger clauses and workflow-specific rules
- Shorten to ≤120 lines while preserving essential guidance

## Technical Details

The security rules section currently duplicates patterns documented in:
- `plugins/yellow-ci/skills/ci-conventions/SKILL.md`

By converting to a reference, we reduce duplication and stay within line budget.

## Acceptance Criteria

- [ ] `failure-analyst.md` is ≤120 lines
- [ ] Security guidance still accessible via ci-conventions reference
- [ ] No loss of essential agent-specific instructions
- [ ] All trigger clauses and workflow patterns preserved
