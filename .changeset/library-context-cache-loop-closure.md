---
'yellow-research': minor
'yellow-core': patch
---

feat(library-context): close the context7 cache loop — tier2 doc-content cache + runtime writeback

Two ends of the cache loop noted as out-of-scope in PR #538 are now
wired: `hooks/lib/context7-cache.sh` gains `_lc_lookup_docs` (tier2
reader), `_lc_write_tier1`, and `_lc_write_tier2` (atomic-merge writers
with LRU eviction at 50 entries), exposed via two new wrappers —
`bin/lc-cache-lookup-docs` and `bin/lc-cache-write <tier> <args...>`.

SKILL.md's Step 1 (library-id resolution) and Step 2 (document lookup)
now instruct writeback after a successful live MCP call, so the cache
warms with use instead of only filling via the SessionStart pre-warm.
`best-practices-researcher.md`'s inlined safe-chain block gains the same
symmetric tier1/tier2 writeback (renumbered 1.1-1.5), preserving the
RULE 13 drift sentinel unchanged.

Writebacks are advisory — a failed write is logged to stderr and
swallowed, never blocking the agent whose MCP call already succeeded.
`reference.md`'s Cache section is rewritten to describe the shipped
tier2 lookup/write API and the runtime writeback contract in place of
the earlier "reserved for a future round" framing.
