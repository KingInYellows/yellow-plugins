---
'yellow-ruvector': patch
'yellow-core': patch
---

yellow-ruvector: the MCP launcher leases its pinned install so a concurrent
prune from another plugin version skips it until the server starts;
remove-legacy-hooks treats a quoted executable word
(`"/usr/local/bin/ruvector" hooks post-edit`) as a ruvector invocation.
yellow-core: `/setup:all` probes every yellow-ruvector data-dir candidate
instead of stopping at the first, so a stale broken one no longer hides a
healthy install.
