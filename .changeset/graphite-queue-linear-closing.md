---
'yellow-linear': patch
'gt-workflow': patch
'yellow-core': patch
---

Make Linear follow PRs landed through Graphite's merge queue. The queue closes
PRs instead of merging them, so Linear's "PR merged" automation never fired.
`smart-submit`, `gt-amend` and `/flow:work` now end the commit body with
`Closes <ISSUE-ID>` when the branch or stack item carries a Linear ID, which
Linear's commit linking acts on when the squash commit reaches the default
branch. `/linear:sync`, `/linear:sync-all` and `linear-pr-linker` no longer read
a `CLOSED` PR whose `(#<number>)` squash commit is on the default branch as
closed without merge. The Linear and GitHub setup steps are in the yellow-linear
README.
