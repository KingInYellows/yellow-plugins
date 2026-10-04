# GPT-6 orchestration guidance applied to Yellow Harness

**Date:** 2026-10-03. **Status:** evaluation proposal, not an accepted ADR or
model-routing default. **Inspected:** yellow-plugins `0c384957`; yellow-goal
`81c53c6` (`goal-gen` 0.3.0). No live model benchmark has run.

## Finding

OpenAI's [October 2 model guide][guide] supports testing the Astra/Sol/Luna
coordinator idea. It does not establish that a three-model coordinator beats a
single model on Yellow's milestones. Optimize verified task success, total cost
per success, and completion latency; use task labels as initial hypotheses.

| Candidate     | Vendor positioning                     | Yellow hypothesis to test                                     |
| ------------- | -------------------------------------- | ------------------------------------------------------------- |
| `gpt-6-astra` | Hardest reasoning                      | Difficult diagnosis, ambiguous evidence, and escalations      |
| `gpt-6.1-sol` | Complex coding, research, computer use | Bounded implementation and repository investigation           |
| `gpt-6-luna`  | Focused repeated tasks                 | Classification, extraction, and structured evidence summaries |

The guide explicitly calls Sol's Responses API multi-agent support **beta**. The
[API model guide][api] describes API capabilities; these do not establish
support in the installed Codex CLI, access for this account, or heterogeneous
subagent model selection. Probe those separately before designing around them.
An application-managed router and provider-native delegation are different
experiment arms.

## Fit with the current system

The current engine keeps A\* planning deterministic and derives world state from
observed results. M1 executes Claude Code serially; multi-executor routing and
dependency-graph parallelism remain M2. The new approval-gated Protocol v2 path
exposes `agx-claude-code`, not an OpenAI executor. Protocol v1 remains
stub-only. Sources: [engine instructions][constitution], [PRD][prd], [completion
decision][completion], and [real-run approval decision][approval].

The marketplace owns host/provider integration and consumes the engine as a
process. Canonical acceptance semantics belong to yellow-goal. An OpenAI
adapter, routing policy, or parallel execution change needs an engine-first
specification and any necessary new ADR; a research note cannot expand the
existing protocol or authorization.

## Apply the orchestration principles

| Guidance                             | Harness application                                                                                                                                   | Observable check                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Implement, execute, inspect, correct | Bind success to candidate bytes and independent required checks; perform bounded correction only within approved scope                                | A plausible patch with a failed, missing, blocked, or stale check cannot become accepted |
| Mid-turn steering                    | Persist changed requirements and invalidate affected pending work/evidence; re-evaluate authority before the next dispatch                            | Steer during a slow tool; reconcile its eventual result against the new requirements     |
| Asynchronous tools                   | Overlap independent work while a slow tool runs; join before dependent work or declaring success                                                      | Delay a required test result; completion stays pending until it arrives                  |
| Parallel work                        | Start with independent read-only investigations, bounded fan-out, and one writer per worktree; verify integrated output                               | A join with a failed branch or integration conflict cannot report success                |
| Compaction                           | Preserve milestone/base/candidate identities, approval scope, constraints, pending tool IDs, checks, failures, and remaining budgets in durable state | Resume after compaction with a pending tool and changed requirement; neither is lost     |
| Prompt caching                       | Stable instructions, schemas, and tool definitions precede changing task details                                                                      | Compare cold/warm usage; report cached input separately and retain identical behavior    |
| Explicit approval boundaries         | Routine authorized local work continues; spend, changed authority, merge, and deployment follow the owning contract                                   | A model/tool/budget change cannot reuse an approval bound to the previous invocation     |

Steering updates are queued: they **do not cancel tools or undo completed
actions**. Cancellation needs a separate harness mechanism. Do not treat a
compacted summary as authority, acceptance evidence, or a rollback log.

The guide's caching discount is **up to 95% for cached input**, depending on the
model; it is not a workflow-cost guarantee. Cost accounting must include
uncached input, applicable cache writes and long-context rates, output/reasoning
usage, tools, coordination, retries, verification, and failed runs.

## Proposed experiment

1. **Freeze the evaluation contract offline.** Select 12 representative
   development tasks: four bounded repairs, four difficult
   diagnoses/implementation milestones, and four
   extraction/classification/summary tasks. Include negative cases (insufficient
   evidence, impossible constraints, malformed output). Record immutable inputs,
   required checks, allowed tools, budgets, and timeouts before seeing outputs.
   For write-capable tasks, each trial (model × repeat) starts from a clean
   worktree or snapshot of that frozen base; the verifier binds its candidate to
   that workspace so a later trial cannot inherit a prior patch, generated
   artifact, or changed fixture. Freeze a separate held-out promotion set of 6
   tasks before any live run: two bounded repairs, two difficult
   diagnoses/implementation milestones, and two
   extraction/classification/summary tasks, including at least one negative
   case. Use the same three repeats and independently recorded immutable inputs,
   checks, tools, budgets, timeouts, and per-trial isolation.
2. **Check the verifier independently.** Use known passing and failing
   candidates through existing offline acceptance profiles. Confirm that missing
   evidence and worker narratives cannot produce acceptance. Current profiles
   such as `config-repair` cover a narrow repair surface; additional tasks
   require independently authored oracles, not an assumption that every task
   fits that profile. Structured summaries need schema and source-grounded
   factual checks, not JSON validity alone.
