---
'yellow-review': patch
---

`review-ledger.sh summary` leaves out a ledger that another session pruned while
it was being read, instead of reporting it as `null`. `/review:sweep` names the
worktree that holds a PR branch on a branch mismatch, with the
`cd '<path>' && /review:sweep <PR#>` command to run there, and
`/review:sweep-all` puts it in the summary's Notes.
