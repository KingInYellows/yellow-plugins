---
name: agent-learning
description: Agent learning patterns and quality guidelines. Use when commands or agents need to determine when and how to record learnings, apply quality gates, or retrieve past knowledge using ranked retrieval.
user-invokable: false
---

# Agent Learning Patterns

## What It Does

Defines when to record learnings, quality standards for entries, and retrieval strategies. Loaded by memory-related commands and agents for consistent learning behavior.

## When to Use

Use when yellow-ruvector plugin commands or agents need guidance on learning triggers, quality gates, or retrieval ranking.

## Usage

This skill is not user-invokable. It provides shared context for the yellow-ruvector plugin's learning workflows.

## Learning Triggers

### Record a Reflexion When

- Test failure that required a code fix
- Lint or type error that needed resolution
- User corrected the agent's approach
- Agent retried after an error and succeeded
- Build or deploy failure

### Record a Skill When

- Complex operation succeeded on first attempt
- User explicitly praised a technique
- Clean solution to a recurring problem
- Novel approach that worked well

### Record a Causal Observation When

- Debugging revealed "X caused Y"
- Configuration change resolved an issue
- Performance investigation found a bottleneck
- Dependency update triggered a regression

### Skip Recording When

- Trivial file reads or searches
- Simple, routine operations
- Information already captured in a previous entry
- The operation has no notable outcome

## Quality Gates

Every learning entry must meet these criteria:

1. **Minimum length:** 20 words in the content field
2. **Structure:** Must include context (what happened), insight (why), and action (what to do)
3. **Specificity:** Reference concrete files, functions, or error messages — not vague generalizations
4. **Actionability:** The "action" must be something a future agent can follow

### Good Examples

**Reflexion:**
> "Test `auth.test.ts:testTokenRefresh` failed because the mock JWT was expired. Fix: always set mock token expiry to `Date.now() + 3600000` instead of a hardcoded timestamp. Applied in commit abc123."

**Skill:**
> "Batch database inserts wrapped in a transaction are 10x faster than individual inserts for the users table. Use `db.transaction(async (tx) => { ... })` pattern when inserting more than 5 rows."

### Bad Examples

> "Fixed a bug" — No context, no insight, no action.
> "Tests should pass" — Not specific, not actionable.

## Retrieval Strategy

Use Reciprocal Rank Fusion (RRF) to combine multiple ranking signals:

```
final_score = sum(1 / (rank_i + 60)) for each signal i
```

### Ranking Signals

1. **Semantic similarity** — Vector cosine distance to query
2. **Recency** — Time-decay: newer entries rank higher
3. **Frequency** — Entries retrieved more often rank higher (validated usefulness)

### Context Budget

- Load max 5 learnings per session start (via SessionStart hook)
- Prioritize by RRF score
- Each loaded learning should be a concise, actionable reminder

### Dedup Threshold

- Cosine similarity > 0.85 = likely duplicate
- Warn user before storing near-duplicates
- Don't apply hard threshold on search results — always return top-k, filter below 0.5

## Skill Promotion

When a reflexion pattern appears 3+ times across sessions, consider promoting it to a skill:
1. Identify the recurring pattern from reflexion entries
2. Formulate as a positive "do this" rule (not "don't do that")
3. Store in the `skills` namespace with broader context
4. Optionally add to project CLAUDE.md if it's a project-wide convention
