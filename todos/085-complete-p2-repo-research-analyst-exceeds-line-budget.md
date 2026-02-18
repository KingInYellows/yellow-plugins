---
status: pending
priority: p2
issue_id: '085'
tags: [code-review, quality, agent-length]
dependencies: [078]
---

# 🟡 P2: repo-research-analyst exceeds line budget and missing allowed-tools

## Problem Statement

The `yellow-core/agents/research/repo-research-analyst.md` agent is 143 lines,
exceeding the 120-line budget by 23 lines. Additionally, it's missing the
`allowed-tools` frontmatter field (covered in issue #078).

## Findings

File: `plugins/yellow-core/agents/research/repo-research-analyst.md`

- Current length: 143 lines
- Over budget by: 23 lines
- Target: 120 lines or less
- Also missing: `allowed-tools` frontmatter

The agent likely contains detailed examples or verbose instructions that could
be condensed.

## Proposed Solutions

### Solution 1: Trim one detailed example, add allowed-tools (Recommended)

Remove or significantly condense one detailed example section, and add the
missing `allowed-tools` frontmatter.

**Pros:**

- Meets line budget
- Fixes frontmatter issue simultaneously
- Preserves core functionality
- Reduces duplication of LLM training data

**Cons:**

- Requires careful editing to maintain clarity
- May lose one helpful example

**Effort:** 1-2 hours **Risk:** Low

### Solution 2: Condense multiple sections incrementally

Make smaller cuts across multiple sections instead of removing one example.

**Pros:**

- Preserves more content
- Distributed impact

**Cons:**

- Harder to execute cleanly
- May result in less clear prose

**Effort:** 2 hours **Risk:** Low

## Recommended Action

Adopt Solution 1: trim one detailed example and add `allowed-tools` frontmatter.

## Technical Details

File: `plugins/yellow-core/agents/research/repo-research-analyst.md` (143 lines)

Actions:

1. Add `allowed-tools` frontmatter listing tools used (Read, Grep, Glob, Bash,
   etc.)
2. Identify the most verbose or redundant example
3. Remove or condense it to save 23+ lines
4. Verify remaining content is coherent

Note: This issue depends on #078 (missing allowed-tools) being resolved, as both
affect the same file.

## Acceptance Criteria

- [ ] File is 120 lines or less
- [ ] `allowed-tools` frontmatter is present and accurate
- [ ] Core research workflow is preserved
- [ ] Agent remains effective and understandable

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review.

## Resources

- Plugin marketplace review session
- Project memory: "Agent `.md` files: keep under 120 lines"
- Issue #078: missing allowed-tools frontmatter
