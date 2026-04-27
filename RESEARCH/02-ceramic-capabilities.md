# Phase 2 — Ceramic.ai Capability Research

Read-only docs review plus 5 live probes against `https://api.ceramic.ai`.
Survey date: 2026-04-26. Auth: `Authorization: Bearer ${CERAMIC_API_KEY}` (key
prefix `cer_sk…`).

Every claim in §1–§4 cites either a docs URL or a probe number from §6.

---

## 1. What it does

Ceramic.ai sells one product: a **lexical web search API** with a single
`POST /search` endpoint.

| Capability | Quote / source | Phase 3 relevance |
|---|---|---|
| Web-scale search index | "40B+ Web pages" — `https://www.ceramic.ai` | Same general scope as Tavily/EXA basic search. |
| Self-described latency | "50ms" advertised — `https://www.ceramic.ai` | Probe 1 measured server `executionTime: 0.113s`; with network round-trip from this host, total `279ms`. Probes 4 and 5 saw `97–113ms` server exec. Marketing's 50ms appears achievable inside their POP, not from arbitrary client networks. |
| Search style | **"Ceramic is a lexical search engine"… "matches documents on exact keywords and phrases"** — `https://docs.ceramic.ai/api/search/best-practices.md` | **Critical.** This is *not* a semantic search like EXA-neural or Perplexity-with-LLM. See §5 comparison. |
| Language coverage | **"Ceramic currently supports English web pages"** with more "coming soon" — same source | Limits drop-in replaceability for any non-English research the agents currently send to Perplexity/Tavily. |
| Citations | Every result returns `title`, `url`, `description` (content excerpt) — confirmed Probe 1 body | Drop-in for the citation pattern in `yellow-research/agents/research/research-conductor.md:130-136` ("Sources: - [Title](URL) — what was found here"). |
| Document QA / summarization | **Not advertised, no endpoint** — `llms.txt` index only lists `/search` and the standard ops pages | Ceramic does NOT offer any synthesis/answer endpoint. Cannot replace `perplexity_research`, `perplexity_reason`, or `parallel__createDeepResearch`. |
| Async / batch / streaming | **Not documented anywhere.** No streaming or batch endpoint in `llms.txt`. SDKs offer sync + async variants over the same single call. | Phase 3 fan-out logic stays — if multiple sub-questions are needed, the client issues N `/search` calls. |
| Private data ingestion | "Private data indexing for internal knowledge bases" advertised — `https://www.ceramic.ai` | Enterprise feature, gated. Out of scope. |
| Compliance | "SOC 2 Type II", "Zero data retention policy" — same source | Useful to record in plugin docs. |
| MCP server | **Official Ceramic MCP server at `https://mcp.ceramic.ai/mcp`** (HTTP transport), single tool `ceramic_search` — `https://docs.ceramic.ai/mcp/ceramic-mcp.md` | This is the cleanest integration path. Matches the existing yellow-research `parallel` MCP entry in `plugins/yellow-research/.claude-plugin/plugin.json:55-57` (`"type": "http", "url": "https://task-mcp.parallel.ai/mcp"`). One JSON entry per plugin, no `npx` shim needed. |

---

## 2. API surface

### 2.1 Endpoint

- **`POST https://api.ceramic.ai/search`** — only documented endpoint.
  Source: `https://docs.ceramic.ai/api-reference/search.md` (and confirmed by
  every probe).

### 2.2 Auth

- Header: `Authorization: Bearer <key>` —
  `https://docs.ceramic.ai/api-reference/search.md`.
- Keys minted at `https://platform.ceramic.ai/keys`.
- Key format observed: `cer_sk…` prefix (verified at Phase 0).
- 401 challenge response includes a standards-compliant `WWW-Authenticate:
  Bearer` header (Probe 2).

### 2.3 Request schema

| Field | Type | Constraint | Source |
|---|---|---|---|
| `query` | string | **required**, "between 1 and 50 words", "extra whitespace ignored" | `api-reference/search.md` |

