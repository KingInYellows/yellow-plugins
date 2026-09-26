---
'yellow-review': patch
---

`/review:triage` now records a closed or merged PR's state in the ledger
(new `review-ledger.sh refresh-state <pr>`), so the SessionStart notice stops
counting a PR that closed with findings still pending. Before, `<pr>.state`
was only refreshed by a ledger write, and the notice kept counting the PR as
pending for up to 7 days. Found during the manual check for task 6.5a.
