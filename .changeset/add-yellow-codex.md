---
"yellow-codex": minor
"yellow-review": minor
"yellow-core": minor
---

Add yellow-codex plugin wrapping OpenAI Codex CLI with review, rescue, and
setup workflows. Patch yellow-review to spawn codex-reviewer as an optional
supplementary reviewer, and patch yellow-core to surface yellow-codex readiness
plus delegate codex:setup from /setup:all.
