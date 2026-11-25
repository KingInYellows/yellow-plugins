---
'yellow-ruvector': patch
---

Fix a flaky SessionStart test: wait for the old co-edit cursor temp to be swept
before asserting it is gone, instead of checking it as soon as the other two
temps disappear. The test's other temp-sweep checks keep running.
