---
status: pending
priority: p1
issue_id: '075'
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Best Practices Researcher Agent Exceeds Line Budget by 120 Lines

## Problem Statement

The yellow-core/agents/research/best-practices-researcher.md agent is 240 lines,
exceeding the 120-line quality rule by exactly 120 lines (200%). The file
duplicates LLM training data with extensive OAuth2 and React examples, detailed
research methodology that any LLM knows, and verbose workflow instructions.

## Findings

**Current state:**

- File length: 240 lines
- Over budget: 120 lines (200% of limit)
- Location: `plugins/yellow-core/agents/research/best-practices-researcher.md`

**Bloat sources:**

1. **Extensive examples** (lines 90-180): 90 lines of detailed OAuth2
   implementation and React Hooks examples — both well-known patterns in LLM
   training data
2. **Detailed research methodology** (lines 50-89): 40 lines explaining how to
   search docs, compare sources, validate practices — standard research process
3. **Verbose workflow instructions** (lines 190-220): 30 lines of step-by-step
   instructions repeating standard development workflow
4. **Redundant source validation**: Multiple sections repeat "check official
   docs first"

**Quality impact:**

- Exactly 2x over line budget
- Duplicates OAuth2 and React best practices from LLM training
- Documents standard research methodology model already knows
- Violates "don't document what the model already knows" principle

## Proposed Solutions

### Solution 1: Trim to Research Directive (Recommended)

Remove detailed examples and methodology explanations, keep only unique research
directive and output format.

**Trim:**

- Remove lines 90-180 (OAuth2/React examples) → trust LLM knows these patterns
- Condense lines 50-89 (research methodology) → "Search docs, compare sources,
  validate against official standards" (~3 lines)
- Condense lines 190-220 (workflow instructions) → "Use WebSearch/WebFetch for
  current best practices" (~5 lines)
- Remove redundant source validation instructions

**Keep:**

- Agent purpose and trigger clause ("Use when researching current best practices
  for a technology or pattern")
- High-level research focus (official docs > community consensus > blog posts)
- Output format specification (summary, sources, recommendations)
- Unique directives (e.g., "flag outdated practices", "note version-specific
  guidance")

**Pros:**

- Gets under 120-line limit
- Removes LLM training data duplication
- Focuses on research task, not methodology education
- Trusts model's domain knowledge

**Cons:**

- No explicit examples (but LLM knows OAuth2/React)
- Less hand-holding for research process

**Effort:** Low (1-2 hours) **Risk:** Very low (OAuth2/React are well-known)

### Solution 2: Keep Methodology, Remove Examples

Keep research methodology as reference, remove all detailed examples.

**Pros:**

- Preserves research process guidance
- Still gets under budget

**Cons:**

- Still documents what LLM knows
- Less aggressive trimming

**Effort:** Low (1 hour) **Risk:** Very low

## Recommended Action

**Implement Solution 1**: Aggressively trim to research directive, remove
examples and methodology details.

**Execution plan:**

1. Remove lines 90-180 (OAuth2/React examples) entirely
2. Condense lines 50-89 (methodology) → replace with:
   - "Search official documentation first"
   - "Compare multiple authoritative sources"
   - "Validate against current versions and community consensus" (~5 lines
     total)
3. Condense lines 190-220 (workflow) → replace with:
   - "Use WebSearch for current best practices"
   - "Use WebFetch for official documentation"
   - "Synthesize findings into actionable recommendations" (~5 lines total)
4. Consolidate source validation to single bullet
5. Ensure output format section clear (summary, sources, recommendations)
6. Target final length: ~110 lines
7. Verify trigger clause: "Use when researching current best practices for a
   technology or pattern"

## Technical Details

**Current structure (240 lines):**

```
Lines 1-49: Frontmatter + trigger clause
Lines 50-89: Research methodology (CONDENSE to ~5 lines)
Lines 90-180: OAuth2/React examples (REMOVE)
Lines 190-220: Workflow instructions (CONDENSE to ~5 lines)
Lines 221-240: Output format (KEEP)
```

**Target structure (~110 lines):**

```
Lines 1-30: Frontmatter + trigger clause
Lines 31-40: Research directive (3-5 bullets)
Lines 41-50: Workflow (3-5 bullets)
Lines 51-110: Output format + unique directives + edge cases
```

**Key content to preserve:**

- Trigger: "Use when researching current best practices for a technology or
  pattern"
- Research priority: official docs > community standards > blog posts
- Output structure:
  - Summary of best practices
  - Source citations with URLs
  - Version-specific guidance
  - Recommendations for implementation
- Unique directives:
  - Flag outdated or deprecated practices
  - Note version-specific differences
  - Distinguish "best practice" from "common practice"
  - Highlight security implications

## Acceptance Criteria

- [ ] File length ≤ 120 lines
- [ ] OAuth2/React examples removed entirely
- [ ] Research methodology condensed to 3-5 bullets
- [ ] Workflow instructions condensed to 3-5 bullets
- [ ] Redundant source validation removed
- [ ] Trigger clause preserved
- [ ] Output format specification clear
- [ ] Unique directives preserved (flag outdated, version-specific, security)
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can research best practices

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. Agent is 240 lines (120 over budget), duplicates OAuth2 and React
training data, documents standard research methodology.

## Resources

- Plugin marketplace review session
- Agent file: `plugins/yellow-core/agents/research/best-practices-researcher.md`
- Quality rule source: PR #8 review
