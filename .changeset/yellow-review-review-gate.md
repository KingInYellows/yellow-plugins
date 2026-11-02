---
'yellow-review': minor
'yellow-core': patch
---

Add the `review-gate` dynamic workflow (`/yellow-review:review-gate`), the Hunt
→ Vote → Rank core of the risk-tiered review pipeline: one persona agent per
included reviewer, a plain-code dedup, one or three verifier votes per finding
by severity and risk tier, then Important / Nit / Pre-existing ranking with the
REVIEW.md Nit cap. A reviewer that fails is reported in `coverage.failed`, never
as a clean review. `/review:pr` runs it in shadow mode when
`yellow-plugins.local.md` sets `review_pipeline: workflow`: the persona review
is unchanged and Coverage adds a one-line comparison; the workflow's findings
are not applied or recorded. yellow-core's `local-config` skill documents the
new `review_pipeline` value.
