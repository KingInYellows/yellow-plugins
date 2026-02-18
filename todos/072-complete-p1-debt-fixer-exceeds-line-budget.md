---
status: pending
priority: p1
issue_id: '072'
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Debt Fixer Agent Exceeds Line Budget by 206 Lines

## Problem Statement

The yellow-debt/agents/remediation/debt-fixer.md agent is 326 lines, exceeding
the 120-line quality rule by 206 lines (272%). The file contains extremely
detailed fix strategies, extensive pre-flight validation instructions, and
language-specific guidance that duplicate LLM training data and content already
in the debt-conventions skill.

## Findings

**Current state:**

- File length: 326 lines
- Over budget: 206 lines (272% of limit)
- Location: `plugins/yellow-debt/agents/remediation/debt-fixer.md`

**Bloat sources:**

1. **Detailed fix strategies** (lines 70-180): 110 lines of step-by-step
   instructions for common fixes (unused variables, magic numbers, duplicate
   code, etc.) — all standard refactoring knowledge
2. **Extensive pre-flight validation** (lines 40-69): 30 lines of validation
   steps that should reference debt-conventions skill
3. **Language-specific sections** (lines 190-260): 70 lines of
   TypeScript/Python/Rust-specific fix patterns
4. **Redundant safety rules**: Multiple sections repeat "run tests", "verify no
   regressions" in different ways
5. **Full fix workflow template**: Detailed checklist duplicating standard
   development practices

**Quality impact:**

- Nearly 3x over line budget
- Duplicates refactoring knowledge from LLM training
- Duplicates validation rules from debt-conventions skill
- Harder to maintain and update

## Proposed Solutions

### Solution 1: Condense to Core Directive + Skill References (Recommended)

Remove detailed fix strategies, reference debt-conventions skill for validation,
keep only unique safety rules.

**Trim:**

- Remove lines 70-180 (detailed fix strategies) → replace with 2-3 sentence
  directive per category
- Remove lines 40-69 (extensive validation) → replace with "Follow
  debt-conventions skill validation rules"
- Condense lines 190-260 (language-specific) → keep 1-2 bullets per language
- Remove redundant safety repetition → consolidate to single section
- Remove full workflow template → reference standard git workflow

**Keep:**

- Agent purpose and trigger clause ("Use when fixing a specific technical debt
  issue")
- High-level fix categories (code quality, performance, security, etc.)
- Output format (commit message, test verification)
- Unique yellow-debt workflow (todo status updates, dependency checking)

**Pros:**

- Gets under 120-line limit
- Removes LLM training data duplication
- Leverages debt-conventions skill (DRY)
- Focuses on unique yellow-debt workflow

**Cons:**

- Less hand-holding for standard refactoring tasks
- Requires trust in LLM's refactoring knowledge

**Effort:** Low (1-2 hours) **Risk:** Very low (standard refactoring is
well-known)

### Solution 2: Split Strategies to Separate Skill

Keep agent concise, move fix strategies to `debt-fix-strategies` skill.

**Pros:**

- Preserves detailed guidance
- Agent meets line budget
- Reusable for other fix agents

**Cons:**

- Creates skill for LLM training data
- Maintenance burden
- Doesn't solve duplication problem

**Effort:** Medium (3-4 hours) **Risk:** Low

## Recommended Action

**Implement Solution 1**: Condense to core directive, reference debt-conventions
skill.

**Execution plan:**

1. Remove lines 70-180 (detailed strategies) → replace with:
   - "Code quality fixes: remove unused code, extract magic numbers, eliminate
     duplication"
   - "Performance fixes: optimize algorithms, reduce allocations, cache results"
   - "Security fixes: validate input, sanitize output, update dependencies"
   - (~6 lines total)
2. Remove lines 40-69 (validation) → replace with "Follow debt-conventions skill
   validation rules" (1 line)
3. Condense lines 190-260 (language-specific) → 1-2 bullets per language (~10
   lines)
4. Consolidate safety rules to single section (~10 lines):
   - Run tests before and after
   - Verify no regressions
   - Update todo status on completion
5. Ensure workflow section covers unique yellow-debt steps (todo updates,
   dependency checks)
6. Target final length: ~110 lines
7. Verify trigger clause clear

## Technical Details

**Current structure (326 lines):**

```
Lines 1-39: Frontmatter + trigger clause
Lines 40-69: Extensive validation (CONDENSE → skill ref)
Lines 70-180: Detailed fix strategies (REMOVE)
Lines 181-189: Transition/filler (REMOVE)
Lines 190-260: Language-specific patterns (CONDENSE)
Lines 261-290: Safety rules (CONSOLIDATE)
Lines 291-326: Workflow template (CONDENSE)
```

**Target structure (~110 lines):**

```
Lines 1-30: Frontmatter + trigger clause
Lines 31-40: Validation (reference skill)
Lines 41-50: High-level fix categories (6 bullets)
Lines 51-60: Language-specific bullets (1-2 each)
Lines 61-70: Safety rules (consolidated)
Lines 71-110: yellow-debt workflow + output format
```

**Key content to preserve:**

- Trigger: "Use when fixing a specific technical debt issue tracked in a todo
  file"
- Validation: "Follow debt-conventions skill rules"
- Fix categories: code quality, performance, security, maintainability
- yellow-debt workflow: read todo → fix → test → update status → commit
- Output: conventional commit message, test verification, status update

**References to add:**

- "See debt-conventions skill for validation rules"
- "See debt-conventions skill for commit message format"
- "See debt-conventions skill for todo status values"

## Acceptance Criteria

- [ ] File length ≤ 120 lines
- [ ] Detailed fix strategies removed (replaced with high-level categories)
- [ ] Validation section references debt-conventions skill
- [ ] Language-specific sections condensed to 1-2 bullets each
- [ ] Safety rules consolidated to single section
- [ ] Trigger clause preserved
- [ ] yellow-debt workflow (todo updates, dependencies) preserved
- [ ] Output format clear
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can fix sample debt issue

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. Agent is 326 lines (206 over budget), contains extensive fix strategies
and validation duplicating LLM training data and debt-conventions skill content.

## Resources

- Plugin marketplace review session
- Agent file: `plugins/yellow-debt/agents/remediation/debt-fixer.md`
- debt-conventions skill: `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
- Quality rule source: PR #8 review
