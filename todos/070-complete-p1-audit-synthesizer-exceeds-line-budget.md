---
status: complete
priority: p1
issue_id: '070'
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Audit Synthesizer Agent Exceeds Line Budget by 237 Lines

## Problem Statement

The yellow-debt/agents/remediation/audit-synthesizer.md agent is 357 lines,
exceeding the 120-line quality rule by 237 lines (297%). The file contains
extensive algorithm pseudocode, detailed examples, and a full todo file template
that duplicate LLM training data and violate the "don't document what the model
already knows" principle.

## Findings

**Current state:**

- File length: 357 lines
- Over budget: 237 lines (297% of limit)
- Location: `plugins/yellow-debt/agents/remediation/audit-synthesizer.md`

**Bloat sources:**

1. **Python algorithm pseudocode** (lines 80-140): 60 lines of detailed priority
   scoring, grouping logic, and statistical calculations that any LLM can
   implement
2. **Extensive examples** (lines 180-250): 70+ lines of example findings,
   categories, and output formats
3. **Full todo file template** (lines 280-340): 60+ lines duplicating the
   template already in debt-conventions skill
4. **Redundant instructions**: Multiple sections repeat "use debt-conventions
   skill" but then inline the content anyway

**Quality impact:**

- Harder to maintain (3x larger than standard)
- Slower for LLM to process
- Duplicates content from debt-conventions skill
- Violates project quality rule from PR #8 review

## Proposed Solutions

### Solution 1: Aggressive Trimming to Core Directive (Recommended)

Remove all LLM training data duplication, reference debt-conventions skill
instead of inlining.

**Trim:**

- Remove Python pseudocode entirely (lines 80-140) → just say "calculate
  priority scores based on severity/impact/effort"
- Condense examples to 2-3 short bullets instead of 70 lines
- Replace full todo template with "use debt-conventions skill template"
- Remove redundant "how to calculate statistics" sections

**Keep:**

- Agent purpose and trigger clause
- High-level workflow (collect → group → prioritize → synthesize)
- Output format specification (audit.md structure)
- Unique directives (e.g., "defer structural refactors")

**Pros:**

- Gets agent under 120-line limit
- Follows DRY principle (references skill instead of duplicating)
- Easier to maintain
- Follows project quality standards

**Cons:**

- Less hand-holding for simple implementation details
- Requires trust in LLM's ability to implement standard algorithms

**Effort:** Low (1-2 hours) **Risk:** Very low (LLMs can do basic
scoring/grouping)

### Solution 2: Split into Main Agent + Supporting Skill

Keep detailed pseudocode but move it to a separate `audit-synthesis-algorithms`
skill.

**Pros:**

- Preserves detailed guidance
- Agent file meets line budget
- Reusable for other audit agents

**Cons:**

- Creates skill infrastructure for LLM training data
- Maintenance burden for algorithm updates
- Doesn't solve duplication problem

**Effort:** Medium (3-4 hours) **Risk:** Low

## Recommended Action

**Implement Solution 1**: Aggressively trim to core directive, reference
debt-conventions skill.

**Execution plan:**

1. Remove lines 80-140 (Python pseudocode) → replace with 2-3 sentence directive
2. Condense lines 180-250 (examples) → keep 2-3 bullet examples max
3. Remove lines 280-340 (todo template) → add "See debt-conventions skill for
   todo file format"
4. Verify workflow section is concise (collect → group → prioritize →
   synthesize)
5. Ensure trigger clause and output format remain clear
6. Target final length: ~110 lines (10 line buffer)
7. Test with sample debt findings to verify no functionality loss

## Technical Details

**Current structure (357 lines):**

```
Lines 1-30: Frontmatter + trigger clause
Lines 31-79: High-level workflow (good)
Lines 80-140: Python algorithm pseudocode (REMOVE)
Lines 141-179: Grouping strategies (condense)
Lines 180-250: Extensive examples (condense)
Lines 251-279: Statistics instructions (condense)
Lines 280-340: Full todo template (reference skill)
Lines 341-357: Edge cases + footer
```

**Target structure (~110 lines):**

```
Lines 1-30: Frontmatter + trigger clause
Lines 31-60: High-level workflow
Lines 61-75: Scoring directive (2-3 sentences)
Lines 76-85: Grouping directive (brief)
Lines 86-95: 2-3 example bullets
Lines 96-110: Output format + edge cases
```

**Key content to preserve:**

- Trigger: "Use when you need to synthesize multiple technical debt findings
  into a structured audit"
- Workflow: collect → validate → group → prioritize → synthesize
- Output: audit.md with statistics, grouped findings, actionable recommendations
- Unique rule: "Defer structural refactors that overlap with targeted fixes"

## Acceptance Criteria

- [ ] File length ≤ 120 lines
- [ ] Python pseudocode removed (reference "calculate priority scores" instead)
- [ ] Examples condensed to 2-3 bullets max
- [ ] Todo template replaced with skill reference
- [ ] Trigger clause preserved verbatim
- [ ] High-level workflow (collect → group → prioritize → synthesize) preserved
- [ ] Output format specification clear
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can synthesize sample findings correctly

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. Agent is 357 lines (237 over 120-line limit), contains extensive
algorithm pseudocode and examples duplicating LLM training data.

**2026-02-15**: RESOLVED. Trimmed agent from 357 lines to 98 lines (18% under
budget):

- Removed Python pseudocode (60 lines) - replaced with 2-sentence algorithm
  directive
- Condensed examples from 2 to 1 essential example
- Removed inlined todo template - added reference to debt-conventions skill
- Condensed workflow sections while preserving all critical security rules
- Preserved: YAML frontmatter, trigger clause, output format, slug derivation
  security, safety rules
- Validation: `pnpm validate:plugins` passes, LF line endings verified

## Resources

- Plugin marketplace review session
- Agent file: `plugins/yellow-debt/agents/remediation/audit-synthesizer.md`
- debt-conventions skill: `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
- Quality rule source: PR #8 review
