---
title: 'Feature: Agent Quality Audit — Under-Specified Files'
date: 2026-02-24
category: 'code-quality'
---

# Feature: Agent Quality Audit — Under-Specified Files

## Problem Statement

Research confirmed the 120-line agent guideline is a soft audit threshold, not
a hard limit. This raises the question: were any agents artificially kept short
at the expense of quality? A systematic audit is needed to identify P1 gaps
(wrong or unsafe output without the missing content) and P2 gaps (suboptimal
output).

Research also found a **structural bug** in the yellow-debt scanner agents: they
reference the `debt-conventions` skill at runtime but `Skill` is not in their
`allowed-tools`, so they cannot actually call it. This means they carry inline
duplicates of skill content that can diverge. There is also a scoring threshold
discrepancy between `complexity-scanner.md` (>15 lines → High) and
`debt-conventions` SKILL.md (>20 lines → High).

## Current State

- 43 total agent files; 22 are under 120 lines (candidates for under-specification)
- 5 yellow-debt scanner agents are each exactly 93–94 lines — identical lengths
  strongly suggest systematic trimming
- All 8 yellow-review agents are under 120 lines (90–118), by design for the
  PR comment pipeline — lean is correct here
- `docs/audits/` directory does not exist; will need to be created

## Proposed Solution

A **category-grouped audit** using 5 parallel analysis agents. Each group agent
reads all agents in a functional category (including over-120 agents as quality
baselines), applies the 6-point rubric, and returns structured findings. A
synthesis step produces a ranked report at `docs/audits/`.

This is a **read-only workflow** — no agent file improvements in this PR. The
output is a prioritized report; implementation follows as a separate PR.

## Implementation Plan

### Phase 1: Setup

- [ ] 1.1: Create `docs/audits/` directory
- [ ] 1.2: Define the 6-point analysis rubric (see Technical Details)
- [ ] 1.3: Define the 5 category groups and which files each covers

### Phase 2: Parallel Category Analysis (5 agents)

Launch all 5 analysis agents concurrently via Task tool.

Each analysis agent:
1. Reads all agents in its assigned group (using Read, Glob, Grep)
2. Reads the plugin's CLAUDE.md and relevant skills for domain context
3. Applies the 6-point rubric to each under-120 file in the group
4. Returns structured findings: each gap rated P1 or P2 with a specific
   "what to add" suggestion

**Group A — Yellow-debt scanners (priority 1)**
Files: `complexity-scanner`, `architecture-scanner`, `duplication-scanner`,
`ai-pattern-scanner`, `security-debt-scanner` (all 93–94 lines),
`audit-synthesizer` (124), `debt-fixer` (128)
Context: `plugins/yellow-debt/CLAUDE.md`, `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
Known issues to verify: Skill-tool missing from allowed-tools, scoring threshold
discrepancy (>15 vs >20 cyclomatic), inlined security rules duplicate skill content

**Group B — Yellow-review pipeline (priority 2)**
Files: `code-reviewer` (118), `pr-test-analyzer` (117), `silent-failure-hunter`
(116), `type-design-analyzer` (112), `learning-compounder` (111),
`comment-analyzer` (107), `code-simplifier` (106), `pr-comment-resolver` (90)
Context: `plugins/yellow-review/CLAUDE.md`, `plugins/yellow-review/skills/pr-review-workflow/SKILL.md`
Note: These agents are intentionally lean (P1/P2/P3 PR comment format) — gaps
expected to be minor, if any

**Group C — Research agents (priority 3)**
Files: `code-researcher` (56), `research-conductor` (102), `repo-research-analyst`
(101), `spec-flow-analyzer` (104)
Context: `plugins/yellow-research/CLAUDE.md`, `plugins/yellow-core/CLAUDE.md`
Note: `code-researcher` at 56 lines is the shortest agent in the repo — high
probability of meaningful gaps

**Group D — Workflow/utility agents (priority 4)**
Files: `brainstorm-orchestrator` (108), `linear-issue-loader` (106),
`memory-manager` (101), `semantic-search` (87)
Context: respective plugin CLAUDE.md files
Note: `semantic-search` at 87 lines is the second-shortest; check for missing
output format spec and search scope definitions

**Group E — Yellow-core review (priority 5, low)**
Files: `git-history-analyzer` (114) — only under-120 agent in yellow-core review
Context: `plugins/yellow-core/CLAUDE.md`; baseline = sibling agents at 138-164
Note: One agent, likely minor gaps only

### Phase 3: Synthesis and Report

- [ ] 3.1: Aggregate all group findings into ranked list by P1/P2 priority
- [ ] 3.2: Deduplicate cross-group patterns
- [ ] 3.3: Write report to `docs/audits/2026-02-24-agent-quality-audit.md`

### Phase 4: Follow-up Tracking

- [ ] 4.1: For each P1 gap: create a GitHub issue or Linear ticket
- [ ] 4.2: Queue a follow-up PR to implement P1 improvements first

## Technical Details

### 6-Point Analysis Rubric

Each under-120 agent is scored on these dimensions:

| Dimension | Question | P1 if... | P2 if... |
|---|---|---|---|
| **Decision logic** | Are branching rules, scoring algorithms, or classification tables present? | Missing logic causes agent to produce wrong classification/selection | Missing logic causes agent to produce a reasonable-but-not-optimal result |
| **Edge case handling** | Are empty results, invalid inputs, tool failures, and domain-specific edge cases handled? | Unhandled case causes silent failure or incorrect output | Unhandled case causes confusing output |
| **Output format spec** | Is the expected output structure fully specified (columns, labels, section order, field names)? | Output format varies unpredictably; downstream consumers break | Output is inconsistent but usable |
| **Security/validation rules** | Are injection fencing, input validation, and secret-redaction requirements explicitly stated? | Missing security rule enables prompt injection or secret exposure | Missing rule causes inconsistent security posture |
| **Error paths** | Are tool failures, empty results, and API errors handled explicitly? | Error causes agent to stop silently or produce corrupt output | Error causes unhelpful generic message |
| **LLM duplication** | Does the file contain content Claude already knows (general concepts, standard tool docs)? | — (never P1) | Contains >5 lines of content that should be cut per novel-logic test |

### Novel Logic Test

Before grading a file as under-specified, confirm it's not already covered by:
1. The plugin's CLAUDE.md (shared conventions)
2. A referenced skill (check `allowed-tools` for `Skill` + the body text for
   "Reference the X skill for...")
3. A referenced `docs/solutions/` document

Content covered in those locations does NOT need to be duplicated in the agent.

### Report Format

```markdown
# Agent Quality Audit — 2026-02-24

