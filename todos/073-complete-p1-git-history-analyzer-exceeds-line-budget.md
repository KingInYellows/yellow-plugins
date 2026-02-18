---
status: pending
priority: p1
issue_id: '073'
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Git History Analyzer Agent Exceeds Line Budget by 163 Lines

## Problem Statement

The yellow-core/agents/research/git-history-analyzer.md agent is 283 lines,
exceeding the 120-line quality rule by 163 lines (236%). The file contains
extensive examples, comprehensive git command reference, and detailed analysis
patterns that duplicate well-known git knowledge from LLM training data.
Additionally, the agent is missing required `allowed-tools` frontmatter.

## Findings

**Current state:**

- File length: 283 lines
- Over budget: 163 lines (236% of limit)
- Location: `plugins/yellow-core/agents/research/git-history-analyzer.md`
- Missing: `allowed-tools` frontmatter field

**Bloat sources:**

1. **Extensive examples** (lines 80-160): 80 lines of detailed analysis examples
   for various scenarios (refactoring, bug investigation, author patterns)
2. **Comprehensive git command reference** (lines 40-79): 40 lines documenting
   git log, git blame, git show options — all standard git knowledge
3. **Detailed analysis patterns** (lines 170-240): 70 lines of step-by-step
   instructions for common investigations
4. **Redundant workflow instructions**: Multiple sections repeat "use Bash tool
   for git commands"

**Quality impact:**

- More than 2x over line budget
- Duplicates git knowledge from LLM training data
- Violates "don't document what the model already knows" principle
- Missing required `allowed-tools` frontmatter

## Proposed Solutions

### Solution 1: Condense to Essential Patterns + Add Frontmatter (Recommended)

Remove detailed examples and git command documentation, keep only analysis
framework and output format. Add missing `allowed-tools`.

**Trim:**

- Remove lines 40-79 (git command reference) → replace with "Use standard git
  commands (log, blame, show, diff)"
- Remove lines 80-160 (extensive examples) → keep 2-3 brief example bullets
- Condense lines 170-240 (analysis patterns) → high-level investigation types
  only
- Remove redundant tool usage instructions

**Keep:**

- Agent purpose and trigger clause ("Use when analyzing git history, commit
  patterns, or code evolution")
- High-level analysis types (evolution, authorship, bug investigation,
  refactoring impact)
- Output format specification
- Unique directives (e.g., "correlate commits with issues/PRs")

**Add:**

- `allowed-tools` frontmatter listing Bash (for git), Read, Grep

**Pros:**

- Gets under 120-line limit
- Removes git training data duplication
- Adds required frontmatter
- Focuses on analysis goals, not git mechanics

**Cons:**

- Less explicit git command examples
- Requires trust in LLM's git knowledge

**Effort:** Low (1-2 hours) **Risk:** Very low (git commands are fundamental)

### Solution 2: Keep Commands, Split Examples to Skill

Keep git command reference as reminders, move analysis examples to separate
skill.

**Pros:**

- Preserves git command quick reference
- Separates concerns

**Cons:**

- Still duplicates git training data
- Creates skill maintenance burden
- Doesn't fully solve bloat problem

**Effort:** Medium (3-4 hours) **Risk:** Low

## Recommended Action

**Implement Solution 1**: Condense to essential patterns, add `allowed-tools`
frontmatter.

**Execution plan:**

1. Add `allowed-tools: [Bash, Read, Grep]` to frontmatter
2. Remove lines 40-79 (git commands) → replace with "Use git log, blame, show,
   and diff commands via Bash tool" (~2 lines)
3. Remove lines 80-160 (extensive examples) → keep 2-3 example bullets (~10
   lines):
   - "Evolution: Track how a feature/module changed over time"
   - "Bug investigation: Find when/why a bug was introduced"
   - "Authorship: Identify domain experts and code ownership"
4. Condense lines 170-240 (analysis patterns) → list investigation types without
   step-by-step (~15 lines)
5. Remove redundant workflow instructions
6. Ensure output format section is clear
7. Target final length: ~110 lines
8. Verify trigger clause: "Use when analyzing git history, commit patterns, or
   code evolution"

## Technical Details

**Current structure (283 lines):**

```
Lines 1-39: Frontmatter + trigger clause (missing allowed-tools)
Lines 40-79: Git command reference (REMOVE)
Lines 80-160: Extensive examples (CONDENSE to 3 bullets)
Lines 170-240: Detailed analysis patterns (CONDENSE)
Lines 241-283: Output format + footer (KEEP/CONDENSE)
```

**Target structure (~110 lines):**

```
Lines 1-30: Frontmatter (with allowed-tools) + trigger clause
Lines 31-45: Git commands brief mention (~2 lines) + investigation types (~13 lines)
Lines 46-55: 3 example bullets
Lines 56-110: Output format + edge cases + unique directives
```

**Frontmatter to add:**

```yaml
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob # if used
```

**Key content to preserve:**

- Trigger: "Use when analyzing git history, commit patterns, or code evolution"
- Investigation types: evolution tracking, bug archaeology, authorship analysis,
  refactoring impact
- Output: timeline, key commits, patterns identified, recommendations
- Unique directives:
  - Correlate commits with issues/PRs when possible
  - Identify code ownership and domain experts
  - Flag suspicious patterns (large commits, silent changes)

## Acceptance Criteria

- [ ] File length ≤ 120 lines
- [ ] `allowed-tools` frontmatter added with all tools used
- [ ] Git command reference removed (keep 1-2 sentence mention)
- [ ] Examples condensed to 2-3 bullets max
- [ ] Analysis patterns condensed to high-level types
- [ ] Redundant workflow instructions removed
- [ ] Trigger clause preserved
- [ ] Output format specification clear
- [ ] Unique directives preserved (correlate with issues, flag patterns)
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can analyze git history

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. Agent is 283 lines (163 over budget), contains extensive git command
reference and examples duplicating LLM training data, missing `allowed-tools`
frontmatter.

## Resources

- Plugin marketplace review session
- Agent file: `plugins/yellow-core/agents/research/git-history-analyzer.md`
- Quality rule source: PR #8 review
- Frontmatter requirement: `docs/plugin-validation-guide.md`
