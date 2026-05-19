---
'yellow-core': minor
---

feat(yellow-core): /compound:review-staged + RULE 14/14b lint + docs

Stack item #3 of plans/background-compounding-triggers.md. Completes the
background-compounding pipeline with the manual-override command, the
load-bearing lint rules that prevent the load-bearing
`disallowedTools: [AskUserQuestion]` from being silently removed from
`staging-promoter`, and the docs that describe the full architecture.

**New files:**

- `plugins/yellow-core/commands/compound/review-staged.md` — manual
  drain command. Skips count + age thresholds, includes M3
  AskUserQuestion confirmation gate showing pending count + sample
  titles before any bulk write, acquires the same `.drain-lock` as the
  SessionStart hook (refuses if a drain is in flight), spawns the
  same disowned `claude -p` subshell with `COMPOUND_DRAIN_IN_PROGRESS=1`.

**Modified files:**

- `scripts/validate-agent-authoring.js` — adds RULE 14 and RULE 14b:
  - RULE 14: staging-promoter frontmatter MUST contain
    `disallowedTools: [AskUserQuestion]` (in YAML list or flow style).
    This is the load-bearing scheduler-level hard-deny that prevents
    drain-context confirmation prompts (D8 in the plan). Silent
    removal would block the entire drain pipeline indefinitely; lint
    turns that into a CI failure.
  - RULE 14b (V1 prose-only): staging-promoter body must reference
    the `## Session Notes` write gate AND state a "Never modify
    CORE_RULES / USER_PREFERENCES / KNOWN_PROJECTS" invariant. This
    is the V1 enforcement of D9-L1 memory partitioning; V2 will add
    full AST lint of Write/Edit invocations.
  - Both rules verified with negative tests: removing the deny from
    frontmatter or the invariant from the body fails the lint with a
    clear error citing the rule.
- `plugins/yellow-core/CLAUDE.md` — adds a `## Compound Staging`
  section (architecture summary, manual-override pointer, auth-route
  note) and a `## Known Limitations` section (per-worktree staging,
  PII residue window with 7d TTL reaper, async via disowned-subshell
  only, manual MEMORY.md migration, uninstall does not reap staging
  dirs). Agent catalog count bumped 18 → 21; commands 8 → 9; new
  `compound-staging.sh` listed in Shared Libraries.
- `plugins/yellow-core/README.md` — extends Commands + Workflow Agents
  tables (Workflow 4 → 7) with staging-reviewer, staging-scorer,
  staging-promoter rows.

**MEMORY.md partition (per-user, not committed):** the auto-memory
MEMORY.md (at `~/.claude/projects/<slug>/memory/MEMORY.md`, not in the
repo) gets a canonical 4-section structure (`## CORE_RULES`,
`## USER_PREFERENCES`, `## KNOWN_PROJECTS`, `## Session Notes`) with a
contract preamble. Migration is per-user manual work; `staging-promoter`
creates `## Session Notes` at end-of-file if absent. Two new local
memory entries (`pattern_staging_promoter_disallowed_tools.md`,
`pattern_compound_drain_in_progress_env_recursion_guard.md`) capture
the load-bearing patterns for future sessions.

**Validation:** `pnpm validate:schemas && pnpm validate:agents && pnpm test:unit
&& pnpm lint && pnpm typecheck && bats plugins/yellow-core/tests/` all green
(83/83 bats including the 44 from stack #1).

**Pipeline now end-to-end functional:**

  Stop hook (item #1) captures pending entries.
  SessionStart hook (item #1) dispatches drain claude -p session.
  Drain invokes staging-reviewer (item #2).
  Reviewer scores via staging-scorer (item #2).
  Reviewer promotes via staging-promoter (item #2).
  Promoter writes docs/solutions/ + MEMORY.md ## Session Notes.
  RULE 14 lint protects the promoter's disallowedTools enforcement.
  /compound:review-staged offers manual flush ahead of thresholds.

Phase 8 (manual smoke tests) is the post-merge closure checklist; not
part of any PR.
