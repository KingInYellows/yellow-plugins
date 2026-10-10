---
'yellow-goal': patch
---

Make the runtime-protocol test helpers ignore a capture line the fake provider is still appending, so a poll no longer fails on half-written JSON.
