---
'yellow-review': minor
'yellow-core': patch
---

`/review:merge-ready` and `check-merge-ready` report approval by risk tier
(CLAUDE-234). The tier comes from `classify-risk` over the PR's files with
`.github/review-risk.json` read at the default branch tip. Low needs no human;
medium and high need one approving review on the head SHA from a listed human
(never a bot); high also needs a cross-lineage bot review on the head. The new
`yellow-plugins.local.md` keys `review_approval_gate` (`off`, `advisory`
default, `enforce`), `review_approval_humans` and `review_cross_lineage_bots`
are documented in yellow-core's local-config skill.
