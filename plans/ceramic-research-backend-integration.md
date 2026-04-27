# Feature: Ceramic.ai as Default Research Backend

## Problem Statement

Today, all external research in `yellow-plugins` flows through three paid
search APIs (Perplexity, Tavily, EXA) plus one async deep-research provider
(Parallel Task), all wired in via MCP servers in
`plugins/yellow-research/.claude-plugin/plugin.json:21-67` and a single
agent in yellow-core that uses built-in `WebSearch`/`WebFetch`
(`plugins/yellow-core/agents/research/best-practices-researcher.md:7-9`).

<!-- deepen-plan: codebase -->
> **Codebase line-number drift (audit).** Several citations in this plan
> have drifted from `main` HEAD as of 2026-04-27. Fix when editing each
> file rather than batching:
> - `yellow-research/.claude-plugin/plugin.json:21-67` → `mcpServers`
>   actually opens at line 22 and closes at line 69.
> - `yellow-research/.claude-plugin/plugin.json:55-57` (`parallel` block)
>   → actually lines 55-58 (4 lines, the closing `}` was cut).
> - `yellow-core/.claude-plugin/plugin.json:14-17` (`context7` block) →
>   actually lines 21-25.
> - `research-conductor.md:97-101` (skip-source pattern) → actually
>   **lines 128-132** ("Skip any source that is unavailable…"). Lines
>   97-101 are inside the async-tool polling block.
> - `setup.md:226-251` (status decision tree) → actually 224-243 (8
>   lines tighter; 244-251 are the redaction warning).
> - `setup.md:262-330` (MCP source health) → actually 262-342.
> - `setup.md:404-415` (export block) → actually 403-416.
> - `setup.md` baseline length → 484 lines, not 470. +60 → 544 lines,
>   still under the 600-line extraction threshold.
> - `setup/all.md:254-269` (yellow-research classification) → 254-268.
> - `best-practices-researcher.md:7-9`, `setup/all.md:79-86`,
>   `AGENTS.md:108-109` — accurate.
<!-- /deepen-plan -->

We want **Ceramic.ai** as the default first-hop research backend because it
is high-capability and *significantly* cheaper than the existing providers
($0.05 per 1,000 queries — see `RESEARCH/02-ceramic-capabilities.md` §3).
This makes it the right fit for high-volume research calls.

## Current State

Phase 1–3 audit artifacts:

- `RESEARCH/01-plugin-inventory.md` — repo-wide audit; identifies
  yellow-research and yellow-core as the only external-research consumers.
- `RESEARCH/02-ceramic-capabilities.md` — Ceramic.ai contract verified by
  5 live probes; documents the lexical-vs-semantic distinction, the
  official HTTP MCP at `https://mcp.ceramic.ai/mcp`, and the documented
  RFC 7807 error model.
- `RESEARCH/03-integration-plan.md` — line-by-line diff plan; this file
  is its actionable distillation.

## Proposed Solution

**Declarative-first integration**, no new TypeScript module on the
critical path. Add one `mcpServers.ceramic` HTTP block to the two consumer
plugins, rewire their three agents to prefer Ceramic with explicit
fall-through, leave every prior backend declared so we can A/B and roll
back without code changes.

Key design decisions (operator-confirmed defaults from
`RESEARCH/03-integration-plan.md` §6):

1. **MCP-only path.** Optional shared TS client (`packages/ceramic`) is
   deferred — design spec lives in `RESEARCH/03 §1.B` for follow-up.

