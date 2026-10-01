---
'yellow-research': patch
---

fix(yellow-research): `/research:setup` no longer says a shell-env-only API key
makes the MCP fail. The `start-*.sh` wrappers fall back to `EXA_API_KEY`,
`TAVILY_API_KEY` and `PERPLEXITY_API_KEY` (userConfig wins when both are set),
so the status line reads `set (shell env only — MCP reads it via the
start-*.sh fallback)`, a rejected live probe lists only real causes, and the
`research-patterns` skill describes the same precedence.
