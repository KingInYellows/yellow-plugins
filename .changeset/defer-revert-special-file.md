---
'yellow-review': patch
---

In revert modes, `run-verify-command` keeps a listed FIFO, socket, or device
until the recovery patch has recorded its tracked deletion without opening it.
If that snapshot cannot be written and the special file was put back, it stays
in place and nothing is reverted. The hold path is recorded before the rename
back. If that ledger write fails, the file is put back when it can; if it
cannot, stderr names the remaining path. A rewrite of the ledger replaces it
only after the new copy is complete, so a failed rewrite leaves the recorded
hold in place. Each record is the held path, a NUL, the original path, and a
NUL, so a newline in a tracked name cannot split the record. A rename back
that fails is retried; if the entry is still held, the reason names that path
instead of claiming the tree was untouched. An unlink that fails is reported and the revert continues,
so a special file already removed is still restored.