<!-- deepen-plan: external -->
> **Research:** Ceramic MCP authenticates via **OAuth 2.1**, not API
> key. Verified by inspecting `WWW-Authenticate` on a `POST` probe to
> `https://mcp.ceramic.ai/mcp` — the response is `401 Bearer
> error="unauthorized" … resource_metadata="https://mcp.ceramic.ai/.well-known/oauth-protected-resource"`,
> which is the standard MCP-spec OAuth 2.1 Protected Resource Metadata
> endpoint. The `mcpServers.ceramic` entry therefore needs no `env`
> block (and should not have one). The shape is identical to the
> existing `parallel` block in
> `plugins/yellow-research/.claude-plugin/plugin.json:55-58`:
> `{ "type": "http", "url": "https://mcp.ceramic.ai/mcp" }`.
> First session use will pop a browser for Ceramic login/consent —
> same UX as Parallel Task today. `CERAMIC_API_KEY` is still needed
> separately for the REST live-probe in `/research:setup`, but **not**
> for the MCP server. See MCP spec 2025-11-25 §authorization. — added
> 2026-04-27.
<!-- /deepen-plan -->
2. **First-hop with fallback** (not parallel A/B). Ceramic runs first;
   prior providers run only when Ceramic returns thin/irrelevant results
   or is unavailable. Existing skip-source pattern at
   `plugins/yellow-research/agents/research/research-conductor.md:97-101`
   handles graceful degradation already.

<!-- deepen-plan: codebase -->
> **Codebase:** Two corrections to this decision:
> 1. The skip-source pattern is at `research-conductor.md:128-132`,
>    not `:97-101` (drift noted above).
> 2. Existing degradation in the repo is **availability-based only**
>    ("if tool unavailable via ToolSearch, skip; if `task_id` is null,
>    skip the poll"). There is **no precedent** for a result-count
>    threshold like "if Ceramic returns ≤2 results, fall through to
>    Perplexity" — `code-researcher.md:94-96` has an "if no useful
>    results" pattern, but it's a terminal stop, not a fall-through.
>    The proposed result-count threshold here is novel; either invent
>    it deliberately (and document why) or simplify the fallback to
>    availability-based to match existing style.
<!-- /deepen-plan -->
3. **LLM-rewrite step in agent prose.** Each updated agent gets one
   sentence telling Claude to convert natural-language topics into
   keyword-style queries before calling Ceramic. Encodes the recipe at
   `https://docs.ceramic.ai/api/search/best-practices.md`. Probe 5
   (`RESEARCH/02 §6`) directly motivated this.

<!-- deepen-plan: codebase -->
> **Codebase:** No existing yellow-plugins agent performs an LLM
> query-rewrite step before tool calls. `research-conductor.md` passes
> the topic verbatim (lines 101-107); `code-researcher.md` routes by
> query type but does not rewrite the text; `best-practices-researcher.md`
> has no rewrite step. The proposed pattern is novel — there is no
> in-repo template to copy. Document the new prose pattern carefully
> so it can be reused if other agents adopt it later.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** This technique has canonical names — **"Query
> Rewriting"** (narrow), **"Query Transformations"** (LangChain
> umbrella), **"Multi-Query Retrieval"** (LangChain
> `MultiQueryRetriever`), **"Query Expansion"** (older IR term). All
> grep well in LangChain/LlamaIndex source. Empirical evidence
> (Elastic's lexical-search benchmark) shows a **separate explicit
> LLM round-trip outperforms inline chain-of-thought** on top-10
> recall. The advanced version generates 2-3 keyword variants per
> question, fans out parallel searches, and unions the result sets
> before deduplication. **Decision for this plan:** keep the simpler
> single-rewrite-then-search for v1 (matches Ceramic's own example
> prompt); log multi-query retrieval as a follow-up enhancement once
> we have A/B data. Sources: `langchain.com/blog/query-transformations`,
> `elastic.co/search-labs/blog/query-rewriting-llm-search-improve`. —
> added 2026-04-27.
<!-- /deepen-plan -->
4. **Single global env var** `CERAMIC_API_KEY` — mirrors the existing
   `PERPLEXITY_API_KEY`/`TAVILY_API_KEY`/`EXA_API_KEY` pattern. No per-
   plugin override.
5. **READMEs updated in the same PR.** Stale install instructions on day
   one are worse than a slightly larger diff.
6. **`/research:setup` growth is accepted in-line.** ~60 lines is
   tolerable; defer extraction until next setup edit if it crosses 600.

## Implementation Plan

### Phase 1: Verification (one probe)

- [ ] **1.1** Verify the Ceramic HTTP MCP accepts `Authorization` from
  the `mcpServers.ceramic.env` block. Drop the JSON block into a local
  `.claude/settings.local.json`, restart Claude Code, run
  `mcp__plugin_<scratch>_ceramic__ceramic_search` once with a trivial
  query, confirm HTTP 200. If 401, fall back to Open Question 2 of
  `RESEARCH/03 §6` (use SDK path or contact Ceramic).

<!-- deepen-plan: external -->
> **Research:** Task 1.1 is now mostly resolved by deepen-plan. A
> direct `curl -X POST https://mcp.ceramic.ai/mcp` (run 2026-04-27)
> returned `401` with a `WWW-Authenticate: Bearer …
> resource_metadata=".well-known/oauth-protected-resource"` header,
> confirming OAuth 2.1. The verification step now becomes:
> (a) install the simplified config (no `env` block, just `{type, url}`);
> (b) restart Claude Code; (c) confirm `ceramic_search` appears in
> ToolSearch results; (d) on first invocation, complete the browser
> OAuth handshake; (e) confirm a successful tool call. Failure modes
> reduce to "browser OAuth flow blocked" (rare in normal dev
> environments) rather than "env-forwarding doesn't work".
<!-- /deepen-plan -->

### Phase 2: yellow-research (primary migration)

- [ ] **2.1** Add `mcpServers.ceramic` block to
  `plugins/yellow-research/.claude-plugin/plugin.json` (after the
  `parallel` block at line 55).

<!-- deepen-plan: codebase -->
> **Codebase:** Insert after the `parallel` block which actually
> closes at line 58 (not 57). The new block must mirror `parallel`'s
> shape exactly — `{ "type": "http", "url": "https://mcp.ceramic.ai/mcp" }`
> — no `env` block, no `headers` block. The `parallel` block at
> `:55-58` is the canonical template (it also uses OAuth).
<!-- /deepen-plan -->
- [ ] **2.2** Update `agents/research/code-researcher.md`:
  - `tools:` add `mcp__plugin_yellow-research_ceramic__ceramic_search`
    (line 8-22 region).
  - Source Routing table at lines 25-45: add "General web (keyword-
    tight) → ceramic_search" row.
  - Fall-through chain at lines 47-54: insert Ceramic between Context7
    and EXA.
  - Add the LLM-rewrite prep sentence before the Ceramic call.
