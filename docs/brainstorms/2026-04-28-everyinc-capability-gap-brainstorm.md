# EveryInc Capability Gap Discovery — Brainstorm

**Date:** 2026-04-28
**Topic:** Capability gaps in yellow-plugins relative to EveryInc/compound-engineering-plugin
**Session type:** Second brainstorm; first session (merge sequencing) already complete
**Source documents:** `RESEARCH/MERGE_PLAN.md`, `RESEARCH/every-plugin-research.md`, `docs/brainstorms/2026-04-28-everyinc-merge-brainstorm.md`, `plans/everyinc-merge.md`
**Status:** Decisions locked; Wave 3 additions and post-merge opportunities ready for `/workflows:plan`

---

## What We're Building

This session identified capability gaps and improvement opportunities that the
existing merge plan (`plans/everyinc-merge.md`) did not address. The merge plan
covers Wave 1 (foundation hardening), Wave 2 (review pipeline keystone rewrite),
and a Wave 3 that already includes ce-debug, ce-doc-review, resolve-pr
improvements, git-worktree fixes, agent-native reviewers, yellow-plugins.local.md
expansion, and yellow-codex/composio research reports.

This session adds five new Wave 3 tasks and identifies two post-merge
opportunities. It does NOT modify Wave 1 or Wave 2, and does NOT re-litigate any
of the five locked decisions from the first brainstorm (workflows:* namespace
stays, no new plugin creation by default, etc.).

The organizing question was: of the ~25 MISSING components not covered by the
existing plan, which are worth pulling in, and are there CE patterns that should
improve UNIQUE yellow-plugins agents even when CE has no equivalent component?

---

## Why This Approach

The existing plan is comprehensive for the review pipeline and compound loop
closure goals. The gaps this session surfaces are in three categories:

**1. The compound lifecycle is half-addressed.** Wave 2 closes the read side of
the loop (learnings-researcher reads docs/solutions/ back into reviews). But the
write side has no staleness detection, overlap detection, or consolidation.
CE added ce-compound-refresh (v2.52.0) specifically for this. Without the
maintenance side, the loop-closure work degrades over time as docs/solutions/
accumulates contradictions and stale entries.

**2. Skipped P2 components have yellow-plugins-specific synergy not evaluated in
the first session.** ce-ideate's warrant contract is useful as a pre-brainstorm
self-check even with concrete input. ce-sessions is more valuable in a
multi-vendor footprint (Devin + Codex + Claude Code) than in CE's single-vendor
design. ce-optimize has direct ruvector synergy for tuning agent prompts and
comparing implementations.

**3. UNIQUE yellow-plugins agents can borrow CE patterns without being replaced.**
knowledge-compounder has no track schema (bug vs knowledge type) and no context
budget precheck — both exist in ce-compound and would improve the quality of
learnings-researcher's relevance rankings. The five yellow-debt scanners produce
noisy output; CE's adversarial-reviewer confidence calibration + failure-scenario
framing is the same problem Wave 2 solves for persona reviewers, and should be
applied consistently.

**Two genuine post-merge opportunities** are not CE ports at all — they are
yellow-plugins differentiators enabled by the Graphite-native stack that CE
cannot implement.

---

## Key Decisions

### Q&A log