No other parameters are accepted. Probe 3 confirmed sending an unknown field
returns `400 unsupported_parameter`. There is no `topK`, no pagination cursor,
no language, no date filter, no domain filter, no `includeContent`, no region
in the documented surface. **Result page size is hard-coded** — every probe
returned exactly 10 results with `totalResults: 10`.

### 2.4 Response schema (success)

From `api-reference/search.md` (verbatim shape) and confirmed by Probe 1:

```json
{
  "requestId": "<uuid>",
  "result": {
    "results": [
      { "title": "...", "url": "...", "description": "..." }
    ],
    "searchMetadata": { "executionTime": 0.097 },
    "totalResults": 10
  }
}
```

Notable from Probe 1: `description` is *not* a one-line snippet — it's a
multi-paragraph content excerpt (the first result was ~1.7 KB of legal
analysis text). This makes Ceramic responses heavier than typical SERP APIs
but lighter than full-page crawls. Useful for RAG-style consumption without a
follow-up fetch.

### 2.5 Response schema (error) — RFC 7807 Problem Details

From `api-reference/error-codes.md` and confirmed by Probes 2 and 3:

```json
{
  "title": "...",
  "status": <int>,
  "detail": "...",
  "requestId": "<uuid>",
  "code": "<machine_code>"
}
```

`Content-Type: application/problem+json; charset=utf-8` (Probes 2, 3).

### 2.6 Rate limits

| Plan | QPS | Source |
|---|---|---|
| Pay As You Go | **20 QPS** | `https://docs.ceramic.ai/admin/rate-limits.md` |
| Pro | **50 QPS** | same |
| Enterprise | Custom reserved QPS | same |

**No rate-limit response headers are exposed.** Probe 5 explicitly grepped for
`x-ratelimit*`, `x-quota*`, `x-credits*`, `retry-after` — none present. This
means a Phase 3 client cannot proactively throttle from header hints; it must
react to 429s with backoff.

### 2.7 Streaming, async, batch — none

Not documented anywhere in `llms.txt`. The only way to scale is concurrent
calls bounded by your plan's QPS.

### 2.8 Official SDKs

| SDK | Package | Repo / install | Notes |
|---|---|---|---|
| Python | `ceramic_ai` | `pip install ceramic_ai` — `sdks/python-sdk.md` | Sync `Ceramic(api_key=...)`, async `AsyncCeramic`, `max_retries`, `with_options(...)` per-request override. |
| TypeScript | `ceramic-ai` | `npm install ceramic-ai` — `sdks/typescript-sdk.md`; source `github.com/CeramicTeam/ceramic-typescript` | `new Ceramic({ apiKey, maxRetries })`, error classes `Ceramic.APIError`, `Ceramic.APIConnectionError`. |

Both SDKs **automatically retry 2× by default** on network errors,
`408 Request Timeout`, `429`, and `5xx` (`api-reference/error-codes.md` →
"Retry Strategy"). Tunable via `max_retries` / `maxRetries` constructor or
per-call.

---

## 3. Pricing and quotas

| Item | Value | Source |
|---|---|---|
| Standard rate | **$0.05 per 1,000 queries** = **$0.00005 per query** | `https://www.ceramic.ai` (homepage pricing tile) |
| Free credits | "1,000 free credits when you sign up" | `https://www.ceramic.ai` and `https://docs.ceramic.ai` |
| Plan tiers | Pay As You Go, Pro, Enterprise | `admin/rate-limits.md` |
| Enterprise dedicated | "Reserved QPS", "Dedicated support" | same |

**Cost math relative to current research backends.** A plausible heavy day
inside this repo (yellow-research + yellow-core's research agent + plan
deepening) runs ~50 calls. At Ceramic prices that is **$0.0025/day**, or
**~$0.91/year** at one heavy day per day. That is below the noise floor of
any provider's monthly bill. The real cost driver in this migration is *not*
per-call pricing; it is the QPS ceiling (20 QPS PAYG) interacting with
fan-out patterns in `agents/research/research-conductor.md` (which can launch
4 parallel sources for "Complex" queries). Per the `Complex` ladder, a single
research-conductor invocation tops out at well under 20 QPS — fine.

