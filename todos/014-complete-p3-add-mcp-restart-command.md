---
status: complete
priority: p3
issue_id: "014"
tags: [code-review, agent-native, reliability]
dependencies: []
---

# Agents Cannot Restart Crashed MCP Server

## Problem Statement

If the ruvector MCP server crashes mid-session, agents have no programmatic way to restart it. CLAUDE.md suggests manual `npx ruvector mcp-server`, but agents can't execute this recovery.

## Findings

- **Agent-Native Reviewer (Warning #1):** MCP restart gap reduces agent autonomy
- **Agent-Native Reviewer (Warning #2):** Hook execution status not visible to agents

## Proposed Solutions

Add `/ruvector:health` command or extend `/ruvector:status` with MCP connectivity test and recovery instructions. Expose hook execution metrics in status output.

**Effort:** Small (1-2 hours) | **Risk:** Low

## Acceptance Criteria

- [ ] Agents can detect MCP server failure
- [ ] Recovery path documented and agent-invocable

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-12 | Created from PR #10 code review | Agent-native warnings #1,#2 |

## Resources

- PR: #10
