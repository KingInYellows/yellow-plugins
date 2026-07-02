---
'yellow-ruvector': patch
'yellow-core': patch
---

Memory-protocol drift control (Tier 2 C7): declare yellow-ruvector's `memory-query` skill the canonical home of the ruvector protocol constants and put the duplicated copies under a CI drift lint.

- `memory-query/SKILL.md` gains a Canonical Source header; yellow-core's `memory-recall-pattern`, `memory-remember-pattern`, and `mcp-integration-patterns` are marked replicas (their old self-canonical "Design reference" blockquotes rewritten)
- A single ASCII sentinel line carrying the constants (recall top_k=5 / score < 0.5 / top-3 / 800-char truncation / dedup top_k=1 / 0.82) is byte-identical in all four files
- New RULE 16 in `scripts/validate-agent-authoring.js` fails CI when the sentinel line diverges in any copy, a declared file lacks the sentinel or is missing entirely, or an undeclared plugins/ file carries one (containment); the surrounding prose restatements of the constants remain a manual sweep
- The ~10 consuming command files are documented as out of CI scope (context-adapted paraphrases), with two divergences recorded: `ruvector/search.md` top_k=10 (intentional) and `ruvector/learn.md` missing dedup (open maintainer question, not silently fixed)
