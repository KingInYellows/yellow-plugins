---
status: pending
priority: p2
issue_id: "084"
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🟡 P2: devin-orchestrator agent exceeds 120-line budget

## Problem Statement
The `yellow-devin/agents/devin-orchestrator.md` agent is 145 lines, exceeding the 120-line quality rule by 25 lines. This violates the plugin authoring guideline: "Agent `.md` files: keep under 120 lines — don't duplicate LLM training data."

## Findings
File: `plugins/yellow-devin/agents/devin-orchestrator.md`
- Current length: 145 lines
- Over budget by: 25 lines
- Target: 120 lines or less

The agent likely contains detailed workflow steps that could be referenced from the `devin-workflows` skill instead of duplicated inline.

## Proposed Solutions
### Solution 1: Condense workflow steps, reference skill for details (Recommended)
Move detailed workflow patterns to the `devin-workflows` skill and reference it from the agent.

**Pros:**
- Reduces duplication of LLM training data
- Makes agent more focused and scannable
- Centralizes detailed patterns in skill
- Meets quality guideline

**Cons:**
- Requires careful editing to maintain clarity
- Must ensure skill has sufficient detail

**Effort:** 1-2 hours
**Risk:** Low

### Solution 2: Remove verbose examples
Cut or simplify detailed examples while keeping core workflow.

**Pros:**
- Quick to implement
- Preserves workflow structure

**Cons:**
- May lose helpful context
- Harder to know what to cut

**Effort:** 1 hour
**Risk:** Low

## Recommended Action
Adopt Solution 1: condense workflow steps and reference the devin-workflows skill for detailed patterns.

## Technical Details
File: `plugins/yellow-devin/agents/devin-orchestrator.md` (145 lines)

Strategy:
1. Identify repetitive or overly detailed sections
2. Extract to `devin-workflows` skill if not already present
3. Replace with brief summary + reference: "See devin-workflows skill for detailed X pattern"
4. Target: remove 25+ lines while preserving agent effectiveness

## Acceptance Criteria
- [ ] File is 120 lines or less
- [ ] Core workflow logic is preserved
- [ ] References to devin-workflows skill are clear
- [ ] Agent remains effective and understandable

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- Project memory: "Agent `.md` files: keep under 120 lines"
- `plugins/yellow-devin/skills/devin-workflows/SKILL.md` (reference target)
