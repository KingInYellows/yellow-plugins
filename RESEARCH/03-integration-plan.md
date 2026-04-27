# Phase 3 — Ceramic.ai Integration Plan

Implementation-ready plan, derived from `01-plugin-inventory.md` (repo state)
and `02-ceramic-capabilities.md` (Ceramic contract). No code changes have
been made.

The integration is intentionally **declarative-first**: it adds an MCP
server entry to the two plugins that do external research, rewires their
agents to prefer Ceramic, and leaves every prior backend in place so we can
A/B and roll back without touching code. A thin TypeScript shared client is
specified for follow-up use (tests, future cost rollup, programmatic non-
agent code paths) but is **not on the critical path** for the migration —
see §1.B and Open Question 1.

---

## 1. Shared client

### 1.A Primary path — declarative MCP integration (recommended for this PR)

**No new TypeScript module is added.** The integration is one
`mcpServers.ceramic` entry per consuming plugin, exactly mirroring the
existing `parallel` HTTP MCP pattern at
`plugins/yellow-research/.claude-plugin/plugin.json:55-57`.

Added entries:

```jsonc
// plugins/yellow-research/.claude-plugin/plugin.json
"ceramic": {
  "type": "http",
  "url": "https://mcp.ceramic.ai/mcp",
  "env": {
    "CERAMIC_API_KEY": "${CERAMIC_API_KEY}"
  }
}
```

```jsonc
// plugins/yellow-core/.claude-plugin/plugin.json
"ceramic": {
  "type": "http",
  "url": "https://mcp.ceramic.ai/mcp",
  "env": {
    "CERAMIC_API_KEY": "${CERAMIC_API_KEY}"
  }
}
```

> **Note on the `env` field with HTTP MCP servers.** The Phase 2 docs only
> show the bare `{type, url}` shape (`https://docs.ceramic.ai/mcp/ceramic-mcp.md`).
> Whether Claude Code forwards the `env` block to an HTTP MCP server, and
> whether the Ceramic MCP server reads `CERAMIC_API_KEY` from its process env
> at all (vs. requiring an inline `Authorization` header), is **not stated**
> on the docs page I read. Open Question 2 covers the verification step
> needed before merging.

Tool name produced by the auto-discovery rule documented in
`MEMORY.md → MCP Bundled Server Tool Naming`:

- From yellow-research: `mcp__plugin_yellow-research_ceramic__ceramic_search`
- From yellow-core: `mcp__plugin_yellow-core_ceramic__ceramic_search`

Both refer to the same upstream tool. They show up as separate tools to
agents because each plugin scopes its MCPs. Duplication is fine — the
existing repo already runs the same `mcp__grep__searchGitHub` from multiple
agents across plugins.

### 1.B Optional shared TypeScript client (deferred — design spec only)

If §1.A goes in but follow-up work needs a programmatic surface (vitest
integration tests, future `scripts/ceramic-cost-report.ts`, or a future
non-agent CLI), introduce one workspace package:

- **Module path:** `packages/ceramic/` (new)
  - `src/index.ts` — re-exports
  - `src/client.ts` — the client
  - `src/types.ts` — request/response types
  - `src/errors.ts` — error class hierarchy
  - `src/client.test.ts` — Vitest unit tests, fetch mocked
- **Workspace package name:** `@yellow-plugins/ceramic`
- **`packages/ceramic/package.json`** — mirrors
  `packages/infrastructure/package.json:1-31` shape: `private: true`,
  `version: "0.1.0"`, `type: "module"`, build/clean/typecheck scripts,
  `engines: { node: ">=22.22.0 <25.0.0" }`.
- Listed in `pnpm-workspace.yaml:7` `packages:` block.

**Public interface.** Direct port of the documented contract from Phase 2
§2.3–§2.5:

