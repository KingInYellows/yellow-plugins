---
'yellow-goal': minor
'yellow-core': patch
---

Add the read-only `yellow-goal` engine bridge: `/goal:setup` probes a pinned
`goal-gen` process (`version --json` vs `0.1.0`) and fail-closes on missing
binary or mismatch; `/goal:request` wraps `request create` / `request validate`.
The engine is spawned, never imported. Deterministic fake-process tests and
a blocking public v0.1.0 release-artifact job cover the process contract,
strict usage errors, identity checks, and bounded process termination.
