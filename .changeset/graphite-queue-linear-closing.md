---
'yellow-linear': patch
'gt-workflow': patch
'yellow-core': patch
---

Make Linear follow PRs landed through Graphite's merge queue. The queue closes
PRs instead of merging them, so Linear's "PR merged" automation never fired.
`smart-submit` and `/flow:work` now end the commit body with a Linear closing
line (`Part of <ISSUE-ID>`, or `Closes <ISSUE-ID>` on the commit that completes
the issue) taken only from the branch name's ID segment or the plan's `Linear:`
field, and `gt-amend` keeps an existing line. `/linear:sync`, `/linear:sync-all`
and `linear-pr-linker` no longer read a `CLOSED` PR whose `(#<number>)` squash
commit is on the default branch as closed without merge; the check is the new
tested `scripts/pr-landed.sh`, which answers `unknown` for a shallow clone, a
mismatched origin or any fetch or log failure. `/linear:sync-all` now lists PRs
with `--state all`. The Linear and GitHub setup steps are in the yellow-linear
README.