| # | Question | Answer |
|---|---|---|
| Q1 | Compound lifecycle (stale/overlap detection) — Wave 3 addition or post-merge? | **Wave 3.** Even at 48 entries the loop isn't truly closed without maintenance. New yellow-core skill, invokable on-demand, optionally scheduled. |
| Q2 | ce-ideate and ce-sessions — move from out-of-scope to Wave 3? | **Both into Wave 3.** ce-ideate: warrant contract is a useful self-check even with concrete input, friction is acceptable. ce-sessions: multi-vendor footprint (Devin + Codex + Claude Code) makes cross-vendor context loss the real pain point — more valuable than CE's single-vendor design accounted for. |
| Q3 | Improvements to UNIQUE agents from CE patterns — knowledge-compounder schema upgrade and yellow-debt confidence calibration? | **Both as Wave 3 tasks.** knowledge-compounder track schema + context budget precheck improves learnings-researcher ranking quality. Yellow-debt scanner confidence calibration + adversarial framing applies the same fix Wave 2 applies to persona reviewers, consistently. |
| Q4 | ce-polish-beta stacked-PR-seeds — Wave 3 or post-merge? | **Post-merge as a yellow-plugins differentiator.** The Graphite-native angle is what makes it worth pursuing, not ce-polish-beta's other HITL behaviors. Scope: "stacked-PR seeds emitted by review agents, executed natively by gt-workflow." |
| Q5 | ce-optimize into Wave 3? lfg as post-merge? | **ce-optimize into Wave 3** (ruvector synergy; cost of deferral exceeds adoption complexity). **lfg as post-merge** (composition of Wave 1/2/3 capabilities, not a port; benefits from Wave 2 pipeline being live before chaining into it). |

### Implicit decisions

- knowledge-compounder schema upgrade has a sequencing question: it should
  ideally land in Wave 2 prep so learnings-researcher is built against the new
  schema from day one rather than retrofitted. Surface this as an explicit
  sequencing decision for `/workflows:plan` — either fold knowledge-compounder
  upgrade into W2.1 prep, or accept that Wave 3 retrofits learnings-researcher
  ranking logic.
- ce-sessions cross-vendor extension goes beyond CE's design. The
  session-historian agent should query Claude Code transcripts natively; Devin
  history via the yellow-devin plugin's API surface; Codex session logs via
  yellow-codex. The yellow-core skill owns cross-vendor aggregation.
- ce-optimize's schema.yaml + README are part of the Wave 3 adoption scope, not
  optional.
- Remaining MISSING components not addressed (confirmed intentionally left out):
  ce-demo-reel, ce-release-notes, ce-report-bug, ce-update, ce-sessions
  (now moved in), ce-polish-beta (post-merge framing only), ce-proof,
  ce-gemini-imagegen, ce-slack-research, ce-dhh-rails-style, ce-frontend-design,
  Figma/design agents, data-migration/schema-drift/deployment agents, stack-specific
  persona reviewers (Rails/Swift/Ruby). All remain out of scope.

---

## New Wave 3 Additions

These are additive to the existing Wave 3 in `plans/everyinc-merge.md`. They do
not conflict with any existing Wave 3 task. `/workflows:plan` should integrate
them as new task blocks (W3.10 through W3.14 or equivalent numbering).

### W3-NEW-1: Compound lifecycle management (ce-compound-refresh analog)

**What:** A new `yellow-core` skill (`plugins/yellow-core/skills/compound-lifecycle/SKILL.md`)
that detects stale entries, flags overlapping solutions, and proposes consolidations
in `docs/solutions/`. Invokable on-demand (`/workflows:compound-refresh` or
equivalent); optionally scheduled via a PostToolUse hook or manual cron.

**Why:** Wave 2 adds learnings-researcher as an always-run read-pass over
docs/solutions/. Without staleness detection, that catalog degrades over time
— stale entries produce misleading review context. The write loop is not truly
closed until there is a maintenance step.

