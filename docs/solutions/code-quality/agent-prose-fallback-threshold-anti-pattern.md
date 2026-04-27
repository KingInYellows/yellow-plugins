---
title: Agent Prose Fallback Thresholds Are a Silent-Failure Anti-Pattern
date: 2026-04-26
category: code-quality
tags: [agent-authoring, fallback, threshold, llm-behavior, plugin-authoring, research]
components: [yellow-research]
pr: '#265'
---

# Agent Prose Fallback Thresholds Are a Silent-Failure Anti-Pattern

## Problem

Three agents in PR #265 (`feat: Ceramic.ai as default research backend`) used
subjective language to express quality-based fallback decisions:

- `plugins/yellow-research/agents/research/code-researcher.md`: "If
  `ceramic_search` returns no useful results, fall through to secondary
  sources."
- `plugins/yellow-research/agents/research/research-conductor.md`: "Queries
  that score thin on Ceramic should escalate to the full tier."
- `plugins/yellow-research/agents/research/best-practices-researcher.md`: "If
  results feel sparse, continue to the complementary source."

All three had the same structural failure: the fallback condition was expressed
as a qualitative judgment ("useful", "thin", "sparse") with no mechanical
signal. The LLM must decide whether the threshold is met using only its own
assessment of result quality — and it tends to treat any non-empty response as
"useful", suppressing the fallback chain entirely.

The observable symptom is that secondary sources are never invoked even when
Ceramic returns a single weak hit, because the LLM judges one result as
"useful enough."

## Root Cause

Qualitative fallback language puts the routing decision inside the LLM's
judgment loop rather than outside it. The LLM has a strong prior toward
satisficing — treating the first non-empty response as sufficient. Phrases like
"no useful results" or "scores thin" give it interpretive latitude to conclude
that whatever it received clears the bar.

This is distinct from cases where the LLM should exercise judgment (e.g.,
"combine sources if the topic is ambiguous") — those are content decisions, not
routing decisions. Routing decisions that depend on result quality need an
objective signal the LLM can evaluate without interpretation.

## Fix

Replace subjective fallback expressions with a numeric guard on a measurable
field from the tool's response schema:

```
# Broken — subjective
If `ceramic_search` returns no useful results, fall through.

# Fixed — numeric guard
If `ceramic_search` returns `totalResults < 3`, fall through to secondary
sources. (Rationale: 3 confirms a real knowledge cluster, not a fluke match.)
```

Applied to all three agents in PR #265. The threshold value (3) should be
chosen based on the tool's response schema and what constitutes a meaningful
result cluster for the domain. Document the rationale inline so reviewers can
evaluate whether the threshold is appropriate.

For agents with a multi-source fallback chain, also add an explicit terminator
for the both-sources-thin case:

```
If both primary and secondary sources return totalResults < 3, synthesize
from what is available and note coverage gaps explicitly in the response.
Do not loop or retry indefinitely.
```

Without this terminator, the LLM may attempt unbounded retry or produce an
empty response when every source returns thin results.

## Prevention

### Rule: Numeric Guard for Every Quality-Based Routing Decision

Any agent step that conditionally invokes a fallback based on result quality
must express the condition as a measurable predicate, not prose judgment. The
checklist for authoring or reviewing an agent that uses multi-source fallback:

1. Identify every fallback branch triggered by result quality (not by error
   or timeout — those are separate).
2. For each branch, confirm the tool's response schema exposes a numeric
   field that can stand in for quality (e.g., `totalResults`, `score`,
   `resultCount`, `confidence`).
3. Replace subjective language with `field < N` where N is documented inline
   with a one-sentence rationale.
4. Add an explicit terminator for the all-sources-thin case.

### Grep to Find Violations

```bash
# Subjective fallback language in agent markdown files
rg --glob 'plugins/*/agents/**/*.md' \
  'no useful|not useful|too thin|score.*thin|feels? sparse|insufficient results|not enough results|low quality results'
```

Any hit in an agent file that is followed by a fallback or escalation
instruction is a candidate for a numeric guard.

### Fields to Look For in Common Tool Schemas

| Tool type | Candidate numeric field |
|---|---|
| Search (web, vector, code) | `totalResults`, `resultCount`, `numResults` |
| RAG / vector recall | `score` (top result), `results.length` |
| GitHub code search | `total_count` |
| Perplexity / research | response length proxy (word count of citations) |

If the tool schema provides no numeric field, use `results.length` (array
length of the returned results list) as a fallback proxy.

## Related Documentation

- [stale-env-var-docs-and-prose-count-drift.md](./stale-env-var-docs-and-prose-count-drift.md) — Co-occurring count drift findings from PR #265
- [setup-classification-probe-coupling.md](./setup-classification-probe-coupling.md) — Co-occurring probe/classification coupling failure from PR #265
- [claude-code-command-authoring-anti-patterns.md](./claude-code-command-authoring-anti-patterns.md) — Broader anti-pattern catalog for command and agent authoring
