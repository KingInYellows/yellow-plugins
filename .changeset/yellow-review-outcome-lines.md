---
'yellow-review': minor
---

`/review:resolve-stack` and `/review:sweep-all` now end with a machine-readable
outcome line, `ResolveStack: …` or `SweepAll: …`, carrying
`blocking=<n> ratelimited=<0|1> aborted=<0|1> not_attempted=<n> exit=<0|1>`. A
parent agent can tell a rate-limited run (re-run later) from blocking threads (a
human must answer) and a dirty-tree abort (fix the tree first) without parsing
the summary table. Exit codes are unchanged. Pinned in
`tests/skill-content.bats` (CLAUDE-66).
