---
"yellow-morph": minor
"yellow-core": patch
"yellow-research": patch
---

yellow-morph: migrate Morph API key from shell `MORPH_API_KEY` to plugin
`userConfig` (Claude Code prompts at plugin-enable time and stores in the
system keychain). Shell `MORPH_API_KEY` remains supported as a power-user
fallback. Ship `bin/start-morph.sh` wrapper and a SessionStart prewarm hook
that install `@morphllm/morphmcp@0.8.165` into `${CLAUDE_PLUGIN_DATA}` —
serialized via an atomic `mkdir`-lock so wrapper and hook cannot run
concurrent `npm ci`. Fix `ENABLED_TOOLS` no-op (morphmcp ignores it; switch
to `DISABLED_TOOLS=github_codebase_search`). Correct WarpGrep tool name
from the non-existent `warpgrep_codebase_search` to `codebase_search`.

yellow-core: update `setup:all` classification probe so yellow-morph is
detected via the renamed `codebase_search` tool, and refresh the
mcp-integration-patterns skill to reference the new tool name.

yellow-research: rename the `filesystem-with-morph` global MCP probe in
`/research:setup` to `codebase_search` (current name), with
`warpgrep_codebase_search` retained in `allowed-tools` as a backward-
compatibility hedge for users still on an older global MCP version.
