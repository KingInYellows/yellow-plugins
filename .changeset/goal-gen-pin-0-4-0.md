---
'yellow-goal': minor
'yellow-core': patch
---

Pin the goal-gen engine to 0.4.0 (annotated tag `v0.4.0` at `63647f1`,
`goal-gen-0.4.0.tgz` SHA-256 `e95639e3…ba78`). 0.4.0 splits the engine's models
by role: extraction on Sonnet, action attempts on Haiku, and retries after a
failed attempt on Sonnet. The approval-gated real run is unchanged. `/setup:all`
now reports READY only for engine version 0.4.0.
