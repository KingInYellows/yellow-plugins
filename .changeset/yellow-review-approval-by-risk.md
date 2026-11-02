---
'yellow-review': minor
'yellow-core': patch
---

`/review:merge-ready` and `check-merge-ready` report approval by risk tier
(CLAUDE-234). The tier comes from `classify-risk` over the PR's files with
`.github/review-risk.json` read at the default branch tip. Low needs no human;
medium and high need a listed human's approval of the head SHA (never a bot): an
approving review on it, or adding `graphite-queue` after the head arrived, since
GitHub will not let the owner approve their own PR; high also needs a
cross-lineage bot review on the head. The new `yellow-plugins.local.md` keys
`review_approval_gate` (`off`, `advisory` default, `enforce`),
`review_approval_humans` and `review_cross_lineage_bots` are documented in
yellow-core's local-config skill.
