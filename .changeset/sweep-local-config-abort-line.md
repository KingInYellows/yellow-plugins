---
'yellow-review': patch
---

`/review:sweep` ends a changed-local-config stop with an anchored
`Sweep: aborted (local-config-changed)` line, and `/review:sweep-all` reads it
as an aborted batch (`aborted=1`) instead of a `no contract` review blocker
(CLAUDE-180).
