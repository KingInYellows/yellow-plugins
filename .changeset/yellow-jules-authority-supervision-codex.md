---
'yellow-jules': minor
---

Add the mutating and supervision surface, gated by owner-written grants.
`delegate`, `reply`, and `approve` send a single, never-retried request under
`--grant-id`; `authorize` writes, lists, and revokes grants and moves the
controller between hosts; `abandon` gives up an unresolved operation;
`supervise` runs one bounded pass and returns one decision. The runtime opens
`/dev/tty` itself and requires a typed challenge for `authorize`, `abandon`,
`supervise --clear-pause`, and `authorize --take-over`, so a caller without a
terminal cannot widen what it may do; the terminal check does not stop a
same-UID process that allocates its own pseudo-terminal, and grants do not
constrain a process that holds `JULES_API_KEY` itself; the README and CLAUDE.md
state both. Every write runs inside one authority critical section, a lost
response is reported as an unknown outcome and reconciled by
`status --reconcile` rather than replayed, and a data directory copied to
another path cannot write. Adds six command wrappers, the host-neutral
`jules-delegation` and `jules-supervision` skills, and enables both for Codex.
Live Jules behavior is still unexercised: the owner smoke in
`docs/yellow-jules/smoke-procedure.md` comes next.

A write stamped in the same millisecond as a status walk's start can no longer
claim a same-text teammate message as its echo (it is held, then classified as
outside), and `status --reconcile` frees the grant slot of a create it binds to
an already completed or failed session in the same run.

Overlapping `supervise` passes for one session no longer let an older pass
clear or replace the plan a newer pass evaluated, so a plan swap is neither
missed nor falsely paused.

Relative order no longer depends on clock resolution. The journal keeps a
`seq` counter that only advances under its lock, and the order of writes,
walks, supervise passes, plan evaluations, pauses and held messages is decided
by it, so two events in one millisecond are still ordered: a reply dispatched
after a plan evaluation explains a later plan change, one made before it does
not, and a write counts as an echo only when proven to precede the walk. State
written before this change has an unknown order and never authorizes anything
(a pause it holds is cleared only by a walk that carries a sequence).
`status --reconcile` and a create's own bind now fold an `observe` row for the
same session into the create (deviations, pause and outside markers; read
cursors reset) and retire that row, and refuse to bind a session another create
already owns (`session-already-owned`), so a recorded policy deviation can no
longer be hidden from the write gate.

A `reserved` or `unknown-outcome` reply no longer hides a plan replacement from
`supervise`: only an accepted, reconciled, or echo-confirmed reply explains it,
so an unproven reply fails safe and the pass pauses. `status --reconcile` now
resolves an unknown-outcome reply as landed when a plain `status` had already
recorded its echo, instead of leaving it unknown.

`status --reconcile` no longer binds an unknown-outcome reply to an echo that a
settled reply with the same text may own; it stays unresolved and `status`
credits such an echo to the settled reply first. `supervise` withholds `reply`
for a question the command wrapper would display differently (for example
`git push --force`, tabs, or text over 6000 characters), the same rule plan
review follows.

The same holds for an unknown-outcome approval when a settled approval of the
same plan could own the single `planApproved` activity.

A plan step with a missing or non-string title, or a present non-string
description, is now an unmapped activity instead of being read as empty text,
so such a plan is neither shown as reviewed nor approved. `delegate
--retry-failed` checks the data directory location before it reads the journal,
so a data directory inside the checkout or plugin cache is refused without
creating anything. `supervise --clear-pause` requires this host's controller
authority for the pause's grant.

`supervise` now pauses when a newer plan reuses the evaluated plan id with
different steps, and offers no approve or reply for a plan whose text `status`
redacted. A question-bound `reply` is refused when a user message that this
plugin did not send follows the question.
