---
'yellow-ruvector': patch
---

Make the co-edit session and store locks exclusive on Ubuntu 26.04. Its
uutils `mkdir` can report success to two racing callers, so a lock is now
held by whoever also creates `<lock>/.owner` under noclobber (an `O_EXCL`
create done by the shell). Unlock and the reclaim-marker sweep remove the
owner file first.
