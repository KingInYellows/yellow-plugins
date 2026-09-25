---
'yellow-review': minor
---

Add a SessionStart hook that prints one line when an open PR in this clone has
pending or attention findings in the review-findings ledger. It reads only
sidecar counts, names unverified PRs, stays within a 3 s budget (overall 2.3 s
deadline for lock waits and fallback folds), and never prints finding text.
