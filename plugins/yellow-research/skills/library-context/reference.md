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

### Future RULE 13 lint (deferred follow-up)

`scripts/validate-agent-authoring.js` should grow a RULE 13 that fails CI
when an agent file references `mcp__context7__` in its `tools:` list AND
does NOT preload via `skills: [library-context]` AND does NOT contain the
sentinel phrase in the body. The two-condition exemption is mandatory —
without it, the rule false-positives on within-yellow-research consumers
like `code-researcher` where the sentinel is injected at spawn via the
preloaded skill, not present in the static agent body.

Pseudocode:

```
for each agent.md in plugins/*/agents/**/*.md:
  if 'mcp__context7__' in tools list:
    has_preload   = 'library-context' in skills frontmatter list
    has_sentinel  = 'context7 unavailable — falling back to' in body
    if not has_preload and not has_sentinel:
      fail(agent.md, "context7 reference without library-context preload or sentinel block")
```

Fixture coverage the follow-up PR MUST add:

- Positive: `code-researcher` (preload-exempt — has context7 in tools AND
  `library-context` in skills; body has no sentinel — rule passes)
- Positive: `best-practices-researcher` (inline path — has context7 in tools,
  no preload, sentinel present in body — rule passes)
- Negative: synthetic agent fixture with context7 in tools, no preload, no
  sentinel — rule fails

Template after W1.5 in `scripts/validate-agent-authoring.js` — locate via
`grep -n 'W1.5' scripts/validate-agent-authoring.js` (line offsets shift
as the validator grows; the current W1.5 implementation is ~line 290);
approximately 15-20 lines of additional logic plus the fixture tests.
The grep above is the runtime check the rule's negative branch performs
per-file.

Block opt-in adoption to additional plugins until RULE 13 lands — otherwise
each new consumer is a fresh drift surface with no CI coverage.

## Consumer enumeration (2026-05-17)

Initial PR consumers:

- `plugins/yellow-research/agents/research/code-researcher.md` — preloads via
  `skills: [library-context]`; inline context7 prose removed
- `plugins/yellow-core/agents/research/best-practices-researcher.md` —
  cross-plugin: inlines the safe-chain block in its Phase 1 (cannot preload —
  see Distribution model above)

Opt-in candidates for follow-up adoption (NOT in initial PR):

- `plugins/yellow-debt/` — scanner agents that lookup library docs while
  classifying debt
- `plugins/yellow-semgrep/` — finding-fixer when proposing language-idiomatic
  fixes
- `plugins/yellow-codex/` — research and rescue agents
- `plugins/yellow-docs/` — doc generator when documenting library usage
- `plugins/yellow-review/` — polyglot-reviewer and pattern-recognition agents
- `plugins/yellow-council/` — gemini-reviewer, opencode-reviewer
- `plugins/yellow-devin/` — devin-orchestrator
- `plugins/yellow-browser-test/` — app-discoverer

Each follow-up adoption is one PR that adds the safe-chain inlined block to
the candidate agent, includes the sentinel phrase verbatim, and adds a
changeset entry. Should NOT land before RULE 13.

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

## Cache (consumer wiring landed in this PR; hook in PR #537)

SKILL.md Step 1 now reads the pre-warmed cache via the
`${CLAUDE_PLUGIN_ROOT}/bin/lc-cache-lookup` helper before calling
`mcp__context7__resolve-library-id`. The helper is provided by
yellow-research; cross-plugin consumers probe for it and skip cleanly
when yellow-research is not installed.

**Cache shape** (defined by the SessionStart hook in PR #537,
`hooks/lib/context7-cache.sh`):

- Location: `${CLAUDE_PLUGIN_DATA}/context7-cache-<md5_of_project_dir>.json`
- `tier1`: `library-name → {library_id, fetched_at}` (24h TTL, capped at 5
  libs pre-warmed per session)
- `tier2`: `library-id|topic → {docs, fetched_at}` (4h TTL, max 50;
  reserved for future lazy population on cache miss — not pre-warmed)
- `lockfile_fingerprint`: mtimes of detected lockfiles for invalidation
- `schema: "1"` for forward-compatibility

The `lc-cache-lookup` reader only consults `tier1`; doc-content caching
(tier2) is reserved for a future round where the skill's Step 2
(`query-docs`) similarly checks the cache before the MCP call. That round
also needs to design a cache-write contract for runtime hits (today the
cache only fills via the SessionStart pre-warm).

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