3. **Establish single-model baselines.** Once an operator authorizes a supported
   live evaluation path, run every development task on each available GPT-6
   candidate, three repeats per model (108 runs if all three are available),
   with equivalent tool access and budgets. Predeclare a randomized,
   task/repeat-stratified schedule that includes the incumbent Claude path. Run
   Claude on that same development matrix with the same repeats, required
   checks, and latency collection; it is a separate comparison, not one of the
   108 GPT-6 runs, and does not enter the GPT-6 baseline freeze. Before any live
   run, freeze a pricing snapshot and one cost-allocation policy (subscription
   versus API, shared verification, retries) so every cost-per-success figure
   uses the same basis. Start at model-default reasoning; record the effective
   effort. If a higher effort is required, select it on development results and
   freeze it as part of the candidate before holdout. Select and freeze the best
   single-model GPT-6 baseline from these development results only, using the
   predeclared quality, cost, and latency criteria. Holdout scores, if collected
   for reporting, must not reopen that selection.
4. **Test routing without parallelism.** Derive a policy from development
   results and compare it with the frozen single-model baseline on the
   development tasks. Validate Luna output before downstream use; escalate on
   observed failures, ambiguity, or exhausted capability. Charge all routing and
   escalation work. Do not silently substitute a model within a hash-bound
   approval. Existing real-run approvals authorize one attempt, not a repair
   loop or a multi-model run. Freeze that routing policy before holdout; do not
   retune it after seeing holdout outcomes.
5. **Add orchestration features one at a time.** On suitable development tasks,
   compare async overlap, bounded parallel investigations, steering, compaction,
   and cold/warm caching against the serial baseline. Evaluate native Sol beta
   delegation separately if supported. Test dependency waits, failed joins, late
   results, permission changes, and cache/compaction correctness. After those
   results, freeze at most one orchestration package (or keep serial routing
   only) as a holdout candidate. Do not add configurations after seeing holdout.
6. **Confirm once on held-out evidence.** Evaluate only the frozen routing
   policy, the optional frozen orchestration package, the frozen GPT-6 baseline,
   and the incumbent Claude path on the holdout matrix. Promote the lowest total
   cost per verified success among those predeclared candidates that meet the
   quality and latency requirements. Do not choose a winner by shopping
   additional holdout configurations. If the comparison is inconclusive, expand
   the evaluation rather than retuning on this set. Do not raise reasoning
   effort on holdout after a failure; any fallback effort must already be part
   of a frozen candidate. Keep beta delegation optional with a serial fallback
   until access, quality, failure handling, and cost are demonstrated.

Twelve development tasks and three repeats, plus the frozen 6-task holdout with
three repeats, are a pilot, not enough evidence for a universal routing policy.
Declare promotion thresholds before live runs; report paired results and
uncertainty by task family, and expand inconclusive comparisons. Any false
acceptance or authority violation blocks promotion. Report unavailable models as
unavailable, not as failures or wins for another model.

## Evidence to collect

Each trial records task/repeat IDs; immutable input and base identities;
candidate/artifact identity; engine, prompt, skill, and tool versions; model,
effort, transport and service tier; approval scope; cache state; all model/tool
usage and costs; retries/escalations; start/end times; required-check outcomes;
inspection findings; final disposition and rejection reason; and the durable
verification bundle or equivalent task oracle evidence.

- **Verified success rate:** accepted trials / attempted trials. Keep blocked,
  timed-out, and failed outcomes visible; report infrastructure failures
  separately without silently removing them from the primary denominator.
- **Cost per verified success:** total cost of all attempted trials / accepted
  trials, using the frozen pricing snapshot and allocation policy. Zero accepted
  trials means no finite cost-per-success result.
- **Latency:** end-to-end p50/p95, including coordination and verification;
  report terminal failures and successful completion latency separately.
- **Routing value:** compare complete routed workflows with the frozen
  development-selected single-model baseline and with the incumbent Claude path
  on the same task matrix, not per-token prices or isolated worker outputs.

## Applied now and next boundary

This note records the verified vendor guidance, current architectural fit,
failure probes, and benchmark contract. It changes no executor or model default.
The next implementation is a bounded evaluation seam with independent oracles
and trial accounting, before a general coordinator. Actual model measurements
remain unverified. The engine's [instructions][constitution] reserve real spend
and `run approve` for a human operator; this study does not initiate either.

Local verification on 2026-10-03: from `yellow-goal/goal-gen`,
`npm test -- tests/cli/candidate-offline.test.ts tests/cli/run-manifest.test.ts tests/cli/run-approval-verifier.test.ts`
passed **129 tests across three files** (exit 0). These exercise the existing
offline verifier and approval foundation, not OpenAI model quality or a new
coordinator.

[guide]: https://openai.com/index/practical-guide-building-gpt-6
[api]: https://developers.openai.com/api/docs/guides/latest-model
[constitution]:
  https://github.com/KingInYellows/yellow-goal/blob/81c53c61539f6dd675e2ce518e1cc9e26157b1f2/goal-gen/CLAUDE.md
[prd]:
  https://github.com/KingInYellows/yellow-goal/blob/81c53c61539f6dd675e2ce518e1cc9e26157b1f2/goal-gen/docs/prd.md
[completion]:
  https://github.com/KingInYellows/yellow-goal/blob/81c53c61539f6dd675e2ce518e1cc9e26157b1f2/goal-gen/docs/decisions/0018-verified-single-milestone-execution.md
[approval]:
  https://github.com/KingInYellows/yellow-goal/blob/81c53c61539f6dd675e2ce518e1cc9e26157b1f2/goal-gen/docs/decisions/0020-approval-gated-real-execution.md
