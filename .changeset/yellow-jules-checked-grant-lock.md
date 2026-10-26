---
'yellow-jules': patch
---

Require the controller lock whenever a grant write passes a controller check:
`revokeGrant` and `releaseSlotInStore` now take one `{ beforeWrite, lock }`
object, so a caller cannot pass the check without the lock. The take-over
lock-wait test now waits for the take-over to reach its lock attempt instead of
a fixed 300 ms.
