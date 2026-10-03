# Brainstorm: Turn the integration evaluation into an executable yellow-plugins roadmap

**Date:** 2026-10-02
**Status:** Decisions resolved; `/flow:plan` research done (see Planning Addendum, which supersedes earlier sections where they differ). Next: `/flow:spec` per spec.
**Source:** "yellow-plugins x Anthropic Directory - Integration Evaluation" (research result, baseline `864e622`; `main` is one version-packages commit ahead, `a6d765ca1`). Reference material only; no candidate plugin is installed or copied except the step 8 vendor under `PROVENANCE.json`.

## What We're Building

An executable program for the evaluation's 13-step adoption roadmap (its section 8). The roadmap installs nothing. It borrows ideas from third-party plugins into existing yellow components, with one vendored set of stdlib eval scripts.

The program is four dependency-clustered specs, each decomposed into shells by the existing `/flow:spec`, `/flow:decompose`, `/flow:pick-next-shell`, `/flow:expand-shell`, `/flow:work` pipeline and tracked with `/plan:status`.

| Spec | Theme | Steps |
| --- | --- | --- |
| A | Loop and work-execution integrity (yellow-core) | 1 Stop-hook re-entrant capture, 4 plan supersession frontmatter and picker, 6 opt-in `--goal` in `/flow:work`, 7 phantom-completion check |
| B | Review pipeline (yellow-review, yellow-council) | 5 quote-grounding gate (report mode, then enforce), 13 `/review:resolve --until-clean` (3 PRs), 11 council multi-round and OpenCode serve, plus the repro-required "Confirmed" item from step 12 |
| C | Authoring tooling and context budget | 8 vendor skill-creator trigger evals, the `disable-model-invocation` pass from step 12, a baseline measurement of the section 7.2 metrics |
| D | Docs, debt and delegation borrows | 9 `sources`/`verified_at` frontmatter, 10 yellow-debt ratchet and pin inventory, the remaining step 12 borrows |

Direct small PRs, outside the specs:
- **Step 2:** docs only. Add the "not for single-prompt rewrites" clause to optimize, the "do not co-install Semgrep Guardian" note, and the Serena recipe.
- **Step 3:** a spike on whether `"optional": true` dependencies are honored. The result goes in `docs/plugin-validation-guide.md`.

Scope is all 13 steps. Each step is one PR with its own changeset, stays within one plugin, and ships off by default or with a fallback to today's behaviour.

## Why This Approach

- **Existing vehicle.** `plans/specs/` and `plans/shells/` already carry multi-unit efforts (council v2, jules integration, session continuity). They give a dependency graph, fresh-session execution per shell and requirement-coverage checks. `/plan:status` and `/plan:complete` supply tracking and gated archival, so no new format or tracker is needed.
- **Why four specs, not one.** The roadmap's dependency edges (1 to 6, 5 to 13, 8 to the step 12 `disable-model-invocation` pass) fall inside clusters, so shells run without cross-spec coupling. Each cluster maps to one plugin area, which keeps changesets and review scope small. One 13-step spec would be about the size of the 51k jules spec and would hide the independent tracks.
- **Alternatives rejected.** One plan per wave (Now/Next/Later) has no dependency graph or coverage check. A Linear-only tracker is not coupled to the plan-lifecycle validators.
- **Validators are the authority.** The past solution `plugin-add-enumeration-checklist-gaps.md` says hand-written checklists miss sites that validators enforce. Cross-check each step's site list against the relevant validators before shells are expanded.
- **Phase moves propagate by dependency.** Per `phase-boundary-orphaned-triggers-artifacts.md`, if any step moves between waves, find affected triggers, owners and enforcement artifacts by relation, not by grepping step names.

## Key Decisions

1. **Format:** four specs, then shells (above). Spec boundaries follow dependency clusters.
2. **Scope:** all 13 steps.
3. **Gated steps get an explicit spike task first.** The rest proceeds in parallel.
   - **Step 1:** settle the Stop-hook fix scope (all loop drivers or native `/goal` only), and how several Stop hooks that disagree on block versus allow combine. This is undocumented.
   - **Step 3:** the `optional` dependency spike above, which also gates the yellow-linear dependency assumptions in step 13.
   - **Step 8:** maintainer accepts monthly sync ownership of the vendored directory (otherwise step 8 becomes a reimplementation), and the stream-json parsing is smoke-tested against the installed `claude` CLI. A related question is whether skill-creator, which appears installed in the maintainer's own session, should be disabled in yellow-plugins projects or kept alongside the near-miss eval.
   - **Dependents:** step 6 (needs step 1) and the `disable-model-invocation` pass (needs step 8) wait on their spike.
