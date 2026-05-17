# Cross-plugin shared skill architecture for context7

**Date:** 2026-05-17
**Sources:** Perplexity (deep research), Tavily (deep research + web search), EXA (deep researcher pro), GitHub code search (mcp__grep__searchGitHub), repo-local file reads (yellow-research/agents/research/code-researcher.md, yellow-core/agents/research/best-practices-researcher.md, yellow-core/skills/mcp-integration-patterns/SKILL.md, yellow-core/skills/security-fencing/SKILL.md, yellow-core/skills/session-history/SKILL.md, yellow-core/skills/create-agent-skills/SKILL.md, yellow-research/skills/research-patterns/SKILL.md, yellow-core/CLAUDE.md, yellow-research/CLAUDE.md)

---

## Executive summary

Claude Code's `skills:` frontmatter is strictly plugin-scoped — no native cross-plugin skill resolution exists and the upstream feature request (anthropics/claude-code#15944) was closed as "not planned." The only runtime mechanism that reliably crosses plugin boundaries is the `Task` tool (subagent spawn) or the `Skill` tool with a fully-qualified invocation, both of which require the consuming agent to spell out the exact `subagent_type` or skill path. This repo already has a working precedent for the problem in yellow-core's `security-fencing` skill, which documents itself as "a documentation skill, not an agent-injection skill" precisely because inlining wins over `skills:` injection until scale justifies the migration cost. The same rationale applies to `library-context`: the canonical skill body should live in yellow-research (domain owner), be documented via SKILL.md as the single source of truth, and be propagated to each consumer plugin as an inlined block — with a ToolSearch-gated fallback chain already established by the two existing consumers serving as the template.

---

## Research question 1: Cross-plugin shared-skill patterns

### Findings

**Platform constraint (confirmed):** Claude Code's `skills:` frontmatter field resolves only within the same plugin. The feature request for namespaced cross-plugin references (e.g., `plugin-b:external-skill`) was filed as anthropics/claude-code#15944 and closed as not planned. This is not a bug or gap that will be filled soon — it is an intentional isolation boundary. (Source: Perplexity deep research, EXA deep research, Tavily research synthesis)

**The three patterns the ecosystem has converged on:**

1. **Inline replication with a canonical source of truth.** The skill body is inlined verbatim into each consuming agent, but there is one authoritative SKILL.md that documents what the inlined block should contain. Changes flow from the canonical file outward via manual propagation (enforced by a machine-verifiable grep). This is exactly what `security-fencing` does across 34 agents in 5 plugins. The skill file itself notes: "agents typically include this content inline until skill-injection behavior is verified at scale." Repo-confirmed.

2. **ToolSearch-based runtime detection.** Instead of static skill injection, agents call `ToolSearch` at runtime to discover whether an optional MCP tool is present, then branch accordingly. This is what `code-researcher` and `best-practices-researcher` already do with context7. The pattern is: `ToolSearch("resolve-library-id")` → if found, use context7 tools; else skip to EXA fallback. This is the de facto standard for optional MCP wrappers in this repo. Repo-confirmed.

3. **Shared plugin as a utility dependency.** Some communities package shared utility skills into a standalone "common-skills" plugin that other plugins declare as a dependency and invoke via `Skill(plugin:name)` or Task. This is viable but creates an install dependency and requires users to have both plugins. The yellow-plugins marketplace already practices a lighter version: yellow-core's `best-practices-researcher` detects yellow-research's Ceramic tool via ToolSearch and falls back to WebSearch when absent. (Source: EXA deep research, Tavily research)

**Analogous patterns in other extension systems:**

- **VS Code extensions:** Extensions can declare `extensionDependencies` in `package.json` and import APIs from each other through explicit `vscode.extensions.getExtension()` calls. This is the mature version of Pattern 3, but it requires install-time coupling. (Source: Perplexity, Tavily)
- **GitHub Actions composite actions:** Shared logic is packaged as a reusable composite action. Consumers reference it with `uses: org/action@v1`. This is Pattern 2 in spirit — discovery is static (explicit reference in workflow YAML) not dynamic. (Source: Perplexity, Tavily)
- **Helm sub-charts:** Sub-charts are standalone but cannot access parent values by default — parent must explicitly pass them. This reinforces the isolation-first model that Claude Code follows. Global values in Helm (`Values.global`) are the closest analogue to a shared "canonical block" — available to all charts in a dependency tree but requiring explicit opt-in. (Source: Perplexity, Tavily)

