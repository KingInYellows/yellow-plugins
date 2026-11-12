# Roadmap: Claude Code quality and cost across yellow-plugins

Date: 2026-11-09 · Status: ticketed in Linear (umbrella CLAUDE-301), no work
started · Measured at `main` `8d9762e57`

This is an umbrella roadmap, not an implementation plan. Each initiative below
(ids `R0.1` … `R8.3`) becomes one Linear ticket, or maps to an existing one
where noted, and gets its own `/flow:plan` before any code changes.

## Overview

The marketplace ships 22 plugins: 148 commands, 82 agents, 77 skills, 12 MCP
servers and hooks in 11 plugins. The goal is better work from Claude Code when
these plugins are installed, at lower cost. Quality comes first. Cost has four
measures, with weekly usage headroom on the Max subscription as the primary
one; context pressure, wall-clock time and metered dollars are tracked beside
it.

Three findings shape the order of work:

- Nothing records tokens, dollars or duration per workflow today, so no cost
  claim can be checked. Measurement comes first.
- Eval assets exist (`scripts/eval/model-swap/`, `scripts/eval/review-gate/`,
  thermonuclear fixtures, the review ledger) but do not yet cover prompt edits,
  skill triggering or planning output. A minimum eval set gates every
  behaviour change.
- Several savings need no eval at all: about 18k tokens of always-loaded
  descriptions, 8 command/skill name collisions, and headless `claude -p`
  calls with no budget cap. These start immediately.

## Settled Decisions

- Scope is all 22 plugins. (session-settled: user-directed — chosen over core
  workflows only (yellow-core flow, yellow-review, gt-workflow): the user
  wants every plugin audited.)
  Conflict: yellow-jules is scheduled for removal after 2026-12-31
  (CLAUDE-262), so it gets no prompt or description work here.
- The deliverable is one umbrella roadmap that folds the open plans in as
  tracks, with a Linear ticket per initiative. (session-settled: user-directed
  — chosen over a new-work-only roadmap and over going straight to
  `/flow:spec` with shells: the user wants one sequenced view plus tickets.)
- Quality of work outranks every cost measure. (session-settled: user-directed
  — chosen over cost-first optimization: the user stated quality is most
  important.)
- Only behaviour-changing work must pass the eval gate: prompt edits, review
  pipeline changes, model or effort swaps and orchestration changes.
  Validators, description budgets and headless budget caps are exempt.
  (session-settled: user-approved — chosen over gating every change and over
  spot-checks only: gating everything spends eval usage on changes that cannot
  alter output.)
- Weekly usage headroom is the primary cost metric. (session-settled:
  user-approved — chosen over context pressure, wall-clock time or metered
  dollars as primary: it is the one resource the subscription cannot buy more
  of.)
- The 8 gt-workflow name collisions are fixed by removing one side and keeping
  the existing name. (session-settled: user-approved — chosen over renaming
  with a deprecated alias or renaming outright: no user-facing rename.)
