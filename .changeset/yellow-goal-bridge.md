---
'yellow-goal': minor
'yellow-core': patch
---

Add the read-only `yellow-goal` engine bridge: `/goal:setup` probes a pinned
`goal-gen` process (`version --json` vs `0.1.0`) and fail-closes on missing
binary or mismatch; `/goal:request` wraps `request create` / `request validate`.
The engine is spawned, never imported. Fake-binary contract tests cover the
process contract; the live v0.1.0 tarball CI job waits on that GitHub Release.