**Key difference from VS Code/GitHub Actions:** Those systems have first-class dependency declaration and version management. Claude Code plugin dependencies exist (per `code.claude.com/docs/en/plugin-dependencies`) but the skill resolver does not follow dependency edges — only local plugin skills are visible at frontmatter resolution time. This makes Pattern 1 (inline with canonical source) lower friction than Pattern 3 (dependency install) for a skill that is small and self-contained.

**What the `security-fencing` precedent proves:** The repo has already solved this exact problem for a 180-token block (security-fencing) that is needed in 34 agents across 5 plugins. The chosen architecture: one authoritative SKILL.md in yellow-core, a machine-verifiable one-liner to detect drift, and inlined copies in every consumer. No `skills:` frontmatter injection. The SKILL.md explicitly defers the migration to `skills:` injection until (a) deduplication behavior is verified, (b) GitHub Issue #21891 ships or cost is confirmed acceptable, and (c) a lint rule catches drift. This is the closest repo precedent for the library-context problem.

### Sources

- Repo file: `plugins/yellow-core/skills/security-fencing/SKILL.md` — canonical inline-vs-injection rationale
- Repo file: `plugins/yellow-core/skills/create-agent-skills/SKILL.md` — skill frontmatter field catalog
- EXA deep research: cross-plugin skill sharing patterns, GitHub issue #15944 reference
- Perplexity deep research: VS Code, GitHub Actions, Helm analogues
- Tavily: plugin dependency documentation, marketplace mechanics

---

## Research question 2: MCP tool wrapping + fallback chain best practices

### Findings

**The established repo pattern (ToolSearch → use → fallback):**

The two existing context7 consumers in this repo implement an identical three-step pattern:

```
1. ToolSearch("resolve-library-id")
   → If found: use mcp__context7__resolve-library-id + mcp__context7__query-docs
   → If not found: skip directly to fallback (EXA get_code_context_exa)
2. If context7 returns no match: fall to mcp__plugin_yellow-research_exa__get_code_context_exa
3. If EXA returns nothing: fall to mcp__plugin_yellow-research_exa__web_search_exa
```

Both agents also annotate the fallback path for caller transparency (e.g., "[code-researcher] Ceramic unavailable — using EXA directly."). This is the established annotation convention for fallback paths in this repo.

**ToolSearch is the correct availability check, not a health endpoint:** Context7 is an optional user-level MCP. Its presence is determined by whether the tool descriptor is registered in Claude Code's MCP tool catalog. ToolSearch is a token-threshold-driven deferred loader — it returns descriptors only for registered tools. If context7 is not installed, ToolSearch returns nothing; if it is installed but not authenticated, ToolSearch may return the descriptor but the first tool call fails. The current pattern (ToolSearch check → attempt call → fallback on miss) handles both cases. (Source: repo files, Tavily research citing tessl.io/blog/anthropic-brings-mcp-tool-search, Perplexity)

**Annotation convention:** Every fallback path in this repo that deviates from primary source uses a bracketed component-prefix annotation: `[component-name] Source unavailable — using X instead.` This is present in code-researcher, best-practices-researcher, and the research-conductor agent. A library-context skill should follow the same pattern.

**Caching of resolved IDs:** Context7 requires a two-step call sequence: `resolve-library-id` first (to get a canonical library ID), then `query-docs` with that ID. The resolve step is the slower call (~2.5s median per EXA research). For agent workflows that query the same library multiple times in a session, the resolved ID can be stored in a shell variable within the same Bash block or passed in the Task input prompt — but cannot persist across Bash subprocesses in command files without re-derivation. (Source: EXA deep research, repo analysis of Bash-block isolation)