- Paid evals run locally and by hand under a per-run cap; CI runs only free
  deterministic graders and replay. (session-settled: user-approved — chosen
  over a scheduled CI eval job from the start: a scheduled job waits until the
  review pipeline's weekly eval needs it.)

## Problem Statement

### Current pain points

| Area | Measured today | Why it matters |
|---|---|---|
| Measurement | No per-workflow token, cost or duration record | Cost targets cannot be set or verified |
| Always-loaded context | ~72k chars of `description:` (~18k tokens): commands 31.2k, agents 23.5k, skills 17.3k | Paid every session; the skill listing is budgeted at 1% of the context window and drops least-used descriptions on overflow |
| Manual-only commands | 2 of 148 set `disable-model-invocation`; 0 skills do | Their descriptions sit in context though only the user invokes them |
| Name collisions | 8 command/skill pairs in gt-workflow | The thin command wrapper has loaded instead of the skill body (CLAUDE.md, Claude Code 2.1.259) |
| Body size | 18 commands over 500 lines, 14 agents over 300; `council.md` 4,000, `review-pr.md` 1,486, `flow/work.md` 1,156 | After compaction only the first 5,000 tokens of an invoked skill survive, so late rules are lost mid-run |
| Prompt style | 265 all-caps emphasis hits (whole-file regex, overcounts); yellow-core 83, yellow-review 37, yellow-council 36, yellow-debt 29, yellow-codex 26 | Current models over-apply emphasized rules |
| Review fan-out | `/review:pr` dispatches up to ~22 personas, all results in the lead's context; the review-gate workflow that would replace this is still in shadow | Largest token consumer and the main source of review noise |
| Caching | 6 commands set `model:`; nothing uses `context: fork` | A `model:` different from the session model forces a full cache miss that turn |
| Headless | SessionStart drain spawns `claude -p` each session; CI runs claude-code-action in two workflows | No budget cap or cost capture on any call site |
| Hooks | Per-Bash hooks in gt-workflow and github-workflow, per-edit hooks in yellow-ruvector, 8 SessionStart hooks | Latency and injected context on every session and tool call; cost unmeasured |

### What already exists and is not re-decided here

The plan files in `plans/` lag `main`. Status below is from Linear, the git
log and `docs/research/model-routing-policy.md`, checked 2026-11-09.

- **Model routing: Phases 1–3 shipped** (CLAUDE-163, CLAUDE-187, CLAUDE-194,
  CLAUDE-200; #1385, #1407, #1436, #1469), each swap graded by
  `scripts/eval/model-swap/`. The policy doc records every verdict and the
  swaps that failed (git-history-analyzer, codex-reviewer, test-runner).
- **Risk-tiered review pipeline: Phases 0–3 and the eval loop shipped**
  (umbrella CLAUDE-231 is Done). The review-gate workflow runs in shadow, in
  CI and under `review_pipeline: workflow`; `/review:pr` still defaults to the
  persona pipeline. Open: CLAUDE-285 (decide whether review-gate leaves
  shadow, window ends about 2026-11-16), CLAUDE-238 (hunter rule vocabulary)
  and CLAUDE-248 (upstream code-review job skips re-review).
- **CLAUDE-216** (Todo) — shrink the largest commands into thin spines with
  step-scoped references, eval-gated, starting with `council.md`. It defines
  the measurement method this roadmap adopts: measure the noise floor on two
  identical builds and register the pass bar in writing before any edit.
- **CLAUDE-291** (Backlog) — single-line description validator for agents and
  commands. **CLAUDE-292** (Backlog) — refresh the prompting guide for the
  current model generation.
- **CLAUDE-262** (Todo) — remove yellow-jules after Jules shuts down on
  2026-12-31.
- `plans/yellow-rtk-plugin.md` — deferred behind a one-week pilot; the plan
  needs a rewrite before any work.
- Rule packs `prompt-style-current-models` and `trim-before-offloading`, and
  the standing preference that line ceilings are advisory: prune by content
  value, not by line count.

## Proposed Solution

### Principles

1. Measure before claiming. Every initiative states a baseline, a target and a
   pass/fail check. Where the baseline does not exist yet, the ticket sets the
   target after `R0.1`.
2. One behaviour change per PR, each with a changeset, so a quality regression
   is one revert.
3. A behaviour change ships only when the eval set shows no quality loss.
   Before/after runs use a fixed repeat count; one run per case is not
   evidence.
4. Ratchet, do not block. New validators start warn-only and fail only when a
   number grows.
5. No new per-tool-call hook for measurement. Parse transcripts and
   `claude -p` JSON output after the fact.

### Sequence

```text
Now (no eval needed, run in parallel)
  R0.1  R0.2  R2.1  R2.2  R2.3  R7.1  R8.1
Next (needs R0.1 baseline)
  R0.3  R1.1  R1.2  R8.3
Then (needs the R1.1 eval floor; one initiative per track at a time)
  T4 review pipeline (after CLAUDE-285)  ->  T3 prompt sweep (yellow-review last)
  T5 routing leftovers (separate PRs from T3 so effects can be attributed)
Later (needs T4's workflow pattern proven)
  T6 orchestration and caching      T7.3 hooks replacing prompt rules
```

T3 and T4 touch the same files (`review-pr.md`, the reviewer agents). T4 goes
first there, so the sweep does not polish prose that T4 rewrites or deletes.

## Tracks and initiatives

Each initiative lists its check. "Gate" means the eval gate applies.

### T0 — Baseline and measurement

- [ ] **R0.1 Per-workflow cost baseline.** A script that turns session
  transcripts and `claude -p --output-format json` output into a table of
  tokens, duration and cost per workflow. Check: one committed table for the
  five most-used workflows (`/review:pr`, `/review:resolve`, `/flow:plan`,
  `/flow:work`, `/review:sweep`). Verify the OpenTelemetry export before
  designing around it.
- [ ] **R0.2 Usage attribution snapshot.** Record `/usage` attribution by
  plugin, skill, subagent and MCP server, plus `/context` and `/doctor` listing
  cost, for one normal week. Check: snapshot committed under `docs/research/`,
  with the caveat that `/usage` covers one machine only.
- [ ] **R0.3 Quality scorecard and reviewer-yield rollup.** Define the quality
  numbers the roadmap is judged on: review precision and recall on known
  incident PRs, skill trigger rate, rework after review. Build the
  per-reviewer yield rollup from the review ledger (open question 6 of the
  routing plan: who owns ledger export, since the ledger is pruned when a PR
  closes). Check: one scorecard file, refreshed monthly; usage share and
  metered dollars reported as separate pools.

### T1 — Eval corpus and gate

- [ ] **R1.1 Minimum incident-derived corpus.** 15–20 cases per touched area,
  drawn from `docs/solutions/` and past reviewed PRs, in the existing
  `scripts/eval/review-gate/` case format where it fits. Check: the floor
  exists for review, resolve and planning before T3–T5 start.
- [ ] **R1.2 `claude plugin eval` suite for triggering.** Cases for skill and
  command triggering, including negative cases that must not trigger.
  Deterministic graders (`regex`, `tool_used`) first; model-graded cases on a
  sample only. Check: suite runs locally under a stated per-run cap; the
  repo's schema and generators accept the `evals` layout.
- [ ] **R1.3 Gate definition.** Adopt the CLAUDE-216 method for every gated
  change: measure the noise floor on two identical builds, then register the
  pass bar, repeat count and result location in writing before the edit. No
  primary source defines a non-inferiority margin, so the choice is documented
  here. Check: a short section in `CONTRIBUTING.md`; free replay in CI, paid
  runs manual.

### T2 — Always-loaded context (no gate, except R2.4)

- [ ] **R2.1 Description-budget validator.** Print description characters per
  plugin and in total, in warn-and-ratchet mode: fail only when the total
  grows. Check: validator in `pnpm validate:schemas`. Shipped baseline:
  70,817 chars, below the 72.0k measured at plan time because commands that
  set `disable-model-invocation` are excluded.
  The single-line description rule for agents and commands is the existing
  CLAUDE-291, folded into this track.
- [ ] **R2.2 Resolve the 8 gt-workflow collisions.** Test which side Claude
  Code loads on the current version, then remove the other and keep the name.
  Add a collision check to the validator. Check: no shared names; the
  `smart-submit` and `gt-amend` workaround paragraph in `CLAUDE.md` is
  deleted; Codex and Cursor copies regenerate cleanly.
- [ ] **R2.3 `disable-model-invocation` on manual-only commands.** Grep every
  cross-reference first: a command that another command or skill invokes by
  name must stay model-invocable. Clean-install test, since the local schema
  and the remote validator differ. Check: description total drops; no
  workflow that chains commands breaks.
- [ ] **R2.4 Description rewrite for triggering.** Put the trigger first and
  trim the rest, plugin by plugin. Descriptions are trigger text, so this one
  is gated: `R1.2` runs before and after. Check: trigger rate not lower,
  total characters lower. Target set in the ticket after `R2.1`.

### T3 — Prompt quality sweep, all 22 plugins (gated)

- [ ] **R3.1 Largest bodies first — existing CLAUDE-216, no new ticket.**
  `council.md` first, then `review-pr.md`, `flow/work.md` and `setup/all.md`,
  one PR each with its own registered bar. This roadmap adds to its list
  `linear/delegate.md`, `resolve-pr.md` and the three council/codex reviewer
  agents, and one rule: must-hold rules go in the first 5,000 tokens, because
  that is all that survives compaction.
- [ ] **R3.2 Style sweep per plugin.** Starts after CLAUDE-292 refreshes the
  prompting guide, which is folded into this track. Remove all-caps emphasis, "be
  conservative" reviewer instructions, standing "always delegate" lines and
  stale cautions; add an explicit delegation rule where agents spawn agents.
  Review self-verification lines one by one: steps that gate destructive
  actions (resolve, merge, revert) stay. Order: yellow-core, yellow-council,
  yellow-debt, yellow-codex, the remaining plugins, yellow-review last;
  yellow-jules is skipped. The plugins with no agents, hooks or MCP servers
  need only this and T2. Check:
  one PR per plugin, eval pass rate unchanged.
- [ ] **R3.3 Prompt-style lint.** Advisory lint with an allowlist so the
  removed patterns do not return. Check: runs in `pnpm lint:plugins`.
- [ ] **R3.4 Stale-caution sweep of instruction files.** Root and per-plugin
  `CLAUDE.md`, `AGENTS.md` and the memory index: delete cautions whose reason
  no longer holds, write exceptions into the rule itself. Cautions about
  destructive actions stay until the maintainer confirms.

### T4 — Review pipeline (gated; the pipeline itself has shipped in shadow)

- [ ] **R4.1 Shadow-exit decision — existing CLAUDE-285, no new ticket.** It
  blocks CLAUDE-238 and CLAUDE-248, which stay as they are.
- [ ] **R4.2 Reconcile `plans/risk-tiered-review-pipeline.md`** with `main`
  (its status line still reads "Phase 0 in progress") and archive it if done.
- [ ] **R4.3 Workflow core as the `/review:pr` default.** Blocked by
  CLAUDE-285. Hunters report everything and the verifier pass filters; the
  persona fan-out stays reachable until the workflow path passes its eval.
  The risk tier sets the fan-out, with the full panel always on for security,
  auth and shell paths. Check: recall on known-incident PRs unchanged; tokens
  per review and lead-context use lower at the low and medium tiers, against
  the `R0.1` baseline.

### T5 — Model and effort routing (gated; Phases 1–3 have shipped)

- [ ] **R5.1 Reconcile `plans/haiku-5-5-model-routing-phase-1.md`** with
  `main`, confirm the `linear-pr-linker` write-path smoke test (task 1.5.2)
  and archive the plan.
- [ ] **R5.2 Remaining swap candidates,** one per PR with
  `scripts/eval/model-swap/`: research-conductor (Opus to Sonnet, in a run
  with its MCP sources), the conditional Opus reviewers in `/flow:work`,
  test-runner with exploratory-mode cases, and the compounder's Category
  Classifier once its category definitions are sharpened. The
  git-history-analyzer and codex swaps failed on 2026-10-28 and stay closed
  until their cause is fixed.
- [ ] **R5.3 Agent frontmatter hygiene.** `maxTurns` on pinned agents,
  `omitClaudeMd` on leaf agents that need no repo rules, `effort` on
  knowledge-compounder. Confirm first that no agent sets these today and that
  plugin-shipped agents honour them; clean-install test.
- [ ] **R5.4 Trigger tightening** for the plugin-markdown reviewers in
  `/review:pr` (the policy's remaining Phase 3 item), decided together with
  `R4.3` because both change which reviewers run.

### T6 — Orchestration and caching (gated)

- [ ] **R6.1 Workflow-script pilots** for `/docs:review`, `/debt:audit`,
  `/flow:plan` and `/council`, one at a time, each with a win criterion
  written before the pilot. Workflows cut lead-context pressure but can raise
  total tokens, so each is judged on quality first, then weekly usage.
- [ ] **R6.2 Remove in-context model switches.** Move the 6 commands that set
  `model:` to `context: fork` or an agent. This changes which model does the
  work, so it is decided together with `R5.2`.
- [ ] **R6.3 Subagent cache TTL decision.** Measure whether a longer TTL pays
  back on the review and resolve fan-outs before setting it.

### T7 — Headless, CI and hooks

- [ ] **R7.1 Budget and model pin on every `claude -p` call** (no gate):
  `session-start.sh`, `stop.sh`, `compound-staging.sh`, the eval runners and
  CI. Capture `total_cost_usd`. Test `--bare` on the SessionStart drain before
  applying it, since the drain relies on plugin state. Check: a grep-based
  test that every call site carries the flags.
- [ ] **R7.2 Hook cost audit.** Measure latency and injected context of the 8
  SessionStart hooks, the per-Bash hooks and the per-edit hooks. Check: a
  table; any hook over a stated budget gets a ticket.
- [ ] **R7.3 Hooks in place of prompt rules** (gated) for must-hold
  behaviours. Fail open, with bats tests under bash and zsh.
- [ ] **R7.4 CI checks.** `claude plugin validate --strict` beside the
  in-repo validators; a budget for the claude-code-action jobs; consider
  failing on `plugin_errors` in the init event once it is known not to break a
  tolerated condition.

### T8 — MCP and tool output

- [ ] **R8.1 MCP footprint measurement.** Byte counts of server instructions
  and tool schemas for the 12 shipped servers; keywords within the first
  4,096 characters of each instruction. Tool counts per server were not
  measured in this research.
- [ ] **R8.2 Research-provider spend controls** in `/flow:deepen-plan` and
  `/research:deep`: the metered-dollar hot spot.
- [ ] **R8.3 yellow-rtk pilot decision.** Rewrite the plan, run the one-week
  pilot against the `R0.1` baseline, then ship or close.

## Mapping of open plans

| Plan or ticket | Track | Action |
|---|---|---|
| `plans/risk-tiered-review-pipeline.md` | T4 | Shipped in shadow; reconcile and archive (R4.2) |
| CLAUDE-285, CLAUDE-238, CLAUDE-248 | T4 | Existing tickets; R4.3 is blocked by CLAUDE-285 |
| `plans/haiku-5-5-model-routing-phase-1.md` | T5 | Shipped; reconcile and archive (R5.1) |
| Compound Engineering v3.33.2 adoption (CLAUDE-207) | T3, T4 | Mostly shipped (CLAUDE-208 to 221). Open: CLAUDE-216, CLAUDE-293, CLAUDE-294 |
| CLAUDE-216 | T3 | Existing ticket is R3.1 |
| CLAUDE-293 | T4 | Changes `/review:pr`; land before or together with R4.3, not after |
| CLAUDE-294 | none | Rule packs from another repo; independent of this roadmap |
| CLAUDE-291 | T2 | Existing ticket; R2.1 adds only the budget check |
| CLAUDE-292 | T3 | Existing ticket; precedes R3.2 |
| CLAUDE-50 | T0 | Existing ledger ticket; related to R0.3 |
| CLAUDE-262 | none | yellow-jules removal; excluded from T2 and T3 |
| `plans/yellow-rtk-plugin.md` | T8 | Rewrite, pilot, decide (R8.3) |
| `plans/cycle-1-resolve-hardening-and-ci-split.md` | none | 33 of 40 boxes per the file; reconcile on its own |
| `plans/shell-alias-hardening.md` | none | Complete; archive with `/plan:complete` |

## Linear tickets

Project: "Claude Code quality and cost roadmap" in the yellow-plugins team.
Umbrella: CLAUDE-301. Milestones: 1 Now, 2 Next, 3 Then, 4 Later.

| Milestone | Initiative → ticket |
|---|---|
| 1 Now | R0.1 CLAUDE-302 · R0.2 CLAUDE-303 · R2.1 CLAUDE-306 · R2.2 CLAUDE-307 · R2.3 CLAUDE-308 · R7.1 CLAUDE-309 · R8.1 CLAUDE-310 |
| 2 Next | R0.3 CLAUDE-314 · R1.1 CLAUDE-304 · R1.2 CLAUDE-315 · R1.3 CLAUDE-305 · R4.2 CLAUDE-311 · R5.1 CLAUDE-312 · R7.2 CLAUDE-313 · R8.3 CLAUDE-325 |
| 3 Then | R2.4 CLAUDE-326 · R3.2 CLAUDE-316 · R3.3 CLAUDE-327 · R3.4 CLAUDE-317 · R4.3 CLAUDE-318 · R5.2 CLAUDE-319 · R5.3 CLAUDE-320 · R5.4 CLAUDE-328 |
| 4 Later | R6.1 CLAUDE-329 · R6.2 CLAUDE-330 · R6.3 CLAUDE-321 · R7.3 CLAUDE-322 · R7.4 CLAUDE-323 · R8.2 CLAUDE-324 |
| Existing | R3.1 CLAUDE-216 · R4.1 CLAUDE-285 |

## Acceptance Criteria

1. `R0.1` and `R0.2` produce a committed baseline before any cost claim is
   made in a later ticket.
2. Every initiative has a Linear ticket that names its baseline, target, check
   and, for gated work, the eval cases it runs.
3. No gated change merges without a before/after eval result attached to its
   PR.
4. The description total, collision count and `claude -p` flag coverage are
   enforced by validators, in ratchet mode.
5. The scorecard is refreshed monthly and shows quality numbers beside weekly
   usage share; a track whose quality number falls is paused.

## Risks

- **Triggering regressions.** Shorter descriptions and
  `disable-model-invocation` can stop a skill or a chained command from
  firing. Mitigation: `R1.2` before and after; cross-reference grep in `R2.3`.
- **Tier misclassification** skips the persona that would have caught a bug.
  Mitigation: full panel floor for security, auth and shell paths; recall
  measured on incident PRs.
- **Schema divergence.** New frontmatter keys may be rejected by the local
  schema or the remote validator, or mishandled by the Codex and Cursor
  copies. Mitigation: clean-install test per key; `pnpm validate:generated`.
- **Evals eat the weekly limit.** Mitigation: deterministic graders first,
  per-run cap, model-graded cases on a sample, never in default CI.
- **Attribution loss** if prompt edits and effort changes land together.
  Mitigation: separate PRs, one initiative per gated track at a time.
- **Validators that block every PR.** Mitigation: warn-and-ratchet.

## Open Questions

1. CLAUDE-285, CLAUDE-291 and CLAUDE-292 have no Linear project; they are
   linked to the roadmap but were not moved.
2. Not verified in the research, to confirm in the owning ticket: the
   `--max-turns` flag, OpenTelemetry metric names, the per-model prompting
   pages for the Sonnet, Opus and Haiku 5.5 models, hook handler types beyond
   `command`, and whether any agent already sets `maxTurns` or `omitClaudeMd`.
3. Whether to keep the upstream code-review CI job is decided in CLAUDE-285,
   not here.

## References

- Repo: `docs/research/model-routing-policy.md`,
  `docs/research/best-practices/gpt-claude-latest-model-prompting-guidance.md`,
  `docs/rule-packs.md`, `scripts/eval/`, `plugins/yellow-review/lib/review-ledger.sh`,
  `plugins/yellow-core/lib/context-observer.py`, `scripts/validate-agent-authoring.js`,
  `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md`,
  `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md`.
- Claude Code docs (fetched 2026-11-09): <https://code.claude.com/docs/en/skills>,
  `/sub-agents`, `/plugins-reference`, `/plugin-evals`, `/workflows`,
  `/prompt-caching`, `/costs`, `/headless`, `/mcp`, `/code-review`.
- Prompting guides: <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
  and its per-model pages for Fable 5.2 and Opus 5.
- Evals: <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>
  (2026-01-09).
