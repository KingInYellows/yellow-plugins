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
