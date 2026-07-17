# Brainstorm: Which untapped RuVector MCP tool families to build into yellow-ruvector

**Date:** 2026-07-17
**Grounding:** `docs/research/ruvector-latest-featureset-and-plugin-ideation.md` (deep research, already complete — not re-derived here)

## What We're Building

A decision on **which of RuVector's untapped MCP tool families to wire into
the `yellow-ruvector` plugin next**, in what order, and with what trust and
graceful-degradation guardrails — not a redesign of the plugin, and not an
attempt to expose all ~97 tools. `yellow-ruvector` today uses only 2 of the
~97 reachable tools (`hooks_remember`/`hooks_recall`); this brainstorm scopes
the *first* increment beyond that.

Three candidates were surveyed, all anchored to tools confirmed reachable in
the installed `ruvector` npm 0.2.34 MCP surface:

- **I1 — Error→fix memory.** `hooks_error_record`/`hooks_error_suggest`
  against the existing `docs/solutions/` + `MEMORY.md` corpus.
- **I2 — Learned review-persona routing.** `hooks_route_enhanced`/
  `hooks_swarm_recommend` as an advisory signal alongside the review
  pipeline's current static persona-selection heuristics.
- **I3 — Co-edit file-sequence prediction.** `hooks_coedit_record`/
  `hooks_coedit_suggest` for review file-grouping and `/workflows:work`
  context pre-warming.

**Recommendation: build I1 first, in its query-only MVP shape** (seed
`hooks_error_record` from the existing `docs/solutions/` corpus; ship only
the `hooks_error_suggest` query side, wired into the `debugging` skill and
`/review:resolve` — not into a hook). I2 and I3 are documented as
well-scoped next candidates, not committed to a sequence.

The shared/team "brain" (I4, `brain_*`) is explicitly **out of scope this
round** — per-developer `MEMORY.md` + `docs/solutions/` remain the sole
source of truth; I4 is noted as a possible future option only.

## Why This Approach

### Codebase grounding (this session's research, not re-derived from the prior report)

A targeted codebase pass (`yellow-core:research:repo-research-analyst`)
found zero existing call-sites for any of the six candidate hook tools
anywhere in `plugins/` or `docs/` — this is genuinely greenfield, no
conflicting prior art to reconcile. It also located the concrete integration
points each idea would need:

- **I1's target is real and currently empty.** `plugins/yellow-core/skills/debugging/SKILL.md`
  (five-phase: Triage/Investigate/Root Cause/Fix/Handoff) has **no
  pre-fix knowledge-base query anywhere in Phases 0–2** — it re-derives
  every root cause from scratch today. Its only `docs/solutions/` touchpoint
  is at the *end* (Phase 4, optionally invoking `/yellow-core:workflows:compound`
  to *write* a new solution doc — never to *read* existing ones first). This
  is exactly the gap `hooks_error_suggest` fills, and the fix requires no new
  infrastructure — just a query call in an existing phase.
- **I2's target is a well-defined static table, not a black box.** The
  "tiered persona dispatch" logic lives in `plugins/yellow-review/commands/review/review-pr.md`
  Step 4 (~lines 293-379) and is mirrored in `review-all.md` Step 6
  (~line 165): always-on personas run unconditionally; conditional personas
  (`adversarial-reviewer`, `security-reviewer`, `performance-reviewer`,
  `architecture-strategist`, plugin-authoring personas) trigger on diff-size
  and path-glob heuristics. A learned router would sit *alongside*, not
  inside, this table.
- **I3's obvious target doesn't already exist the way the research doc
  assumed.** "File-based review grouping" today (`plugins/yellow-review/commands/review/resolve-pr.md`
  Step 3d) clusters **PR *comment threads*** by file+region for parallel
  resolution — it is not a diff-file relatedness predictor. The manual rule
  cited as the motivating example (touching `plugin.json` implies also
  touching `marketplace.json` + `setup/all.md`) is documented only in
  `AGENTS.md` (line 122) and enforced by `validate-setup-all.js`, a
  standalone script — not by any review or planning command. I3 would need
  new wiring (e.g., into `/workflows:work` Phase 1 or a new pre-PR advisory
  check), not a slot-in to existing grouping logic.

This changes the effort ranking from the original research doc: I1 has the
cleanest existing insertion point (one query call in one already-empty
phase), I2 has a well-defined but higher-trust-stakes insertion point
(review pipeline), and I3 has no insertion point yet at all — it would be
building new plumbing, not augmenting existing plumbing.

### Prior-incident grounding (learnings pre-pass, `yellow-core:research:learnings-researcher`)

Three past incidents directly bound how any of these three must be built,
regardless of which is picked first:

