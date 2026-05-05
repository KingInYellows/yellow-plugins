---
'yellow-core': minor
---

git-worktree: inject `.ruvector/` symlink into new worktrees so the ruvector
MCP server and hook scripts reach the project's shared DB instead of silently
no-op'ing on a missing directory. Adds three new helpers to `worktree-manager.sh`
(`get_main_repo_root`, `link_ruvector_db`, `cleanup_ruvector_link`), wires them
into `create` / `copy-env` / `cleanup`, mirrors the cleanup logic in
`/yellow-core:worktree:cleanup`, and ships bats coverage. Also adds a new
`plugin-shell-tests` CI job that runs the new yellow-core suite as a required
check and existing plugin bats suites as advisory.
