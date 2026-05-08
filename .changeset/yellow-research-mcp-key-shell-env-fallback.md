---
"yellow-research": minor
---

feat(yellow-research): MCP API keys now fall back to shell env when userConfig is unset

Each of the perplexity, tavily, and exa MCP servers now launches via a thin
wrapper script (`bin/start-<server>.sh`) that resolves its API key with the
following precedence:

1. `userConfig` value (preferred — keychain-encrypted via Claude Code)
2. Shell env fallback: `PERPLEXITY_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`

Power users who already export these keys in their shell rc no longer have
to re-enter them through the plugin config UI. If both sources are set,
`userConfig` wins. If neither is set, the wrapper unsets the empty value so
the MCP package sees "absent" rather than "explicitly empty"; behavior on
the no-key path is unchanged.

The wrapper pattern matches the existing `plugins/yellow-morph/bin/start-morph.sh`
precedent. `--` separator added before forwarded args defends against future
flag-injection if Claude Code ever passes args to MCP servers.
