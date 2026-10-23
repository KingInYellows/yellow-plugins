---
'yellow-review': minor
---

`/review:pr`, `/review:all` and `/review:triage` now commit review fixes through
`commit-resolve-fixes`, the script `/review:resolve` already uses: it stages
only the files the fixes touched, adds a new commit instead of amending the
branch's last one with `gt modify -m`, submits through the active provider and
verifies the remote head (CLAUDE-54). The ledger records the fix SHA from the
script's result.
