# Claude Code Agent Markdown File Length: 120-Line Guideline Analysis

**Date:** 2026-02-24
**Sources:** Anthropic official documentation (platform.claude.com/docs), Anthropic engineering blog (anthropic.com/engineering), SFEIR Institute research, community practitioners (humanlayer.dev, psantanna.com), empirical analysis of 43 agent files in this repository

---

## Summary

The 120-line guideline in your MEMORY.md is a **soft anti-padding rule**, not a hard limit. Anthropic's official documentation sets 500 lines as the hard guidance for Skill files. There is no documented hard limit on agent `.md` files specifically. The real constraint is context token cost and instruction compliance degradation — and compliance research shows files up to ~200 lines maintain 92%+ application rates. Your 237-line `runner-assignment.md` falls within a defensible range because every section encodes genuinely novel logic (lookup tables, scoring algorithms, per-file fencing, multi-option sub-flows) that Claude cannot infer from training data. The 120-line number should be treated as a **"stop and audit" threshold**, not a maximum.

---

## Key Findings

### 1. Where Did the 120-Line Guideline Come From?

There is **no Anthropic-sourced 120-line limit** for agent `.md` files anywhere in official documentation. Searching the official docs yields:

- **SKILL.md files**: Anthropic explicitly documents "keep SKILL.md body under **500 lines** for optimal performance"
- **CLAUDE.md files**: No official line limit stated
- **MEMORY.md files**: Anthropic documents a **200-line hard truncation** — content beyond line 200 is silently dropped from the system prompt

The 120-line number in MEMORY.md appears to be an internally-derived rule of thumb based on the pattern that most agents in this repo were being written around that length. It is a reasonable heuristic to catch padding, not a limit backed by any engine constraint.

### 2. What is the Real Tradeoff?

**Agent files are NOT loaded at session start.** Unlike CLAUDE.md, an agent file's body only loads when the agent is spawned into a fresh subagent context. That subagent carries no session history — the 237 lines compete primarily against the injected runner inventory JSON and workflow file content, not an entire accumulated session.

**Instruction compliance degradation** is the real mechanism, not truncation:
- Files under 200 lines → **92%+ rule application rate**
- Files 200-400 lines → ~80-85% compliance
- Files over 400 lines → 71% and dropping

237 lines sits in the moderate degradation zone. The mitigation is **imperative phrasing and concrete examples** — both already used throughout the repo's agent files.

**Actual token cost of 237 lines**: approximately 1,800–2,200 tokens — roughly 1% of a 200K-token context window. Not a meaningful budget concern for a purpose-spawned subagent.

### 3. Empirical Data: Agent File Lengths in This Repository

Analysis of all 43 agent files in `yellow-plugins`:

| Metric | Value |
|---|---|
| Minimum | 56 lines |
| Maximum | 237 lines (`runner-assignment.md`) |
| Median | 118 lines |
| Mean | 121 lines |
| Files over 120 lines | 22 of 43 (**51%**) |

**51% of the repo's existing agents already exceed the 120-line guideline.** The guideline is descriptive of simple agents, not prescriptive across all agent types.

### 4. What is the Actual Mechanism?

**No hard truncation exists for agent files.** The 200-line truncation is specific to `MEMORY.md` only. Agent `.md` files do not have this constraint.

Actual mechanisms penalizing length:
1. **Token consumption** in the subagent context
2. **Instruction compliance degradation** above 200 lines (attention competition)
3. **Cognitive noise** from redundant content (restating training data)

### 5. Content Test: What Justifies Length?

**KEEP (Claude cannot infer from training data):**
- Project-specific lookup tables (signal→requirement mapping)
- Algorithmic decision logic with edge cases (OS filter + label eligibility + load tiebreaker)
- Exact output format specifications (recommendation table column names)
- Security behaviors unique to the threat model (per-file injection fencing)
- Multi-branch user interaction flows (AskUserQuestion with invalid-input re-prompt)
- Error handling for specific tool failure modes (YAML structural damage check)

**CUT (duplicates LLM training data):**
- Explains what YAML is
- Explains standard GitHub Actions concepts
- Generic "read carefully" instructions
- Restating the same rule twice
- Verbose prose where a table works

---

## Recommendation

**Treat the 120-line guideline as a "stop and audit" threshold, not a hard maximum:**

| Range | Guidance |
|---|---|
| Under 120 lines | No audit needed |
| 120–200 lines | Reasonable for multi-step workflows with non-trivial branching or domain-specific algorithms. Accept if content passes the "novel logic" test |
| 200–300 lines | Requires justification. Accept if every section encodes content Claude cannot infer |
| 300–500 lines | Strong signal to split into two agents or move reference material to a file the agent reads via `Read` |
| Over 500 lines | Split unconditionally (Anthropic's official threshold for SKILL.md files) |

**For `runner-assignment.md` at 237 lines:** Justified. Every section is novel logic. The only candidate for trimming is the `<examples>` block (15 lines) — minimal value since the step prose already covers the behavior. Otherwise, keep as-is.

---

## Updated MEMORY.md Guideline

> Agent `.md` files: use 120 lines as an audit threshold — audit for training-data duplication above this. Accept up to 200 lines for multi-step workflows with novel algorithms. Accept up to 300 lines if every section encodes content Claude cannot infer. Split at 300+ lines or if the agent covers two distinct tasks. Anthropic's hard guidance for SKILL.md files is 500 lines.

---

## Sources

- Anthropic official docs — Skill authoring best practices (500-line SKILL.md guidance)
- Anthropic Engineering — Effective context engineering for AI agents (just-in-time loading)
- SFEIR Institute — Claude Code memory system deep dive (92% vs 71% compliance data, 200-line MEMORY.md truncation)
- HumanLayer — Writing an effective CLAUDE.md (production examples)
- Empirical analysis of 43 agent files in `yellow-plugins` (median 118 lines, mean 121, 51% over 120)