```typescript
// packages/ceramic/src/types.ts
export interface CeramicSearchRequest {
  /** 1–50 keyword-style words, English only. */
  query: string;
}

export interface CeramicSearchResultItem {
  title: string;
  url: string;
  /** Multi-paragraph content excerpt, often ~1–2 KB. */
  description: string;
}

export interface CeramicSearchResponse {
  requestId: string;
  result: {
    results: CeramicSearchResultItem[];
    searchMetadata: { executionTime: number };
    totalResults: number;
  };
}

export interface CeramicProblem {
  title: string;
  status: number;
  detail: string;
  requestId: string;
  code: string;
}

// packages/ceramic/src/errors.ts
export class CeramicError extends Error {
  constructor(public readonly problem: CeramicProblem) {
    super(`[ceramic] HTTP ${problem.status} ${problem.code}: ${problem.detail}`);
  }
}
export class CeramicConnectionError extends Error {}

// packages/ceramic/src/client.ts
export interface CeramicClientOptions {
  /** Defaults to process.env.CERAMIC_API_KEY. Throws if neither is set. */
  apiKey?: string;
  /** Defaults to "https://api.ceramic.ai". */
  baseUrl?: string;
  /** Per-call timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Retries on 408/429/5xx and connection errors. Default 2. */
  maxRetries?: number;
  /** Logger receives one line per request and one line per response. */
  logger?: (line: string) => void;
}

export class CeramicClient {
  constructor(options?: CeramicClientOptions);
  search(request: CeramicSearchRequest): Promise<CeramicSearchResponse>;
}
```

**Internal structure.**

- **Auth:** sets `Authorization: Bearer ${apiKey}`. Throws synchronously at
  construction time if `apiKey` is empty, with message
  `[ceramic] CERAMIC_API_KEY is required (set env var or pass apiKey option)`.
- **Retry:** mirrors the official SDK behavior documented at
  `https://docs.ceramic.ai/api-reference/error-codes.md` ("Retry Strategy")
  — 2 attempts by default, on `408`, `429`, `5xx`, and connection errors.
  Backoff: 250 ms × 2^attempt with full jitter (`±50 ms`). No `Retry-After`
  header is exposed by Ceramic (Phase 2 §2.6, Probe 5), so we do not parse
  one.
- **Logging:** if `logger` is supplied, emit two lines per call:
  - request: `[ceramic] req query="<first 60 chars>" len=<word_count>`
  - response: `[ceramic] res status=<int> requestId=<uuid> latency_ms=<int> server_exec_ms=<int> results=<int>`
  No request body or response body is logged at WARN/INFO level. Errors emit
  a third line with the full `CeramicProblem` (no key value).
- **Error mapping:**
  - HTTP 200 → return parsed body.
  - HTTP 4xx/5xx with `application/problem+json` → throw `CeramicError`.
  - HTTP 4xx/5xx without that content type → throw `CeramicError` with a
    synthesized `CeramicProblem` (title `Unknown error`, code
    `non_problem_response`).
  - Network failure → throw `CeramicConnectionError`.
- **Defaults sourced from Phase 2:** baseUrl `https://api.ceramic.ai`,
  timeout 30 s, retries 2.

Default to deferring §1.B until a real consumer shows up. See Open
Question 1.

---

## 2. Configuration schema

### 2.1 Env vars (single, global)

| Name | Required | Format | Source of truth |
|---|---|---|---|
| `CERAMIC_API_KEY` | Yes (when Ceramic features are wanted) | Bearer-style secret. Observed prefix `cer_sk` (Phase 0) — but this is **not** stated in Ceramic's docs, so the format check should be permissive: at least 20 alphanumeric/dash/underscore chars, no whitespace. Same shape as the EXA check at `plugins/yellow-research/commands/research/setup.md:120-126`. | Repo convention (Phase 0). Ceramic documents `Authorization: Bearer YOUR_API_KEY` — does not prescribe an env var name (`https://docs.ceramic.ai/api-reference/search.md`). |

No `CERAMIC_BASE_URL`, no `CERAMIC_TIMEOUT_MS`. Reason: matches the
existing pattern — yellow-research only adds `PERPLEXITY_TIMEOUT_MS` once,
and only because Perplexity has an unusually long timeout. If a future need
appears we follow the same precedent.

**Per-plugin override pattern:** none. Mirroring the existing plugin family
(`PERPLEXITY_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY` are global env vars
shared between every plugin that uses them — see `AGENTS.md:108-109`),
`CERAMIC_API_KEY` is a single global env var. If a future use case ever
needs per-plugin keys, that becomes a new precedent at that time.

### 2.2 plugin.json `mcpServers.ceramic` block

Documented in §1.A. Two plugins get the same block. No further config is
needed in plugin.json.

### 2.3 Files that must be updated atomically with the env-var introduction

Per `AGENTS.md:74-77` and the `validate-setup-all` requirement
(`MEMORY.md → Plugin Manifest Validation`):