---

## 4. Failure modes

### 4.1 Documented

| HTTP | `code` (observed where applicable) | Meaning | Recommended client behavior |
|---|---|---|---|
| 200 | — | Success | Process. |
| 400 | `unsupported_parameter` (Probe 3) | Malformed/unknown field | Do not retry — fix the request. |
| 401 | `missing_api_key` (Probe 2) | Missing or invalid key | Surface to user; do not retry. |
| 429 | (not triggered) | Rate limit | Backoff and retry. SDKs do this automatically (2 attempts default). |
| 500 | (not triggered) | Internal server error | Backoff and retry. |

Source for the 200/401/429/500 grid: `api-reference/error-codes.md`. The 400
case is documented as the one example in the same page; Probe 3 reproduced it
verbatim except for a trailing period in `detail`.

### 4.2 Triggered during this survey

| Probe | What I sent | What I got |
|---|---|---|
| 2 | No `Authorization` header | 401 with `code: "missing_api_key"`, `WWW-Authenticate: Bearer` set, response in 48 ms |
| 3 | `{"prompt":"hello"}` (wrong field name) | 400 with `code: "unsupported_parameter"`, response in 54 ms |

### 4.3 Not triggered, but worth noting for Phase 3

- **`>50 word query`** — docs say it will be rejected; not probed (would have
  cost a probe for low value).
- **Empty query** — not probed.
- **429 rate limiting** — not probed (would have required burst traffic and
  is high-risk for the live key).
- **5xx** — only triggered organically; not reproducible on demand.

The Phase 3 client should map all of these to the same `{title, status, detail,
code}` Problem Details path even if the upstream skips a field, since fields
beyond `requestId`/`code` are documented as required (and were present in
both 4xx probes).

---

## 5. Comparison to the research stack today

Plugin source for the current backends: `plugins/yellow-research/.claude-plugin/plugin.json:21-67`
(five MCP servers) and `plugins/yellow-core/agents/research/best-practices-researcher.md:8-14`
(`WebSearch`, `WebFetch`, Context7).

