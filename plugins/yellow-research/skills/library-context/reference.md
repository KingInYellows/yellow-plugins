# library-context — Reference

Implementer-facing material that does not need to be loaded into every
preloading agent's spawn context. Read on demand via the Read tool from the
canonical [SKILL.md](./SKILL.md) when you're authoring a new consumer or
investigating drift.

## Distribution model — why two forms

Claude Code's `skills:` frontmatter resolves only against the same plugin's
skill directory. Cross-plugin `skills:` references silently no-op
([anthropics/claude-code#15944](https://github.com/anthropics/claude-code/issues/15944),
closed not planned, 2026-04). Two viable distribution mechanisms remain:

- **Within yellow-research:** consumers list `skills: [library-context]` in
  agent frontmatter. The full SKILL.md body is injected at spawn time per the
  official subagents spec. Consumers MUST remove any inline context7/fallback
  prose to avoid conflicting instructions.
- **Cross-plugin:** consumers copy the **safe-chain block** from SKILL.md's
  Usage section verbatim into the agent body, with an `Inlined from
  yellow-research:library-context — keep in sync; verified <date>` annotation
  above the block. The safe chain terminates at built-in `WebSearch` so
  consumers without yellow-research installed still work.

This pattern mirrors `yellow-core/skills/security-fencing/SKILL.md` (44
inlined copies on main, drift-detected via the sentinel `CRITICAL SECURITY
RULES`).

## Drift-detection sentinel

Every inlined copy of the safe chain must contain the exact phrase:

```
context7 unavailable — falling back to
```

The em dash is Unicode U+2014, NOT two hyphens (`--`) or one hyphen (`-`).
Tools that auto-correct ASCII to typographic punctuation can produce mismatches
that silently fail detection. Copy the phrase from SKILL.md's source, not
from rendered Markdown output.

The phrase MUST appear on a single line in the inlined consumer. The grep
below is line-based and silently misses wrapped occurrences. SKILL.md's
canonical safe-chain code fence has the phrase on a single long line —
preserve that wrapping when copying.

### Machine-verifiable grep (today, manual)

```bash
rg 'context7 unavailable — falling back to' plugins/ --type md \
  | grep -v 'library-context/SKILL.md' \
  | grep -v 'library-context/reference.md' \
  | grep -v 'CHANGELOG.md'
```

Re-run before relying on the consumer enumeration below — the list drifts
faster than this file is edited.

### RULE 13 lint (shipped)

`scripts/validate-agent-authoring.js` enforces this automatically. RULE 13
fails CI when an agent file lists any of `mcp__context7__resolve-library-id`,
`mcp__context7__query-docs`, or `mcp__context7__get-library-docs` in its
`tools:` AND does NOT preload via `skills: [library-context]` AND does NOT
contain the exact sentinel phrase in its body. The two-condition exemption is
load-bearing — without it the rule false-positives on within-yellow-research
consumers like `code-researcher` where the chain is injected at spawn via the
preloaded skill, not present in the static agent body. The `CONTEXT7_TOOLS`
Set and `LIBRARY_CONTEXT_SENTINEL` constant live near the top of the
validator; fixture coverage is in
`tests/integration/validate-agent-authoring-context7-rule.test.ts`.

The manual grep above remains useful for an ad-hoc check, but CI is now the
authoritative gate — a corrupted sentinel (ASCII `--` instead of the em dash)
or a missing fallback fails the build, not just code review.

## Consumer enumeration (2026-05-17)

Initial PR consumers:

- `plugins/yellow-research/agents/research/code-researcher.md` — preloads via
  `skills: [library-context]`; inline context7 prose removed
- `plugins/yellow-core/agents/research/best-practices-researcher.md` —
  cross-plugin: inlines the safe-chain block in its Phase 1 (cannot preload —
  see Distribution model above)

### Adoption

There is no pre-tracked adoption backlog. A 2026-06-30 review found that none
of the other plugins (yellow-debt, yellow-semgrep, yellow-codex, yellow-docs,
yellow-review, yellow-council, yellow-devin, yellow-browser-test) have an
existing library-documentation-lookup step to inline the safe chain into —
their agents do code analysis, debt scanning, CLI delegation, doc generation,
or workflow orchestration, not library-doc lookup. Adopting `library-context`
into any of them is therefore a per-plugin *feature* decision, not a follow-up
refactor.

When a future PR adds a library-doc-lookup feature to a consumer plugin, it
adopts the safe chain as a natural part of that work: list the context7 tools,
inline the safe-chain block from SKILL.md verbatim (sentinel and all), and add
a changeset. RULE 13 (shipped) then enforces the sentinel on that new copy
automatically — no separate gating step is required.

## Context7 platform facts (verified 2026-05-17)

- **Tool names:** Canonical is `mcp__context7__resolve-library-id` +
  `mcp__context7__query-docs`. Both names confirmed in upstream context7
  v0.4.2 (released 2026-05-11). Earlier external docs reference
  `get-library-docs` — preserved as a name to verify post-install via
  ToolSearch, since older context7 installs may still expose that name.
- **Auth:** Anonymous use supported. Optional `CONTEXT7_API_KEY` (from
  context7.com/dashboard) gives a dedicated quota; OAuth 2.0 also supported
  for remote HTTP connections.
- **Rate limits:** Anonymous shares a **global 60 req/hr pool** across all
  unauthenticated callers — easily exhausted in busy team environments.
  API key / OAuth gives 60 req/hr per key.
- **Distribution:** USER-LEVEL ONLY. The bundled context7 entry was removed
  from yellow-core's `plugin.json` in CE PR #486 (2026-04-29) to fix an
  OAuth dual-registration regression. Do NOT re-bundle context7 in any
  plugin's `mcpServers` block — recreates the regression. Users install once
  globally: `/plugin install context7@upstash` or via Claude Code MCP
  settings.

## Cache (tier1 wired in PR #538; tier2 + runtime writeback closed the loop)

SKILL.md Step 1 reads the pre-warmed cache via the
`${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-lookup` helper before calling
`mcp__context7__resolve-library-id`; Step 2 reads the tier2 cache via
`${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-lookup-docs` before calling
`mcp__context7__query-docs`. Both readers are provided by yellow-research;
cross-plugin consumers reach them via the established
`${CLAUDE_PLUGIN_ROOT}/../yellow-research/bin/<name>` path pattern and
absorb bash exit 127 (yellow-research not installed) into the
empty-output branch with `2>/dev/null || true`.

**Cache shape** (schema defined by the SessionStart hook in PR #537,
`hooks/lib/context7-cache.sh`):

- Location: `${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_project_dir>.json`
- `tier1`: `library-name → {library_id, fetched_at}` (24h TTL, capped at 5
  libs pre-warmed per session; also grows via runtime writeback for
  libraries outside the pre-warm set)
- `tier2`: `library-id|topic → {docs, fetched_at}` (4h TTL, max 50 entries,
  LRU-evicted by `fetched_at`; populated lazily on cache miss, not
  pre-warmed)
- `lockfile_fingerprint`: mtimes of detected lockfiles for invalidation
- `schema: "1"` for forward-compatibility

**Runtime writeback (closes the loop).** Both tiers now have a matching
writer, exposed via `${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-write <tier>
<args...>`:

- `lc-cache-write tier1 <name> <library-id>` — after a live
  `resolve-library-id` succeeds, writes/refreshes that library's tier1
  entry. Idempotent: re-writing the same name updates `fetched_at` without
  duplicating the entry.
- `lc-cache-write tier2 <library-id> <topic> <docs-file>` — after a live
  `query-docs` succeeds, writes the docs body (read from a file path, not
  argv, to sidestep shell quoting hazards in markdown content) into tier2.
  When the cache already holds `_LC_TIER2_MAX_ENTRIES` (50) entries, the
  write evicts the entry with the oldest `fetched_at` in the same jq pass
  that performs the upsert.

Both writers re-read the cache file on every call (never a caller-held
snapshot) to minimize the multi-writer race window, then atomic-mv the
result — see "Concurrent writes" in Edge Cases below for the accepted
eventual-consistency trade-off. Writes are advisory: a failed writer
(disk full, permission denied, `jq` missing) is logged to stderr and
swallowed — the caller's MCP round-trip already succeeded, so a cache
miss on the write side never blocks the agent. `lc-cache-lookup-docs`
enforces the tier2 TTL on read; an entry older than 4h returns empty
(cache miss) even though it still occupies a slot until the next LRU
eviction pass.

This means the cache is no longer a static SessionStart snapshot: it
warms with use, including for libraries never in the top-5 pre-warm set.

## Why a documentation skill, not just frontmatter preload (longer note)

Same rationale as `security-fencing/SKILL.md`'s "Why this is a documentation
skill" section. The SKILL.md body is the canonical edit-here source.
Cross-plugin consumers inline-copy because they have no other option until
`anthropics/claude-code#15944` reopens. Within-yellow-research consumers
preload via `skills:` because that gives the lowest-friction
single-source-of-truth experience for the most frequent caller
(`code-researcher` runs on every `/research:code` invocation).

For agents that preload via `skills:`, the SKILL.md body is prepended to the
agent's system context at spawn. This is the entire point of the
runtime/reference split:

- Runtime instructions (SKILL.md) — injected every spawn, kept lean
- Reference material (this file) — read on demand, may grow freely

## Stale-figure caveat (security-fencing precedent)

The brainstorm reference to "34 agents in 5 plugins" for security-fencing is
stale. Live count returned 44 at the time of this PR. The exact number is
not load-bearing — the pattern is what matters. Numbers in distribution
write-ups should be re-counted, not copied.
