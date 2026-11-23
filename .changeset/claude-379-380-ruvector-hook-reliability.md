---
'yellow-ruvector': patch
---

Prevent SessionStart from injecting a previous store’s cached memories when
a new store occupies the same path. Ordinary writes to the existing store
preserve its warm recall. Update the hook documentation and cover detached
co-edit updates under contention and timeout.