| Current tool | What it does today | Can Ceramic replace it? | Why / why not |
|---|---|---|---|
| `mcp__plugin_yellow-research_perplexity__perplexity_search` | Web-grounded keyword search w/ snippets | **Yes — direct replacement** | Same shape: query → ranked URLs + snippets. Ceramic's `description` field is fuller. |
| `mcp__plugin_yellow-research_perplexity__perplexity_research` | Multi-source LLM-synthesized research with citations | **No** | Ceramic returns links + excerpts only — no LLM synthesis. Synthesis stays at the agent layer (Claude itself). |
| `mcp__plugin_yellow-research_perplexity__perplexity_reason` | Step-by-step reasoning over sources | **No** | Same reason. Could be re-implemented as "Ceramic + Claude reasoning prompt", but that's an agent-side change. |
| `mcp__plugin_yellow-research_perplexity__perplexity_ask` | Quick factual answer | **Partial** | Ceramic returns links to answers, not the answer itself. Would need LLM follow-up. |
| `mcp__plugin_yellow-research_tavily__tavily_search` | Real-time web search | **Yes — direct replacement** | Most similar peer — both are SERP-style. Ceramic skews lexical, Tavily semantic. See §5.1 caveats. |
| `mcp__plugin_yellow-research_tavily__tavily_research` | Multi-source research mode | **No** | Same reason as `perplexity_research`. |
| `mcp__plugin_yellow-research_tavily__tavily_extract` | Pull content from a specific URL | **No** | Out of Ceramic's surface. Keep Tavily or substitute with `WebFetch`. |
| `mcp__plugin_yellow-research_tavily__tavily_crawl` / `tavily_map` | Site crawl, sitemap | **No** | Out of Ceramic's surface. |
| `mcp__plugin_yellow-research_exa__web_search_exa` | Neural web search | **Partial** | Ceramic = lexical, EXA = neural. Ceramic wins on exact-term queries (Probe 4 example), loses on conceptual queries (Probe 5). Plan should keep EXA as fallback for queries that score poorly on Ceramic's lexical filter. |
| `mcp__plugin_yellow-research_exa__get_code_context_exa` | Code examples / GitHub / Stack Overflow | **Partial** | Ceramic returned plausible developer results in Probe 4 (`Claude Code plugin marketplace plugin.json schema`) — top hits included dev.to, GitHub release notes, security research. But EXA is purpose-built for code; expect EXA to outperform on tight code-pattern queries. |
| `mcp__plugin_yellow-research_exa__deep_researcher_*` | Async EXA deep research report | **No** | Ceramic has no async report endpoint. |
| `mcp__plugin_yellow-research_parallel__createDeepResearch` / `createTaskGroup` | Async multi-source deep research | **No** | Out of Ceramic's surface. |
| `mcp__plugin_yellow-research_parallel__getStatus` / `getResultMarkdown` | Polling | **No** | Same reason. |
| `mcp__plugin_yellow-research_ast-grep__*` | Local AST search | **No (different domain)** | Local code search. Not a research backend — keep as-is. |
| `mcp__plugin_yellow-core_context7__resolve-library-id` / `query-docs` | Curated library docs | **No (different domain)** | Library-specific, official-docs-only. Keep as the primary first-step source for library questions, per `code-researcher.md:30-37`. |
| `mcp__grep__searchGitHub` | GitHub code grep | **No (different domain)** | Repo-specific code grep. Keep. |
| Built-in `WebSearch` / `WebFetch` (used by `best-practices-researcher.md:8-9`) | General web | **Yes for WebSearch — direct replacement** | Migrate `WebSearch` calls to Ceramic. `WebFetch` (single-URL content fetch) is out of Ceramic's surface — keep or swap to Tavily extract. |

### 5.1 Lexical vs semantic — the honest one-liner per current source

