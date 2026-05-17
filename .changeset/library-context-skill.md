---
'yellow-research': minor
---

feat(yellow-research): add `library-context` skill + refactor `code-researcher` to preload it

New canonical SKILL.md at `plugins/yellow-research/skills/library-context/`
defines the context7 → EXA → WebSearch fallback chain for library
documentation lookup: ToolSearch availability detection, two-step
invocation (`resolve-library-id` → `query-docs`), disambiguation rules,
rate-limit handling (anonymous 60 req/hr global pool), citation format,
and the drift-detection sentinel phrase
`context7 unavailable — falling back to` (Unicode em dash U+2014).

Sibling `reference.md` holds distribution rationale, the deferred RULE 13
drift lint grep, the consumer enumeration, and the deferred cache-hook
contract. Loaded on demand, not auto-injected by `skills:` preload.

`code-researcher.md` now preloads via `skills: [library-context]` and
delegates library-doc routing to the skill (inline context7/fallback
prose removed from the "Source Routing" section; table row points to
the skill).

Cross-plugin consumers (initial: yellow-core `best-practices-researcher`)
inline the safe-chain block verbatim since `anthropics/claude-code#15944`
(cross-plugin `skills:` resolution) is closed not planned.
