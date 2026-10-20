---
"yellow-review": patch
---

Make the symlink-chain test for `rp_ignored_changed_since` deterministic: the two links no longer share a directory, so readdir order cannot decide which one the walk names.
