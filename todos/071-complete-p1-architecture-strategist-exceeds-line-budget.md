---
status: pending
priority: p1
issue_id: '071'
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Architecture Strategist Agent Exceeds Line Budget by 215 Lines

## Problem Statement

The yellow-core/agents/review/architecture-strategist.md agent is 335 lines,
exceeding the 120-line quality rule by 215 lines (279%). The file contains
detailed SOLID principles explanations, architecture pattern descriptions, and
language-specific guidance that duplicate well-known LLM training data.
Additionally, the agent is missing required `allowed-tools` frontmatter.

## Findings

**Current state:**

- File length: 335 lines
- Over budget: 215 lines (279% of limit)
- Location: `plugins/yellow-core/agents/review/architecture-strategist.md`
- Missing: `allowed-tools` frontmatter field

**Bloat sources:**

1. **SOLID principles section** (lines 45-110): 65 lines explaining Single
   Responsibility, Open/Closed, Liskov Substitution, etc. — all well-known to
   LLMs
2. **Architecture patterns** (lines 120-200): 80 lines describing MVC, layered
   architecture, microservices — standard CS knowledge
3. **Language-specific sections** (lines 210-280): 70 lines of
   TypeScript/Python/Rust-specific patterns
4. **Extensive examples**: Detailed code snippets for each principle and pattern

**Quality impact:**

- Nearly 3x over line budget
- Duplicates LLM training data on fundamental CS concepts
- Violates "don't document what the model already knows" principle
- Missing required `allowed-tools` frontmatter

## Proposed Solutions

### Solution 1: Trim to Core Review Directive + Add Frontmatter (Recommended)

Remove SOLID explanations and architecture pattern descriptions, keep only
output format and review criteria. Add missing `allowed-tools`.

**Trim:**

- Remove SOLID principles detailed explanations (lines 45-110)
- Remove architecture pattern descriptions (lines 120-200)
- Condense language-specific sections to 2-3 bullet points each
- Remove code examples (LLM knows these patterns)

**Keep:**

- Agent purpose and trigger clause ("Use when analyzing architecture decisions")
- High-level review criteria (coupling, cohesion, separation of concerns)
- Output format specification (findings structure)
- Unique project-specific guidance if any

**Add:**

- `allowed-tools` frontmatter listing all tools used (likely Read, Grep, Glob)

**Pros:**

- Gets under 120-line limit
- Removes redundant training data
- Adds required frontmatter
- Focuses agent on review task, not education

**Cons:**

- Less explicit about what SOLID means (but LLM knows this)
- Requires trust in model's architectural knowledge

**Effort:** Low (1-2 hours) **Risk:** Very low (SOLID/patterns are fundamental
CS)

### Solution 2: Keep Principles, Split Patterns to Skill

Keep SOLID as reminders, move architecture patterns to separate skill.

**Pros:**

- Preserves some explicit guidance
- Separates concerns (principles vs patterns)

**Cons:**

- Still duplicates training data
- Creates skill maintenance burden
- Doesn't fully solve bloat problem
- Agent still likely over budget

**Effort:** Medium (3-4 hours) **Risk:** Low

## Recommended Action

**Implement Solution 1**: Aggressively trim to core directive, add
`allowed-tools` frontmatter.

**Execution plan:**

1. Add `allowed-tools: [Read, Grep, Glob]` to frontmatter (verify actual tools
   used)
2. Remove lines 45-110 (SOLID explanations) → replace with "Review for SOLID
   principles compliance"
3. Remove lines 120-200 (pattern descriptions) → replace with "Identify
   architecture patterns and assess appropriateness"
4. Condense lines 210-280 (language-specific) → keep 2-3 bullets per language
   max
5. Remove all code examples
6. Ensure output format section is clear and concise
7. Target final length: ~110 lines
8. Verify trigger clause: "Use when analyzing architecture decisions, design
   patterns, or system structure"

## Technical Details

**Current structure (335 lines):**

```
Lines 1-44: Frontmatter + trigger clause (missing allowed-tools)
Lines 45-110: SOLID principles explanations (REMOVE)
Lines 120-200: Architecture patterns (REMOVE)
Lines 210-280: Language-specific patterns (CONDENSE)
Lines 281-335: Output format + examples (KEEP/CONDENSE)
```

**Target structure (~110 lines):**

```
Lines 1-30: Frontmatter (with allowed-tools) + trigger clause
Lines 31-50: High-level review criteria (SOLID, patterns, concerns)
Lines 51-70: Language-specific bullets (2-3 per language)
Lines 71-110: Output format + edge cases
```

**Frontmatter to add:**

```yaml
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash # if used for git operations
```

**Key content to preserve:**

- Trigger: "Use when analyzing architecture decisions, design patterns, or
  system structure"
- Review focus: coupling, cohesion, separation of concerns, appropriate patterns
- Output: structured findings with severity, location, recommendation
- Language awareness: TypeScript/Python/Rust-specific considerations

## Acceptance Criteria

- [ ] File length ≤ 120 lines
- [ ] `allowed-tools` frontmatter added with all tools used
- [ ] SOLID principles section removed (keep 1-sentence reference)
- [ ] Architecture patterns section removed (keep 1-sentence reference)
- [ ] Language-specific sections condensed to 2-3 bullets each
- [ ] Code examples removed
- [ ] Trigger clause preserved
- [ ] Output format specification clear
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can perform architecture review

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. Agent is 335 lines (215 over budget), duplicates SOLID/pattern training
data, missing `allowed-tools` frontmatter.

## Resources

- Plugin marketplace review session
- Agent file: `plugins/yellow-core/agents/review/architecture-strategist.md`
- Quality rule source: PR #8 review
- Frontmatter requirement: `docs/plugin-validation-guide.md`
