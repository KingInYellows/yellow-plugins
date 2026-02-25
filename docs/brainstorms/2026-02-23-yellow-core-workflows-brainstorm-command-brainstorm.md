# Brainstorm: yellow-core workflows:brainstorm Command

**Date:** 2026-02-23
**Status:** Ready for planning
**Author:** Brainstorm session

---

## What We're Building

A `workflows:brainstorm` command for the yellow-core plugin — the missing first step in the `brainstorm → plan → work → review → compound` cycle. The command is a thin delegator to a `brainstorm-orchestrator` agent, which runs an iterative dialogue loop combining conversational Q&A with optional research rounds. Output is a structured brainstorm document at `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md` that `/workflows:plan` already knows to detect.

---

## Why This Approach

### Agent-delegated (Approach C) over self-contained command (Approach B)

The cyclic dialogue pattern requires multiple rounds of: ask questions → spawn research agent → synthesize → ask more questions → optionally research again. Embedding that loop in a command file would exceed the readable-command ceiling. Delegating to a `brainstorm-orchestrator` agent:

- Keeps the command file thin (< 30 lines)
- Gives the agent full tool access natively (AskUserQuestion, Task, Write, Glob, Grep)
- Follows the pattern of `/research:code` and `/research:deep`, which both delegate entirely to agents
- Agent stays within the 120-line budget because heavy guidance lives in the companion `brainstorming` skill

### Conversational-first with opt-in research

Research is not forced — the agent offers it as a checkpoint after gathering initial context. This keeps fast sessions fast and complex sessions deep.

---

## Key Decisions

### Files to create

| File | Purpose |
|---|---|
| `plugins/yellow-core/commands/workflows/brainstorm.md` | Thin command: load skill, delegate to agent |
| `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md` | Runs the full cyclic dialogue loop |
| `plugins/yellow-core/skills/brainstorming/SKILL.md` | Reusable reference: question techniques, YAGNI, approach patterns, research escalation |

### Agent dialogue cycle

```
1. Parse $ARGUMENTS → check for existing brainstorm docs in docs/brainstorms/
2. Phase 0: Assess clarity — if already specific, offer to skip to /workflows:plan
3. Phase 1: Load brainstorming skill → ask initial clarifying questions (one at a time, AskUserQuestion)
4. Phase 2: Research checkpoint — AskUserQuestion: "Want me to research this?"
   - Internal question → Task: repo-research-analyst
   - External/novel → Task: research-conductor (yellow-research, fans out to Perplexity/Exa/Tavily)
5. Phase 3: Synthesize research → ask targeted follow-up questions
6. Phase 4: Research round 2 (if needed, same checkpoint pattern) — max 2 rounds total
7. Phase 5: Explore 2-3 approaches with pros/cons + recommendation (YAGNI-filtered)
8. Phase 6: AskUserQuestion confirm approach → write brainstorm doc
9. Phase 7: Soft handoff: "Run /workflows:plan when ready"
```

**Max-rounds guard:** After 2 research rounds, force synthesis regardless. Prevents infinite loops.

### Skill contents (4 sections)

1. **Question techniques** — one-at-a-time, multiple choice format, broad-to-narrow sequencing, assumption validation
2. **YAGNI principles** — prefer simpler approaches, avoid premature abstractions, scope tightening heuristics
3. **Approach exploration patterns** — 2-3 options with pros/cons table, recommendation formatting, when to recommend MVP vs full
4. **Research escalation rules** — when to use `repo-research-analyst` (existing codebase patterns) vs `research-conductor` (external best practices, novel tech, market landscape)

### Research agents

| Agent | When to spawn | What it provides |
|---|---|---|
| `repo-research-analyst` | User's idea relates to existing patterns in the codebase | Existing conventions, related features, CLAUDE.md guidance |
| `research-conductor` | Idea involves external tech, novel approach, or competitive context | Multi-source report from Perplexity + Exa + Tavily + Parallel Task |

### Output document

- Path: `docs/brainstorms/YYYY-MM-DD-<topic>-brainstorm.md`
- Slug: `[a-z0-9-]` max 40 chars (same convention as `/research:deep`)
- Sections: What We're Building, Why This Approach, Key Decisions, Open Questions
- `/workflows:plan` auto-detects this file when run afterward

### Allowed-tools

| File | Tools needed |
|---|---|
| Command | `Task`, `Skill` |
| Agent | `AskUserQuestion`, `Task`, `Write`, `Glob`, `Grep`, `Read`, `Skill` |

---

## Open Questions

1. **Skill invokability:** Should `brainstorming` be `user-invokable: true` so users can load it standalone, or `false` (reference only)? Leaning `false` — the compound-engineering brainstorming skill is external and handles the standalone case.

2. **yellow-research dependency:** `research-conductor` is in the yellow-research plugin. Should the command degrade gracefully if yellow-research is not installed (skip external research round, note it's unavailable)? Likely yes — same pattern as `code-researcher` does with compound-engineering.

3. **Document review step:** Should the agent offer a "review and refine" step (loading `document-review` skill) before handoff, like the compound-engineering version does? Not decided — adds complexity but improves doc quality.

4. **Phase 0 auto-detect:** If `$ARGUMENTS` references a file path or existing feature, should the agent auto-run `repo-research-analyst` before asking questions? Could speed up the loop.

---

## Relationship to Existing Commands

```
/workflows:brainstorm  →  docs/brainstorms/*.md
        ↓
/workflows:plan        →  docs/plans/*.md       (already detects brainstorm docs)
        ↓
/workflows:work        →  implements plan
        ↓
/workflows:review      →  multi-agent code review
        ↓
/workflows:compound    →  docs/solutions/*.md + MEMORY.md
```

The brainstorm command completes the full cycle and makes the `plan` command's existing brainstorm detection meaningful.
