---
'yellow-core': minor
'gt-workflow': patch
---

# Summary

feat(yellow-core): add /worktree:cleanup command for smart git worktree cleanup

New `/worktree:cleanup` command in yellow-core that scans all git worktrees,
classifies them into 7 categories (missing directory, locked, branch merged,
stale, clean-active, dirty, detached HEAD), and removes stale worktrees with
appropriate safeguards.

Also adds Phase 6 to `/gt-cleanup` in gt-workflow to offer triggering
`/worktree:cleanup` via Skill tool with graceful degradation.
