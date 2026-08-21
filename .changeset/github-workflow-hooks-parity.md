---
"github-workflow": minor
---

Add `check-git-push` (PreToolUse) and `check-commit-message` (PostToolUse)
hooks, mirroring `gt-workflow`'s safety net — previously a repo with only
the GitHub provider enabled had no raw-`git push` block at all.
