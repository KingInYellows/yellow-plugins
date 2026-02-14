---
status: ready
priority: p2
issue_id: "056"
tags: [code-review, quality, refactoring]
dependencies: []
pr_number: 12
---

# 🟡 P2: Two Agents Exceed 120-Line Budget

## Problem Statement

debt-fixer (313 lines) and audit-synthesizer (289 lines) exceed the yellow-plugins convention of <120 lines per agent. While the content is valuable, extracting implementation details to skills would improve maintainability.

## Findings

**Locations**:
- `plugins/yellow-debt/agents/remediation/debt-fixer.md` (313 lines, budget: 120)
- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` (289 lines, budget: 120)

**What's causing excess**:
- **debt-fixer**: Comprehensive fix strategies by category (161-237)
- **audit-synthesizer**: Detailed deduplication algorithm pseudocode (57-114)

**Source**: Plugin Validator, Code Simplicity Reviewer

## Proposed Solutions

### Solution 1: Extract Fix Strategies to New Skill

Create `skills/debt-fix-strategies/SKILL.md` with:
- Fix Strategies by Category section
- Pre-flight and post-fix validation patterns

Reduces debt-fixer from 313 → ~120 lines.

**Effort**: Small (1-2 hours)

### Solution 2: Extract Deduplication Algorithm to debt-conventions

Move deduplication algorithm pseudocode to debt-conventions skill's existing synthesis section.

Reduces audit-synthesizer from 289 → ~150 lines.

**Effort**: Small (1 hour)

### Solution 3: Accept the Exceedance

Plugin Validator notes: "exceedances are minor and well-justified for complex orchestration agents"

**Effort**: None

## Recommended Action

**Solution 3** for now (accept). Both agents are complex enough to warrant >120 lines. The budget is a guideline, not hard limit.

If refactoring later, do Solution 1 + 2.

## Acceptance Criteria

Decision needed:
- [ ] Accept exceedance as justified complexity
- [ ] OR: Extract to skills and reduce to ~120 lines each

## Resources

- Plugin validation: /tmp/claude-1000/.../a74d1ea.output
- MEMORY.md: "Agent .md files: keep under 120 lines"

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on
