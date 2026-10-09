---
'yellow-linear': minor
---

`/linear:delegate` now launches Jules sessions. When yellow-jules is the
resolved remote-agent provider, the command dry-runs the launch, finds an
unexpired grant covering the repository, branch, and issue, previews it, and
asks before launching. With no covering grant it prints the exact terminal
command that writes one and stops without contacting Jules or posting a Linear
comment. The Cursor and Devin paths are unchanged.

The Jules block removes its packet directory on every early exit through an
`EXIT` trap; only a dry run that found a covering grant keeps it for the
confirmation.
