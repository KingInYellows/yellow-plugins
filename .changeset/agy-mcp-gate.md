---
'yellow-agy': patch
---

`setup` now runs `agy mcp list` itself and refuses with `AGY_MCP` before it
records host.json when a server is enabled, the command fails, or its table
can't be parsed (pinned to the agy 1.4.12 output captured on the owner's PC).
The owner can keep a server by naming it with `setup --allow-mcp <name>` and
typing the code shown on their own terminal; setup then warns that its tools
bypass the command allowlist and flags an unpinned launch line.
