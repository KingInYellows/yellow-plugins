# Feature: `library-context` Skill

## Problem Statement

Two existing agents — `plugins/yellow-research/agents/research/code-researcher.md`
and `plugins/yellow-core/agents/research/best-practices-researcher.md` —
duplicate the same logic for looking up library documentation via context7
with graceful fallback. Both encode the rule that context7 is a user-level
optional MCP since 2026-04 (yellow-core unbundled it in CE PR #486 to fix the
OAuth dual-registration regression), both run a ToolSearch availability gate,
and both fall through to alternate sources when context7 is missing.

The duplication has already drifted:

- `code-researcher` falls through to `mcp__plugin_yellow-research_exa__get_code_context_exa` → `mcp__plugin_yellow-research_exa__web_search_exa` (full chain).
- `best-practices-researcher` falls through to built-in `WebSearch` only — no EXA tools are even in its `tools:` list (safe chain).
- The availability-check prose differs ("If ToolSearch cannot find …" vs. "Use ToolSearch to detect whether …").
- Citation format differs between the two agents.

Every future cross-cutting concern (rate limit handling, library disambiguation,
caching) will require touching both files independently. Eight more plugins
(yellow-debt, yellow-semgrep, yellow-codex, yellow-docs, yellow-review,
yellow-council, yellow-devin, yellow-browser-test) have agents that could
benefit and would compound the drift.

## Current State

