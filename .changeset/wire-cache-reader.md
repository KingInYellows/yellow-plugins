---
'yellow-research': patch
'yellow-core': patch
---

feat(library-context): wire cache reader into Step 1 (closes PR #537's chatgpt-codex consumer gap)

PR #537 (`yellow-research` SessionStart context7 cache pre-warm hook)
shipped the cache-write side + the `bin/lc-cache-lookup` reader
infrastructure, but the SKILL.md and best-practices-researcher inlined
block — both shipped on PR #536 — still instructed agents to call
`mcp__context7__resolve-library-id` directly. So the pre-warm consumed
context7 quota and wrote a cache nothing read; net effect was making
the anonymous-pool pressure worse, not better.

This commit closes the loop:

- `plugins/yellow-research/skills/library-context/SKILL.md` Step 1
  rewritten as "cache-first" — instructs agents to call
  `bash ${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-lookup <name>` first and
  skip the MCP resolve when output is non-empty. The wrapper exits 0
  on every path (cache miss, expired, helper absent, jq missing), so
  empty output is the safe fallback signal — never an error.
- `plugins/yellow-core/agents/research/best-practices-researcher.md`:
  inlined block adds an optional 1.1 pre-step that calls the helper at
  `${CLAUDE_PLUGIN_ROOT}/../yellow-research/bin/lc-cache-lookup` (the
  established cross-plugin path pattern documented in `AGENTS.md` and
  `plugins/yellow-core/CLAUDE.md`). The call is suffixed with
  `2>/dev/null || true` so bash exit 127 (yellow-research not
  installed) is absorbed into the same empty-output branch as a real
  cache miss. `Bash` is added to the agent's `tools:` list since the
  body now invokes the Bash tool. Other safe-chain steps renumber to
  1.2-1.4; HTML annotation enumerates the five intentional deltas vs
  the canonical SKILL.md block.
- `reference.md`: "Cache-compatibility (deferred)" → "Cache (consumer
  wiring landed in this PR; hook in PR #537)" with the full cache
  schema documented.

Sentinel preserved (2 occurrences in BPR). With this PR + #537 merged,
the cache loop is closed: SessionStart pre-warms via HTTP → SKILL.md
Step 1 reads via `lc-cache-lookup` → runtime context7 quota drops on
cache hits.
