---
'yellow-core': patch
---

`/setup:all` detects yellow-ruvector's plugin-managed ruvector install (in its
plugin data dir) instead of a global `ruvector` on PATH, requires Node 20+, and
reports a missing install as PARTIAL (the plugin installs it on the next
session). The git-worktree skill and `worktree-manager.sh` comments no longer
describe the removed `RUVECTOR_STORAGE_PATH` env var.