1. **RuVector's advertised MCP tool names/schemas have been wrong twice
   before** (`docs/solutions/integration-issues/ruvector-mcp-tool-parameter-schema-mismatch.md`,
   `docs/solutions/integration-issues/ruvector-cli-and-mcp-tool-name-mismatches.md`)
   — design docs and even shipped plugin code referenced parameters and CLI
   commands that didn't exist in the real server. Combined with the fact
   that `rvf_create` itself was broken until 0.2.34, **no candidate here can
   be built from the research doc's tool names alone** — each must be
   empirically confirmed against the live MCP surface before any code or
   documentation references it.
2. **`.ruvector/` silently no-ops inside git worktrees**
   (`docs/solutions/integration-issues/ruvector-worktree-db-symlink.md`) —
   this very session runs in a worktree. Any new memory-backed feature
   inherits the risk of "no matches" looking identical to "broken." New
   tool calls must include an explicit reachability check and a
   user-visible degraded-mode signal, not a silent empty result.
3. **Prior hook-hardening pass exists and should gate new hook code**
   (`docs/solutions/security-issues/yellow-ruvector-plugin-multi-agent-code-review.md`,
   16 issues: path-traversal, JSONL injection, race conditions,
   prompt-injection in hook scripts). If any future work adds a *live*
   detect-record hook (not just a query call), it must be checked against
   this same list — these are exactly the failure modes new hook-writing
   code reintroduces.

### Why I1's query-only MVP over the full detect-record-suggest loop

The research doc's I1 sketch ("record `(error, fix, file)` when a
bash/edit failure is *later resolved*") hides its hardest problem in one
word: "later." A stateless `PostToolUse`/`Stop` hook has no clean, reliable
way to detect that a past failure was subsequently fixed — that
correlation is genuinely unsolved design work, not a wiring task, and it's
exactly where "cleanest, most verifiable first spike" stops being true if
taken at face value.

Splitting I1 into two shapes resolves this:

- **Query-only MVP (recommended first cut):** seed `hooks_error_record`
  once from the existing `docs/solutions/` corpus (a batch, one-time
  operation, not live hook logic). Ship only `hooks_error_suggest`, called
  from the `debugging` skill (Phase 1/2) and `/review:resolve`. This runs in
  **skill/command context, not a hook** — so the 1s/3s hook budgets and the
  `npx` cold-start problem don't apply at all. No correlation-detection
  problem exists because nothing is being recorded live.
- **Full detect-record-suggest loop (later phase, not this round):**
  a live hook records `(error, fix)` when a failure is resolved. Higher
  long-term value (the corpus grows from real sessions, not just the
  existing manually-curated docs), but the resolution-correlation logic is
  unverified, adds new hook-budget risk, and would need the full
  hook-hardening checklist applied to new code.

The MVP is strictly a subset of the full loop's infrastructure — nothing
about building it first forecloses the full loop later. That satisfies
YAGNI cleanly: the query-only shape is independently valuable (turns
`docs/solutions/` from something an agent must think to Grep into something
retrieved automatically) and is a natural stepping stone, not a dead end.

## Approaches surveyed

### Approach A: I1 query-only error→fix memory (recommended first spike)

Seed `hooks_error_record` from `docs/solutions/`; wire `hooks_error_suggest`
into the `debugging` skill and `/review:resolve` as a query-before-you-fix
step. No live recording hook in this phase.

**Pros:**
- Cleanest existing insertion point confirmed by codebase research (an
  already-empty phase in an existing skill).
- No hook-budget risk — runs in skill/command context.
- No correlation-detection problem — nothing is recorded live.
- Directly reuses a corpus that already exists and is already curated.
- Verifiable in isolation: does the suggestion actually surface a matching
  past fix for a known repeat problem?

**Cons:**
- Value is capped by the existing `docs/solutions/` corpus size until a
  later phase adds live recording.
- Still requires the confidence-gating guardrail (below) to avoid
  confidently-wrong suggestions displacing a correct fresh diagnosis.

**Best when:** the goal is a low-risk, quickly-verifiable first proof that
ruvector's learned-memory tools add value over the hand-built corpus,
before committing to any live-hook design work.

### Approach B: I2 learned review-persona routing (advisory signal)

Feed the diff to `hooks_route_enhanced`/`hooks_swarm_recommend` alongside
the existing static tiered-dispatch table in `review-pr.md`/`review-all.md`;
record outcomes via `hooks_learn` so routing improves across PRs.
Advisory-only — never suppresses an always-on persona or a
diff-size/path-glob-triggered conditional persona.

**Pros:**
- Insertion point is well-defined (a known, static table to augment).
- Directly targets the highest-conceptual-fit vendor capability
  (Q-learning task routing).
- Low blast radius if kept strictly advisory (worst case: a redundant
  suggestion, not a missed always-on review).

**Cons:**
- Touches the review pipeline's core trust surface — any bug here is
  higher-stakes than I1's read-only suggestion.
