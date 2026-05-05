---
"yellow-core": minor
"yellow-review": minor
"yellow-codex": patch
"yellow-debt": patch
---

Enable true parallel execution for multi-agent review sessions

Add `background: true` to 15 agents (7 in yellow-core/agents/review,
6 in yellow-review/agents/review, plus `yellow-core/agents/research/best-practices-researcher`
and `yellow-review/agents/workflow/pr-comment-resolver`) and update four
orchestrator commands (`review-pr.md`, `resolve-pr.md`, `work.md`, `audit.md`)
to explicitly require `run_in_background: true` on each Task invocation, with
explicit wait gates (TaskOutput / TaskList polling) before any step that
consumes agent output. Frontmatter flag alone is insufficient — the spawning
call must also run in the background for agents to run concurrently rather
than serially.

Memory field changes: drop the prior `memory: true` from review and research
agents (it was a no-op and re-adding a scope value would silently activate
per-spawn MEMORY.md injection of up to ~25 KB across 13+ parallel agents).
Set `memory: project` only on the three workflow orchestrators
(`brainstorm-orchestrator`, `knowledge-compounder`, `spec-flow-analyzer`),
where MEMORY.md context is intentional and the spawn fan-out is small.
Auditing the broader `memory:` activation across review agents remains a
Phase 1.5 follow-up (plan open question 8).