## Executive Summary

- Agents audited: N (under-120 candidates)
- P1 gaps found: N (cause wrong/unsafe output)
- P2 gaps found: N (would improve quality)
- Agents with no gaps: N

## P1 Findings (Act Now)

### [Agent name] — [Gap type]
**File:** `path/to/agent.md` (N lines)
**Gap:** [Specific missing content]
**Impact:** [What goes wrong without this]
**Fix:** [What to add, 1-3 sentences]

## P2 Findings (Improve When Convenient)
[Same format]

## Agents with No Gaps Found
[List — do not expand these]

## Cross-Group Patterns
[Systemic gaps found in multiple agents]
```

### Files to Create

- `docs/audits/` — new directory
- `docs/audits/2026-02-24-agent-quality-audit.md` — the audit report

### Files NOT Modified

No agent files are changed in this PR. This is read-only analysis.

## Acceptance Criteria

1. All 22 under-120 agents have been assessed against the 6-point rubric
2. Every P1 gap has a specific "what to add" description (not just "this is missing")
3. Every agent assessed is explicitly listed — either in P1/P2 findings or in "No gaps found"
4. The known debt scanner bug (Skill missing from allowed-tools, threshold discrepancy) is confirmed and documented with P1/P2 classification
5. `code-researcher` (56 lines) gap assessment is detailed, not generic
6. Report is written to `docs/audits/2026-02-24-agent-quality-audit.md`
7. No agent files are modified in this PR

## Edge Cases

- **Agent references a skill but Skill is not in allowed-tools:** P1 gap (agent cannot actually delegate to skill, must carry logic inline; OR skill reference in body is dead prose — either way needs fixing)
- **Agent is short but clearly a thin wrapper (delegates entirely via Task):** Short is correct — no gap
- **Gap is already in plugin CLAUDE.md:** Not a gap — do NOT recommend adding it to the agent
- **Group baseline (over-120 agent) itself has unnecessary padding:** Flag it as a separate P2 CUT recommendation, but don't use it as "complete" baseline for that dimension

## References

- `docs/brainstorms/2026-02-24-agent-audit-under-specified-files-brainstorm.md`
- `docs/research/do-we-actually-need-a-120-line-maximum-o.md`
- `docs/solutions/code-quality/parallel-multi-agent-review-orchestration.md` — orchestration patterns
- `docs/solutions/code-quality/brainstorm-orchestrator-agent-authoring-patterns.md` — pre-commit checklist
- `plugins/yellow-core/skills/create-agent-skills/SKILL.md` — agent quality criteria
- `plugins/yellow-debt/skills/debt-conventions/SKILL.md` — scanner agent template (~40 lines target)
