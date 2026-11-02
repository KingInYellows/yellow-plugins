---
'yellow-review': minor
---

Add `classify-risk`, which sorts a change into a review risk tier (`low`,
`medium`, `high`) from its changed paths and the repository's
`.github/review-risk.json`, read from a trusted ref: the base ref by default, or
the default branch when called with `--policy-ref` as `/review:pr` does, so a
pull request (or the parent PR in a stack) cannot lower its own tier.
`/review:pr` reports the tier in its Coverage section; it does not change
reviewer selection yet. Also adds a root `REVIEW.md` with the repository's
review rules and the seed risk policy. First step of the risk-tiered review
pipeline in `plans/risk-tiered-review-pipeline.md`.
