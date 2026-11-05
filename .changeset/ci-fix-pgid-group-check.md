---
'yellow-agy': patch
---

Stabilize the bridge Linux group timeout test by asserting the process group is gone instead of checking a single pid that CI may reuse.