- Brainstorm: `docs/brainstorms/2026-05-17-library-context-skill-brainstorm.md` (233 lines, complete)
- Research: `docs/research/cross-plugin-shared-skill-architecture-f.md`
- Solution doc: `docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md`
- Precedents: `plugins/yellow-core/skills/security-fencing/SKILL.md` (cross-plugin inline-copy pattern, sentinel `CRITICAL SECURITY RULES` matches 44 files); `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` (within-plugin `skills:` preload pattern)
- Validator: `scripts/validate-agent-authoring.js` enforces V1/V2/V3/V4/W1.5 + subagent-registry + BASH_SOURCE + skill-reference + `allowed-tools` rules; no sentinel-phrase rule exists yet
- Context7 published surface (2026-05-17): canonical tool names are `mcp__context7__resolve-library-id` and `mcp__context7__query-docs` (this repo's two agents already use `query-docs`; `get-library-docs` appears in older external docs); anonymous quota is a global 60 req/hr pool shared across all unauthenticated callers
- Open issue `anthropics/claude-code#15944` (cross-plugin `skills:` resolution) is closed "not planned" — confirmed via best-practices research; inline-copy is the only cross-plugin distribution mechanism

## Proposed Solution

A single canonical `plugins/yellow-research/skills/library-context/SKILL.md`
plus a sibling `reference.md` for implementer notes (separated so the SKILL.md
body stays small enough to preload via `skills:` frontmatter without
ballooning every spawn).

<!-- deepen-plan: codebase -->
> **Codebase:** SKILL.md + sibling-file pattern is well-established. Seven
> skills already ship this way: `yellow-ci/skills/ci-conventions/` (3 refs),
> `yellow-core/skills/create-agent-skills/`, `yellow-core/skills/git-worktree/`,
> `yellow-core/skills/optimize/`, `yellow-devin/skills/devin-workflows/`,
> `yellow-review/skills/pr-review-workflow/`, `yellow-semgrep/skills/semgrep-conventions/`.
> All link via prose "load on demand" (`Read references/X.md` or markdown
> link) — siblings are NEVER auto-loaded by `skills:` preload, only the
> SKILL.md body is. Use a `## References` (or `## When to Load Reference`)
> section in SKILL.md that explicitly tells the agent when to `Read reference.md`.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** `skills:` + `mcp__*` co-existence is the dominant pattern, not
> a novel risk. Confirmed precedents: `yellow-semgrep/agents/semgrep/finding-fixer.md`,
> `yellow-semgrep/agents/semgrep/scan-verifier.md`, `yellow-ruvector/agents/ruvector/semantic-search.md`,
> `yellow-ruvector/agents/ruvector/memory-manager.md`, `yellow-mempalace/agents/mempalace/memory-archivist.md`
> (9 MCP tools + 2 skills), `yellow-linear/agents/research/linear-explorer.md`
> (5 MCP tools). `ruvector-conventions/SKILL.md:27` even hardcodes
> `mcp__plugin_yellow-ruvector_ruvector__<tool_name>` in skill body — same
> pattern `library-context` will use. No empirical risk to flag.
<!-- /deepen-plan -->

The SKILL.md owns:

- Context7 availability detection via ToolSearch (two candidate tool names,
  verify before hardcoding)
- Two-step invocation contract (`resolve-library-id` → `query-docs`; never
  call `query-docs` with a plain library name)
- Two published fallback chains:
  - **Within yellow-research (full):** context7 → `mcp__plugin_yellow-research_exa__get_code_context_exa` → `mcp__plugin_yellow-research_exa__web_search_exa` → built-in `WebSearch`
  - **Cross-plugin (safe):** context7 → built-in `WebSearch`
- Disambiguation rule when `resolve-library-id` returns multiple candidates
- Rate-limit vs. unavailable vs. private-library distinction
- Citation format: `[<library>@<version> via context7]` / `[exa: <url>]` / `[web: <url>]`
- Drift sentinel phrase that every inlined copy must contain (Unicode em dash, U+2014, NOT two hyphens)
- Cache-compatible Step 1 wording (named step boundary; no contract design — future hook PR defines its own keying/TTL)
- Explicit non-redundancy directive: agents that preload via `skills:` must
  remove their inline context7 prose (no dual instructions)
- Reference to the security-fencing SKILL.md for treating `query-docs`
  responses as untrusted content

The sibling `reference.md` owns:

- Distribution model rationale (why inline-copy for cross-plugin; why
  `skills:` for within-yellow-research)
- Consumer enumeration (current + opt-in roadmap)
- RULE 13 tracking — exact grep one-liner the future lint must use, with
  Unicode codepoint note
- Stale-figure clarifications (security-fencing currently matches 44 files,
  not the brainstorm's "34 in 5 plugins")

Within yellow-research, `code-researcher.md` preloads the skill via
`skills: [library-context]` frontmatter; its inline context7/fallback prose is
removed (the SKILL.md content is injected at spawn — duplication would create
conflicting instructions).

For the only cross-plugin consumer in this initial PR
(`plugins/yellow-core/agents/research/best-practices-researcher.md`), the
safe-chain block is inlined verbatim — `anthropics/claude-code#15944` is
closed "not planned," so cross-plugin `skills:` preload is unavailable.

The eight other candidate plugins are opt-in follow-up; this PR ships only
the SKILL.md and the two initial consumers.

## Implementation Plan

### Phase 1: Skill scaffold

- [ ] 1.1 Create `plugins/yellow-research/skills/library-context/SKILL.md` with frontmatter (`name: library-context`, `user-invokable: true`, single-line `description:` containing a "Use when" clause, no `disable-model-invocation` field — setting it true would silently block `skills:` preload)
- [ ] 1.2 Author the three standard sections: `## What It Does` (≤6 lines), `## When to Use` (decision rules + non-use cases), `## Usage` (numbered runtime steps + chain variants + disambiguation rule + citation format + sentinel phrase + cache-compatibility wording)
- [ ] 1.3 Verify SKILL.md body stays ≤120 lines so `skills:` preload remains lightweight; if the runtime content exceeds that, move examples to `reference.md`

<!-- deepen-plan: codebase -->
> **Codebase:** No SKILL.md in this repo currently hits a 120-line target.
> Existing SKILL.md sizes for skills with sibling files: ci-conventions 131,
> devin-workflows 226, semgrep-conventions 238, pr-review-workflow 348,
> git-worktree 440, optimize 461, create-agent-skills 513. The validator does
> NOT enforce line count. Treat 120 as an aspirational design target, not a
> pass/fail acceptance gate. A SKILL.md that genuinely needs 180-220 lines for
> clear runtime instructions is fine — the discipline is "move non-runtime
> reference content out," not "hit a magic line count."
<!-- /deepen-plan -->
- [ ] 1.4 Create `plugins/yellow-research/skills/library-context/reference.md` with distribution rationale, consumer enumeration, RULE 13 grep + Unicode codepoint note, and stale-figure clarifications
- [ ] 1.5 Confirm both candidate context7 tool names appear in SKILL.md: `mcp__context7__query-docs` (current, used in this repo) and `mcp__context7__get-library-docs` (legacy, seen in external docs); include ToolSearch verification instruction

### Phase 2: Refactor within-plugin consumer

- [ ] 2.1 Add `skills:` frontmatter to `plugins/yellow-research/agents/research/code-researcher.md`: `skills: [library-context]`
- [ ] 2.2 Remove the inline context7/fallback prose from `code-researcher.md`'s "Source Routing" section (the SKILL.md content is injected at spawn — keeping both creates conflicting instructions)

<!-- deepen-plan: codebase -->
> **Codebase:** Exact prose to remove is `code-researcher.md` lines 42–51 on
> main — the "**Start with Context7** for any named library…" paragraph
> through "…use `mcp__plugin_yellow-research_exa__web_search_exa` as last
> resort." Implementer must also decide what to do with the "Source Routing"
> table at lines 30–40, specifically the `| Library/framework docs | mcp__context7__resolve-library-id → mcp__context7__query-docs ...|`
> row — leaving it inline contradicts the skill's routing. Recommend:
> rephrase that row to `| Library/framework docs | preloaded via library-context skill |`
> so the table still indexes the routing concern without duplicating chain detail.
<!-- /deepen-plan -->
- [ ] 2.3 Leave the `mcp__context7__*` entries in the agent's `tools:` list untouched — the SKILL.md body must only reference tools already in the agent's tool list, but the agent still needs them to execute
- [ ] 2.4 Confirm `validate-agent-authoring.js` skill-reference rule passes for the agent (the rule requires that backtick-wrapped skill name mentions in the body have a matching `skills:` preload — adding `library-context` to `skills:` satisfies this)

<!-- deepen-plan: codebase -->
> **Codebase:** Rule lives at `scripts/validate-agent-authoring.js:210` —
> regex `` /`([a-z0-9][a-z0-9-]*)`\s+skill\b/gi ``. It only fires when an
> agent body contains a backtick-wrapped name followed by the literal word
> "skill" (e.g., `` `library-context` skill ``). `code-researcher.md`
> currently has NO such backtick-skill mention in body prose, so the rule
> will not fire either way. Task 2.4 is effectively a no-op gate for this
> agent — not a meaningful pass/fail check. Consider dropping it or
> reframing as "spot-check `validate:schemas` passes after the refactor."
<!-- /deepen-plan -->
- [ ] 2.5 Verify the agent's chain prose, where retained, still aligns with the SKILL.md (no contradictions; if any prose stays in the agent, it should defer to the skill)

### Phase 3: Refactor cross-plugin consumer

- [ ] 3.1 Read the "Cross-plugin safe chain" block from the SKILL.md verbatim
- [ ] 3.2 Replace the existing context7 block in `plugins/yellow-core/agents/research/best-practices-researcher.md`'s "Phase 1: Curated Knowledge Check" section with the inlined safe-chain block

<!-- deepen-plan: codebase -->
> **Codebase:** Phase 1 on main spans lines 58–68 and contains THREE items,
> not one. Item 1 is the context7 availability + fall-through prose (the
> target of this replacement). Items 2 (`**Query Format:**`) and 3
> (`**Priority Sources:**`) are generic research-quality guidance and are
> NOT context7-specific. Decision needed: keep items 2 and 3 as siblings to
> the inlined block, merge them into the new block as post-context7 prose,
> or drop them entirely. Recommend: keep items 2 and 3 as-is below the
> inlined block — they describe how to phrase queries and which sources to
> prefer, which the inlined block does not cover.
<!-- /deepen-plan -->
- [ ] 3.3 Confirm the inlined block contains the exact sentinel `context7 unavailable — falling back to` (em dash U+2014, not hyphens)
- [ ] 3.4 Confirm the inlined block references ONLY context7 + built-in `WebSearch` — NO `mcp__plugin_yellow-research_*` tools (yellow-core does not declare yellow-research as a dependency; the safe chain protects consumers without yellow-research installed)
- [ ] 3.5 Add a one-line "Inlined from yellow-research:library-context — keep in sync; verified <date>" annotation above the block so future maintainers can trace the canonical source

<!-- deepen-plan: codebase -->
> **Codebase:** This "Inlined from … — keep in sync" annotation does not
> currently exist anywhere in the repo (`rg "Inlined from"` returns zero
> matches). It is a novel convention being introduced by this PR.
> `security-fencing` — the precedent we're following — does NOT use such
> annotations on its 44 inlined copies; consumers rely on the sentinel-phrase
> grep alone. Worth recording in `reference.md` as a new convention so
> future cross-plugin inliners adopt it consistently.
<!-- /deepen-plan -->

### Phase 4: Validation + changesets

- [ ] 4.1 Run `pnpm validate:schemas && pnpm validate:agents` — must pass with no new errors

<!-- deepen-plan: codebase -->
> **Codebase:** `pnpm validate:schemas` already chains
> `validate-agent-authoring.js` (per the script definition in `package.json`),
> so running `validate:schemas && validate:agents` runs agent authoring
> validation twice. Harmless but redundant. Simplify to `pnpm validate:schemas`
> alone, or keep both if you want explicit signal in the CI log.
<!-- /deepen-plan -->
- [ ] 4.2 Run `pnpm test:unit` — must pass
- [ ] 4.3 Run `pnpm lint && pnpm typecheck` — must pass
- [ ] 4.4 Run `pnpm validate:setup-all` — must pass (skills aren't listed in `setup:all.md` or `marketplace.json`, but verify no regression)
- [ ] 4.5 `pnpm changeset` — add **two** entries:
  - `yellow-research` minor (new skill + `code-researcher.md` refactor)
  - `yellow-core` minor (`best-practices-researcher.md` refactor)

<!-- deepen-plan: codebase -->
> **Codebase:** Pending changesets on this branch already touch both
> packages: `.changeset/multi-host-fleet-skill.md` is a yellow-core minor,
> and `.changeset/yellow-research-shell-dedup.md` is a yellow-research entry.
> Changesets accumulate cleanly (highest bump wins for the version), but the
> CHANGELOG entries appear separately under each release. Ensure the two new
> changeset summaries are distinct and meaningful so the released CHANGELOG
> reads as "added library-context skill" + "best-practices-researcher inlines
> library-context" rather than blending with the other pending entries.
<!-- /deepen-plan -->
- [ ] 4.6 Normalize LF endings on any new `.md` files created on WSL2: `sed -i 's/\r$//' <new-files>`
- [ ] 4.7 Confirm the sentinel grep returns ≥2 matches: `rg 'context7 unavailable — falling back to' plugins/` should hit the SKILL.md and `best-practices-researcher.md`
- [ ] 4.8 `gt commit create -m "feat(yellow-research): library-context skill + refactor 2 consumers"` then `gt stack submit`

### Phase 5: Follow-up tracking (not in this PR)

- [ ] 5.1 Open issue: "validate-agent-authoring.js RULE 13 — context7 drift-detection lint" referencing the grep one-liner in `reference.md`; should land within 2 PRs of this one, before any opt-in adoption PRs for the other 8 plugins
- [ ] 5.2 Open issue: "context7 cache hook" — the SessionStart hook deferred from Decision 4; cache contract (path, key format, TTL) defined by the hook PR, not pre-specified
- [ ] 5.3 Open issue: "library-context opt-in adoption" — track adoption for yellow-debt, yellow-semgrep, yellow-codex, yellow-docs, yellow-review, yellow-council, yellow-devin, yellow-browser-test

## Technical Details

### Files to create

- `plugins/yellow-research/skills/library-context/SKILL.md` (≤120 lines of runtime instructions)
- `plugins/yellow-research/skills/library-context/reference.md` (distribution rationale + RULE 13 + consumer enumeration)
- `.changeset/library-context-skill.md` (yellow-research minor)
- `.changeset/best-practices-researcher-inline.md` (yellow-core minor)

### Files to modify

- `plugins/yellow-research/agents/research/code-researcher.md` — add `skills: [library-context]` to frontmatter; remove inline context7 prose from "Source Routing" section
- `plugins/yellow-core/agents/research/best-practices-researcher.md` — replace "Phase 1: Curated Knowledge Check" context7 block with inlined safe-chain excerpt from SKILL.md

### Files NOT to modify

- `.claude-plugin/marketplace.json` — skills aren't listed in the catalog
- `plugins/yellow-core/commands/setup/all.md` — `setup:all` tracks plugins, not skills
- Any `plugin.json` — no new `mcpServers` entries (must NOT re-bundle context7 — CE PR #486 regression); no `commands:` or `skills:` schema changes
- The other 8 candidate plugins — opt-in adoption is follow-up work

### Tool surface (no new tools required)

Both refactored agents already have `mcp__context7__resolve-library-id`,
`mcp__context7__query-docs`, and `ToolSearch` in their `tools:` lists.
`code-researcher.md` also has both EXA tools. `best-practices-researcher.md`
already has built-in `WebSearch`. The SKILL.md must not introduce tool
references that aren't in the consumer's `tools:` list.

## Acceptance Criteria

1. `plugins/yellow-research/skills/library-context/SKILL.md` exists and parses with `name: library-context`, `user-invokable: true`, single-line `description:`, no `disable-model-invocation` field.
2. `pnpm validate:schemas && pnpm validate:agents` passes with no new errors.
3. `code-researcher.md` declares `skills: [library-context]` AND does NOT contain inline context7/fallback prose duplicating the SKILL.md (the `mcp__context7__*` tool names in `tools:` remain).
4. `best-practices-researcher.md` contains the exact sentinel `context7 unavailable — falling back to` (Unicode em dash U+2014).
5. `rg 'context7 unavailable — falling back to' plugins/` returns ≥2 matches (SKILL.md + `best-practices-researcher.md`).
6. The inlined block in `best-practices-researcher.md` references ONLY context7 and built-in `WebSearch` — no `mcp__plugin_yellow-research_*` tools.
7. SKILL.md uses the three standard headings (`## What It Does`, `## When to Use`, `## Usage`).
8. Two `.changeset/*.md` files exist: one minor for yellow-research, one minor for yellow-core; `pnpm validate:versions` passes.
9. SKILL.md names both context7 tool candidates (`query-docs` + `get-library-docs`) and instructs ToolSearch verification before hardcoding.
10. SKILL.md Step 1 is expressed as a named step boundary that accommodates a future cache hook (wording equivalent to "resolve library ID (from cache or via `resolve-library-id`)"); no cache file path, key format, or TTL is specified.
11. SKILL.md body keeps runtime instructions focused; non-runtime reference content lives in `reference.md` (distribution rationale + RULE 13 grep one-liner + consumer enumeration). Line count is a design target, not a validator gate — see deepen-plan annotation at task 1.3.
12. `pnpm validate:setup-all` passes (no marketplace or setup:all change required).
13. SKILL.md explicitly notes the sentinel phrase uses em dash U+2014 (not `--` or `-`).
14. The inlined block in `best-practices-researcher.md` has a "Inlined from yellow-research:library-context — keep in sync" annotation.

## Edge Cases (must appear in SKILL.md prose)

- **context7 installed but rate-limited (HTTP 429 or "rate limit" in error message):** treat as unavailable for this session; fall through; do NOT retry; emit `[library-context] context7 rate-limited (60 req/hr global anonymous pool) — falling back to <next>` (variant of the unavailability sentinel — drift detection should match both variants if RULE 13 lands).
- **`resolve-library-id` returns multiple candidates:** prefer exact-name match; if no exact match, pick the first result and annotate the citation with the matched slug (`[react@18.3.1 via context7 — matched /facebook/react]`); never prompt the user inline.
- **`resolve-library-id` returns zero results (private/internal library):** skip `query-docs` entirely; go directly to next fallback step; do NOT treat as an error.
- **Sub-agent spawned with restricted `tools:` that omits context7:** ToolSearch returns nothing → proceed silently to the next step → do NOT surface as an error; the SKILL.md must be explicit about this so restricted spawns don't emit misleading "context7 missing" errors.
- **All fallbacks exhausted (context7 unavailable + EXA error + WebSearch error):** stop and report `No documentation source available for <library>. Check network connectivity or install context7 at user level.`; never silently return empty output.
- **context7 returns results but none relevant to the query:** treat as "returns nothing useful" and fall through to the next step (same path as zero-result resolve).
- **`query-docs` response is untrusted external content:** SKILL.md must reference (not duplicate) the `security-fencing` skill's content-fencing rules before synthesizing context7 output.

## Known Limitations / Follow-Ups

- **RULE 13 drift-detection lint is deferred.** Without CI enforcement, the sentinel can silently drift on any future edit. The follow-up issue must land within 2 PRs to cover any opt-in adoption work. Template: ~15-20 lines in `validate-agent-authoring.js` following the W1.5 rule structure.
- **Cache hook deferred (Decision 4).** Step 1 is named for compatibility; cache contract (path, keying, TTL) defined by the future hook PR.
- **Opt-in adoption deferred.** Eight other plugins have candidate agents but adoption timing is not in scope.
- **Phase 0 glob in `best-practices-researcher` will discover the canonical SKILL.md at runtime AND the inlined copy in its own body.** The two paths must give identical safe-chain guidance. Drift between them is a latent consistency obligation; RULE 13 partially mitigates it.
- **`code-researcher` `skills:` preload cost.** Body injected at every `/research:code` spawn. The ≤120-line SKILL.md budget limits this to roughly 800-1,200 tokens per spawn — comparable to the current inline prose, with the bonus that the reference content stays out of the injection.
- **Three open questions from the brainstorm:**
  - Q1 (context7 tool name) — resolved: `query-docs` confirmed canonical; document both.
  - Q3 (`best-practices-researcher` chain) — resolved: safe chain matches current agent behavior.
  - Q2 (RULE 13 timing) and Q4 (citation format) — non-blocking; tracked in follow-ups above.

## References

- Brainstorm: `docs/brainstorms/2026-05-17-library-context-skill-brainstorm.md`
- Research: `docs/research/cross-plugin-shared-skill-architecture-f.md`
- Solution pattern: `docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md`
- Cross-plugin inline-copy precedent: `plugins/yellow-core/skills/security-fencing/SKILL.md`
- Within-plugin preload precedent: `plugins/yellow-review/skills/pr-review-workflow/SKILL.md`
- Skill authoring rules: `AGENTS.md` (lines 206-213), `CONTRIBUTING.md` (lines 90-91, 416-461)
- Validator template: `scripts/validate-agent-authoring.js` (W1.5 rule for RULE 13 structure)
- Context7 published surface: `https://glama.ai/mcp/servers/upstash/context7-mcp`; `https://deepwiki.com/upstash/context7/4.1-resolve-library-id-tool`
- Closed cross-plugin skills issue: `https://github.com/anthropics/claude-code/issues/15944`
- Context7 unbundling rationale: `plugins/yellow-core/CLAUDE.md` (CE PR #486, 2026-04-29)
