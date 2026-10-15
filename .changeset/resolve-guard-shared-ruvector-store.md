---
"yellow-review": patch
---

The resolve ignored-file guard no longer stops on `.ruvector/intelligence.json`.
A linked worktree shares the ruvector memory store with the main checkout, so
another session's MCP server could save it mid-run and revert every fix.
`run-verify-command` now skips it while it is a regular file and prints a
`Note:` line when it changed, and `/review:resolve` reports it as a
non-blocking note. Other files under `.ruvector/` still stop the run.
