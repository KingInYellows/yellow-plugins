---
title: "Agent Quality Audit — Under-Specified Files"
date: 2026-02-24
author: session
tags:
  - agents
  - quality-audit
  - 120-line-soft-limit
---

# Brainstorm: Agent Quality Audit — Under-Specified Files

## Context

Research confirmed the 120-line agent file guideline is a soft audit threshold,
not a hard limit. Anthropic's actual hard guidance is 500 lines for SKILL.md.
The finding raises a follow-up question: were any existing agents artificially
kept short at the expense of quality?

**Inventory snapshot (2026-02-24):**

- 43 total agent files
- 22 under 120 lines (56–118 lines) → audit candidates
- 21 over 120 lines (already exceed old guideline)
- Most striking pattern: all 5 yellow-debt scanner agents at **exactly 93–94 lines**
  (complexity, architecture, duplication, ai-pattern, security-debt) — identical
  length strongly suggests systematic trimming

---

## What We're Building

A **category-grouped quality audit** that reads agent files in related groups,
compares them against each other and their plugin context, and produces a
ranked list of specific gaps — missing edge cases, decision logic, output
format specs, error handlers, or security rules. Output is a prioritized report;
humans decide which improvements to implement.

---

## Why Approach B (Category-Grouped)

- **Cross-file comparison surfaces systematic patterns:** If all 5 debt scanners
  are missing the same severity scoring section, a group analysis finds it;
  per-file analysis only finds "this scanner is missing X" 5 separate times
- **Context-aware assessment:** Agents in the same plugin share domain conventions
  (CLAUDE.md, skills). Reading them together avoids false gaps that are actually
  covered by shared conventions
- **Over-120 agents as reference:** Each group includes both under- and over-120
  agents. The longer agents provide a "what complete looks like" baseline for
  grading the shorter ones

---

## Key Decisions

### 1. Agent Groups (5 categories)

| Group | Agents | Under-120 |
|---|---|---|
| **A: Debt scanners** | complexity, architecture, duplication, ai-pattern, security-debt, audit-synthesizer, debt-fixer | 5 of 7 |
| **B: Yellow-review pipeline** | pr-comment-resolver, code-simplifier, comment-analyzer, learning-compounder, type-design-analyzer, silent-failure-hunter, pr-test-analyzer, code-reviewer | 8 of 8 |
| **C: Research agents** | code-researcher, research-conductor, repo-research-analyst, spec-flow-analyzer, best-practices-researcher | 4 of 5 |
| **D: Workflow/utility** | brainstorm-orchestrator, linear-issue-loader, memory-manager, semantic-search | 4 of 4 |
| **E: Yellow-core review** | security-sentinel (164), architecture-strategist (148), polyglot-reviewer (140), performance-oracle (140), test-coverage-analyst (138), code-simplicity-reviewer (152), git-history-analyzer (114) | 1 of 7 |

Group E (yellow-core review) has only 1 under-120 agent; deprioritize.

**Priority order: A → B → C → D → E**

Group A is highest priority: the 93–94 line scanner cluster is the clearest
signal of artificial cutting.

### 2. Analysis Rubric (Applied Per Group)

Each group analysis agent scores every under-120 file on:

| Gap type | Question |
|---|---|
| **Missing decision logic** | Are there branching rules / scoring algorithms / classification tables that the agent needs but aren't written? |
| **Missing edge case handling** | What inputs or states are unhandled that would cause silent failure or wrong output? |
| **Missing output format spec** | Is the expected output structure (columns, labels, section order) fully specified? |
| **Missing security/validation rules** | Are there injection fencing, input validation, or secret-redaction requirements that are domain-specific? |
| **Missing error paths** | Are tool failures, empty results, and API errors all handled explicitly? |
| **LLM training data audit** | Is any content in the file duplicating general knowledge (what YAML is, generic "read carefully" instructions)? → flag for CUT |

Each gap is rated: **P1** (agent produces wrong/unsafe output without this) or
**P2** (agent produces suboptimal output; would benefit from this).

### 3. What "Under-Specified" Means

An agent is under-specified if it:
- Relies on LLM inference for logic that is project-specific (scoring, format, labels)
- Omits error handling that the LLM cannot reasonably default to correctly
- Lacks output format specs that downstream consumers depend on

An agent is NOT under-specified just because it is short. A 56-line focused
agent with a clear single task and no branching logic is fine.

### 4. Output Format

A report at `docs/audits/2026-02-24-agent-quality-audit.md`:

```
# Agent Quality Audit Report

## Summary
- Total agents audited: N
- P1 gaps found: N (would cause wrong/unsafe output)
- P2 gaps found: N (would improve quality)
- Recommended expansions: N agents

## Priority Findings

### P1: [Agent name] — [Gap type]
> [Specific missing content]
> Impact: [What happens without this]
> Suggested addition: [What to add, in 1-2 sentences]

## Per-Group Analysis
[...]

## Agents with No Gaps Found
[List — don't expand these]
```

### 5. Scope Boundaries

**In scope:** All 22 agents under 120 lines
**Out of scope:**
- Commands (different pattern — they orchestrate, not specialize)
- SKILL.md files (already above 120 in most cases; subject to different guidelines)
- Skills reference files (failure-patterns.md, linter-rules.md — not agent files)

---

## Open Questions

1. **Scanner agents: shared base or individual fixes?** If all 5 debt scanners
   are missing the same section, should we add it to a shared skill or add it
   to each agent individually? (Depends on whether the content differs per scanner)

2. **Improvement implementation:** After the report, should improvements be
   grouped into one PR (all agents) or split by plugin? Per-plugin is safer
   for review but slower.

3. **Re-audit trigger:** After implementing improvements, should we add a CI
   check that flags agent files over 300 lines? Or rely on the updated MEMORY.md
   guideline?

---

## Success Criteria

- Every under-120 agent has been assessed against the 6-point rubric
- P1 gaps are identified with specific "what to add" guidance
- Agents with no gaps are explicitly listed (don't expand them unnecessarily)
- Report is actionable: each finding has a suggested improvement, not just a
  description of the gap