**Citation format normalization:** Both existing consumers synthesize inline without prescribing a citation format for the context7 result. A library-context skill should define a standard output contract: library name, version, doc URL (if available from context7 response), and summary paragraph. This normalization is missing from the two existing agents and represents a deduplication opportunity the shared skill can capture.

**Fallback chain for agents that do NOT have yellow-research installed:** The fallback from context7 currently points to `mcp__plugin_yellow-research_exa__get_code_context_exa`. This creates an implicit dependency on yellow-research for the EXA fallback. A cross-plugin shared skill must handle agents in plugins like yellow-debt or yellow-semgrep that may not have yellow-research installed. The safe fallback-of-last-resort is built-in `WebSearch` (always available to all agents) or a Perplexity tool if available. The skill should branch: context7 → (if yellow-research installed) EXA → WebSearch.

**How other communities structure MCP fallback chains:** The community pattern for optional MCP wrapping is:
- Use `try`/catch-equivalent in agent prose (i.e., explicit "if not found, proceed to next source" instructions)
- List the primary MCP tool in the agent's `tools:` frontmatter alongside a fallback tool
- Do NOT use `frontmatterFallbacks` or similar — no such field exists in Claude Code's schema (the EXA deep research example was speculative; the actual schema does not support it per yellow-plugins validate-plugin checks)

(Sources: repo files, Tavily research, EXA deep research)

### Sources

- Repo file: `plugins/yellow-research/agents/research/code-researcher.md` — canonical ToolSearch + fallback pattern
- Repo file: `plugins/yellow-core/agents/research/best-practices-researcher.md` — canonical ToolSearch + fallback pattern
- Repo file: `plugins/yellow-research/skills/research-patterns/SKILL.md` — source routing table
- Tavily web search: glama.ai/mcp/servers/@upstash/context7-mcp — context7 tool surface
- EXA deep research: ToolSearch mechanics, fallback chain patterns
- Perplexity deep research: graceful degradation and fail-open/closed semantics

---

## Research question 3: Context7 capabilities and limits

### Findings

**Tool surface (confirmed):** Context7 exposes exactly two MCP tools relevant to this use case:
- `resolve-library-id` — takes a library name string; returns a Context7-compatible library ID. Required first step before querying docs.
- `get-library-docs` (also seen as `query-docs` in some sources — the repo uses `mcp__context7__query-docs`) — takes the resolved library ID, a query string, and an optional token limit; returns version-specific documentation.

The Glama.ai documentation and the upstash/context7 GitHub repo confirm the two-tool surface. A third tool `search-libraries` appears in some third-party documentation but is not confirmed in the package's published MCP server schema. Always verify actual tool names after install via ToolSearch — LLM-generated names cannot be trusted (confirmed in yellow-research/CLAUDE.md conventions). (Source: Tavily web search citing glama.ai, upstash/context7 GitHub)

**Library coverage:** As of 2026, context7 indexes documentation for libraries across JavaScript/TypeScript, Python, Go, Java, Rust, and C# ecosystems. The upstash/context7 GitHub repo shows active maintenance through April 2026 (most recent commit in the commit log). Coverage is community-expandable via a self-serve portal at context7.com/add-package. (Source: Tavily web search, EXA deep research)

**Rate limits:** Context7 imposes rate limits that vary by API key tier. Without an API key: ~60 requests/minute per EXA research, with an API key: higher limits that scale per plan. The EXA research cites ~5 req/sec with a key. The Glama.ai documentation and Claude Code integration docs recommend passing the API key via header: `CONTEXT7_API_KEY: YOUR_API_KEY` for the remote HTTP transport, or `--api-key YOUR_API_KEY` for the local npx transport. For the user-level optional MCP pattern (install via `/plugin install context7@upstash`), this is handled at install time. (Source: Tavily web search, EXA deep research)

**Latency:** EXA research cites ~2.5s median for `resolve-library-id` and ~1.2s for `get-library-docs` after warm cache. These latencies are in the "acceptable for interactive" range for most agent workflows but should be noted in skill documentation so consumers can set expectations.

