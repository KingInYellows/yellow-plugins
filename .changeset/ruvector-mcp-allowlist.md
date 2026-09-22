---
'yellow-ruvector': patch
---

Launch the ruvector MCP server with an explicit `RUVECTOR_MCP_ALLOW`
list of the five tools this plugin calls. Do not set
`RUVECTOR_MCP_PROFILE`. On ruvector 0.2.34 an empty or misspelled
policy exposes every tool, and a profile unions extra tools into the
allowlist. `hooks_remember` stays allowed. The pin stays
`ruvector@0.2.34`.
