---
"yellow-research": minor
"yellow-core": minor
---

Add Ceramic.ai as the default first-hop research backend across yellow-research
and yellow-core.

- yellow-research: bundle a 6th MCP server entry pointing at
  `https://mcp.ceramic.ai/mcp` (OAuth 2.1; same shape as the existing
  Parallel Task block). The `code-researcher` and `research-conductor` agents
  prefer `ceramic_search` for general-web and Simple/Moderate triage tiers,
  with explicit fall-through to the existing Perplexity/Tavily/EXA stack
  when Ceramic is unavailable or returns no useful results. Both agents are
  instructed to rewrite topics into concise keyword form before calling
  Ceramic, since it is a lexical (not semantic) search engine.
  `/research:setup` gains a `CERAMIC_API_KEY` format check, REST live-probe,
  and dashboard row; `CERAMIC_API_KEY` powers the REST probe only — the MCP
  authenticates via OAuth.

- yellow-core: bundle the same Ceramic MCP entry as a second `mcpServers`
  alongside `context7`. The `best-practices-researcher` agent leads its
  Phase 2 web-search step with `ceramic_search`, falling back to built-in
  `WebSearch`. `WebFetch` stays primary for single-URL content fetches
  (Ceramic has no fetch endpoint).

Pricing: $0.05 per 1,000 queries (vs. tens of $/month per provider in the
prior stack). Rate limits: 20 QPS pay-as-you-go; 50 QPS Pro.

No prior backend is removed. Roll back by deleting the `mcpServers.ceramic`
block from either plugin's `plugin.json`.
