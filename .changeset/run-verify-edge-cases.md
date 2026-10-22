---
"yellow-review": patch
---

`run-verify-command` edge cases. A directory in the worktree that another user
owns and this user cannot read, write or search (a root-owned docker volume)
no longer drops every PATH directory and stops every mode; an unreadable
directory the user owns still fails closed, and stderr now names it instead of
a missing awk (CLAUDE-174). The recovery patch keeps the staged content of a
path replaced by a FIFO, socket or device instead of recording an empty
creation or a deletion (CLAUDE-128). A directory that replaced a tracked file
is checked against the mount table before its device walk, which no longer
crosses filesystems (CLAUDE-109).
