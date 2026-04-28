---
"yellow-core": minor
"yellow-review": minor
"yellow-debt": patch
---

Enable true parallel execution for multi-agent review sessions

Add `background: true` to 13 review agents (7 in yellow-core/agents/review,
6 in yellow-review/agents/review) plus `best-practices-researcher` and update
orchestrator commands (review-pr.md, resolve-pr.md, work.md, audit.md) to
explicitly require `run_in_background: true` on each Task invocation.
Frontmatter flag alone is insufficient — the spawning call must also run in
the background for agents to run concurrently rather than serially. Also
correct invalid `memory: true` to `memory: project` (the field requires a
scope string: `user` / `project` / `local`).
