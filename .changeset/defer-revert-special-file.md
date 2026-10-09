---
'yellow-review': patch
---

In revert modes, `run-verify-command` keeps a listed FIFO, socket, or device
until the recovery patch has recorded its tracked deletion without opening it.
If that snapshot cannot be written, the special file stays in place and
nothing is reverted.
