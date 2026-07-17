---
"yellow-ruvector": minor
"yellow-core": patch
---

Error→fix institutional memory (I1 MVP) + storage-scoping foundation fixes.
yellow-ruvector: new `/ruvector:seed-solutions` command batch-seeds
`ERROR-FIX:` entries from track:bug solution docs (idempotent, ADR-210
unlock/version-alignment guidance, intel_path project-scoping gate); MCP
server pinned to `npx -y ruvector@0.2.34` via catalog (stale 0.2.25 global
resolution silently wrote the machine-global ~/.ruvector store from
worktree sessions); install.sh defaults to the same pin; session-start.sh
heals a worktree's missing or dangling `.ruvector` symlink — resolving
the worktree root even from nested launch dirs — before the MCP server
can cache a fallback store path (10 new bats tests incl. version-pin and
0.40-floor drift guards); canonical Error→Fix
protocol section + calibrated 0.40 retrieval floor in memory-query
SKILL.md; storage-path doc drift fixed. yellow-core: debugging skill gains
step 1.4 (query institutional memory between trace and hypothesis-forming)
with the full inlined guard pattern and a causal-chain guard.
