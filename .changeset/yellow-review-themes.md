---
"yellow-review": minor
"yellow-core": patch
---

`/review:pr` now numbers findings once and opens its report with a
`### Themes` section that groups related findings by shared root cause,
subsystem, failure mode or fix path, with a preferred fix per group. Grouping
never changes a finding's severity, route or ledger record, and groups are
re-partitioned after fixes are applied. New `review_grouping: auto | off |
always` key in `yellow-plugins.local.md` (CLAUDE-218).
