---
'yellow-review': patch
'yellow-core': patch
---

Set `experimental.cacheTtl: 1h` on the five always-run `/review:pr` agents
(`project-compliance-reviewer`, `correctness-reviewer`, `maintainability-reviewer`,
`project-standards-reviewer`, and the Step 8 `code-simplifier`) — the agents
whose stable system prompt is re-sent on every review. A second review within
the hour reads those prompts from cache. `learnings-researcher` (yellow-core)
stays at the default: `/review:pr` and the flow/docs callers dispatch it
once, and a `1h` write bills about 2x base input versus 1.25x for `5m`.
`/review:all` dispatches it once per PR and can pay back on a slow batch,
but the common path is a single `/review:pr`. A `subagentPromptCacheTtl`
setting or env var overrides the frontmatter for all subagents. Verified
against Claude Code 2.1.259; ignored while a subscription is drawing on
usage credits.
