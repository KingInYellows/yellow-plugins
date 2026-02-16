---
status: complete
priority: p3
issue_id: "088"
tags: [code-review, yellow-ci, quality]
dependencies: []
---

# runner-diagnostics.md Over 120 Line Limit

## Problem Statement

Project convention requires agent `.md` files to stay under 120 lines. `runner-diagnostics.md` is at 128 lines (8 over limit).

## Findings

- **File**: `plugins/yellow-ci/agents/maintenance/runner-diagnostics.md`
- **Current length**: 128 lines
- **Over limit by**: 8 lines

The SSH security section duplicates patterns documented in `ci-conventions` skill `references/security-patterns.md`.

## Proposed Solutions

**Option 1 (Recommended): Reference ci-conventions skill**
- Replace inline SSH security rules with reference to ci-conventions skill
- Keep trigger clauses and agent-specific instructions
- Target: ≤ 118 lines
- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] runner-diagnostics.md is ≤120 lines
- [ ] SSH security guidance accessible via ci-conventions reference
- [ ] Trigger clauses and agent-specific instructions preserved
