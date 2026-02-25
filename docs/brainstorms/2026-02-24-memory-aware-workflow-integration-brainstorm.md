---
date: 2026-02-24
topic: memory-aware-workflow-integration
---

# Memory-Aware Workflow Integration

## What We're Building

A cohesive system that closes the learning loop and makes institutional memory actively influence agent behavior — rather than being a write-only archive.

Two sides of one system:

- **Write side (learning loop):** Every time a solution doc lands in `docs/solutions/`, it is automatically indexed into ruvector — ambient by default, explicit as belt-and-suspenders in the agent that creates it.
- **Read side (active memory):** Before acting, key agents query ruvector for relevant past findings, solutions, and known patterns — injected as context so agents build on prior work rather than starting from scratch.

## Why This Approach

The infrastructure already exists (ruvector hooks, learning-compounder, docs/solutions/) but the two halves are disconnected:
- `learning-compounder` writes to `docs/solutions/*.md` — but does not trigger ruvector indexing
- ruvector hooks index files — but are not wired to watch `docs/solutions/` specifically
- No agent queries ruvector before acting

Rather than adding a new plugin, we wire together existing components using a shared skill pattern. This keeps surface area small and the pattern reusable as new agents are added.

## Key Decisions

- **Write trigger (A + lightweight B):** Primary = `PostToolUse` hook on Write, path matches `docs/solutions/**`, calls `hooks_remember`. Belt-and-suspenders = `learning-compounder` gets a final step calling `hooks_remember` directly.
- **Cohesion mechanism:** A new shared `memory-context` skill (in `yellow-ruvector`) that any agent can include as a prefix step. Single place to maintain query logic and output format.
- **Read injection points (initial scope):**
  1. `yellow-core /work` — pre-implementation: "what solutions exist for this pattern?"
  2. All `yellow-review` specialist agents — pre-review: "what have we previously flagged in these files?"
  3. `yellow-review:review-pr` command — before spawning agents: surface relevant past patterns as shared context
- **Not in scope (yet):** yellow-ci :diagnose, yellow-core /brainstorm read injection, yellow-research lifecycle management

## Open Questions

- Should the `memory-context` skill live in `yellow-ruvector` or `yellow-core`? (`yellow-ruvector` owns the storage, but `yellow-core` owns the workflow skills — leaning toward yellow-ruvector since it manages the MCP server)
- What's the right output format for memory query results injected into agents? (Bulleted findings? Inline prose? A fenced block?)
- Does the `PostToolUse` hook fire on Write tool calls from subagents, or only from the main process? (Needs empirical verification)

## Next Steps

→ `/workflows:plan` for implementation details