- [ ] **2.3** Update `agents/research/research-conductor.md`:
  - `tools:` add the same Ceramic tool (lines 8-34).
  - Triage ladder at lines 26-43: Ceramic becomes the lead source for
    Simple and Moderate tiers, joins Complex as a sixth parallel call.
  - Add the LLM-rewrite prep sentence.
  - Match the existing graceful-skip annotation pattern at lines 97-101.
<!-- deepen-plan: codebase -->
> **Codebase:** `code-researcher.md` line 17 already declares
> `mcp__plugin_yellow-research_perplexity__perplexity_search` as the
> "Recent releases, new APIs" routing target. Insert the new Ceramic
> row at the **top** of the routing table at lines 31-38 (above
> Context7), since Ceramic is the new general-web first hop. The
> SKILL.md source matrix to update is at `skills/research-patterns/SKILL.md:63-72`.
<!-- /deepen-plan -->

- [ ] **2.4** Update `commands/research/setup.md`:
  - `CERAMIC_API_KEY` set/format check alongside existing five at lines
    80-160.
  - Optional live probe with the same 5-second curl pattern as EXA at
    lines 177-200 (`POST /search` with `{"query":"test"}`).
  - MCP source health row at lines 262-330.
  - Dashboard row at lines 360-385 (note: Ceramic is API-key-based, so
    it goes in the "API Keys" subtable not the "MCP Sources" subtable).
  - Setup-instructions block update at lines 404-415.
- [ ] **2.5** Update `commands/research/code.md` and
  `commands/research/deep.md` `allowed-tools:` lists with the new MCP
  tool name (one line each).
- [ ] **2.6** Update `skills/research-patterns/SKILL.md` source matrix.
  Important: do **not** introduce another multi-line description — see
  `RESEARCH/01 §4` gap 1.
