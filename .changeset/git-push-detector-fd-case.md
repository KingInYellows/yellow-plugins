---
'gt-workflow': patch
'github-workflow': patch
---

git-push hook detector:

- A shell whose script is `/dev/fd/N`, `/dev/stdin` or `/proc/self/fd/N`
  is read only when that descriptor has a heredoc, here-string, pipe or
  `N< <(…)` on the same command; otherwise the command is refused as
  unverifiable (`exec 3<<'X' … X` then `bash /dev/fd/3` used to pass
  unread).
- `git -c alias.x='!bash /dev/fd/3' x 3<<'T'`, `GIT_SSH_COMMAND=` and
  `PAGER=` values now keep the command's heredoc context, so a push inside
  it is caught; a pager or editor reading its own stdin is refused.
- `case` pattern lists (`*)`, `R*|C*)`) and `$((…))` arithmetic are no
  longer read as commands, so about 120 markdown shell blocks — including
  the six wrapped yellow-debt and yellow-ruvector blocks — stop tripping
  the "could not verify" refusal.
