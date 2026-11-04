---
'yellow-review': patch
---

Document the new `review-gate.yml` CI job, which runs the `review-gate` workflow
headless with the default branch's reviewer on non-draft, same-repository,
human-authored PRs when `CLAUDE_CODE_OAUTH_TOKEN` is set (shadow by default,
advisory comment opt-in; findings never block).
