---
status: pending
priority: p1
issue_id: '074'
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Performance Oracle Agent Exceeds Line Budget by 143 Lines

## Problem Statement

The yellow-core/agents/review/performance-oracle.md agent is 263 lines,
exceeding the 120-line quality rule by 143 lines (219%). The file contains
extensive language-specific performance patterns, detailed optimization
techniques, and algorithmic complexity explanations that duplicate well-known
optimization knowledge from LLM training data. Additionally, the agent is
missing required `allowed-tools` frontmatter.

## Findings

**Current state:**

- File length: 263 lines
- Over budget: 143 lines (219% of limit)
- Location: `plugins/yellow-core/agents/review/performance-oracle.md`
- Missing: `allowed-tools` frontmatter field

**Bloat sources:**

1. **Language-specific performance patterns** (lines 60-170): 110 lines of
   TypeScript/Python/Rust-specific optimization techniques (async patterns, GIL
   avoidance, zero-copy, etc.) — all well-known to LLMs
2. **Algorithmic complexity explanations** (lines 40-59): 20 lines explaining
   Big-O notation and complexity classes — fundamental CS knowledge
3. **Detailed optimization techniques** (lines 180-230): 50 lines of specific
   optimization strategies (caching, batching, indexing, etc.)
4. **Extensive profiling instructions**: Detailed steps for performance
   measurement duplicating standard practices

**Quality impact:**

- More than 2x over line budget
- Duplicates performance optimization training data
- Violates "don't document what the model already knows" principle
- Missing required `allowed-tools` frontmatter

## Proposed Solutions

### Solution 1: Trim to Analysis Framework + Add Frontmatter (Recommended)

Remove language-specific details and optimization techniques, keep only analysis
framework and output format. Add missing `allowed-tools`.

**Trim:**

- Remove lines 40-59 (Big-O explanations) → assume LLM knows complexity analysis
- Remove lines 60-170 (language-specific patterns) → condense to 2-3 bullets per
  language
- Condense lines 180-230 (optimization techniques) → high-level categories only
- Remove detailed profiling instructions → replace with "profile and measure"

**Keep:**

- Agent purpose and trigger clause ("Use when analyzing performance issues or
  optimization opportunities")
- High-level performance concerns (algorithmic complexity, I/O efficiency,
  memory usage, concurrency)
- Output format specification (findings with severity, location, impact
  estimate)
- Unique directives (e.g., "quantify impact where possible")

**Add:**

- `allowed-tools` frontmatter listing all tools used (likely Read, Grep, Glob,
  Bash)

**Pros:**

- Gets under 120-line limit
- Removes optimization training data duplication
- Adds required frontmatter
- Focuses on review task, not optimization education

**Cons:**

- Less language-specific guidance
- Requires trust in LLM's optimization knowledge

**Effort:** Low (1-2 hours) **Risk:** Very low (performance optimization is
well-known)

### Solution 2: Keep Framework, Split Patterns to Skill

Keep analysis framework, move language-specific patterns to separate skill.

**Pros:**

- Preserves language-specific guidance
- Agent meets line budget

**Cons:**

- Creates skill for training data
- Maintenance burden
- Doesn't solve duplication problem

**Effort:** Medium (3-4 hours) **Risk:** Low

## Recommended Action

**Implement Solution 1**: Trim to analysis framework, add `allowed-tools`
frontmatter.

**Execution plan:**

1. Add `allowed-tools: [Read, Grep, Glob, Bash]` to frontmatter (verify actual
   tools used)
2. Remove lines 40-59 (Big-O explanations) → assume understood
3. Remove lines 60-170 (language-specific patterns) → replace with 2-3 bullets
   per language (~10 lines):
   - "TypeScript: async patterns, promise handling, event loop blocking"
   - "Python: GIL contention, list comprehensions, generator usage"
   - "Rust: allocation patterns, clone usage, async runtime"
4. Condense lines 180-230 (optimization techniques) → high-level categories (~10
   lines):
   - "Algorithmic: complexity, data structures, caching"
   - "I/O: batching, streaming, connection pooling"
   - "Memory: allocations, copies, data structure size"
   - "Concurrency: parallelism, lock contention, async efficiency"
5. Remove detailed profiling steps → "Profile and measure before/after changes"
   (~2 lines)
6. Ensure output format section clear
7. Target final length: ~110 lines
8. Verify trigger clause: "Use when analyzing performance issues or optimization
   opportunities"

## Technical Details

**Current structure (263 lines):**

```
Lines 1-39: Frontmatter + trigger clause (missing allowed-tools)
Lines 40-59: Big-O explanations (REMOVE)
Lines 60-170: Language-specific patterns (CONDENSE to ~10 lines)
Lines 180-230: Optimization techniques (CONDENSE to ~10 lines)
Lines 231-263: Output format + profiling (KEEP/CONDENSE)
```

**Target structure (~110 lines):**

```
Lines 1-30: Frontmatter (with allowed-tools) + trigger clause
Lines 31-50: High-level performance concerns
Lines 51-60: Language-specific bullets (2-3 per language)
Lines 61-70: Optimization categories (4 bullets)
Lines 71-110: Output format + measurement guidance + edge cases
```

**Frontmatter to add:**

```yaml
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash # if used for profiling commands
```

**Key content to preserve:**

- Trigger: "Use when analyzing performance issues or optimization opportunities"
- Performance concerns: algorithmic complexity, I/O, memory, concurrency
- Output: structured findings with severity, location, impact estimate,
  recommendation
- Unique directives:
  - Quantify impact where possible (latency, throughput, memory)
  - Distinguish micro-optimizations from architectural issues
  - Consider trade-offs (performance vs maintainability)

## Acceptance Criteria

- [ ] File length ≤ 120 lines
- [ ] `allowed-tools` frontmatter added with all tools used
- [ ] Big-O explanations removed (assume understood)
- [ ] Language-specific patterns condensed to 2-3 bullets per language
- [ ] Optimization techniques condensed to high-level categories
- [ ] Detailed profiling instructions removed (keep brief mention)
- [ ] Trigger clause preserved
- [ ] Output format specification clear
- [ ] Unique directives preserved (quantify, distinguish, trade-offs)
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can perform performance review

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. Agent is 263 lines (143 over budget), contains extensive
language-specific patterns and optimization techniques duplicating LLM training
data, missing `allowed-tools` frontmatter.

## Resources

- Plugin marketplace review session
- Agent file: `plugins/yellow-core/agents/review/performance-oracle.md`
- Quality rule source: PR #8 review
- Frontmatter requirement: `docs/plugin-validation-guide.md`
