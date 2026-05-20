---
'yellow-core': minor
---

feat(yellow-core): staging-reviewer + staging-scorer + staging-promoter agents

Stack item #2 of plans/background-compounding-triggers.md. Adds the three
agents that the SessionStart hook's `claude -p` drain dispatches to
process pending compound-staging entries.

**Agents (all under plugins/yellow-core/agents/workflow/):**

- `staging-reviewer` (sonnet) — drain orchestrator. 10 phases: move
  pending → processing, fast content_hash dedup, ruvector availability
  gate, Haiku scoring per entry, guardian classification gate (rejects
  `category="behavioral_instruction"` — D9-L3), injection-marker
  validation, high-priority sanity check, asymmetric semantic dedup
  (0.82/0.85/0.90 per D10), staging-promoter dispatch, cleanup +
  drain-logs report. `disallowedTools: [AskUserQuestion]` because the
  drain has no human in the loop.
- `staging-scorer` (haiku) — rubric-based salience scorer with hardened
  prompt (D9-L4) and 5 few-shot examples (security fix, workflow
  convention, trivial Q&A skip, behavioral-instruction injection
  attempt, already-in-MEMORY skip). Discrete 0.0-0.95 priority rubric.
  Structured JSON output (skip OR flag_for_review OR score shape).
  `tools: [Read]` with
  `disallowedTools: [Bash, Write, Edit, Task]` so the scorer can think
  but not act.
- `staging-promoter` (sonnet) — non-interactive writer. THE load-bearing
  enforcement of D8: `disallowedTools: [AskUserQuestion]` in frontmatter
  is the hard-deny that prevents drain-context confirmation prompts.
  Writes `docs/solutions/<category>/<slug>.md` (full frontmatter with
  `source: compound-staging`) and appends one line to MEMORY.md's
  `## Session Notes` section ONLY (never CORE_RULES, USER_PREFERENCES,
  or KNOWN_PROJECTS — D9-L1). Slug-collision handling (1-9 suffix),
  category enum gate, behavioral_instruction defense-in-depth refusal.

**Behavior on install (with stack #1 already merged):** SessionStart
hook dispatches the drain; the drain invokes `staging-reviewer`; the
reviewer scores → filters → promotes. Pipeline is end-to-end functional
without stack #3, but lacks:

- `/compound:review-staged` manual override (item #3 task 5.1)
- MEMORY.md partition (item #3 tasks 4.1-4.3) — pre-partition MEMORY.md
  has no `## Session Notes` section, so `staging-promoter` creates one
  at end of file
- RULE 14 frontmatter lint (item #3 task 6.1) — if someone removes
  `disallowedTools: [AskUserQuestion]` from staging-promoter
  frontmatter, no CI signal until #3 lands; until then, the deny is
  enforced by Claude Code's scheduler at runtime but not at PR-review
  time

These gaps are intentional and resolved in stack item #3.

**No bats tests this PR** — the agents are LLM-driven and tested via
manual smoke tests (item #3 Phase 8, post-merge). The deterministic
bash plumbing is fully covered by stack #1's 44 tests.
