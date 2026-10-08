---
"yellow-review": patch
---

Share git hardening between the resolve commit and verify scripts, refuse a gt or node symlink into the worktree, and require --ignored-since on every verify run. The commit script now drops in-worktree PATH entries before it runs gt or node by absolute path, refuses an empty cleaned PATH, and checks `timeout` and `gtimeout` before the probe that runs them. The revert and check-ignored modes of run-verify-command no longer refuse a repository-local transport, credential or signing config (a resolver could block its own rollback that way), the verify command no longer inherits `safe.bareRepository=explicit`, and `harden_git_config` reads config through `yr_git` and fails closed when awk fails.
