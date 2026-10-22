---
"yellow-claudemod": patch
---

The spawn ledger now keeps each session's rows under its own store key, so concurrent sessions no longer overwrite each other, and keeps the eight most recent sessions. A store call that never settles can no longer stall a subagent spawn: each ledger write gives up after 2 seconds. `/claudemod-status` says when the session's last ledger write failed. `/claudemod:setup` reports an installed but disabled plugin as disabled, with the command to enable it.
