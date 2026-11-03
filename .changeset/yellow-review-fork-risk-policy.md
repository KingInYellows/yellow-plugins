---
'yellow-review': patch
---

Read the risk policy and base branch from the PR's base repository, not
`origin`, in `/review:pr` and `/review:resolve`. In a fork checkout `origin` is
the fork, so its owner could set the displayed tier. A new `pr-base-remote`
helper picks the configured remote that points at the base repository, or its
https URL when none does.