**Installation path (confirmed from this repo):** Context7 was previously bundled in yellow-core as an HTTP MCP server. It was removed in 2026-04-29 (CE PR #486) specifically because bundling caused dual-registration OAuth pop-ups when users also had context7 at user level. The current model is: install once at user level (`/plugin install context7@upstash` or Claude Code MCP settings UI); all agents that need it detect via ToolSearch. This history is directly relevant to the library-context skill architecture — it means any plugin that bundles context7 will recreate the original problem.

**GitHub code search evidence:** Searching GitHub for `context7 resolve-library-id` in Markdown files confirms that public Claude Code agent files reference context7 in two patterns:
1. Direct inline calls in agent bodies (most common — `bennycode/trading-signals`, `gsd-build/get-shit-done`, `torlando-tech/columba`)
2. Tiered research workflows where context7 is "Level 1 — Quick Verification" before longer discovery workflows

The `NagaAgent/apiserver/skills_templates/context7/SKILL.md` shows a community attempt at a context7 skill wrapper using `npx -y mcporter@latest call` as a CLI bridge — an unusual pattern not applicable to the Claude Code plugin model but confirming the demand for a reusable abstraction. (Source: GitHub code search results)

**Key gap:** No public plugin.json example wrapping context7 with ToolSearch-gated fallback was found in GitHub search results. The two authoritative examples are in this repo (code-researcher and best-practices-researcher). The shared skill would be a first-mover contribution to the ecosystem.

### Sources

- Tavily web search: upstash.com/blog/context7-mcp, glama.ai/mcp/servers/@upstash/context7-mcp, github.com/upstash/context7
- EXA deep research: context7 rate limits, latency, integration patterns
- Repo files: yellow-core/CLAUDE.md, yellow-research/CLAUDE.md — removal history and current install model
- GitHub code search: real-world agent files using context7 resolve-library-id

---

## Research question 4: Skill vs subagent vs sourced library

### Findings

**The three archetypes in this repo:**

The `create-agent-skills` SKILL.md in yellow-core provides the authoritative archetype table. The relevant comparison for a cross-plugin documentation-lookup concern:

| Abstraction | When to use | Overhead | Isolation |
|---|---|---|---|
| **Skill (inlined block)** | Stateless, deterministic lookup; inline result needed; no file write | Lowest (no spawn) | None — shares parent context |
| **Subagent (Task spawn)** | Long-running, resource-intensive, or requires separate tool whitelist | Highest (spawns new model instance) | Full — separate context window |
| **Sourced bash library** | Repeatable shell logic (validation, path canonicalization); no LLM reasoning | None (pure shell) | Process-level |

For context7 lookup specifically: the operation is a two-step MCP call (`resolve-library-id` → `get-library-docs`) followed by inline synthesis. It is stateless, fast (~2-4s total), and the result is consumed inline in the calling agent's context. **This is the ideal skill profile** — not a subagent, not a bash library.

The `mcp-integration-patterns` skill in yellow-core provides the analogous precedent: it is `user-invokable: false`, documented as "internal reference," and inlined verbatim by consumers. It uses exactly the same ToolSearch-then-fallback pattern that library-context would use.

**Where subagent wins:** If a future use case required context7 to query multiple libraries in parallel (e.g., resolving 5 libraries simultaneously during a research workflow), spawning a background subagent with `background: true` would isolate the parallel lookups from the calling agent's context budget. The `code-researcher` agent already notes "When looking up multiple libraries, start ALL Context7 resolve-library-id calls simultaneously" (seen in the GitHub bennycode/trading-signals DocsExplorer.md pattern). For the base case (single library lookup), this is overkill.

**Where a sourced bash library wins:** If the abstraction needed was pure ID normalization (e.g., `react` → `/react/react`) without a live MCP call, a bash function in a shared lib file would be cleaner. Context7 has its own resolution step, so this does not apply here.

**Evidence from analogous systems:**

- VS Code uses contribution points (declarative registration) for cross-cutting concerns that are discovery-driven, and explicit imports for logic that must execute inline. The context7 lookup is the latter — it needs to run in the agent's conversation thread and return content to that thread. Contribution points are not the right analogue.
- GitHub Actions composite actions are the closest analogue: a composite action wraps a fixed set of steps and can be referenced by any workflow. The equivalent here is the inlined skill block with ToolSearch-gated conditional execution.
- Helm sub-charts are state/config-oriented; not applicable to an MCP tool call.

**The session-history skill as a second repo precedent:** `yellow-core/skills/session-history/SKILL.md` is `user-invokable: true` and dispatches the `session-historian` subagent. It demonstrates the skill-as-orchestrator pattern where the skill body decides whether to spawn a Task. Library-context does not need this level of indirection for the common case — but the pattern is available if a multi-library parallel case is needed.

### Sources

- Repo file: `plugins/yellow-core/skills/create-agent-skills/SKILL.md` — archetype table
- Repo file: `plugins/yellow-core/skills/mcp-integration-patterns/SKILL.md` — ToolSearch-then-fallback precedent
- Repo file: `plugins/yellow-core/skills/session-history/SKILL.md` — skill-as-orchestrator pattern
- Perplexity deep research: skill vs subagent vs MCP server decision criteria
- Tavily research: VS Code, GitHub Actions, Helm comparative analysis
- EXA deep research: subagent isolation rationale

---

## Research question 5: Plugin home decision

### Findings

**The two candidate homes:**

| | yellow-research | yellow-core |
|---|---|---|
| Domain ownership | Owns context7 domain knowledge; both existing consumers are here or in yellow-core but reference yellow-research's EXA fallback | Hosts other cross-plugin shared utilities: `security-fencing`, `mcp-integration-patterns`, `session-history` |
| Consumer plugins | yellow-research agents use context7 now; non-research plugins (yellow-debt, yellow-docs) have no yellow-research dependency | All plugins effectively depend on yellow-core — it is the "toolkit" plugin |
| Install prevalence | yellow-research is optional (requires API keys, separate install) | yellow-core is the base plugin recommended for all users |
| Precedent for shared skills | No non-research-specific shared skills today | Three non-plugin-specific shared skills confirmed: `security-fencing`, `mcp-integration-patterns`, `mcp-integration-patterns` |
| Conflict with existing patterns | yellow-research already has the EXA fallback tools and the ToolSearch pattern | yellow-core previously bundled context7 and removed it explicitly (PR #486) — re-adding any context7 dependency to yellow-core risks confusion |

**The strongest arguments:**

For yellow-research: it is the domain owner. Both current consumers reference yellow-research's EXA tools as the fallback. A skill that wraps context7 and falls back to EXA is fundamentally a yellow-research skill — it composes yellow-research's own MCP tools. The skill content is identical to what `code-researcher` already contains inline.

For yellow-core: yellow-core hosts the existing shared-utility skills and has broader install prevalence. However, the CLAUDE.md explicitly notes that yellow-core no longer bundles any MCP servers, and the `best-practices-researcher` in yellow-core already uses ToolSearch to detect yellow-research's Ceramic tool rather than duplicating the MCP registration. This "yellow-core detects yellow-research tools at runtime" pattern is established.

**The decisive factor:** A library-context skill that falls back to `mcp__plugin_yellow-research_exa__get_code_context_exa` as its secondary source requires yellow-research to be installed for the fallback to work. If the skill lives in yellow-core, agents in plugins that install yellow-core but not yellow-research will have a partially non-functional fallback chain (ToolSearch won't find the EXA tool). If the skill lives in yellow-research, this dependency is natural — it is a yellow-research skill and the fallback works by definition.

**Resolution via the secondary fallback:** If the fallback chain is written as context7 → (if yellow-research installed, EXA) → (always available) WebSearch, then the skill can live in yellow-core with a degraded-but-functional behavior when yellow-research is absent. This is precisely the pattern yellow-core uses for Ceramic: "prefers Ceramic when yellow-research is installed, detected via ToolSearch, falls back to built-in WebSearch silently when yellow-research is absent."

**Analogous real-world precedents:** In VS Code, cross-cutting utility extensions (e.g., ESLint, language servers) are placed in the extension that owns the domain, not in a "utility" extension. The "utility extension" pattern is used for pure tooling (e.g., extension pack, common APIs). GitHub Actions places reusable workflows in the org that owns the domain knowledge, not in a generic "shared" repo unless the utility is truly domain-agnostic.

**Conclusion:** The weight of evidence favors yellow-research as the canonical home because the fallback chain depends on yellow-research's EXA tools. However, a clean multi-tier fallback (context7 → EXA if available → WebSearch) would make yellow-core viable as the home if broader install coverage is prioritized.

### Sources

- Repo files: yellow-core/CLAUDE.md, yellow-research/CLAUDE.md — install model, removal history, dependency detection patterns
- Repo file: yellow-core/agents/research/best-practices-researcher.md — "yellow-core detects yellow-research tools via ToolSearch" pattern
- Perplexity deep research: VS Code, GitHub Actions placement precedents
- EXA deep research: domain-home vs utility-home decision criteria

---

## Synthesis: recommended approach

### Which plugin homes the skill

**Primary recommendation: yellow-research, with cross-plugin documentation in yellow-core's `mcp-integration-patterns` skill.**

The canonical `library-context` skill lives at `plugins/yellow-research/skills/library-context/SKILL.md`. It is `user-invokable: false` (internal reference only) and documents the inlined block that every consuming agent should copy verbatim. yellow-research's EXA tools are the natural secondary fallback; the skill therefore requires yellow-research to be installed for full functionality.

Add a pointer in `yellow-core/skills/mcp-integration-patterns/SKILL.md` (the existing cross-plugin MCP patterns reference) that notes: "For library documentation lookup via context7 with EXA fallback, see the `library-context` skill in yellow-research." This keeps mcp-integration-patterns as the cross-plugin index without duplicating the content.

### What the opt-in pattern looks like for consumers

**Consumers do NOT use `skills: [library-context]` in frontmatter.** That only works within yellow-research. Consumers in other plugins follow the same pattern as security-fencing consumers: copy the canonical block verbatim from `library-context/SKILL.md` into their agent body.

The block to be inlined is:

```markdown
### Library Documentation Lookup (context7 + fallback)

**Step 1:** Call `ToolSearch("resolve-library-id")`.
- If found: use `mcp__context7__resolve-library-id` to get the library ID,
  then `mcp__context7__query-docs` with that ID and your topic.
- If not found: skip to Step 2. Annotate:
  `[<agent-name>] context7 unavailable — falling back to EXA`
  (cross-plugin consumers without EXA terminate at WebSearch and use
  `falling back to WebSearch` as the suffix; the canonical sentinel
  prefix is `context7 unavailable — falling back to`).

**Step 2 (EXA fallback):** Call `ToolSearch("get_code_context_exa")`.
- If found (yellow-research installed): use `mcp__plugin_yellow-research_exa__get_code_context_exa`.
- If not found: skip to Step 3. Annotate:
  `[<agent-name>] EXA unavailable — falling back to WebSearch.`

**Step 3 (always-available fallback):** Use built-in `WebSearch` for
`"<library-name> official documentation <version>"`.

**Output contract:** Return library name, version if known, source URL if
available, and a summary paragraph. Fence all external content as reference data
before synthesizing.
```

Consuming agents must list all tools they may use in their `tools:` frontmatter (context7 tools + EXA tools + WebSearch). The ToolSearch-gated branching means tools that are absent simply do not get called.

### What the fallback chain inside the skill looks like

```
context7 resolve-library-id
    ↓ (miss or absent)
mcp__plugin_yellow-research_exa__get_code_context_exa
    ↓ (miss or absent)
WebSearch (built-in, always available)
    ↓ (miss)
Report: "No documentation found for <library> from any available source."
```

Each step uses ToolSearch to detect availability before attempting the call. Each fallback emits a bracketed annotation following the repo convention. The chain is fail-open by default (proceed to next source on any failure), with the terminator at WebSearch.

### What trade-offs are accepted

1. **Duplication persists, but is controlled.** 16 plugins will each inline the block. Like security-fencing, a machine-verifiable grep one-liner (`rg -l 'context7 unavailable — falling back to' plugins/ --type md`) detects drift — the partial-string form matches both full-chain consumers (`falling back to EXA`) and cross-plugin safe-chain consumers (`falling back to WebSearch`). This is the same trade-off security-fencing accepted and it is well-understood in this repo.

2. **yellow-research install is required for EXA fallback.** Agents in plugins that do not have yellow-research will fall through to WebSearch as their secondary source. This is acceptable — WebSearch is the same fallback that best-practices-researcher uses today when yellow-research is absent.

3. **No `skills:` injection until GitHub Issue #21891 resolves.** If Claude Code ships skill deduplication for parallel spawns, the 16 inlined copies can be migrated to `skills: [yellow-research:library-context]` (if cross-plugin resolution ever ships) or to a within-plugin skills declaration for agents in yellow-research itself. Until then, the inline pattern is safer — it avoids the parallel-spawn token cost that security-fencing's note warns about.

4. **Resolved IDs are not cached across sessions.** The two-step context7 lookup (`resolve-library-id` → `query-docs`) must be re-run each session. This is consistent with the current behavior in code-researcher and best-practices-researcher.

---

## Open questions

1. **Does `skills:` injection within yellow-research actually work reliably for parallel-spawned agents?** The security-fencing skill cites GitHub Issue #21891 (skill deduplication in parallel spawns) as the reason not to use `skills:` injection yet. If this issue has resolved, agents within yellow-research could use `skills: [library-context]` directly instead of inlining. This should be tested empirically on a small sample before adopting for new consumers.

2. **What is the exact tool name — `query-docs` or `get-library-docs`?** Both names appear in different sources. `code-researcher.md` uses `mcp__context7__query-docs`; the Glama.ai documentation describes `get-library-docs`. The correct name must be verified via ToolSearch after context7 is installed at user level. The library-context skill should document which name was confirmed and when.

3. **Should the fallback for non-yellow-research plugins be `WebSearch` or `Perplexity`?** WebSearch is always available and requires no plugin. Perplexity (`mcp__plugin_yellow-research_perplexity__perplexity_search`) is higher-quality but requires yellow-research. The skill template currently proposes WebSearch as the universal fallback. If most target plugins are expected to have yellow-research installed (e.g., yellow-docs likely pairs with yellow-research), Perplexity could be Tier 2 with WebSearch as Tier 3.

4. **Should the 16 new consumers list context7 tools in their `tools:` frontmatter?** The current repo convention is that agents list all tools they may use. But context7 tools are user-level optional MCP — listing them in `tools:` means they appear in the tool whitelist even for users who haven't installed context7. This is consistent with how code-researcher handles it today (context7 tools listed, ToolSearch gates actual use), but the behavior for agents in yellow-debt or yellow-semgrep should be verified.

5. **Is there a drift-detection strategy beyond the grep one-liner?** The security-fencing skill uses a manual hand-maintained consumer list plus a grep count. For 34 consumers, drift is a real risk. A validate-agent-authoring.js rule that checks "any agent referencing `mcp__context7` must include the ToolSearch gate phrase" would be a more reliable CI-gated approach than a manual list. This is a new validator rule, not just a skill.

6. **Cross-plugin consumers via the Skill tool:** The EXA and Perplexity research note that the `Skill` tool can invoke skills from other plugins dynamically at runtime (e.g., `Skill(skill: "yellow-research:library-context")`). If Claude Code supports this invocation form, it would eliminate the need for inlining in some consumer patterns. This should be verified against the actual plugin.json schema and tested in the validator — the MEMORY.md notes that `Skill(skill: "review:resolve")` invokes the `resolve-pr.md` command by its `name:` value, which suggests dynamic skill invocation does work for same-plugin references. Cross-plugin Skill tool invocation needs empirical verification.