| File | Edit |
|---|---|
| `AGENTS.md:108-109` | Append `CERAMIC_API_KEY` to the never-commit list. |
| `plugins/yellow-research/CLAUDE.md` | Add `CERAMIC_API_KEY` to the API-key setup section (after the existing `PERPLEXITY_API_KEY` line, ≤5 lines added). |
| `plugins/yellow-core/CLAUDE.md` | Add a single-line note documenting that `best-practices-researcher` honours `CERAMIC_API_KEY`. |
| `plugins/yellow-core/commands/setup/all.md` lines 79-86 | Add `CERAMIC_API_KEY` set/NOT-SET probe alongside the existing five. |
| `plugins/yellow-core/commands/setup/all.md` lines 254-269 | Update the **yellow-research** classification block: change "5 bundled sources" → "6 bundled sources", add `CERAMIC_API_KEY` as point 6, adjust READY/PARTIAL/NEEDS-SETUP thresholds. |
| `plugins/yellow-core/commands/setup/all.md` plugin loop at line 171 | No change — yellow-core is already in the loop. |
| `.claude-plugin/marketplace.json` plugin descriptions | Optional cosmetic update to mention "Ceramic.ai" in yellow-research's description. Non-blocking; defer. |

### 2.4 No `.env.example` file added

Repo precedent: env vars are documented in `CLAUDE.md` per plugin and in
`AGENTS.md`. There is no `.env.example` in the root or in any plugin
(verified via `find -name '.env*'`). Do not add one — it would create a
new pattern.

---

## 3. Migration list

Two plugins are touched. All other plugins are unaffected. Per the brief
("Do NOT delete the prior research backend code"), Perplexity / Tavily /
EXA / Parallel / Context7 / WebFetch all stay declared and reachable —
Ceramic becomes the **first hop**, with explicit fall-through to the
existing tools.

### 3.1 yellow-research — primary migration

**Current backend** (Phase 1 §2.1):

- `plugins/yellow-research/.claude-plugin/plugin.json:21-67` — five MCP servers
  (perplexity, tavily, exa, parallel, ast-grep)
- `plugins/yellow-research/agents/research/code-researcher.md:8-22` —
  6 MCP tools listed (Context7, EXA `get_code_context`/`web_search`,
  GitHub grep, Perplexity `search`, ast-grep ×4)
- `plugins/yellow-research/agents/research/research-conductor.md:8-34` —
  ~21 MCP tools listed (full Perplexity/Tavily/EXA/Parallel/ast-grep surface)
- `plugins/yellow-research/commands/research/setup.md` — 5-source health check

**Target Ceramic.ai endpoint:** `POST https://api.ceramic.ai/search` via
`mcp__plugin_yellow-research_ceramic__ceramic_search` (single param `query`,
1–50 words, lexical English).

**Hard swap vs. fallback chain:** **Fallback chain.** Drop-in *first hop*
for two specific roles:

1. In `code-researcher.md`, Ceramic becomes the new "general web" entry.
   The Source Routing table at `code-researcher.md:25-45` adds a row:

   ```
   | General web (keyword-tight) | mcp__plugin_yellow-research_ceramic__ceramic_search |
   ```

   The "General web" row currently pointing to
   `mcp__plugin_yellow-research_exa__web_search_exa` is downgraded to the
   second-stage fallback in the existing fallback chain at
   `code-researcher.md:47-54` ("If Context7 returns no match, use EXA…").
   New chain: `Context7 → Ceramic → EXA get_code_context → EXA web_search →
   Perplexity search`.

   The "Recent releases, new APIs" row stays on Perplexity — Ceramic is
   English/lexical, while Perplexity carries recency signals.

   Add the LLM-rewrite recipe (Phase 2 §5.1) as a **prep step** before any
   Ceramic call in this agent. One sentence in the agent prose:

   > Before calling `mcp__plugin_yellow-research_ceramic__ceramic_search`,
   > rewrite the topic into a concise keyword-style query (≤50 words, no
   > conversational phrasing). Ceramic is lexical — see
   > `https://docs.ceramic.ai/api/search/best-practices.md`.

2. In `research-conductor.md`, Ceramic enters the **Simple** and **Moderate**
   tiers as the first parallel call. Lines `research-conductor.md:26-43`
   (the Simple/Moderate ladder) gain Ceramic as the lead source:

   - **Simple** — replace the single Perplexity reason call with: first
     `ceramic_search`; if `result.results` is empty or count < 3, fall
     through to `perplexity_reason`.
   - **Moderate** — `ceramic_search` runs first; the existing 2–3 parallel
     calls (`perplexity_research`, `tavily_search`) launch concurrently and
     supplement.
   - **Complex** — Ceramic is added as a sixth parallel source. The async
     Parallel Task / EXA deep researcher tools are unaffected.
   - The same LLM-rewrite step applies in this agent.

