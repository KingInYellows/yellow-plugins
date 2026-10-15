---
"yellow-review": minor
---

Interactive `/review:resolve` now asks before reverting trusted-config files
(agent instructions and tool config) on a refusal path. The new
`run-verify-command --revert-denied --dry-run` lists them without reverting,
and "Leave them" reports each under Blocking merge. `--non-interactive` runs
still revert them without asking.
The confirmed revert passes the preview's `--expect-snapshot` and refuses
when a trusted-config file changed while the user was asked.