4. **Step 13 stays in "Next"**, after step 5, as the evaluation orders it. It ships as three PRs: (a) `get-pr-comments` fields plus a `reply-pr-thread` script, (b) the resolver disposition contract, (c) the loop. Its optional `/goal` outer driver needs step 1 first.
5. **Baseline measurement item (Spec C, early).** Measure the section 7.2 metrics before any change lands, so "better" can be checked. These cover plan-picker questions per `/flow:work` start, ungrounded review findings, final-iteration compound captures under `/goal`, "done" claims backed by a proof command, phantom subagent edits, held-out trigger accuracy, and open bot threads after a resolve run. Include the listing-budget check (`/context`) for yellow's roughly 42,100 description characters.
6. **Step 5 enforcement.** The grounding gate runs in report mode and logs drops to the review ledger for 2 weeks before it enforces.
7. **Not on the roadmap:** installing or declaring any candidate as a dependency, a UserPromptSubmit hook, any hook on Edit|Write|MultiEdit, or a fourth memory store.
8. **Sequencing.**
   - **Now:** step 1 (after its spike), 2, 3, 4 and the baseline measurement.
   - **Next:** 5, 6, 7, 8, 9 and 13.
   - **Later:** 10, 11 and the remaining step 12 items.

## Open Questions

- **`disable-model-invocation` count.** A grep at HEAD found 2 plugin markdown files matching, while the evaluation says only 1 component sets it. The second match may be a mention, not a setting. Re-check before the step 12 pass.
- **Stop-hook scope.** Resolved only by the step 1 spike.
- **`optional` dependency behaviour.** Resolved only by the step 3 spike.
- **Sync ownership of the vendored evals** and the skill-creator co-install conflict. Resolved by the step 8 spike.
- **Serena recipe.** Is a documented opt-in recipe worth shipping given ruvector, warpgrep and ast-grep? Decide when writing step 2, defaulting to include it as the evaluation proposes.
- **prompt-master refresh.** Outside this repo, but the evaluation calls it the larger prompting gap. Track separately.
- **Native `/goal` availability.** The evaluation did not run the installed `claude` binary. Verify before step 6.
- **Directory identity.** The upstream repos for 32 community candidates are matched by author, version and components, not by a catalog link. Confirm the repo from the directory's install source before borrowing from any of them.
- **Citations.** Re-anchor every `path@864e622#Lx-Ly` citation on current `main` before editing, and note any moved lines in the PR.

## Planning Addendum (2026-10-03)

`/flow:plan` ran its research and gap analysis against `main` at `a6d765ca1`, then escalated: this is spec-tier work, so no single plan was written. Where this section differs from the sections above, this section wins.

### Decisions made during planning

1. **Council sequencing.** Council v2 shells `yellow-council-v2-four-cli-04` (quota and OpenCode routing) and `-05` (evidence verification) ship first. Step 5 and shell 05 share one grounding primitive, built on `rl_window_match` / `rl_normalize_line` in `plugins/yellow-review/lib/review-ledger.sh`. Step 11 leaves Spec B and becomes a council-V3 spec that amends the out-of-scope list in `plans/specs/yellow-council-v2-four-cli.md`.
2. **Goal flag.** Step 6's flag is `--goal-condition`. It composes a condition for native Claude Code `/goal`. If a command cannot invoke `/goal`, the flag prints a ready-to-paste condition instead. Every spec that mentions it states that this flag is unrelated to the `yellow-goal` plugin (`/goal:*`) and to the jules goal-engine milestone.
3. **Step 7 home.** Step 7 moves to Spec B and folds into step 13(b). Resolvers declare their file lists, and the orchestrator compares the diff against those claims. Per-resolver `git diff` attribution is impossible in a shared working tree.
4. **Optional dependencies.** On Claude Code 2.1.288 (`--plugin-dir`), `"optional": true` is ignored: a plugin whose optional dependency is missing gets disabled. yellow-ci and yellow-debt are therefore disabled today when yellow-linear is absent. Step 3 becomes a spike plus a follow-up PR:
   - The spike confirms the same behaviour on the marketplace-install path, using a disposable `CLAUDE_CONFIG_DIR`.
   - The follow-up PR removes the yellow-linear entry from the emitted `plugin.json` and keeps it as a catalog-only annotation.
   - At runtime, the commands detect yellow-linear via ToolSearch.
   - The PR fixes the "Required" wording in `plugins/yellow-ci/CLAUDE.md` and `plugins/yellow-debt/CLAUDE.md`, and records the result in `docs/plugin-validation-guide.md`.
5. **Baseline method.** Two Now-wave metrics are measured by hand before their steps merge: plan-picker questions per `/flow:work` start (before step 4) and final-iteration captures under `/goal` (before step 1). The other §7.2 metrics use the report-mode output of the step that introduces them, so step 5's report mode is the grounding baseline. Each metric gets a numeric target in its spec.

### Revised spec membership