- [ ] **2.7** Update `plugins/yellow-research/CLAUDE.md`: add Ceramic to
  the API-key setup section.
- [ ] **2.8** Update `plugins/yellow-research/README.md` install
  instructions to mention `CERAMIC_API_KEY`.

### Phase 3: yellow-core (secondary migration)

- [ ] **3.1** Add `mcpServers.ceramic` block to
  `plugins/yellow-core/.claude-plugin/plugin.json` (after the existing
  `context7` block at lines 14-17). Note: this becomes yellow-core's
  second MCP entry.

<!-- deepen-plan: codebase -->
> **Codebase:** The `context7` block is actually at lines **21-25**,
> not 14-17. The new `ceramic` entry uses the same shape as both
> existing HTTP MCPs in the repo (parallel, context7) — no `env`
> block (per the OAuth finding above).
<!-- /deepen-plan -->
- [ ] **3.2** Update `agents/research/best-practices-researcher.md`:
  - `tools:` add `mcp__plugin_yellow-core_ceramic__ceramic_search`
    (line 7-14 region).
  - Workflow at lines 35-43: "Phase 2: Research & Synthesis" leads with
    Ceramic, falls back to `WebSearch`.
  - Research Tools section at lines 95-103: replace "Web Search
    (Tavily/Perplexity)" reference at line 114 with "Web Search
    (Ceramic, fallback to WebSearch)".
  - `WebFetch` stays primary for single-URL content fetches — Ceramic
    has no fetch endpoint.
  - Add the LLM-rewrite prep sentence.
- [ ] **3.3** Update `plugins/yellow-core/CLAUDE.md` — note that
  `best-practices-researcher` honours `CERAMIC_API_KEY`.
- [ ] **3.4** Update `commands/setup/all.md`:
  - Lines 79-86: add `CERAMIC_API_KEY` set/NOT-SET probe.
  - Lines 254-269: update yellow-research classification block to "6
    bundled sources" with Ceramic as point 6, adjust READY/PARTIAL/
    NEEDS-SETUP thresholds accordingly.

### Phase 4: Cross-plugin coordination

- [ ] **4.1** Append `CERAMIC_API_KEY` to the never-commit list in
  `AGENTS.md:108-109` (alongside the existing four entries).
- [ ] **4.2** Update root `README.md` to mention Ceramic in the
  yellow-research feature list.
- [ ] **4.3** Optional (cosmetic): mention Ceramic in
  `.claude-plugin/marketplace.json` description for yellow-research.

### Phase 5: Quality

- [ ] **5.1** Add `tests/integration/ceramic.test.ts` (the
  `tests/integration/` dir is currently empty per `RESEARCH/01 §4` gap
  7). Vitest test gated on `RUN_LIVE=1` AND `CERAMIC_API_KEY`. One
  positive test (Phase 2 Probe 1 query: `"California rental laws"`,
  assert `result.totalResults > 0`); one negative test (`CERAMIC_API_KEY=`
  empty → assert agent skip behavior).
- [ ] **5.2** Run `pnpm validate:schemas` — must pass after manifest
  edits.
- [ ] **5.3** Run `pnpm validate:setup-all` — must pass after the
  setup/all.md classification edits.
- [ ] **5.4** Run `pnpm validate:agents` — must pass after agent
  frontmatter edits.
- [ ] **5.5** Add a `.changeset/<auto>.md` entry at `minor` for both
  yellow-research and yellow-core.
- [ ] **5.6** Manual smoke: `/research:setup` shows new Ceramic row
  ACTIVE; `/research:code` and `/research:deep` use the new tool first
  on a test query.

### Phase 6: Submit

- [ ] **6.1** Commit-by-commit per the Phase 4 brief. Conventional
  commits — `feat(yellow-research): add Ceramic MCP backend` etc. One
  logical change per commit.
- [ ] **6.2** Open a **draft** PR on branch `ceramic-integration`.
  Title `feat: Ceramic.ai as default research backend`. PR body
  enumerates touched files (see Technical Details below) and the
  validation commands run.
- [ ] **6.3** Do not merge, do not force-push, do not modify any branch
  other than `ceramic-integration`.