**Test strategy:**

- **Mock (vitest unit, in `packages/ceramic/src/client.test.ts` if §1.B
  ships):** mock `fetch`, assert the request shape (URL, Authorization
  header, JSON body), assert that the documented 200/400/401/429/500
  cases produce the expected return value or `CeramicError` with the
  right `code`.
- **Live (in `tests/integration/ceramic.test.ts`, currently empty per
  Phase 1 §3.1):** one test gated on `RUN_LIVE=1` AND `CERAMIC_API_KEY`
  — call `ceramic_search` with `query: "California rental laws"` (the
  same query as Phase 2 Probe 1) and assert `result.totalResults > 0`.
  This is the canonical smoke test the brief asks for in Phase 4.
- **Manual smoke:** rerun `/research:setup` after Phase 4 lands; verify
  the new "Ceramic" row shows ACTIVE and the capability summary updates.

**Estimated diff size:** ~135 lines added, ~20 lines edited across:

- `plugin.json` — +6 lines (one `mcpServers.ceramic` entry)
- `agents/research/code-researcher.md` — +2 lines tools, +12 lines prose
  (route table row, fall-through chain note, LLM-rewrite sentence)
- `agents/research/research-conductor.md` — +2 lines tools, +25 lines
  prose (Simple/Moderate/Complex tier updates, LLM-rewrite sentence,
  source-skip annotation parity)
- `commands/research/setup.md` — +60 lines (CERAMIC_API_KEY check, format
  check, optional probe with the same 5-second curl pattern at
  `:177-200`, MCP source health row at `:262-330`, dashboard row at
  `:360-385`, env-var setup block at `:404-415`)
- `commands/research/deep.md` — +2 lines tools (add the new MCP tool
  name to `allowed-tools:`)
- `skills/research-patterns/SKILL.md` — +5 lines (add Ceramic to the
  source matrix; **note: do not introduce another multi-line description**
  — see Phase 1 §4 gap 1)
- `CLAUDE.md` — +8 lines

### 3.2 yellow-core — secondary migration

**Current backend:**
`plugins/yellow-core/agents/research/best-practices-researcher.md:7-9`
declares `WebSearch`, `WebFetch`, plus Context7 MCP tools. Free-text prose
at `best-practices-researcher.md:114` mentions "Web Search
(Tavily/Perplexity)" as an aspirational source — those tools are not
actually in the agent's `tools:` list. Today the agent uses Claude Code's
built-in `WebSearch` for community/recency lookups.

**Target Ceramic.ai endpoint:** same MCP tool, namespaced under yellow-core:
`mcp__plugin_yellow-core_ceramic__ceramic_search`.

**Hard swap vs. fallback chain:** **Hybrid.**

- `WebSearch` is downgraded to "fallback if Ceramic returns nothing useful".
  Phrasing in agent prose should explicitly say so — `WebSearch` and
  `WebFetch` stay declared in `tools:`.
- `WebFetch` is **kept as primary** for any single-URL content fetch —
  Ceramic does not have a "fetch a URL's content" endpoint (Phase 2 §5
  comparison row).
- Context7 stays as the canonical first hop for "named library" queries
  (per the existing `code-researcher.md:30-37` pattern in yellow-research).

**Test strategy:**

- Mock test as in §3.1.
- Manual smoke: invoke `best-practices-researcher` agent on a known
  technical query (e.g., "tokio runtime spawn vs spawn_blocking") and
  verify the agent's output cites a Ceramic-sourced URL.

**Estimated diff size:** ~25 lines added, ~5 lines edited across:

- `plugin.json` — +6 lines (`mcpServers.ceramic` entry — note: this is
  the second `mcpServers` entry yellow-core ships, after `context7`)
- `agents/research/best-practices-researcher.md` — +1 line tools, +12
  lines prose (rewrite the "Phase 2 / Research & Synthesis" workflow at
  lines 35-43 to lead with Ceramic, fall back to WebSearch; update the
  "Research Tools" section at lines 95-103 to describe Ceramic; update
  the prose mention at line 114 to read "Web Search (Ceramic, fallback
  to WebSearch)")
