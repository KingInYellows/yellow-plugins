---
"yellow-research": patch
---

Add RULE 13 to `validate-agent-authoring.js`: agents listing a context7 tool (`mcp__context7__resolve-library-id`/`query-docs`/`get-library-docs`) must either preload `skills: [library-context]` or carry the inline drift sentinel `context7 unavailable — falling back to` (em dash U+2014). Catches a corrupted/missing fallback chain at CI instead of code-review time. Also de-scopes the deferred-lint promise and the speculative opt-in-adoption backlog from the skill's `reference.md`.