## Technical Details

### Files to modify (13)

```
M  AGENTS.md                                                            (+1)
M  README.md                                                            (~3)
M  plugins/yellow-core/.claude-plugin/plugin.json                       (+6)
M  plugins/yellow-core/CLAUDE.md                                        (+5)
M  plugins/yellow-core/agents/research/best-practices-researcher.md     (+13)
M  plugins/yellow-core/commands/setup/all.md                            (+10)
M  plugins/yellow-research/.claude-plugin/plugin.json                   (+6)
M  plugins/yellow-research/CLAUDE.md                                    (+8)
M  plugins/yellow-research/README.md                                    (~3)
M  plugins/yellow-research/agents/research/code-researcher.md           (+14)
M  plugins/yellow-research/agents/research/research-conductor.md        (+27)
M  plugins/yellow-research/commands/research/code.md                    (+1)
M  plugins/yellow-research/commands/research/deep.md                    (+1)
M  plugins/yellow-research/commands/research/setup.md                   (+60)
M  plugins/yellow-research/skills/research-patterns/SKILL.md            (+5)
```

### Files to create

```
A  tests/integration/ceramic.test.ts                                    (~30)
A  .changeset/<auto>.md                                                 (~5)
```

Total: ~165 lines added, ~6 lines edited.

### Dependencies

None. The integration is one HTTP MCP block; no new npm or pip packages
ship with the migrated plugins. (Optional `packages/ceramic` is deferred
per `RESEARCH/03 §1.B`.)

### Config changes

Single new env var: `CERAMIC_API_KEY`. Documented in
`plugins/yellow-research/CLAUDE.md`, `plugins/yellow-core/CLAUDE.md`,
and the root `AGENTS.md` never-commit list.

## Acceptance Criteria

1. **Verified MCP integration.** `mcp__plugin_yellow-research_ceramic__ceramic_search` and `mcp__plugin_yellow-core_ceramic__ceramic_search` both return HTTP 200 for a smoke query when `CERAMIC_API_KEY` is set. Verified via `/research:setup` showing `Ceramic | ACTIVE` in the dashboard and via the `RUN_LIVE=1` integration test.
2. **Graceful degradation preserved.** With `CERAMIC_API_KEY` unset, `/research:code` and `/research:deep` complete successfully using the existing Perplexity/Tavily/EXA chain. No agent throws, no command exits non-zero.
3. **Prior backends untouched.** `pnpm validate:schemas`, `pnpm validate:setup-all`, `pnpm validate:agents` all pass. The `mcpServers.{perplexity,tavily,exa,parallel,ast-grep}` entries in yellow-research and the `mcpServers.context7` entry in yellow-core are byte-identical to `main`.
4. **Rollback works.** Deleting the `mcpServers.ceramic` block from either plugin's `plugin.json` and restarting Claude Code returns the agent surface to current `main` behavior.
5. **README accuracy.** Both `README.md` files document `CERAMIC_API_KEY` as the new optional env var; install steps reference it.
6. **No silent doc drift.** `AGENTS.md:108-109` lists `CERAMIC_API_KEY` alongside the existing four secrets.

## Edge Cases

- **Ceramic returns ≤2 results on a Simple-tier query.** Agent prose
  must explicitly fall through to Perplexity rather than returning a
  thin answer. Mirrors `research-conductor.md:97-101` skip-source
  pattern.
- **Natural-language query bypassed the rewrite step.** Probe 5 showed
  this produces lexically diluted results. The agent prose is the only
  guard; if the LLM skips the rewrite, the result quality drops but
  nothing fails. Acceptable — fallback chain catches it.
- **`CERAMIC_API_KEY` is set but invalid.** `/research:setup` Step 3
  pattern at `setup.md:226-251` already maps 401 → `INVALID`, 429 →
  `RATE LIMITED`, etc. Reuse verbatim for the new probe.
- **Ceramic MCP HTTP server unreachable** (network outage, regional
  block). ToolSearch will not surface the tool; existing skip-source
  logic kicks in.