- `CLAUDE.md` — +5 lines

### 3.3 Other plugins — no changes

- yellow-debt scanners and yellow-review reviewers consume only ast-grep
  from yellow-research (Phase 1 §2.5, §2.6). Out of scope.
- yellow-devin DeepWiki is a different domain (repo-targeted Q&A, not web
  search). Out of scope.
- yellow-codex's `codex-analyst` runs the local `codex exec` CLI. Out of
  scope.
- yellow-docs / yellow-ci / yellow-linear / yellow-chatprd / yellow-semgrep
  / yellow-morph / yellow-composio / yellow-browser-test / yellow-ruvector
  / gt-workflow do not perform external research. Out of scope.

### 3.4 Total cross-plugin file touch list

Single-PR diff target for Phase 4:

```
M  AGENTS.md                                                       (+1)
M  plugins/yellow-core/.claude-plugin/plugin.json                  (+6)
M  plugins/yellow-core/CLAUDE.md                                   (+5)
M  plugins/yellow-core/agents/research/best-practices-researcher.md(+13)
M  plugins/yellow-core/commands/setup/all.md                       (+10)
M  plugins/yellow-research/.claude-plugin/plugin.json              (+6)
M  plugins/yellow-research/CLAUDE.md                               (+8)
M  plugins/yellow-research/agents/research/code-researcher.md      (+14)
M  plugins/yellow-research/agents/research/research-conductor.md   (+27)
M  plugins/yellow-research/commands/research/code.md               (+1)
M  plugins/yellow-research/commands/research/deep.md               (+1)
M  plugins/yellow-research/commands/research/setup.md              (+60)
M  plugins/yellow-research/skills/research-patterns/SKILL.md       (+5)
A  tests/integration/ceramic.test.ts                               (~30 new)
A  RESEARCH/01-plugin-inventory.md                                 (already present)
A  RESEARCH/02-ceramic-capabilities.md                             (already present)
A  RESEARCH/03-integration-plan.md                                 (this file)
A  .changeset/<auto-gen>.md                                        (~5 new)
```

Plus, if §1.B ships in the same PR (deferred per Open Question 1):

```
M  pnpm-workspace.yaml                                             (+1)
A  packages/ceramic/package.json                                   (~30 new)
A  packages/ceramic/tsconfig.json                                  (~10 new)
A  packages/ceramic/src/index.ts                                   (~5)
A  packages/ceramic/src/client.ts                                  (~120)
A  packages/ceramic/src/types.ts                                   (~30)
A  packages/ceramic/src/errors.ts                                  (~20)
A  packages/ceramic/src/client.test.ts                             (~150)
```

---

## 4. Observability

The MCP-server integration runs out-of-process; we don't see its HTTP
calls directly. Two observability surfaces:

### 4.1 Per-call logging from Claude Code's MCP infrastructure

Already exists — Claude Code logs MCP tool invocations and their durations
to its session log. No change needed for visibility; the `ceramic_search`
calls show up the same way `mcp__plugin_yellow-research_perplexity_search`
calls do today.

### 4.2 Per-call logging from the agent layer (no extra infra)

In both updated agents (`code-researcher.md`, `research-conductor.md`,
`best-practices-researcher.md`), add a one-line annotation requirement
when Ceramic is used:

> When `ceramic_search` is invoked, add to your final output's "Sources"
> section: `- ceramic — <N> results in <ms>ms server exec` (read N from
> `result.totalResults`, ms from `result.searchMetadata.executionTime *
> 1000`).

This gives us per-invocation visibility without a new logger or hook.
Per-plugin cost rollup follows by counting "ceramic — N results" lines in
the saved `docs/research/<slug>.md` files.

### 4.3 Cost rollup (deferred)

If a real cost-tracking need appears, add `scripts/ceramic-cost-report.ts`
that walks `docs/research/*.md` and `~/.claude/projects/.../session.log`
and counts Ceramic invocations × `$0.00005`. **Do not build this in
Phase 4** — it's premature for a $0.003/day workload. Listed here only so
we don't reinvent later.

### 4.4 Format and destinations

