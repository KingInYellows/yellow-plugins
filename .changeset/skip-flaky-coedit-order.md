---
'yellow-ruvector': patch
---

Make the busy-store co-edit bats case deterministic. It started two
background edits a fixed 20ms apart and required the later path to be the
session's last file, so on a busy runner the later edit could finish first.
The test now starts the second edit only after the first has saved its
session state, which keeps the check that a waiting edit releases its
session lock.
