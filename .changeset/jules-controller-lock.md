---
'yellow-jules': patch
---

Serialize controller authority writes across data directories that share a
controller id (CLAUDE-182). A new `<controllerDir>/<controllerId>.lock`, taken
inside the journal lock, now covers the first `authorize`,
`authorize --take-over` and `--revoke`, reservations and the dispatch stamp,
slot releases, `abandon`, `supervise --clear-pause` / `--clear-deviation`, and
reconcile persistence. Two concurrent take-overs can no longer roll the
authority back to a stale epoch, and a take-over of another data directory can
no longer land between a write's controller check and its journal write.