- The learning loop needs many PRs of `hooks_learn` feedback before
  outperforming the existing static heuristics; the "80%+ accuracy" figure
  is [vendor-stated] and unverified at this repo's PR volume — payoff is
  not immediate, so it's a weaker *first* spike even though it may be
  higher long-term value.
- Requires deciding what "a persona produced a surviving finding" means as
  a reward signal — this is nontrivial design work, not just wiring.

**Best when:** I1 has already validated that ruvector's suggestions are
trustworthy enough to act on, and there's appetite for a longer feedback
loop before seeing routing improve.

### Approach C: I3 co-edit file-sequence prediction

Wire `hooks_coedit_record`/`hooks_coedit_suggest` into `/workflows:work`
Phase 1 (new insertion point) to surface likely-related files before
editing, learning patterns like "touching `plugin.json` usually also means
touching `marketplace.json` + `setup/all.md`."

**Pros:**
- No correlation-detection problem (recording is a direct observation of
  co-edited files, not an inference about causality).
- Concrete, checkable existing manual rule to compare against
  (`validate-setup-all.js` + `AGENTS.md` line 122).
- Genuinely novel capability — nothing today automates this.

**Cons:**
- Codebase research found **no existing insertion point** — the
  "file-based review grouping" this was assumed to slot into is actually
  PR-comment clustering, a different mechanism. This is new plumbing, not
  an augmentation, raising effort versus A and B.
- Value is unproven until enough co-edit history accumulates locally
  (`.ruvector/` is per-developer and gitignored — no shared corpus to seed
  from, unlike I1).

**Best when:** after I1 (and optionally I2) have established the pattern of
"query ruvector before/during a task," as a second increment — not as the
first, given it requires building a new insertion point from scratch.

## Key Decisions

1. **First spike: Approach A (I1, query-only MVP).** Ship
   `hooks_error_suggest` in the `debugging` skill and `/review:resolve`
   only; do not build the live detect-record loop this round.
2. **Verify-first is a hard prerequisite, not implementation detail.**
   Before writing any code or skill/command prose that names
   `hooks_error_record`/`hooks_error_suggest`, empirically confirm against
   the live MCP surface (introspect the running 0.2.34 server) that these
   tools exist with the parameter shapes assumed here. Given the two prior
   tool-name/schema-mismatch incidents, do not trust the research doc's
   tool names as ground truth for implementation.
3. **Confidence gating is a first-class behavior, not a nice-to-have.**
   `hooks_error_suggest` must support "no confident match" as a normal,
   silent outcome — raw similarity is not sufficient grounds to surface a
   suggestion. A wrong suggestion that displaces correct fresh reasoning is
   worse than no suggestion.
4. **Graceful degradation applies at the tool-call level, not just
   plugin-absent.** Given the worktree symlink incident, "ruvector present
   but silently returning nothing" must be distinguished from "ruvector
   absent" — surface a visible degraded-mode signal rather than treating
   empty results as "no match found."
5. **I2, if pursued, is advisory-only, permanently.** A learned router may
   suggest; it may never suppress an always-on persona or a heuristic-
   triggered conditional persona. This is a standing constraint on I2, not
   a phase-1-only restriction.
6. **I4 (shared brain) is deferred, not designed.** Git-committed
   `MEMORY.md` + `docs/solutions/` remain the sole source of truth this
   round. `brain_*` / federated sync stays off the table until a future,
   separate decision addresses the shared-state trust model explicitly.
7. **Pin `ruvector` npm 0.2.34 exactly; re-verify tool contracts on every
   version bump.** 0.2.34 itself was a bug-fix release for a previously
   broken MCP tool (`rvf_create`) — this surface churns on a near-weekly
   cadence.

## Open Questions

- What does "confident enough to suggest" mean concretely for
  `hooks_error_suggest` — a similarity threshold, a minimum corpus-match
  count, or something else? Needs a small empirical pass once the tool is
  verified reachable, before Approach A ships.
- Does seeding `hooks_error_record` from `docs/solutions/` require a
  one-time migration script, or can it be done incrementally per-category?
  Left to the implementation plan.
- If Approach A validates well, does I2 or I3 become the natural second
  increment? This brainstorm intentionally leaves that unordered — revisit
  once I1's MVP has real usage data.
- For I2's eventual reward signal ("a persona produced a surviving
  finding"), what existing review-pipeline data (if any) already tracks
  finding survival across `/review:resolve` rounds, that `hooks_learn`
  could consume without new instrumentation? Not investigated this round.
- Should the debugging skill's Phase 4 (currently write-only to
  `docs/solutions/`) also call `hooks_error_record` directly at fix time,
  or should recording stay batch-only (re-seeded periodically) until the
  live-loop design in a later phase is worked out? Left open pending the
  live-loop follow-up brainstorm/plan.
