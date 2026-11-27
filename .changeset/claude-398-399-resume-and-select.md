---
'yellow-core': patch
---

`/flow:work` resume no longer rebuilds a stack item whose PR merged and whose
branch was deleted: the item is reconciled from its merged PR when this
checkout built the PR head. A fresh run no longer stops when origin cannot be
read, and a half-built branch is no longer reported as ready to submit.
`/stack:select` refuses a switch that a narrower-scope disable would undo, and
a user-scope switch planned from a repository that disables the other provider
now still disables it at user scope. `/setup:all` shows a plugin installed for
another project as such instead of suggesting the cached copy be cleared.
