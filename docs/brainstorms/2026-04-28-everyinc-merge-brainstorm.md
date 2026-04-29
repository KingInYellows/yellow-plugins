# EveryInc/compound-engineering-plugin Merge — Brainstorm

**Date:** 2026-04-28
**Topic:** Selectively integrating components from EveryInc/compound-engineering-plugin into yellow-plugins
**Source documents:** `RESEARCH/MERGE_PLAN.md`, `RESEARCH/every-plugin-research.md`
**Status:** decisions locked, ready for `/workflows:plan`

---

## What We're Building

A multi-PR, three-wave selective integration of the best components from
EveryInc/compound-engineering-plugin (CE) into the yellow-plugins marketplace.
This is not a git merge — yellow-plugins has no fork ancestry with CE. It is a
concept-fork that mirrors CE's pre-v2.38.0 state (before the `workflows:*` →
`ce:*` rename and the skills-first migration). The goal is to upgrade the
yellow-plugins implementation selectively: close the compound knowledge loop,
upgrade the review pipeline to a tiered persona model with confidence
calibration, adopt high-value individual components, and repair drifted agents —
while keeping the existing `workflows:*` namespace, the 16-plugin marketplace
shape, and all unique plugins intact.

The keystone change is a coherent rewrite of `review:pr` that simultaneously
adds the learnings-researcher pre-pass (closing the write-only `docs/solutions/`
loop) and the tiered persona reviewers with a confidence rubric. Every subsequent
PR lands after this pipeline is active, meaning the improved review process
reviews its own successors.

---

## Why This Approach

### Architectural framing

yellow-plugins is a concept-fork of CE at roughly its v2.28.0–v2.33.0 state
(January–February 2026). Since then, CE has shipped approximately 40 additional
releases, the most significant being:

- v2.38.0 (2026-03-01): `workflows:*` → `ce:*` rename
- v2.51.0–v2.52.0 (2026-03-24/25): tiered persona reviewer pipeline
- v2.55.0 (2026-03-27): adversarial reviewers, project-standards-reviewer
- v2.60.0 (2026-03-31): confidence rubric, FP suppression, intent verification
- v2.62.0–v2.66.0 (2026-04-03/15): compound loop hardening, read-only reviewer
  restriction, ce-debug, ce-pr-description, base-branch-fetch hardening
- v2.65.0–v2.68.0 / v3.x (2026-04-11/26): ce-setup, ce-optimize, ce-ideate,
  ce-polish-beta, release automation

The divergence is significant but the delta is well-catalogued. CE now has
approximately 36 skills and 51 agents; yellow-plugins has 43 UNIQUE components
CE lacks, 15 DRIFTED components, 43 MISSING components, and only 8 clean
matches.

### Why pipeline-first sequencing (Approach B) over alternatives

Wave 1 hardening (context7 removal, read-only restriction, drifted agent
repairs) is low-risk and creates a clean baseline. Wave 2 is the keystone: once
the tiered persona pipeline and learnings pre-pass are live, every Wave 3 PR is
reviewed by the improved system — dogfooding the pipeline on its own successors.
Big-bang parallel (Approach A) foregoes this benefit and concentrates review
risk. Thin vertical slices (Approach C) create artificial seams between the
review orchestrator and the persona agents it dispatches, which are genuinely
coupled.

### Namespace decision

The `workflows:*` namespace stays permanently. Muscle memory and existing user
installs take priority over tracking CE's v2.38.0 rename. This eliminates the
skills-first skill-injection hook and the `disable-model-invocation` harness
concern as adoption targets — both are only meaningful in the CE skills-first
architecture.

### Plugin shape decision

No new plugin is created to house ported CE components. The default is to absorb
into existing plugins (yellow-review, yellow-core, yellow-docs, etc.), with
new-plugin creation only if a component genuinely does not fit anywhere existing.
Neither yellow-composio nor yellow-codex is deleted; both are expansion
candidates.

---

## Key Decisions

### Locked decisions from Q&A

