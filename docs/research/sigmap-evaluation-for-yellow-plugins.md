# sigmap Evaluation for yellow-plugins Context Management

**Date:** 2026-05-08
**Recommendation:** Skip (with a narrow door left open for a lightweight MCP shim)

---

## TL;DR

Skip sigmap as a yellow-plugins plugin integration for now. It solves a real problem — token-efficient code-context injection — but that problem is addressed differently and more deeply by yellow-ruvector already. sigmap is not a memory tool; it is a code-signature file ranker, and the overlap with existing stack is narrower than the framing suggests. If token pressure on large codebases becomes a specific pain point and ruvector's hook-based injection proves insufficient, revisit sigmap's MCP server mode as a thin opt-in add-on rather than a full plugin.

---

## What sigmap is

[sigmap](https://github.com/manojmallick/sigmap) is a local, zero-external-dependency code-context engine. Its core job is to scan a codebase, extract function/class/type signatures across 21 languages, rank the most relevant files for a given query, and write a compact context summary — targeting files like `.cursorrules` or `CLAUDE.md` — so an AI coding assistant receives a much smaller, higher-signal prompt.

**Mechanism:** A six-step pipeline — Ask, Rank, Context, Validate, Judge, Learn. Retrieval uses hybrid TF-IDF scoring, 2-hop graph boosts, hub suppression, and intent detection, not neural embeddings. The generated context is a condensed signatures file, not a live in-context injection via hooks.

**Install/runtime model:** Three modes:
1. **CLI** — `npx sigmap` or global npm install. One-shot or watch mode.
2. **MCP server** — `sigmap --mcp` starts a stdio server with 9 tools (`read_context`, `search_signatures`, `get_map`, `query_context`, `get_impact`, etc.) compatible with Claude Code.
3. **IDE plugins** — First-party extensions for VS Code, JetBrains, and Neovim (`sigmap.nvim` — this is the correct full repo name, a point of confusion given the user's original URL `manojmallick/sigmap`).

**Dependencies:** Zero npm runtime dependencies. Node.js 18+ or standalone binary. No external database, no cloud account, no Python runtime, no embedding model download on first run.

**Claimed performance:** 40–98% token reduction depending on codebase; 80.0% hit@5 retrieval rate on a 405-repo benchmark; task success rate 52.2% with context vs. ~10% without.

**Maturity signals (as of May 2026):**
- Stars: 181
- Commits: 356
- PRs: 75 closed, 0 open
- Latest version: 6.10.0 (released early May 2026 — actively maintained)
- License: MIT
- Maintainer count: effectively 1 (manojmallick)
- Tests: present (`mcp-server.test.js`, `secret-scan.test.js`), but no published coverage figure
- External discussion: one Reddit thread in r/AgentsOfAI; no HN front-page hits; no independent benchmark comparisons found

---

## What yellow-plugins already has for context management

**yellow-ruvector (v1.1.3):** Persistent vector memory via ruvector. Hooks fire on every prompt submission, every edit, session start, and session end. `hooks_recall` injects relevant memories before Claude processes each prompt. `hooks_remember` records learnings after edits. Semantic code search via `hooks_recall` with `--semantic`. ~80+ MCP tools. Embedding model: all-MiniLM-L6-v2 via ONNX WASM. Storage: `.ruvector/intelligence/memory.rvdb` per-project.

**yellow-mempalace (v1.1.2):** ChromaDB + SQLite temporal knowledge graph. ~29 MCP tools. Global palace at `~/.mempalace/`. Long-term verbatim recall, entity relationships, timelines.

**yellow-research (v3.1.2):** Research fan-out to Ceramic, Perplexity, Tavily, EXA, Parallel Task. Complexity-routed. Saves to `docs/research/<slug>.md`.

**yellow-core auto-memory:** File-based MEMORY.md index at `~/.claude/projects/<dir>/memory/`. Categories: user, feedback, project, reference. Currently at 305 lines, 44.8KB.

---

## Overlap analysis

This is the key section. sigmap and the existing stack are mostly non-overlapping in their data types but do have one meaningful overlap zone with yellow-ruvector.

### vs. yellow-ruvector

This is the closest comparison and the most important one to get right.

**Where they overlap:** Both inject code context before the LLM processes a request. Both use some form of relevance ranking to decide what to surface. Both are project-scoped and run locally.

**Where they differ — and the differences are large:**

| Dimension | yellow-ruvector | sigmap |
|---|---|---|
| What is stored | Learned memories, past decisions, reflex learnings from prior sessions | Current codebase signatures — functions, classes, types |
| Retrieval basis | Semantic embeddings (ONNX) + hash-based hooks | TF-IDF + path matching + 2-hop graph |
| Injection timing | Pre-prompt hook (automatic, every prompt) | Pre-task file generation (write to `CLAUDE.md` or equivalent) |
| Memory persistence across sessions | Yes — the whole point | No — regenerated per task from current codebase |
| What it optimizes | "What did we learn before?" | "Which files are relevant to this query?" |
| Index freshness | Passive, event-driven (post-edit hooks) | Active, requires explicit `sigmap ask` or watch mode |

In plain terms: ruvector answers "what did we do last week that's relevant to this task?" sigmap answers "which files in the repo are relevant to this task right now?" These are complementary questions, but the yellow-plugins stack already answers the second question — implicitly, via ruvector's semantic code search (`mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with `--semantic`), and explicitly, via Claude Code's native file reading. The gap sigmap fills is specifically the token-budget discipline: it forces a compact context file that prevents an agent from loading too much.

That said, yellow-ruvector's hook injection is already doing something similar at the prompt level. Whether sigmap adds meaningfully on top depends on whether you're hitting token-pressure problems in practice.

### vs. yellow-mempalace

Essentially no overlap. mempalace is for long-term, multi-session, entity-relationship memory ("what did we decide about the auth architecture three months ago?"). sigmap is ephemeral code-signature context for the current task. They do not compete.

### vs. yellow-research

No overlap. yellow-research is for external information gathering (web, academic). sigmap is repo-local code structure.

### vs. yellow-core auto-memory

No overlap. Auto-memory is a file-based system for user/feedback/project/reference notes maintained by the agent in `~/.claude/`. sigmap knows nothing about this and writes to different files (`.cursorrules`, `CLAUDE.md` context sections).

### Where sigmap is genuinely additive

One real gap: **explicit token-budget enforcement for large codebase navigation.** ruvector's semantic hook recall is high-quality but it is an injection mechanism — it does not proactively rank and filter the full file graph before a task begins. sigmap's `query_context` and `get_map` MCP tools could serve as a pre-task "load the right files cheaply" step that ruvector's hooks don't currently replicate. For very large repos (multi-hundred-KLOC), this distinction matters.

---

## Integration cost

If you wanted to add sigmap, the lightest viable shape is: add it as an MCP server entry in a plugin's `plugin.json` `mcpServers` block, pointing to `npx sigmap --mcp`. No hooks needed. No new plugin required — it could be a single config addition to yellow-ruvector or yellow-core.

The heavier shape — a full `yellow-sigmap` plugin with commands, agents, and skill files — is overkill given what sigmap actually does. Its 9 MCP tools are the value; wrapping them in elaborate agent workflows adds complexity without proportional return.

**Friction points:**
- `npx sigmap` cold start adds latency (similar to ruvector's own cold-start problem). The binary install avoids this but adds a setup step.
- The context files sigmap writes (`CLAUDE.md` addenda, `.cursorrules`) need `.gitignore` entries or they pollute commits.
- No auth required. No external service. No API key. This is genuinely frictionless on the dependency axis.
- sigmap's context files and yellow-core auto-memory both write to `CLAUDE.md`. If sigmap overwrites or appends without coordination, you get context file conflicts. This needs explicit management.
- Node.js 18+ is already a requirement for ruvector, so no new runtime dependency.

---

## Risks and red flags

**Maintenance health:** Single maintainer with no announced team or org backing. 181 stars is modest for a tool claiming 97% token reduction. High commit velocity (356 commits, active to May 2026) is a positive signal, but bus-factor is 1. If manojmallick goes quiet, the tool stagnates.

**Performance claims need independent verification:** The "97% token reduction" headline is self-reported against the maintainer's own benchmark suite (405 repositories). No independent replications or head-to-head comparisons with alternatives (repomix, ctags-based approaches, etc.) were found in the research. The 80.0% hit@5 number is plausible but unverified externally.

**Context file collision:** sigmap writes to files you already curate manually. Any automated write to `CLAUDE.md` needs disciplined `.gitignore` and a clear ownership model. This is a genuine operational risk, not a theoretical one.

**Secret scanning caveat:** sigmap includes built-in secret scanning (auto-redacts AWS keys, tokens, DB strings). This is good. However, if the generated context file is committed to a public repo before the redaction runs, or if the scanning misses a pattern, sensitive internal API surfaces could leak. The solution (`.gitignore` the output) is obvious but requires enforcement.

**`npx` supply chain risk:** Running `npx sigmap` fetches and executes remote code on every invocation unless pinned. Enterprise or security-conscious environments should use the standalone binary with checksum verification. The project ships `.sha256` files — use them.

**Lock-in:** Low. sigmap writes plain text files. The MCP tools return structured data. Removing it means deleting a config entry and the generated context files. No proprietary database format.

**Complexity tax:** The yellow-plugins stack is already dense on the memory/context axis (ruvector, mempalace, auto-memory, research). Every additional tool adds cognitive load for understanding which system owns which concern. sigmap's value proposition is real but narrow — it risks becoming "yet another context thing" that nobody remembers to run.

---

## Recommendation

**Skip for now.**

The specific gap sigmap fills — pre-task file ranking to enforce token budget discipline — is real but not currently painful. Yellow-ruvector's hook-based semantic injection already handles the "relevant context before acting" use case for code. The existing stack is already sophisticated enough that adding sigmap risks complexity without proportional payoff.

**What would change this assessment:**

1. **Observable token pressure on large-codebase tasks.** If you find yourself hitting context length limits on repos with 50K+ lines, or if ruvector's hook recall is surfacing too much noise, sigmap's file-ranking approach is worth a 14-day pilot. The MCP mode (`sigmap --mcp`) can be wired in as a single `mcpServers` entry in yellow-ruvector's plugin.json without building a new plugin.

2. **The star/community count grows past ~500 and a second maintainer appears.** At 181 stars and 1 maintainer, the bus-factor risk is real. This is a tool that could disappear or stagnate without notice.

3. **An independent benchmark vs. repomix or ctags-based alternatives.** The self-reported 97% token reduction claim is compelling but unverified. If someone publishes an independent comparison that holds up, confidence in the tool's actual utility rises.

**If you do pilot it:** Install the standalone binary (not `npx`), `.gitignore` the generated context files immediately, add a `mcpServers` entry pointing to the binary in the appropriate plugin, and track whether `query_context` actually reduces the number of files Claude opens on cold-start tasks. Keep it out of hooks to avoid interaction with ruvector's existing hook pipeline.

---

## Sources consulted

- [manojmallick/sigmap](https://github.com/manojmallick/sigmap) — primary repo, README, package.json, CHANGELOG.md, gen-context.js
- [manojmallick/sigmap-vscode](https://github.com/manojmallick/sigmap-vscode) — VS Code extension
- [manojmallick/sigmap-jetbrains](https://github.com/manojmallick/sigmap-jetbrains) — JetBrains plugin
- [manojmallick/sigmap.nvim](https://github.com/manojmallick/sigmap.nvim) — Neovim plugin (note: the originally-cited URL `manojmallick/sigmap` is the main CLI repo; `sigmap.nvim` is the editor plugin)
- [r/AgentsOfAI — Complete SigMap Ecosystem](https://www.reddit.com/r/AgentsOfAI/comments/1szhuk2/complete_sigmap_ecosystem/) — community thread
- [sigmap on npmjs.com](https://www.npmjs.com/package/sigmap) — version history and download stats
- [ruvnet/ruvector README](https://raw.githubusercontent.com/ruvnet/ruvector/HEAD/README.md) — upstream ruvector project
- [mempalace/mempalace](https://github.com/mempalace/mempalace) — upstream MemPalace project
- `plugins/yellow-ruvector/.claude-plugin/plugin.json` and `plugins/yellow-ruvector/CLAUDE.md` (repo-relative) — authoritative yellow-ruvector plugin spec
- `plugins/yellow-mempalace/.claude-plugin/plugin.json` and `plugins/yellow-mempalace/CLAUDE.md` (repo-relative) — authoritative yellow-mempalace plugin spec
- `.claude-plugin/marketplace.json` (repo-relative) — full plugin inventory
- Parallel Task deep research (trun_6ae53d1e637f41f8a73ba6298aaca6db) — multi-source synthesis
- [research-conductor] Ceramic — 0 results, no prior team discussion of sigmap found
- [research-conductor] Tavily — skipped (TAVILY_API_KEY unavailable)
- [research-conductor] EXA — skipped (400 errors)
- [research-conductor] Perplexity — unavailable as deferred tool in this session
