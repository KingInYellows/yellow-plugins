---
date: 2026-02-22
topic: workflow-context-and-ruvector-optimization
---

# Workflow Context & Ruvector Optimization

## What We're Building

Two complementary improvements that reduce context loss and tool coordination
overhead in daily workflows:

1. **UserPromptSubmit hook** — auto-injects ruvector context before Claude
   processes any request, so agents never start cold
2. **Workflow skill mandates** — explicit required steps in `workflows:work`,
   `workflows:plan`, and `workflows:brainstorm` to search ruvector at start and
   store learnings on exit; plus a PR review handoff step after `gt stack submit`

## Why This Approach

**Considered:**
- *Context-hydration agent* (Approach C): reliable but adds 2–3s agent startup
  overhead to every workflow command — too heavy for the daily loop
- *UserPromptSubmit-only* (Approach A): structural enforcement without agent
  discipline, but misses the per-workflow ruvector mandates
- *Skill mandates only* (Approach B): low overhead but LLMs can skip guidance

**Chosen: A + B**
The hook handles passive enforcement at the system level (no agent discipline
required). Skill mandates reinforce the pattern within workflow commands and add
the PR review handoff. Together they cover both the "cold start" problem and the
"forgetting to store" problem.

## Key Decisions

- **UserPromptSubmit hook in yellow-ruvector**: new `user-prompt-submit.sh` that
  extracts the prompt from hook input, calls `npx ruvector hooks recall
  --top-k 5 "$PROMPT"`, injects results as `systemMessage`. Must complete in
  <3s. Skips if ruvector not initialized.

- **PostToolUse doc-indexing**: extend existing `post-tool-use.sh` to detect
  when Write tool creates `.md` files under `docs/` and queues them for
  incremental index via `npx ruvector hooks post-edit`.

- **workflows:work skill — ruvector steps**: add "Step 0: Search ruvector" using
  `hooks_recall` with the task description before any code changes. Add "Final
  step: store learnings" using `hooks_remember` after all work is committed.

- **workflows:work skill — PR review handoff**: after `gt stack submit`, the
  skill should prompt Claude to invoke `/workflows:review` with the PR URL. This
  closes the PR→review gap identified as a pain point.

- **workflows:plan and workflows:brainstorm skills**: add "Before generating
  output: recall relevant past plans/brainstorms from ruvector" and "After
  writing doc: index it via /ruvector:index" as explicit steps.

- **Graceful degradation**: all hook additions must follow the existing pattern —
  exit silently with `{"continue": true}` if `.ruvector/` is absent or
  `npx ruvector` is unavailable.

## Scope Boundaries

- No changes to ruvector's internal CLI or MCP tools
- No new agents (defer context-hydration agent to a future iteration)
- No changes to gt-workflow plugin hooks
- UserPromptSubmit hook targets yellow-ruvector plugin only

## Open Questions

- **Latency budget for UserPromptSubmit**: 3s limit — acceptable for everyday
  prompts? Might feel slow on quick single-line commands. Consider a character
  threshold (skip for prompts < 20 chars).
- **Doc indexing scope**: should PostToolUse also index files outside `docs/`
  (e.g., new agents or skills under `plugins/`)? Broader = more useful but
  harder to filter noise.
- **Skill mandate enforcement**: skills are guidance, not code — if agents skip
  the ruvector step, we'll need to evaluate whether Approach C is needed.
- **PR review handoff**: `/workflows:review` may not be the right trigger — does
  it need a PR URL, or does it auto-detect from current branch?

## Next Steps

→ `/workflows:plan 2026-02-22-workflow-context-and-ruvector-optimization-brainstorm.md`