- **Where Ceramic wins (Probe 4, "Claude Code plugin marketplace plugin.json
  schema"):** specific terms ("plugin.json", "Claude Code") returned a
  topically tight result list — Claude Code marketplace guides, plugin
  injection security research, the official npm/GitHub release for a related
  tool. Cost: 1 query.
- **Where Ceramic underperforms (Probe 5, "How do I write a SessionStart hook
  for Claude Code that returns continue true on errors"):** the natural-
  language phrasing diluted the keyword signal. Top result was loosely
  related ("Warcraft III Peon voice notifications" — a Claude Code hook
  *demo*); the actually-useful Claude Code hooks blog post sat at result #5.
  Same lexical-vs-semantic mismatch the Ceramic best-practices doc explicitly
  warns about: "Vague queries… conversational questions… Misspellings or
  loosely related terms" all underperform.
- **Best-practices doc's own LLM-rewrite recipe** (`api/search/best-practices.md`):
  > "Use an LLM to generate multiple keyword-focused queries… 'Rewrite the
  > following user query into a concise, keyword-based search query optimized
  > for a lexical search engine'"

  This recipe should be encoded into the Phase 3 shared client or the
  research-conductor agent — wrap user questions with a Claude rewrite step
  before sending to Ceramic. That converts Probe 5's underperformance into a
  Probe 4-style hit at the cost of one additional model-call per research
  invocation.

---

## 6. Probe log (5/5 used)

```
Probe 1: POST https://api.ceramic.ai/search
  Body:    {"query":"California rental laws"}
  Status:  200
  Latency: 279 ms total (server executionTime 113 ms)
  Headers: HTTP/2, application/json; charset=utf-8, no rate-limit headers
  Notes:   Confirms documented response shape verbatim. 10 results.
           description field is multi-paragraph content excerpt (~1.7 KB on
           top result), not a one-liner snippet.

Probe 2: POST https://api.ceramic.ai/search   (no Authorization)
  Body:    {"query":"hello"}
  Status:  401
  Latency: 48 ms
  Headers: WWW-Authenticate: Bearer; application/problem+json
  Body:    {"title":"Unauthorized","status":401,
            "detail":"Missing authentication token.",
            "requestId":"...","code":"missing_api_key"}
  Notes:   Confirms standards-compliant 401 with RFC 7807 Problem Details.

Probe 3: POST https://api.ceramic.ai/search
  Body:    {"prompt":"hello"}
  Status:  400
  Latency: 54 ms
  Headers: application/problem+json
  Body:    {"title":"Invalid request","status":400,
            "detail":"Unsupported parameter: prompt.",
            "requestId":"...","code":"unsupported_parameter"}
  Notes:   Reproduces the exact 400 example in api-reference/error-codes.md.

Probe 4: POST https://api.ceramic.ai/search
  Body:    {"query":"Claude Code plugin marketplace plugin.json schema"}
  Status:  200
  Latency: 165 ms total (server 113 ms)
  Notes:   Realistic technical query. Top 5 results all topically relevant
           (Claude Code marketplace guides, security research, GitHub
           release notes). Lexical match strong on specific terms.

Probe 5: POST https://api.ceramic.ai/search
  Body:    {"query":"How do I write a SessionStart hook for Claude Code
            that returns continue true on errors"}
  Status:  200
  Latency: 155 ms total (server 97 ms)
  Notes:   Natural-language question. Top result loosely related
           (Warcraft III Claude Code hook demo). Useful Claude blog post
           on hooks landed at #5. Confirms docs' own warning about
           conversational queries. Motivates the LLM-rewrite step in §5.1.
```

Probe-budget summary: 5/5 used. No further live API calls planned for
Phase 2.

---

## 7. Phase 3 hand-off — what this changes

1. **Integration is one-line for HTTP MCP, not a custom client.** The
   Ceramic team ships a public HTTP MCP at `https://mcp.ceramic.ai/mcp` with
   tool `ceramic_search`. This drops into `plugins/yellow-research/.claude-plugin/plugin.json`
   exactly the same way `parallel` does today (current line range `:55-57`).
2. **Direct HTTP client is still useful** for cost-tracking, retries beyond 2,
   and for `yellow-core/agents/research/best-practices-researcher.md` which
   does not currently consume the yellow-research MCPs. Phase 3 should
   propose both: the MCP entry for plugin-level integration, and a thin
   shared TS module for programmatic use (the repo has no shared HTTP client
   today — see Phase 1 §3.1).
3. **Lexical-vs-semantic mismatch is real.** Ceramic is **not** a one-for-one
   replacement for the entire research stack. Phase 3's migration list must
   say so: drop-in for `perplexity_search` and `tavily_search` and built-in
   `WebSearch`; **keep** Perplexity-research / Tavily-research / EXA-deep /
   Parallel deep-research / Tavily-extract / Context7 / GitHub-grep / EXA
   neural for queries where Ceramic underperforms.
4. **Pricing is not the constraint — QPS is.** $0.05/1K means one heavy day
   inside this repo costs ~$0.003. The 20-QPS PAYG ceiling is comfortable
   for the existing fan-out (Complex tier at most 4 parallel sources). No
   throttle work needed in Phase 3 unless a future workflow bursts.
5. **The LLM-rewrite recipe should be encoded in either the shared client
   (preferred, single place to maintain) or in the research-conductor agent
   prose** — it is the one piece of Ceramic-specific guidance that the
   provider's own docs strongly recommend, and Probe 5 confirms why.
6. **Rollback is one MCP entry to remove.** With the HTTP-MCP integration
   pattern, the rollback config flag from the original Phase 3 brief becomes
   "remove the `ceramic` block from `plugin.json` and restart Claude Code"
   — no code rollback path needed.
