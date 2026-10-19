---
"yellow-review": patch
---

The resolver hard-link screens in `lib/resolve-paths.sh` no longer compare a
file's device with the worktree root directory's device. Overlayfs reports a
different st_dev for directories than for regular files, so a hard link in an
outside PATH directory to a worktree file (a planted git-lfs or ssh) passed
`yr_resolve_tool`, `yr_safe_path` and `harden_git_config`. The screens now
match file to file (`find -samefile`, or device and inode against the tree
walk); the stat fallback also checks the devices of the worktree's multi-link
files. Unreadable link counts and failed walks still fail closed.
