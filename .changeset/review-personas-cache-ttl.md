---
'yellow-review': patch
'yellow-core': patch
---

Set `experimental.cacheTtl: 1h` on the four always-on `/review:pr` personas
(`project-compliance-reviewer`, `correctness-reviewer`, `maintainability-reviewer`,
`project-standards-reviewer`), on `code-simplifier` (the unconditional Step 8
final pass), and on `learnings-researcher` (the Step 3d pre-pass) — the agents
that run with a stable system prompt on every review. The one-hour prompt
cache lifetime means a second review within the hour reads those prompts from
cache instead of re-processing them. Verified against Claude Code 2.1.259;
ignored while a subscription is drawing on usage credits.
