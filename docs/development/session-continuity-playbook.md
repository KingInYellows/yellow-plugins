# Session continuity — Claude Code build playbook

**Adopted:** 2026-09-17 into `docs/development/` from the external
session-continuity packet (CLAUDE-CODE-PROMPTS.md sha256 `f1709267…`). Step 1
has been executed; its outcome and the live corrections are recorded in the
[PRD's reconciliation section](../prds/session-continuity.md#live-reconciliation-2026-09-17)
and the
[research ledger addendum](../research/session-continuity-2026-09-17.md#live-reconciliation-addendum-2026-09-17-this-checkout).
Steps 2–10 are the remaining sequence; the prompts reference the adopted
repository paths instead of the packet directory. **Companion documents:**
[PRD](../prds/session-continuity.md) ·
[research ledger](../research/session-continuity-2026-09-17.md) ·
[acceptance tests](../testing/session-continuity-acceptance.md)

**Target:** Fable 5.1 leading work on Brad's repositories. **Rule:** Send one
step at a time. Do not paste the whole playbook as one autonomous mission.

This packet proposes a product. It does not install a plugin, enable live
execution, or authorize a release. Begin in `KingInYellows/yellow-plugins`. The
packet stayed outside both repositories; Step 1 imported its documentation
deliberately. All later `<EXACT_...>` values come from the previous command's
actual output, not from guessed filenames.

Open `/model` and select the available Fable 5.1 entry. Verify the actual
client/provider/model, not only the `fable` label; the alias is
provider-dependent. No automatic client update, global settings edit, model
substitution or usage-credit purchase is part of these prompts.
[Model configuration](https://code.claude.com/docs/en/model-config)

Fable is the lead/integrator. Use one writer per worktree; bounded read-only
specialist review is useful when there is a concrete uncertainty. Do not launch
an arbitrary reviewer swarm or require external coding subscriptions to complete
the foundation.

## Kickoff facts fixed by Step 1 (2026-09-17)

| Fact                          | Value                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base revision                 | `yellow-plugins` `main` `3812fc66` (post-#797); installed `yellow-core` 2.3.1 at `4192ea57` is byte-identical to the checkout's `plugins/yellow-core/`                                                                                          |
| Client                        | Claude Code 2.1.274; statusline = `~/.claude/yellow-statusline.py` (generated 2026-06-02); Graphite is the enabled stacked-PR provider                                                                                                          |
| Engine                        | `yellow-goal` `main` `09bcd16`, `goal-gen` 0.2.0, bridge pin 0.2.0 — no lifecycle capability exists                                                                                                                                             |
| Worktree rule                 | Create `worktrees/yellow-plugins/agent-feat-session-continuity-<shell>/` on an `agent/feat/…` branch; never work in the clone or another session's worktree                                                                                     |
| Open-PR collisions            | #799 rewrites `catalog/plugins/yellow-core.json` hooks and the manifest snapshot; #750 rewrites every plugin `CLAUDE.md`; #793 shares `plans/shells/` and `docs/CONCEPTS.md`. Rebase after they land or keep the first shell off those files    |
| Namespace collisions to avoid | `/flow:*`, `/plan:*`, `/stack:*`, `/statusline:setup`, `/setup:*`, `/worktree:cleanup`, `/compound:review-staged`, skill `session-handoff`, `session-history`; any new command needs the flow-namespace and provider-neutral validators to pass |
| Decision records              | No ADR directory in yellow-plugins; use `plans/specs/<slug>.md` plus `docs/solutions/` notes. Engine ADRs live in `yellow-goal/goal-gen`                                                                                                        |

## 1. Repository preflight and documentation import — EXECUTED 2026-09-17

Executed as a docs-only pass by the Fable 5.1 lead session. Outcome: the four
documents in this repository were created with collision checks (no prior
`docs/prds/` or `docs/development/` directory existed; no canonical document
covered this feature — the closest are the `session-handoff` skill,
`docs/research/rtk-vs-sigmap-context-management-comparison.md` and
`plans/yellow-rtk-plugin.md`, which address a different layer). Nothing was
committed, no branch was changed, no tool installed, no permission altered, and
`yellow-goal` was not edited. The original prompt is kept for provenance:

```text
We are adding Session Continuity and Controlled Rotation. Start with a docs-only
readiness pass in KingInYellows/yellow-plugins.

Read <PACKET_DIRECTORY>/README.md, PRD.md, RESEARCH.md,
ACCEPTANCE-TESTS.md, and this playbook. Treat them as a proposed product baseline;
reconcile them with the live repository instead of assuming the research snapshot
or current chat is authoritative about implementation.

Inspect the current CLAUDE.md, AGENTS.md, CONTRIBUTING.md, branch/worktree status,
active plans and relevant ADRs, catalog sources, validation/test entrypoints,
existing session-handoff and statusline/compaction support, the planning commands,
and the yellow-goal process bridge. Confirm the installed yellow-core command
source/version as distinct from this checkout. Do not enable a duplicate cached
and local copy to make testing work.

Check current overlap with hook PRs #797, #798, #799 and #802 and Jules PR #793.
Inspect only relevant current status and changed paths; do not merge, cherry-pick,
rewrite existing work or start an unrelated migration. Use GitHits if available
for a specific unanswered implementation question; otherwise use primary sources.
Do not restart broad research already captured in the packet.

Import the packet, with collision checks and repaired relative document links,
into these proposed homes:
- docs/prds/session-continuity.md
- docs/research/session-continuity-2026-09-17.md
- docs/testing/session-continuity-acceptance.md
- docs/development/session-continuity-playbook.md
If an existing canonical home covers the same feature, reconcile there instead
of creating a competing document. Report its exact path.

The first milestone is plugin-only: explicit validated handoffs and advisory
context observation in yellow-core. No worker launch/stop, runtime controller,
peer inbox transfer, copied engine schemas, new service, paid probe, or changed
compaction defaults. The yellow-goal engine owns later automatic rotation.

Output the actual revisions and installed versions you could verify, conflicts
or blockers, the adopted document paths, and the recommended scoped-spec brief.
Write documentation only. Do not implement, commit, push, change branches, alter
permissions, install tools, or edit the sibling yellow-goal repository.
```

Result: all four proposed homes were accepted
(`docs/prds/session-continuity.md`,
`docs/research/session-continuity-2026-09-17.md`,
`docs/testing/session-continuity-acceptance.md`,
`docs/development/session-continuity-playbook.md`). Genuine blockers are listed
in the PRD reconciliation section; the only hard one before Step 5 is the #799
file collision on yellow-core's catalog hooks block.

## 2. Author the foundation specification (recommended scoped-spec brief)

Run this as a new Claude Code message, from a fresh worktree on `main` at or
after `3812fc66`:

```text
/flow:spec Session continuity foundation. Use docs/prds/session-continuity.md (requirements R1–R8, R16, R20, R22, R24 and the 2026-09-17 reconciliation section), docs/research/session-continuity-2026-09-17.md (live reconciliation addendum) and docs/testing/session-continuity-acceptance.md (rows T01–T12 only). Target slug session-continuity-foundation.

Scope only yellow-core: (1) explicit handoff selection by artifact reference bound to task, repository, worktree, source session id when available, and a format version — replacing the newest-file rule in skills/session-handoff/SKILL.md; (2) deterministic identity/evidence capture (workspace path, HEAD, dirty-state fingerprint, timestamp, source session, plugin version) written by shell code, labelled separately from model-authored narrative; (3) redacted, bounded, collision-safe, atomic publication reusing cs_redact_secrets, cs_atomic_jsonl_write-style temp-and-rename and validate_file_path; (4) a read-only resume preflight that reports ready / mismatched / unsupported / blocked with reasons and never executes the narrative's next action; (5) an opt-in advisory context observation record sourced only from the statusline payload (session_id, timestamp, context_window fields; null or cross-session data is unknown, never 0 % remaining), composed with the existing generated statusline through an explicit setup change and with a provisional 50 % advisory watermark.

Preserve: the two legacy handoffs under plans/handoff/ stay readable; native compaction and autoCompact settings untouched; the existing Stop/SessionStart/PreCompact hooks unchanged; no edit to the catalog hooks block in the first shell (PR #799 owns that file until it lands); no new plugin, orchestrator, memory store, queue, database, service, worker launch/stop, ownership transfer, durable peer messaging, copied engine schema, paid probe or change to compaction defaults.

Use flat stable local R1..Rn IDs with an explicit mapping table to PRD:R<N>. Include the behavioral tests in scope: a bats suite for the handoff writer/reader/preflight (T01–T08), versioned real-host statusline payload fixtures for the observer (T09–T11), and an installed-vs-checkout plugin identity check (T12); state that pnpm test:unit exercises none of yellow-core. Treat the PRD decisions as my proposed answers; preserve the command's requirements dialogue and approval gates, but ask only about material unresolved decisions that source inspection cannot answer — expected ones are the handoff reference syntax, the on-disk location of the observation record, and whether the statusline segment is added by regenerating through /statusline:setup or by a documented manual merge. Produce only the scoped spec, not code, a second PRD, an ADR bundle, or shells.
```

Why these constraints:

- The newest-file resume rule (`ls -t plans/handoff/*.md | head -n 1`) is the
  concrete defect R2 fixes; naming it keeps the spec anchored to the live skill
  rather than to a generic "handoff v2".
- Reusing `lib/compound-staging.sh` and `lib/validate-fs.sh` avoids a second
  redaction or atomic-write path and keeps the change bats-testable in
  `plugins/yellow-core/tests/`.
- The statusline payload is the only documented context source on 2.1.274 (no
  hook, env var or telemetry surface carries it), so the observer is a payload
  consumer, not a hook, and headless runs report unknown.
- Keeping the first shell off `catalog/plugins/yellow-core.json`,
  `plugins/yellow-core/CLAUDE.md` and `docs/CONCEPTS.md` sidesteps the live
  collisions with #799, #750 and #793 without waiting on them.

Approve or revise the actual specification. This command intentionally writes
only a spec. Do not ask it to write research or other documents that conflict
with its contract.

## 3. Decompose only the foundation

First send this normal message:

```text
For the approved session-continuity-foundation spec, prefer two integrated shells
unless the actual code seams justify fewer or more:
1. Explicit handoff plus its real reader/validator, legacy compatibility and tests.
2. Advisory observation integrated into the existing surface, packaging and
   host-payload tests, and a bounded smoke/evaluation fixture.
Keep producer and consumer together. Every local requirement must be covered.
Do not create engine shells, cross-repository depends_on values, unused generic
frameworks, or dependencies on an unreleased capability. Keep requirement
coverage exact and avoid duplicate bare claims. Await the command's count and
coverage approval before writing shells. Do not implement.
```

Then send the exact-path command separately:

```text
/flow:decompose plans/specs/session-continuity-foundation.md
```

If it legitimately resolves to one shell, follow its single-shell rule and use:

```text
/flow:plan plans/specs/session-continuity-foundation.md
```

In that case, skip shell expansion and use the actual plan produced. Do not
force extra shells just to match this suggested count.

## 4. Expand the intended shell, not another project's shell

Use the exact returned path:

```text
/flow:expand-shell <EXACT_SHELL_PATH>
```

Example placeholder meaning: a real file under `plans/shells/` reported by
decomposition. Do not paste `<EXACT_SHELL_PATH>` literally.

The current no-argument `/flow:pick-next-shell` scans all projects; it does not
accept a feature filter. Use it only when its selected candidate is
intentionally the one you want. Exact expansion still checks its in-repo
dependencies and real consumers. Never falsify `plans/complete/` entries to
unblock it.

Approve the expanded plan and its source-shell deletion through the existing
gate. Stop after expansion. Preserve the actual `plans/<slug>.md` path before
clearing context.

## 5. Implement one approved plan in a fresh session

Send `/clear` by itself. Confirm the correct worktree and Fable 5.1 selection.
Then send this normal prompt:

```text
Implement only the approved session-continuity foundation plan I provide next.
Read the live repository instructions, the plan's originating scoped spec, and
docs/prds/session-continuity.md. Preserve the first-milestone exclusions.

Use one writer in this worktree. Read-only specialist review may address concrete
uncertainties; implementation and fixes stay with the lead. Reuse the existing
handoff/redaction/statusline/catalog utilities and test conventions. Do not add
another plugin, orchestrator, permanent-memory store, queue, or database.

Resolve the active stacked-PR provider through the existing workflow and stop on
conflict; do not switch providers or bypass guards. Preserve unrelated edits.
Author catalog sources and regenerate derived files when required; do not create
hooks/hooks.json mirrors or directly edit generated manifests. Test the actual
runtime artifact and consumer, not only source-string presence.

Complete this plan's behavior and verification only. Report changed files,
requirement/test coverage, commands with actual test counts, existing baseline
failures, and any not-run host checks. Never mark zero tests or unexecuted live
checks as passed. No paid model probes, launches/stops of target sessions,
permissions changes, global settings changes, commits or submission yet.
```

Then send the plan command separately, with no extra prose appended to its
argument:

```text
/flow:work <EXACT_EXPANDED_PLAN_PATH>
```

The normal prompt narrows this run to implementation and local verification.
Preserve any additional confirmations the installed command requires. Do not
paste a plan's narrative as an executable shell script.

## 6. Independent review and bounded repair

Run the relevant installed review workflow after inspecting its current
behavior. For a focused review before a PR exists, this normal prompt supplies
the review scope without pretending a nonexistent command flag exists:

```text
Review the completed foundation plan against its originating spec and master
PRD. Get an independent read-only review of the changed behavior; reviewers do
not edit this worktree. Focus on wrong-task selection, identity drift, partial
writes, secret handling, hostile filenames, stale/null telemetry, cached-plugin
versus checkout behavior, duplicate hooks, and regressions to manual handoffs.
Also identify unnecessary components or premature engine abstractions.

The lead may fix supported findings within the approved plan, then rerun affected
behavioral tests and repository gates. Stop after two repair/review cycles if
material issues remain; report them rather than expanding scope or weakening the
requirements. Distinguish foundation limitations from unimplemented later phases.
Do not label a limitation as solved by prose alone. No live model probes or
session lifecycle operations. Return a requirements-to-evidence table and a
release recommendation with precise outstanding blockers. Do not submit yet.
```

The two-cycle ceiling is a workflow choice for this feature, not an empirical
best-practice constant. A concrete security or correctness blocker remains a
blocker after the ceiling is reached.

## 7. Prepare and submit a reviewable PR

Send only when ready to authorize submission:

```text
Prepare a reviewable PR for the completed foundation plan using the currently
selected stacked-PR provider and this repository's existing commit/submission
workflow. I authorize creating or updating the feature branch and its PR, but
not merging, releasing, deploying, switching providers, or unrelated changes.

Include the appropriate changeset, updated inventories/docs, regenerated catalog
artifacts when applicable, actual verification evidence and explicit not-run
host checks. Check the diff for unrelated work and secrets before committing.
Do not silently waive baseline failures. Prefer draft status where supported;
otherwise preserve the provider workflow and clearly identify review readiness.

Once the PR exists, use the installed /review:pr workflow against its actual
number, following its permission and bounded-fix behavior. Use
/flow:compound --in-pr when appropriate so the solution note co-ships, rather
than creating a competing historical document. Do not auto-merge. Report the
PR, remaining checks and next operator action.
```

After human merge and synchronization, archive using the existing gate:

```text
/plan:complete <EXACT_PLAN_FILENAME>
```

A filename such as `session-continuity-foundation-01-<actual-title>.md` is taken
from the implemented plan; it is not a pre-created filename in this packet. A
`plans/` prefix is accepted by the inspected command. The command creates an
archival branch/PR; it is not merely a local checkbox update. Complete its
normal review/merge flow before relying on the archival record in the shared
base.

**Provider caveat:** the inspected command contains a `gt` prerequisite. If the
installed definition conflicts with a GitHub-only selection, report a workflow
blocker and obtain an explicit separate correction; do not bypass its
merged-evidence gates or silently change provider.

Repeat Steps 4–7 for the next foundation shell after its real dependency is
archived and its produced code is present.

## 8. Start the runtime work in yellow-goal, not in the plugin repo

Open a separate Claude Code session in the independent
`KingInYellows/yellow-goal` clone. Confirm Fable 5.1. Give it the pinned adopted
PRD reference (repository, path and commit) explicitly. Paste:

```text
We are implementing the engine-owned portion of Session Continuity and Controlled
Rotation. Read the adopted yellow-plugins documents docs/prds/session-continuity.md,
docs/research/session-continuity-2026-09-17.md and
docs/testing/session-continuity-acceptance.md (from the sibling clone or
GitHub; do not copy them into this repository) as the proposed feature input. Work only in KingInYellows/yellow-goal.

First inspect goal-gen's current PRD, ADRs, component specs, executor/process
protocol, persistence, budgets, approvals, cancellation, verification/replanning,
and any existing session lifecycle or recovery work. Reconcile this feature with
those decisions and current in-flight work before adding abstractions. Record
actual source revision and capabilities. Do not assume the README means the
published CLI already exposes managed rotation.

Author a scoped engine spec and necessary ADR amendment using existing document
conventions. Map stable local requirement IDs to the master product PRD. Keep the
canonical operational schema here; no copied schemas or cross-repo source imports.
Use installed yellow-plugins planning commands only when available and suitable;
if they are not loaded, report that fact rather than inventing an installed command.

First implementation milestone: deterministic lifecycle and recovery with a fake
executor, finite policy limits, persistent intent/results, post-stop workspace
revalidation, stale-generation rejection, unknown-side-effect reconciliation,
cancellation and cumulative budgets. No paid calls or real worker launches.

Specify how the selected single-host adapter will prove the old worker and its
relevant descendants cannot write before the successor gains write access. A
name, PID alone or generation counter is not the proof. If enforceable isolation
is not yet available, make the real adapter unsupported while completing the
useful fake-provider contract and tests. Keep checkpoint state recoverable.

Plan a separate explicitly authorized Claude pilot and a released, versioned
process capability consumed by the plugin later. Native compaction remains on;
automatic rotation remains opt-in. Start with a docs-only readiness report and
specification for my approval, not implementation or edits to yellow-plugins.
```

Use the same approved-spec → scoped-shell → exact expansion → fresh
implementation → review sequence where the current engine workflow supports it.
Never encode a plugin shell slug as an engine `depends_on` value. Refer to a
released upstream capability as an external gate instead.

## 9. Authorize a bounded real-host pilot separately

Only after fake-provider fault tests and enforcement design are ready:

```text
Prepare, but do not yet execute, the real Claude continuation pilot. Report the
actual client version, selected model/provider, billing mode, proposed task and
worktree, lifecycle operations, writer-isolation proof, total spend/usage ceiling,
maximum rotations/retries, time bounds, cancellation path and cleanup plan.

Use synthetic or approved repository content and one managed worker. The pilot
must demonstrate a genuinely fresh session continuing useful work, not merely
that unsafe requests are refused. Start in shadow/advisory mode before enabling
actual replacement. Compare against checkpoint-assisted native continuation.

Explain any headless usage-credit charges, unknown cost telemetry, or host
capabilities not yet demonstrated. Request approval for this exact bounded pilot.
Do not start a model, change permissions, enable global automation or incur charges
until the scope and budget are approved.
```

An approval is required because the user is authorizing a new kind of live side
effect, not because more architectural clarification is needed. Preserve
applicable provider/platform consent controls.

## 10. Return to yellow-plugins for the engine bridge

After the engine capability is released, open yellow-plugins and paste:

```text
Implement the plugin-facing managed-continuity integration only after verifying
the released yellow-goal engine capability. Inspect the actual versioned process
contract, published artifact identity/checksum and compatibility evidence. Confirm
the release supports the required lifecycle and billing/permission controls.

Keep the plugin a thin consumer. Do not import engine source, copy canonical
runtime schemas, invent missing engine subcommands, or implement a second
supervisor. Consumer fixtures and pinned-version process contract tests belong
here. Preserve existing request/stub behavior and explicit unsupported outcomes.

Create a feature-scoped integration spec using the installed planning workflow.
Cover operator dry-run/status/request/disable behavior, truthful lifecycle versus
task outcomes, supported-host capability gating, catalog generation, packaged
runtime tests and rollback. Reconcile command names with current namespaces.

If the release or capability is absent, return the exact external dependency
blocker and a reviewable integration plan without pretending an implementation
works. Do not fill the gap with a shell loop. Automatic rotation remains off by
default, and any live smoke is separately budget-authorized. Start with the
scoped spec for approval; no implementation in this first pass.
```

## Minimal repeated loop

`approved scoped spec → decompose → exact shell expansion → stop → /clear → exact /flow:work plan → independent review → provider-native PR → human merge → /plan:complete → archival merge → next shell`

Keep progress in canonical plans and evidence, not an ever-growing prompt
transcript. This workflow is itself a manual continuity pattern; the feature
should strengthen it, not remove its approval and fresh-session boundaries.
