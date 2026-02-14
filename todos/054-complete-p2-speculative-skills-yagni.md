---
status: complete
priority: p2
issue_id: "054"
tags: [code-review, yagni, over-engineering]
dependencies: []
pr_number: 12
completed_at: 2026-02-13
---

# 🟡 P2: Speculative Skills with No Consumers (572 LOC YAGNI Violation)

## Problem Statement

The debt-query (248 LOC) and debt-audit-runner (324 LOC) skills document comprehensive APIs for cross-plugin integration, but:
- No executable implementation exists (documented shell commands don't work)
- No consumers exist (yellow-review, yellow-ruvector don't call these)
- Phase 2 features shipped in v1

**Why this matters**: 572 lines (19% of codebase) are documentation for capabilities nobody can use. Classic over-engineering.

## Findings

**Locations**:
- `plugins/yellow-debt/skills/debt-query/SKILL.md` (248 lines)
- `plugins/yellow-debt/skills/debt-audit-runner/SKILL.md` (324 lines)

**Evidence**:
```bash
$ debt-query --format json
bash: debt-query: command not found
```

**Source**: Code Simplicity Reviewer + Agent-Native Reviewer

## Proposed Solutions

### Solution 1: Delete Both Skills, Re-add When Needed

**Pros:**
- Removes 572 LOC of speculative code
- Plugin does what it says, no vaporware
- Can restore from git when actual consumer exists

**Cons:**
- Loses documented API design (but it's in git history)

**Effort**: Quick (delete files, update plugin.json entrypoints)
**Risk**: Very Low
**Impact**: -19% LOC, -23.6% complexity

### Solution 2: Implement the Documented APIs

**Pros:**
- Makes APIs functional
- Enables cross-plugin integration

**Cons:**
- Requires 4-6 hours additional work
- Still no consumers until yellow-review/yellow-ruvector are updated
- Premature optimization

**Effort**: Medium (4-6 hours)

### Solution 3: Keep as Future Documentation

**Pros:**
- Documents vision for Phase 2
- Helps future contributors

**Cons:**
- Confusing to users (claims APIs exist but don't work)
- Violates "do what you say" principle

**Effort**: None

## Recommended Action

**Use Solution 1**: Delete both skills. Move to `docs/future/agent-api-design.md` if design is valuable. Re-add when:
1. yellow-review or yellow-ruvector needs the API
2. Implementation is ready to be built
3. Real use case exists

## Technical Details

**Files to delete**:
- `plugins/yellow-debt/skills/debt-query/SKILL.md`
- `plugins/yellow-debt/skills/debt-audit-runner/SKILL.md`

**plugin.json update**: Remove from entrypoints.skills array

**LOC impact**: -572 lines (-19%)

## Acceptance Criteria

- [x] Both skill files deleted
- [x] plugin.json entrypoints updated
- [x] pnpm validate:schemas still passes
- [ ] Optional: Design preserved in docs/future/

## Resources

- Simplicity review: /tmp/claude-1000/.../a22147f.output
- Agent-native review: /tmp/claude-1000/.../aa022d3.output

### 2026-02-13 - Approved for Work
**By:** Triage Session
**Actions:**
- Issue approved during code review triage
- Status changed from pending → ready
- Ready to be picked up and worked on

### 2026-02-13 - Completed
**By:** pr-comment-resolver agent
**Actions:**
- Deleted both speculative skills (debt-query, debt-audit-runner)
- Updated plugin.json to remove from entrypoints.skills array
- Verified pnpm validate:schemas passes
- LOC impact: -638 deletions, -572 skill documentation
- Status changed from ready → complete
