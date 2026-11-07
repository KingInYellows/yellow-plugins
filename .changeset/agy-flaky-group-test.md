---
'yellow-agy': patch
---

Stabilize the bridge Linux group timeout test: check every member of the killed
process group, ignoring zombies, and give a busy runner up to two seconds to
show them gone.
