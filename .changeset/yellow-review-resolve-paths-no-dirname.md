---
"yellow-review": patch
---

Find `lib/resolve-paths.sh`'s own directory by parameter expansion instead of
`dirname`, so `commit-resolve-fixes` and `run-verify-command` no longer run a
PATH-resolved `dirname` before they screen PATH.
