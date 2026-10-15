---
'yellow-review': minor
'yellow-core': patch
---

`/review:resolve` keeps re-passing after each fix push while the review bot
keeps posting P1 findings, up to `resolve_pr.repass_max_passes` (default 5), and
stops early when the bot goes quiet or only P2-or-lower findings arrive. A new
`pr-review-delta` script checks without a model call whether any review thread
has appeared since the last recorded run.
