---
status: pending
priority: p2
issue_id: "078"
tags: [code-review, quality, frontmatter]
dependencies: []
---

# 🟡 P2: Missing allowed-tools frontmatter in yellow-core agents

## Problem Statement
Five yellow-core agents are missing the `allowed-tools` frontmatter field, violating the plugin authoring quality rule that "Command `allowed-tools` must list every tool used in the body." While this rule specifically mentions commands, the same principle applies to agents for consistency and clarity.

## Findings
The following agents use tools (Read, Grep, Glob, Bash) but don't declare them in frontmatter:
1. `plugins/yellow-core/agents/review/polyglot-reviewer.md`
2. `plugins/yellow-core/agents/review/test-coverage-analyst.md`
3. `plugins/yellow-core/agents/review/spec-flow-analyzer.md`
4. `plugins/yellow-core/agents/review/code-simplicity-reviewer.md` (if not already covered by line-budget todo)
5. `plugins/yellow-core/agents/research/repo-research-analyst.md`

This creates inconsistency with other agents that properly declare their tool usage.

## Proposed Solutions
### Solution 1: Add allowed-tools frontmatter to all 5 agents (Recommended)
Add `allowed-tools` field listing the actual tools each agent uses (Read, Grep, Glob, Bash, etc.).

**Pros:**
- Improves discoverability and documentation
- Makes tool dependencies explicit
- Aligns with plugin quality conventions

**Cons:**
- Requires auditing each agent's tool usage
- Minor maintenance overhead

**Effort:** 1-2 hours
**Risk:** Low

## Recommended Action
Add `allowed-tools` frontmatter to all 5 agents, listing the tools they actually use in their instructions.

## Technical Details
Need to:
1. Audit each agent file to identify all tools used
2. Add `allowed-tools: [Read, Grep, Glob, Bash, ...]` to frontmatter
3. Verify no other yellow-core agents are missing this field

## Acceptance Criteria
- [ ] All 5 agents have `allowed-tools` field in frontmatter
- [ ] Listed tools match actual usage in agent instructions
- [ ] Format is consistent with other agents in the codebase

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review.

## Resources
- Plugin marketplace review session
- Project memory: "Command `allowed-tools` must list every tool used in the body"