**CE source:** ce-compound-refresh (v2.52.0, #372): consolidation + overlap
detection + ce:compound hand-off.

**Key design notes:**
- Staleness signal: entries with no `updated:` frontmatter field older than a
  configurable threshold (default 90 days), or entries whose `problem:` field
  matches a more recent entry at >80% semantic similarity.
- Overlap detection: cluster entries by `category` + `tags`; surface clusters
  with >2 entries covering the same fix pattern.
- Hand-off: after consolidation proposals, invoke knowledge-compounder to
  write the merged entry; archive the superseded entries (move to
  `docs/solutions/archived/`, do not delete).
- Read upstream ce-compound-refresh snapshot (Phase 0 protocol) before
  implementing.

**Sequencing:** Wave 3. No dependency on other Wave 3 tasks.

---

### W3-NEW-2: ce-ideate analog (pre-brainstorm ideation with warrant contract)

**What:** A new `yellow-core` skill (`plugins/yellow-core/skills/ideation/SKILL.md`)
that runs before `/workflows:brainstorm`. Takes a vague idea or problem
statement, generates candidate approaches, applies a warrant contract (forces
articulation of why each approach is grounded), and routes the strongest
candidate into `/workflows:brainstorm`.

**Why:** The brainstorm-orchestrator starts after a direction has been chosen.
The ideation step catches underdeveloped premises before they commit to a
brainstorm artifact. Even with a concrete starting idea, the warrant contract
functions as a useful self-check.

**CE source:** ce-ideate v2 (v2.68.0, #588): mode-aware ideation; subject gate,
surprise-me mode, warrant contract (#671); HITL review-loop (#580).

**Key design notes:**
- The warrant contract is the load-bearing piece: each generated approach must
  answer "what evidence exists that this approach works for this class of
  problem?" before routing forward.
- Subject gate: if the input is fewer than ~10 words and the skill cannot
  determine the domain, ask one clarifying question before proceeding.
- Output: a short ranked list (2-3 approaches) with warrant summaries → user
  selects one → passes selected approach as `$ARGUMENTS` into `/workflows:brainstorm`.
- Read upstream ce-ideate snapshot (Phase 0 protocol) before implementing.

**Sequencing:** Wave 3. Logically precedes the brainstorm skill in the workflow
chain, but no implementation dependency.

---

### W3-NEW-3: ce-sessions analog (cross-vendor session history)

**What:** A new `yellow-core` skill (`plugins/yellow-core/skills/session-history/SKILL.md`)
backed by a new `session-historian` agent (`plugins/yellow-core/agents/workflow/session-historian.md`)
that searches across Claude Code transcripts, Devin session history (via
yellow-devin), and Codex session logs (via yellow-codex) to answer questions
about past decisions.

**Why:** Cross-vendor context loss is the real pain point in a Devin + Codex +
Claude Code footprint. Asking "what did we decide about X last Tuesday" should
return results from all three vendors, not just Claude Code. CE's ce-sessions
covers only Claude Code + Codex + Cursor — yellow-plugins can cover more because
yellow-devin already has an API surface.

**CE source:** ce-sessions + ce-session-historian (v2.64.0, #534): cross-platform
session history search.

**Key design notes:**
- The session-historian agent queries three backends: Claude Code session
  transcripts (local filesystem, standard path); Devin session history (via
  yellow-devin plugin's devin-orchestrator or a new read-only Devin API call);
  Codex session logs (via yellow-codex agents, or the Codex CLI's session log
  path).
- Aggregation: results are merged by timestamp and relevance to the query;
  source tag (Claude Code / Devin / Codex) is always shown.
- Read upstream ce-session-historian snapshot (Phase 0 protocol) for the
  session-transcript schema and query format.
- If yellow-devin or yellow-codex session log access is not available at
  implementation time, degrade gracefully: query only the available backends
  and note which were skipped.

**Sequencing:** Wave 3. Depends on yellow-devin and yellow-codex being present
(both are; neither is being deleted per locked decisions).

---

### W3-NEW-4: UNIQUE agent improvements from CE patterns

Two separate improvement tasks. Both are Wave 3 and independent of each other.

#### W3-NEW-4a: knowledge-compounder track schema + context budget precheck

**What:** Update `plugins/yellow-core/agents/workflow/knowledge-compounder.md`
to adopt:
1. Track-based schema distinguishing bug fixes from knowledge insights (CE
   ce-compound v2.52.0). Each entry written to docs/solutions/ must include a
   `track: bug | knowledge` frontmatter field, plus `tags:` and `problem:` fields
   for relevance ranking.
2. Context budget precheck before writing (CE ce-compound v2.39.0): if the
   resolved solution content exceeds a configurable line threshold, prompt the
   user to split before writing.

**Why this matters for Wave 2:** The learnings-researcher agent (W2.1) ranks
docs/solutions/ entries by relevance to the PR diff. Better metadata (track,
tags, problem statement) makes those rankings significantly more accurate.
Without the schema upgrade, learnings-researcher works against filename-only
heuristics.

**Sequencing note for /workflows:plan:** This task ideally lands in Wave 2 prep
(before W2.1 authors learnings-researcher) so learnings-researcher is built
against the new schema from day one. If that creates Wave 2 PR size concerns,
accept the retrofit in Wave 3 and have W2.1 use filename + category heuristics
as the interim relevance signal, with a note that Wave 3 upgrades the ranking
quality. This is a sequencing decision for `/workflows:plan` to make explicitly.

#### W3-NEW-4b: yellow-debt scanner confidence calibration

**What:** Update the five yellow-debt scanners
(`plugins/yellow-debt/agents/scanners/{ai-pattern,architecture,complexity,duplication,security-debt}-scanner.md`)
and the `audit-synthesizer` to adopt CE adversarial-reviewer's confidence
calibration output format and failure-scenario framing.

Each scanner finding should emit the same structured schema that Wave 2's
persona reviewers use: `severity`, `category`, `file`, `finding`, `fix`,
`confidence`. The synthesizer aggregates using the same dedup and threshold
logic.

**Why consistency matters:** After Wave 2, users will see structured + calibrated
output from review:pr. Debt audit output in a different format creates a
two-tier experience. Applying the same schema ensures the confidence semantics
are uniform across both pipelines.

**Key design notes:**
- The five scanners are analysis agents (not PR reviewers) so they are not
  subject to the read-only tool restriction from Wave 1. They may retain Bash
  for codebase traversal.
- The adversarial framing borrowed from CE adversarial-reviewer: each scanner
  should conclude its findings with a "failure scenario" — a one-sentence
  description of what breaks in production if this debt item is not addressed.
  This is the highest-signal output CE's adversarial pattern produces.
- Read upstream ce-adversarial-reviewer snapshot (Phase 0 protocol) for the
  exact failure-scenario framing.

---

### W3-NEW-5: ce-optimize analog (iterative optimization with LLM-as-judge)

**What:** A new skill (`plugins/yellow-core/skills/optimize/SKILL.md`) adapting
CE's ce-optimize pattern: iterative optimization loops with parallel experiments,
measurement gates, and LLM-as-judge quality scoring. Adopt the schema.yaml and
README structure from CE's ce-optimize directory.

**Why:** ce-optimize has direct synergy with yellow-plugins' ruvector and
multi-backend research investments. Concrete use cases in yellow-plugins: tuning
agent system prompts via LLM-as-judge comparison, comparing implementation
alternatives before committing to a design, optimizing ruvector query parameters
against a labelled recall corpus.

**CE source:** ce-optimize (v2.66.0, #446): auto-research loop, LLM-as-judge,
parallel experiments, measurement gates. Has its own README and schema.yaml.

**Key design notes:**
- The schema.yaml defines the experiment spec format (what to vary, measurement
  criteria, success threshold). Adopt CE's schema; adapt field names to
  yellow-plugins conventions if needed.
- The auto-research loop: before each experiment iteration, invoke
  best-practices-researcher (or research-conductor if yellow-research is
  available) to check for prior art on the optimization target.
- LLM-as-judge: the skill runs two or more candidate implementations/prompts in
  parallel, collects structured outputs, and evaluates with a separate judge
  prompt. The judge must be explicitly instructed to score on the user-specified
  criterion, not overall quality.
- Read upstream ce-optimize snapshot (Phase 0 protocol) including the README and
  schema.yaml.

**Sequencing:** Wave 3. No dependency on other Wave 3 tasks. More complex
adoption than the others due to schema.yaml — allocate proportional implementation
time.

---

## Post-Merge Opportunities

These are not Wave 3 tasks. They are yellow-plugins differentiators that require
the Wave 1/2/3 work to be live first. Each should be the subject of a dedicated
future planning session.

### POST-1: Graphite-native stacked-PR seeds

**Opportunity:** Review agents (review:pr, adversarial-reviewer) detect when a
PR review produces more rework than fits in the current PR and emit structured
"stacked-PR seeds" — minimal branch + title + description tuples. gt-workflow
executes the seeds directly via `gt branch create` + initial commit + `gt stack
submit`.

**Why this is a yellow-plugins differentiator, not a CE port:** CE's ce-polish-beta
emits stacked-PR seeds but CE has no Graphite integration — seeds are ad-hoc text
the user executes manually. yellow-plugins can close this loop because gt-workflow
already owns `gt branch create` and `gt stack submit`. CE cannot do this.

**Why post-merge:** Requires the Wave 2 review pipeline to be live and proven
before adding stack-emission behavior. The seed format should be designed against
the actual Wave 2 reviewer output schema, not against the pre-Wave-2 free-form
output.

**Scope for future planning:** (a) Define the seed format emitted by review
agents (branch name slug, title, description, parent PR context). (b) Add seed
emission as an optional output path in review:pr when adversarial-reviewer or
the aggregation step flags oversized rework. (c) New gt-workflow command or
extension to smart-submit that consumes a seeds list and creates the stack
automatically.

---

### POST-2: Graphite-native autonomous workflow chain (lfg analog)

**Opportunity:** A yellow-plugins-native autonomous workflow chain:
`/workflows:ideate` (new, W3-NEW-2) → `/workflows:brainstorm` → `/workflows:plan`
→ `/workflows:work` → `/workflows:review:pr` (Wave 2 pipeline) →
`/workflows:resolve-pr` → `gt submit` (via gt-workflow/smart-submit).

**Why this is a yellow-plugins differentiator, not a CE port:** CE's lfg uses
vanilla git and gh. A yellow-plugins chain is Graphite-native end-to-end,
incorporates the Wave 2 persona review pipeline, pulls session context from
ce-sessions analog (W3-NEW-3), and chains through yellow-devin and yellow-codex
delegation points where appropriate.

**Why post-merge:** This is a composition of capabilities, not a single component.
Wave 3 must be complete before this chain can be validated end-to-end. The
improved review pipeline (Wave 2) is load-bearing — chaining into a review step
that is still pre-Wave-2 quality defeats the purpose.

**Scope for future planning:** (a) Define the chain as a new top-level skill
(`/lfg` or `/workflows:run`) that sequences the steps with approval gates after
plan and before submit. (b) Determine which steps are pausable (plan approval,
pre-submit review sign-off) vs fully autonomous. (c) Decide whether yellow-devin
and yellow-codex are delegation points within the chain (e.g., work step can
delegate to Devin or Codex) or always use Claude Code for the work step.

---

## Open Questions

**OQ-A: knowledge-compounder sequencing.**
Should the track schema + context budget precheck (W3-NEW-4a) land in Wave 2 prep
(before W2.1 authors learnings-researcher) or as Wave 3? The tradeoff: landing
in Wave 2 gives learnings-researcher better ranking metadata from day one; landing
in Wave 3 keeps Wave 2 PR size manageable. `/workflows:plan` must resolve this
explicitly. Do not treat it as defaulting to Wave 3.

**OQ-B: ce-sessions Devin API access.**
yellow-devin's devin-orchestrator agent is the Devin integration point. It is
not clear whether there is a read-only "list recent sessions" API surface in
yellow-devin or whether adding one requires a new yellow-devin command. Verify
the yellow-devin plugin's API surface before scoping W3-NEW-3's Devin backend.
If not available without new yellow-devin work, treat Devin session history as
a deferred backend (Claude Code + Codex first; Devin in a follow-on PR).

**OQ-C: ce-optimize schema.yaml format.**
The upstream ce-optimize schema.yaml defines the experiment spec format. The
Phase 0 snapshot fetch (per the existing plan's Phase 0 protocol) must include
this file. Its contents determine whether yellow-plugins needs to adopt the
schema verbatim or adapt field names.

**OQ-D: compound-lifecycle scheduling mechanism.**
W3-NEW-1 is "optionally scheduled." The scheduling mechanism is not specified.
Options: (a) a PostToolUse hook that fires after every knowledge-compounder write
and checks for overlap, (b) a manual `/workflows:compound-refresh` command only,
(c) a periodic check integrated into the ce-sessions skill. Decide at plan time;
the simplest correct answer is probably (b) with (a) deferred.

---

## Recommended Plan Updates for `/workflows:plan`

The following additions should be integrated into `plans/everyinc-merge.md` as
new Wave 3 task blocks. Do NOT modify Wave 1 or Wave 2. The existing Wave 3 task
numbering (W3.1 through W3.9) is preserved; append as W3.10 through W3.14 or
equivalent.

**Wave 3 additions (fold into `plans/everyinc-merge.md`):**

| New task | What | Plugin | Changeset type |
|---|---|---|---|
| W3.10 | Compound lifecycle management skill (staleness, overlap, consolidation) | yellow-core | `minor` |
| W3.11 | ce-ideate analog: ideation skill with warrant contract, wraps /workflows:brainstorm | yellow-core | `minor` |
| W3.12 | ce-sessions analog: cross-vendor session-historian agent + session-history skill | yellow-core | `minor` |
| W3.13a | knowledge-compounder track schema + context budget precheck (see sequencing OQ-A) | yellow-core | `patch` or Wave 2 prep |
| W3.13b | yellow-debt scanner confidence calibration + adversarial framing | yellow-debt | `minor` |
| W3.14 | ce-optimize analog: iterative optimization skill with LLM-as-judge + schema.yaml | yellow-core | `minor` |

**Post-merge opportunities (do NOT fold into current plan; flag for future sessions):**

| Opportunity | Framing | Depends on |
|---|---|---|
| POST-1 | Stacked-PR seeds emitted by review agents, executed natively by gt-workflow | Wave 2 pipeline live and proven |
| POST-2 | Graphite-native autonomous workflow chain (/lfg analog): ideate → brainstorm → plan → work → review → resolve → submit | All three waves complete |

**W3.9 changesets update:** W3.9 in the existing plan covers changesets for the
original Wave 3 tasks. After appending the new tasks above, update W3.9 to
include yellow-core `minor` (net: new skills — compound-lifecycle, ideation,
session-history, optimize; updated agent — knowledge-compounder) and
yellow-debt `minor` (scanner calibration).

---

## Scope Boundary — Confirmed Still Out

The following components were reviewed in this session and confirmed not worth
adding to any wave or post-merge opportunity. They are not accidentally omitted.

- **ce-demo-reel** — GIF/video capture; no current UI/visual work in yellow-plugins scope.
- **ce-release-notes, ce-report-bug** — Plugin-meta operations; useful only if yellow-plugins ships to external users on a regular cadence that warrants in-plugin release docs.
- **ce-update cache-dir fix** — Already OS-1 in the existing plan; no change.
- **ce-slack-research + ce-slack-researcher** — No Slack workspace tied to this installation.
- **ce-proof** — Proof collaborative editor; not in the toolchain.
- **ce-gemini-imagegen** — Niche image generation; not relevant.
- **ce-frontend-design, Figma/design agents** — No Figma toolchain in scope.
- **CE data-migration / schema-drift / deployment-verification agents** — Rails-migration-shaped; not applicable.
- **CE stack-specific persona reviewers** (DHH/Rails, Kieran/Rails, Swift/iOS, Ankane/Ruby) — Not the stack (TS/Py/Rust/Go).
- **ce-compound-refresh HITL mode** — The yellow-plugins compound-lifecycle skill (W3.10) is on-demand; the full HITL flow from CE is not needed at current catalog size.
- **ce-issue-intelligence-analyst** — GitHub Issues theme analysis; low signal-to-noise for a solo project.
