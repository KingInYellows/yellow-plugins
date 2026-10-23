---
'yellow-jules': minor
---

`supervise --clear-deviation --session <ref>` is the recovery path for a
blocking policy deviation: TTY-confirmed, controller-checked, and only after a
complete `status` walk newer than the deviation. It marks the session's open
deviations reconciled; a pull request reference outside the grant's repository
also revokes the owning grant, so work continues only under a fresh grant.
`status --reconcile` now asserts the grant's controller authority before any
journal write, so a copied data directory can no longer settle a create as
`failed`. `authorize --take-over` writes its journal marker (now carrying the
new epoch) before rebinding grants, and reconcile leaves reservations unaged
when a grant's epoch has no matching marker. The pending-plan rebase orders a
plan against a concurrent watermark by `createTime` only, keeping an equal-time
plan as `ambiguous` instead of dropping it.
