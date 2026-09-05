---
'yellow-goal': minor
---

Pin the released Yellow Goal engine `0.2.0` (annotated tag `v0.2.0`, public
GitHub Release asset `goal-gen-0.2.0.tgz` with its SHA-256) and add the pure
Provider Protocol v1 consumer guards: capability discovery validation, strict
single-object and JSON Lines framing, run-event stream ordering, terminal
summary/stderr/exit agreement, and additive protocol error codes with bounded
diagnostics. The blocking public-artifact job now verifies the asset hash before
installing it and performs the `capabilities --json` handshake. Existing
`/goal:setup` and `/goal:request` behavior is unchanged; no run surface is
exposed yet.
