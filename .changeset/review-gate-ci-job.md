---
'yellow-review': patch
---

Document the new `review-gate.yml` CI job, which runs the `review-gate` workflow
headless on non-draft PRs with the default branch's reviewer (shadow by default,
advisory comment opt-in, never blocks).