- **HTTP MCP `env` forwarding doesn't work** (Phase 1 verification
  fails). Fall back to either (a) the SDK-based shared client from
  `RESEARCH/03 §1.B`, or (b) ask Ceramic for the documented header
  convention. Either path adds ~150 lines (the deferred TS package) to
  this PR.

<!-- deepen-plan: external -->
> **Research:** This edge case is now obsolete. OAuth 2.1 was
> confirmed conclusively (see Proposed Solution annotations). There
> is no `env` block to fail. Replacement edge case: **OAuth browser
> flow is blocked** (e.g., headless CI, sandboxed environment without
> browser access). Mitigation: in CI / headless contexts, agents
> simply don't have Ceramic available — the existing skip-source
> pattern (now correctly cited at `research-conductor.md:128-132`)
> handles it. The deferred SDK path (`RESEARCH/03 §1.B`) becomes
> useful for *programmatic* contexts (vitest integration tests, CI
> scripts) where OAuth flow isn't viable; for those we'd use direct
> REST + `CERAMIC_API_KEY`.
<!-- /deepen-plan -->
- **Setup command growth.** `commands/research/setup.md` currently 470
  lines (per `RESEARCH/01 §3.6`); +60 = 530. Below the 600-line
  extraction threshold. Re-evaluate on next edit.

<!-- deepen-plan: codebase -->
> **Codebase:** Actual baseline is 484 lines, not 470. +60 → 544 lines.
> Still under the 600-line threshold. Decision unchanged.
<!-- /deepen-plan -->
- **Cross-plugin tool name confusion.** Two plugins surface the same
  upstream tool under different names (`mcp__plugin_yellow-research_ceramic__ceramic_search` vs `mcp__plugin_yellow-core_ceramic__ceramic_search`). This is fine — the same pattern exists today for `mcp__grep__searchGitHub` (used across multiple plugins).

## References

- `RESEARCH/01-plugin-inventory.md` — repo audit (line-cited).
- `RESEARCH/02-ceramic-capabilities.md` — Ceramic contract + probe log.
- `RESEARCH/03-integration-plan.md` — full line-by-line diff plan.
- `https://docs.ceramic.ai/api-reference/search.md` — request/response shape.
- `https://docs.ceramic.ai/api-reference/error-codes.md` — error model.
- `https://docs.ceramic.ai/admin/rate-limits.md` — QPS tiers.
- `https://docs.ceramic.ai/mcp/ceramic-mcp.md` — MCP server URL + tool name.
- `https://docs.ceramic.ai/api/search/best-practices.md` — lexical-search
  best practices including the LLM-rewrite recipe.

<!-- deepen-plan: external -->
> **Research:** Additional references added by deepen-plan (2026-04-27):
> - `https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization`
>   — MCP spec mandate for OAuth 2.1 on HTTP transport.
> - `https://www.langchain.com/blog/query-transformations` — canonical
>   "Query Transformations" / `MultiQueryRetriever` reference.
> - `https://www.elastic.co/search-labs/blog/query-rewriting-llm-search-improve`
>   — empirical evidence that separate rewrite calls outperform inline
>   chain-of-thought for lexical search.
> - `https://docs.parallel.ai/integrations/mcp/task-mcp` — Parallel Task
>   MCP, the closest UX precedent for OAuth-only MCP integration in the
>   yellow-plugins repo.
> - `https://www.npmjs.com/package/mcp-remote` — `mcp-remote` proxy
>   used by Claude Desktop free-plan to convert HTTP MCP to stdio with
>   OAuth flow.
<!-- /deepen-plan -->
- Existing patterns in repo:
  - `plugins/yellow-research/.claude-plugin/plugin.json:55-57` —
    parallel HTTP MCP entry shape (template for ceramic block).
  - `plugins/yellow-research/commands/research/setup.md:177-200` —
    EXA live-probe pattern (template for Ceramic probe).
  - `plugins/yellow-research/agents/research/research-conductor.md:97-101`
    — skip-source-on-unavailable pattern.
- `AGENTS.md:108-109` — never-commit secrets list (target for the
  `CERAMIC_API_KEY` append).