| Where | Format | Destination |
|---|---|---|
| MCP infra | Claude Code's existing MCP call log | Session log |
| Agent output | `- ceramic — <N> results in <ms>ms server exec` line in `Sources` section | The research markdown the user reads |
| Setup command | `Provider | Ceramic | <STATUS>` row in the `/research:setup` table at `setup.md:360-385` | Terminal output of `/research:setup` |
| Optional shared client (§1.B) | Two log lines per call as specified in §1.B "Logging" | `console.error` by default; injectable via the `logger` option |

---

## 5. Rollback

Per the brief, rollback must be possible "per plugin without code changes".
With the MCP-server integration there are two cleanly separable kill
switches, in increasing order of cost:

### 5.1 Soft disable — agents stop using Ceramic

Documented in the agent prose ("Ceramic is the first hop; if
`mcp__plugin_<plugin>_ceramic__ceramic_search` is unavailable in
`ToolSearch` results, skip and proceed with the existing chain"). This
matches the existing skip-source pattern at
`research-conductor.md:97-101`. **Trigger by** unsetting `CERAMIC_API_KEY`
in the shell. The next session start will mark the source as INACTIVE,
and agents will fall through to Perplexity/Tavily/EXA as today.

> Test for this: in `tests/integration/ceramic.test.ts`, add a second
> test that sets `CERAMIC_API_KEY=` (empty) and invokes the agent —
> assert it completes without error, citing only non-Ceramic sources.

### 5.2 Hard disable — remove the MCP server

Delete the `mcpServers.ceramic` block from the plugin's `plugin.json`,
restart Claude Code. The tool simply does not appear. Agents continue to
work with their existing chain.

### 5.3 Total rollback — revert the PR

Standard `git revert <commit>`; works because nothing in this plan deletes
prior backends.

---

## 6. Open questions for me (the operator)

1. **Ship the §1.B TypeScript shared client now, or defer?** I recommend
   **defer**. The MCP integration (§1.A) covers every existing consumer.
   The shared client only earns its keep when (a) we add a vitest
   integration test that talks to Ceramic *without* going through MCP
   (which we can write either way — vitest can also call MCP via
   stdio/http), or (b) a non-agent script needs the API. Neither is
   present today. **Decision needed:** ship A only, or A+B in the same PR?
2. **Does the Ceramic HTTP MCP read `CERAMIC_API_KEY` from its env block,
   or does it require an inline header?** Phase 2 docs surfaced the
   `{type, url}` shape only — Cursor and VS Code config examples don't
   show env-passing. The bundled `parallel` MCP at
   `plugins/yellow-research/.claude-plugin/plugin.json:55-57` does **not**
   pass env at all (it uses OAuth). Action required before Phase 4 starts:
   **one verification probe** — install the MCP entry locally with the
   `env` block and confirm `ceramic_search` returns 200 (not 401). If it
   401s, we either (a) use the SDK-based shared client path from §1.B, or
   (b) ask Ceramic for the documented header convention. **Decision
   needed:** are you OK with me running this single verification probe
   during Phase 4, or do you want me to ask Ceramic support first?
3. **LLM-rewrite step — agent prose or shared client?** I propose agent
   prose (the agent already has Claude in the loop). Alternative:
   encapsulate the rewrite in §1.B's `CeramicClient.search()` so it's a
   single deterministic place. **Decision needed:** agent or client?
4. **Default-default — first-hop with fallback, or full fan-out always?**
   This plan goes with first-hop-with-fallback. The brief says "Ceramic
   becomes the **default research backend**", which I read as "first
   choice". An alternative is "Ceramic always runs, in parallel with the
   prior backends, for at least the next M weeks of A/B". The latter
   doubles cost (still tiny) but produces side-by-side observability data
   for free. **Decision needed:** confirm first-hop-with-fallback, or
   request the parallel-A/B variant?
5. **README.md updates** — yellow-research/README and the root README both
   currently advertise the 5-MCP fan-out. Do you want them updated in the
   Phase 4 PR, or kept until after we have A/B data? I default to
   "include in PR" (otherwise the install instructions go stale on day
   one).
6. **`/research:setup` UX scope creep** — the existing setup command
   already does a lot (Phase 1 §2.1 cited a 470-line file at
   `commands/research/setup.md`). Adding Ceramic adds ~60 more lines per
   §3.1's diff estimate. Acceptable to keep that growth, or extract a
   helper subagent / shared script? My instinct: keep growth in-line for
   this PR; extract on the *next* setup edit if it crosses 600 lines.
   **Decision needed:** confirm growth-in-line is OK?

---

**Stop. Awaiting explicit approval before any code changes (Phase 4).**
