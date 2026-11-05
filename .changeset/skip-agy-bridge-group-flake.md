---
'yellow-agy': patch
---

Skip the flaky bridge-group timeout unit test. On a busy runner the killed
process id can be reused before the liveness check, which failed CI without a
product bug.
