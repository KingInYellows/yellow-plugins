---
'yellow-core': patch
---

Bring `/setup:all` in line with the current per-plugin setup commands:
yellow-agy now needs agy 1.4.12+, its resolved CLI and `jq`, and the
detail names the MCP-server opt-in check `/agy:setup` runs; the council
tool probe adds `cp`, `ln`, `chmod` and `cmp`; yellow-review reports a
degraded review-findings ledger when `flock` or `realpath` is missing.