| # | Question | Decision |
|---|---|---|
| Q1 | `workflows:*` → `ce:*` rename and command→skill migration? | **B: Stay on `workflows:*` permanently.** No rename. No skill migration. Drift from upstream is acceptable; muscle memory and existing installs are not. |
| Q2 | Where do adopted EveryInc components land? | **C with strong lean toward A: absorb into existing plugins.** New plugin only if a component genuinely does not fit anywhere existing. |
| Q3 | Compound loop closure vs reviewer pipeline expansion: sequence or together? | **C: both together.** Learnings pre-pass + new persona reviewers + confidence rubric as one coherent `review:pr` rewrite. Shipping them separately leaves a half-closed loop. |
| Q4 | Scope boundary for this merge effort? | **C: broadly scoped.** Full P0+P1 list. Multi-PR effort. This brainstorm scopes all of it so the implementation plan has a coherent picture. |
| Q5 | yellow-composio and yellow-codex: keep or delete? | **Keep both; treat as expansion candidates.** yellow-codex is the integration path for OpenAI's coding agent (codex:rescue/codex:review are independent value from workflows:work delegation). yellow-composio is actively used for COMPOSIO_REMOTE_WORKBENCH and COMPOSIO_MULTI_EXECUTE_TOOL. |

### Implicit decisions that follow from the above

- The CE skill-injection hook is not adopted (only relevant in skills-first architecture).
- The `compound-engineering.local.md` per-project config file pattern is adapted
  (not copied verbatim) — a `yellow-plugins.local.md` equivalent may be worth
  introducing for configurable review depth and reviewer set, but is deferred to
  the plan stage.
- CE's stack-specific persona reviewers (DHH/Rails, Kieran/Rails, Swift/iOS,
  Ankane/Ruby) are not adopted — not the yellow-plugins stack (TS/Py/Rust/Go).
- CE's design/Figma agents are not adopted — no Figma toolchain in scope.
- CE's data-migration/schema-drift/deployment-verification agents are not adopted
  — Rails-migration-shaped, not applicable.
- yellow-plugins' polyglot-reviewer becomes a question mark once the per-language
  CE persona reviewers (ce-kieran-typescript-reviewer, ce-kieran-python-reviewer)
  are replaced by the broader correctness/maintainability/reliability triad. Flag
  for plan stage.

---

## Approach Exploration

Three approaches were considered for sequencing the full P0+P1 scope.

### Approach A: Big-bang parallel

All P0+P1 work planned upfront and executed simultaneously via parallel agents.
PRs opened roughly together and reviewed as a batch. No intermediate states.

**Pros:**
- Coherent diff; related changes land together
- No period where new reviewer agents exist but the orchestrator doesn't dispatch them
- Best use of parallel agent capacity

**Cons:**
- Largest possible review surface; hardest to catch cross-cutting mistakes early
- A bug in the review pipeline rewrite affects all new agents that depend on it before it's fixed
- Any blocked PR holds up the entire batch
- Forfeits the benefit of the improved pipeline reviewing its own successors

**Best when:** scope is well-understood, components are truly independent, and
confidence in implementation is high before opening PRs.

### Approach B: Pipeline-first sequencing (recommended)

Work lands in three dependency-ordered waves:

**Wave 1 — Foundation (low-risk hardening, no new features)**
- Remove bundled context7 MCP entry from `yellow-core/plugin.json` and update
  `code-researcher.md` references
- Strip Bash and write tools from all existing reviewer agents under `*/agents/review/`
  (architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist,
  performance-oracle, security-sentinel, polyglot-reviewer, test-coverage-analyst)
  — read-only tools only, matching upstream PR #553
