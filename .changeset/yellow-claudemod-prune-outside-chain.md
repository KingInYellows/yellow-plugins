---
'yellow-claudemod': patch
---

Run ledger key pruning beside the write chain, one prune at a time, so a store
call that never answers while pruning no longer holds up later spawns' rows.
