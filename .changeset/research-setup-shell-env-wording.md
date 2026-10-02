---
'yellow-research': patch
---

fix(yellow-research): `/research:setup` no longer says a shell-env-only API key
makes the MCP fail. The `start-*.sh` wrappers fall back to `EXA_API_KEY`,
`TAVILY_API_KEY` and `PERPLEXITY_API_KEY` (userConfig wins when both are set),
so the status line reads `set (shell env only — MCP reads it via the
start-*.sh fallback)`, a rejected live probe lists only real causes, and the
`research-patterns` skill describes the same precedence. When a userConfig key
is also set, the shell-key probe now reports `PRESENT (userConfig takes
precedence — shell key probe: ACTIVE|INVALID)` (Perplexity stays pending until
its MCP tools are visible) instead of a misleading ACTIVE/INVALID. Without jq the
override is not applied (the userConfig check is then a substring match that can
false-positive) and the detail says so, and each Step 3 probe block now prints
its `provider`, `provider_status` and `provider_detail` lines so Steps 4 and 5
can read the result.
