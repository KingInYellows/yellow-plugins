---
'yellow-review': minor
'yellow-core': patch
---

Settled decisions in review (CLAUDE-293): `/review:pr` and `/review:all` read
the `(session-settled: …)` entries of the plan a PR names in its body or commits
under `plans/` (new `settled-decisions-context` script) and set aside P2/P3
`maintainability`/`docs` findings that only re-argue one. Set-aside findings are
listed under Coverage, not applied and not written to the ledger. Defect
findings, and any finding that shows a settled option cannot work, keep full
severity. PRs without a plan behave as before.
