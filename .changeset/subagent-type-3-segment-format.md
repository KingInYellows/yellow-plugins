---
"yellow-review": patch
"yellow-core": patch
"yellow-docs": patch
---

Fix subagent_type format to 3-segment (plugin:directory:agent) across keystone orchestrator and command files.

The Wave 2 keystone (`/review:pr`) Step 4 dispatch table, Step 3d learnings
pre-pass, Step 7 code-simplifier pass, and Step 9a knowledge-compounding step
all referenced agents using the 2-segment form (e.g.
`yellow-review:correctness-reviewer`). The Claude Code agent registry
requires the 3-segment form (`yellow-review:review:correctness-reviewer`,
where the middle segment is the agent's subdirectory under
`plugins/<name>/agents/`). The 2-segment form fails dispatch with
"Agent type not found" — meaning every persona spawn from the new keystone
would error even after the cache picks up the new agents.

This is purely a documentation / orchestration-prose fix; no agent
behaviour changes. Affected files:

- `plugins/yellow-review/commands/review/review-pr.md` — 17 dispatch table
  entries + 3 inline `subagent_type:` references
- `plugins/yellow-review/commands/review/review-all.md` — 1 inline reference
  (parity with review-pr.md Step 3d)
- `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — 2 cross-plugin
  Task examples (security-sentinel, codex-reviewer); pattern hint expanded
  to clarify the 3-segment shape
- `plugins/yellow-review/agents/review/code-reviewer.md` — deprecation-stub
  migration guidance (was pointing users to the wrong format)
- `plugins/yellow-core/commands/workflows/compound.md` — knowledge-compounder
  dispatch
- `plugins/yellow-core/commands/workflows/work.md` — codex-executor rescue
  dispatch
- `plugins/yellow-core/agents/research/learnings-researcher.md` — usage-doc
  invocation example
- `plugins/yellow-docs/commands/docs/audit.md`, `diagram.md`, `generate.md`,
  `refresh.md` — 5 doc-auditor / diagram-architect / doc-generator dispatches

Discovered while running a manual /review:pr trial against PR #287
(Wave 3 trial branch). Every Wave 2 persona dispatch errored with
"Agent type not found" until the 3-segment form was used. This blocks
the keystone from running end-to-end even after a plugin cache refresh.