- Repair drifted agents: `best-practices-researcher` (skills-first Phase 1 pass),
  `repo-research-analyst` (structured technology scan from PR #327),
  `git-history-analyzer` (frontmatter parity), `spec-flow-analyzer` (frontmatter),
  `performance-oracle` (split pattern: oracle + reviewer with confidence calibration),
  `security-sentinel` (split pattern: sentinel + reviewer + lens)

**Wave 2 — Compound loop closure (the keystone rewrite)**
- Rewrite `yellow-review/commands/review/review-pr.md` as a tiered persona
  pipeline:
  - Always-run learnings pre-pass: a new `learnings-researcher` agent that reads
    `docs/solutions/` before any reviewer dispatches — this closes the loop that
    `knowledge-compounder` writes to but nothing reads from
  - Always-fetch base branch before dispatching reviewers (PR #544)
  - Parallel persona dispatch to the full reviewer set (existing yellow-core/yellow-review
    agents plus the new adoptions below)
  - Confidence rubric with FP suppression and intent verification (PR #434)
  - Compact returns from reviewer agents to reduce orchestrator context (PR #535)
- New reviewer agents to adopt into `yellow-review/agents/review/`:
  - `correctness-reviewer` — logic errors, edge cases, state bugs
  - `maintainability-reviewer` — coupling, complexity, naming, dead code
  - `reliability-reviewer` — production reliability, failure modes
  - `project-standards-reviewer` — always-on CLAUDE.md/AGENTS.md compliance (PR #402)
  - `adversarial-reviewer` — failure scenarios across component boundaries (PR #403)
- New research agent to adopt into `yellow-core/agents/research/`:
  - `learnings-researcher` — searches `docs/solutions/` for prior fixes; always-run
    wired into the review pipeline orchestrator

**Wave 3 — Remaining P1 adoptions (reviewed by the Wave 2 pipeline)**
- `ce-debug` equivalent skill → adopt into `yellow-core/skills/` as a new
  `debugging/SKILL.md`; test-first systematic debugging, causal chain tracing
- `ce-doc-review` equivalent → adopt into `yellow-review` or `yellow-docs`; persona-
  based parallel review of plans and brainstorms, not just code; the six doc-review
  persona agents (coherence, design-lens, feasibility, product-lens, scope-guardian,
  security-lens) plus `adversarial-document-reviewer` land here
- `ce-resolve-pr-feedback` hardening → port three specific improvements into
  `yellow-review/commands/review/resolve-pr.md`:
  - Cross-invocation cluster analysis (PR #480)
  - Actionability filter (PR #461)
  - Untrusted-input handling for PR comment text (PR #490) — correctness fix, not optional
- `ce-setup` adaptation → introduce a `yellow-plugins.local.md` per-project config
  pattern for configurable review depth, focus areas, and reviewer set; does not
  need to replicate the full CE `ce-setup` skill, but the per-project config file
  concept is directly portable
- `ce-worktree` improvements → port two specific fixes into
  `yellow-core/skills/git-worktree/SKILL.md`:
  - Auto-trust mise/direnv configs (PR #312)
  - `.git` is-a-file detection
- `yellow-codex` expansion → review for opportunities to deepen integration with
  the improved review pipeline (e.g., `codex:review` invoking the learnings pre-pass,
  `codex:rescue` benefiting from the adversarial reviewer pattern)
- `yellow-composio` expansion → review upstream EveryInc for any batch-execution or
  remote-workbench orchestration patterns that map to COMPOSIO_REMOTE_WORKBENCH /
  COMPOSIO_MULTI_EXECUTE_TOOL; no direct CE analog confirmed, but worth checking
  at plan time

**Pros:**
- Wave 2's improved review process reviews Wave 3 PRs — dogfooding the pipeline on
  its own successors
- Smaller PRs; bugs caught before they propagate
- Wave 1 is low-risk hardening with no new features — good warm-up, clean baseline
- Clear dependency structure: each wave unblocks the next

**Cons:**
- Longer calendar time to full completion than Approach A
- Wave 2 is a moderately large PR (orchestrator rewrite + new persona agents together)
- Requires discipline not to begin Wave 3 before Wave 2 is merged

**Best when:** the review pipeline is the keystone change (it is), and you want
each subsequent PR to benefit from the improved system reviewing it.

### Approach C: Thin vertical slices

Each upstream component ported as its own atomic PR with no batching into waves.

**Pros:**
- Smallest individual review surface
- Any single PR can be reverted independently
- Maximum ordering flexibility

**Cons:**
- Orchestrator and persona agents are genuinely coupled; splitting them forces
  artificial seams and an extended period where agents exist but aren't dispatched
- High PR overhead for a solo agent-assisted author
- Some components (learnings-researcher + confidence rubric + new personas) cannot
  be meaningfully shipped without each other

**Best when:** multiple independent reviewers with low cross-contributor trust;
not the right fit for agent-assisted single-author development.

---

## Open Questions for /workflows:plan

The following questions are unresolved by this brainstorm and must be answered
during planning or implementation. Each one blocks or shapes a specific deliverable.

**OQ-1: Learnings-researcher agent name and namespace.**
The new always-run agent that reads `docs/solutions/` needs a name. Upstream
calls it `ce-learnings-researcher`. Yellow-plugins conventions don't use the `ce-`
prefix. Options: `learnings-researcher` (plain, matches the pattern of existing
agents), `solutions-researcher` (describes what it actually reads), or
`knowledge-researcher` (broader). Decide before Wave 2 implementation begins.

**OQ-2: Confidence rubric scoring schema.**
Upstream's confidence rubric (#434) includes FP suppression thresholds and
severity tiers, but the exact scoring schema was not fetched from the live repo
(access limitations noted in `every-plugin-research.md` §8). Before implementing
Wave 2, read the live `plugins/compound-engineering/skills/ce-code-review/SKILL.md`
to extract the actual rubric numbers and tier definitions. Do not reconstruct
these from the CHANGELOG description alone.

**OQ-3: polyglot-reviewer fate.**
With the correctness/maintainability/reliability triad adopted and per-language
CE reviewers (ce-kieran-typescript-reviewer, ce-kieran-python-reviewer) available
as reference, the existing `polyglot-reviewer` in yellow-core may become redundant.
Decide at Wave 2 plan time: retire polyglot-reviewer and let the new triad cover
its function, or keep it as a generalist fallback alongside the specialists.

**OQ-4: yellow-plugins.local.md scope and schema.**
The CE `compound-engineering.local.md` pattern (introduced PR #345) records stack,
focus areas, review depth, and reviewer set. A `yellow-plugins.local.md` equivalent
is worth adopting. But how much of CE's schema to copy vs. adapt for yellow-plugins'
multi-vendor footprint (Devin, Codex, Linear, ruvector) is a design question. Define
the schema before Wave 3 begins; it affects how `review:pr` reads config.

**OQ-5: ce-doc-review landing location.**
Document review (plans and brainstorms) is a new capability — it does not currently
live in yellow-review (which is code review only) or yellow-docs (which is docs
generation and audit, not review). Options: (a) extend yellow-review with a new
`review:doc` command and the six persona agents, (b) extend yellow-docs, or (c)
introduce a new plugin. This is the one case where the "absorb into existing" default
needs deliberate evaluation. Decide at Wave 3 planning time.

**OQ-6: Wave 2 PR size management.**
The Wave 2 rewrite touches `review:pr` (the orchestrator command), adds `learnings-
researcher` (new agent), adds five new reviewer agents, and updates `pr-comment-
resolver` (untrusted-input handling is a prerequisite correctness fix). That may
be too large for one PR. Consider whether to split: (a) Wave 2a = orchestrator
rewrite + learnings-researcher, Wave 2b = new persona agents; or keep them together
since the orchestrator needs to know about the agents it dispatches. Decide at plan time.

**OQ-7: yellow-composio upstream pattern search.**
The merge plan's research did not find a direct CE analog for the Composio remote-
workbench / multi-tool batch pattern. Before scoping any yellow-composio expansion,
do a targeted search of CE's PR history for batch-execution orchestration patterns
(the `ce-optimize` skill's parallel-experiments pattern may be the closest analog).
This is a research task that precedes any yellow-composio capability expansion work.

**OQ-8: pr-comment-resolver split-out.**
Upstream's `ce-resolve-pr-feedback` improvements (#480, #461, #490) are ports into
`yellow-review/commands/review/resolve-pr.md`. But the merge plan also notes that
`pr-comment-resolver` (the agent) is drifted. Should the agent and the command be
repaired together in one PR, or should the agent repair land in Wave 1 (as a drifted-
agent fix) and the command improvements land in Wave 3? Clarify sequencing at plan time.

**OQ-9: agent-native reviewers promotion from SKIP to P1.**
The merge plan SKIPs `ce-cli-readiness-reviewer`, `ce-cli-agent-readiness-reviewer`,
`ce-agent-native-reviewer`, and the `ce-agent-native-architecture`/`ce-agent-native-audit`
skills — but notes they become P1 "if you ship plugins as a primary use case." Yellow-
plugins does ship plugins; these reviewers exist precisely to review agents and plugins
being built. Decide at plan time whether to promote them and which wave they land in.

**OQ-10: Upstream skill body access.**
The `every-plugin-research.md` research snapshot explicitly flags that individual
agent and skill file bodies were not fetched (access errors on the live repo). Before
implementing any Wave 2 or Wave 3 component, the plan must include a step to read
the relevant upstream file bodies directly (via `gh` CLI or web fetch) to ensure
the implementation is based on the actual prompts, not CHANGELOG summaries. This
applies especially to: the confidence rubric schema (OQ-2), the learnings-researcher
system prompt, the adversarial-reviewer prompt, and the `ce-doc-review` orchestration
logic.