| Spec | Steps |
| --- | --- |
| A — loop and work integrity (yellow-core) | 1 Stop-hook capture; 4 plan supersession + picker; 6 `--goal-condition` |
| B — review pipeline (yellow-review) | 5 grounding gate; 13(a) `get-pr-comments` fields + `reply-pr-thread`; 13(b) disposition contract + step 7 ownership check; 13(c) loop; step-12 repro-required "Confirmed" (debugging skill, correctness-reviewer) |
| Council V3 (after v2 shells 04/05) | 11 prior-round context, anti-escalation, corrections-only addendum, `opencode serve` |
| C — authoring tooling and context budget | baseline + listing-budget measurement; 8 trigger evals; step-12 `disable-model-invocation` pass; fix `create-agent-skills/SKILL.md:83,95` |
| D — docs, debt and delegation | 9 `sources`/`verified_at`; 10 debt ratchet + pin inventory (covers step 8's provenance file); step-12 borrows: dependency rubric (security-sentinel), coding brief (`/devin:delegate`), runner detection + `--verify` (`/setup:claude-web`), consent and verbatim rules (session-handoff), diagram citation file-existence check (diagram-architect), `--help` discovery for repo scripts |
| Direct PRs | 2 docs notes; 3 spike + follow-up PR |

### Resolved open questions

- **`disable-model-invocation` count.** Exactly one setter exists: `plugins/yellow-ci/commands/ci/runner-cleanup.md:9`. The second grep match, `create-agent-skills/SKILL.md:83,95`, documents the key wrongly ("no LLM call"), and Spec C fixes it.
- **Native `/goal`.** It is documented and present in 2.1.288 as a session-scoped, prompt-based Stop hook. Its evaluator reads only the transcript, so a condition must name proof output that appears in the transcript. Whether a command can invoke it is still unverified, and decision 2 covers that fallback.
- **Step 8 vehicle.** Spec C starts with a spike on native `claude plugin eval` (v2.1.269+, `--ablation none` for trigger tests). Vendoring skill-creator's Apache-2.0 `run_eval.py` is the fallback, and the sync-ownership question applies only if the fallback is used.

### Facts the specs must carry

- **Step 1.**
  - `stop.sh:52-57` early-exits on `stop_hook_active`.
  - Capture is a tmp+`mv` overwrite in a disowned subshell. Concurrent subshells can finish out of order, so add a monotonic guard (for example, transcript length).
  - A mid-run SessionStart drain (`session-start.sh:233` requeue) can split one session's capture into two entries, so check dedupe at drain time.
  - Invert `tests/compound-stop-hook.bats:71-81`.
  - The hook must never emit `decision:block`. The block cap is 8 (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
  - yellow-core is the only first-party Stop hook.
- **Step 4.**
  - Picker sites: `flow/work.md:47`, `flow/review.md:51,79`, `plugins/yellow-research/commands/flow/deepen-plan.md:36`. That last one is a cross-plugin exception, or a shared picker script.
  - Plan-status has a generated Codex copy, `tests/plan-status-parity.bats`, and golden fixtures, which all change together.
  - Supersession frontmatter must not use `spec:` or `depends_on:`, because `expand-shell.md:31` uses those keys to detect shells.
  - Reuse compound-lifecycle's `superseded_by:` naming.
  - A plan with no frontmatter counts as active.
- **Step 5.**
  - The finding schema has no quote field. Adding one touches about 13 producer agents, the `tests/skill-content.bats` census and parity tests, the `review-all.md` Step 8 mirror, and ledger `observe`.
  - Gate placement: between validate (`review-pr.md:865`) and dedupe (`:901`).
  - Ground against the raw quote, then store only the redacted quote.
  - A ledger record with no quote field means "not evaluated", not "ungrounded".
  - The enforcement switch needs a numeric criterion (a minimum finding count and a maximum false-drop rate), not only "2 weeks".
- **Step 13.**
  - `resolve-pr.md` rejects unknown flags. `--until-clean` is added together with `docs/plugin-scope-mode-protocol.md`, `argument-hint`, and the `sweep` / `sweep-all` pass-through.
  - Count open threads via GraphQL `reviewThreads`, because `get-pr-comments` drops outdated threads.
  - The `provider-neutral-commands` allowlist caps raw git/gh mentions in `resolve-pr.md` at 4, so reply logic belongs in the script.
  - Human threads stay open, and only bot threads are auto-resolved.
  - Refresh derived state every round (`resolve-stack-state-stale-after-fix-commit-push.md`).
- **Step 8.**
  - Evals spawn `claude -p` without `--bare`, which fires project hooks (compound capture, SessionStart drain). Run evals in a scratch root or set `COMPOUND_DRAIN_IN_PROGRESS=1`.
  - Set a cost cap and a run location (local or CI). Use n runs with a threshold, plus a held-out set.
- **Listing budget.**
  - `CONTRIBUTING.md:773` says `user-invocable: false` skill descriptions are outside the budget, while the evaluation counts them. Settle this with `/doctor` before the `disable-model-invocation` pass.
  - Current description characters: skills 16,023 (58 non-user-invocable skills account for 12,776), commands 23,703, agents 22,153.
- **Every spike** records the Claude Code version (2.1.288 at planning time) and a pass/fail decision rule written before the spike runs.

### Risk ranking (highest first)

1. Step 13 (public write authority).
2. Step 5 (schema change across about 13 agents).
3. Step 1 (race and double capture).
4. The `disable-model-invocation` pass (it can break Skill-tool call chains and `skills:` preloads in 35 agent files).
5. Council V3 (gated on v2 shells).
6. Steps 2, 4, 9 and 10 (low).
