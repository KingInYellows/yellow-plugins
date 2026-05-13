---
'yellow-research': patch
---

feat(yellow-research): emit credential-status.json from SessionStart

Adds `hooks/write-credential-status.sh` (wired via plugin.json SessionStart)
that emits `${CLAUDE_PLUGIN_DATA}/credential-status.json` describing which
of the four API key fields (perplexity, tavily, exa, ceramic) are resolved
from `userConfig` vs shell env vs absent.

This lets `/setup:all` (in a subsequent PR) classify yellow-research as
READY when keys are in the keychain (which it couldn't see before — it only
probed shell env vars). No behavioral change to MCP servers; the 3-element
fallback wrapper from v3.1.0 already worked correctly at runtime.
