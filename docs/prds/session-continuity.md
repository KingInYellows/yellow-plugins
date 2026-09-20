# Session Continuity and Controlled Rotation

**Product requirements document — proposed v1.0**  
**Prepared:** 2026-09-17  
**Owner:** Brad / KingInYellows  
**Primary repositories:** yellow-plugins and yellow-goal  
**Status:** Decision-ready proposal; not an approved implementation plan or a
claim that the feature exists. **Adopted into the repository:** 2026-09-17 from
the external session-continuity packet (PRD.md sha256 `864c87e4…`), after a
docs-only reconciliation against live `main`. The requirement text below is
imported verbatim so `PRD:R<N>` IDs stay stable; every correction from the live
tree is recorded in the reconciliation section rather than by rewriting a
requirement. **Companion documents:**
[research ledger](../research/session-continuity-2026-09-17.md) ·
[acceptance tests](../testing/session-continuity-acceptance.md) ·
[build playbook](../development/session-continuity-playbook.md)

## Live reconciliation (2026-09-17)

The packet inspected `main` at `05a6ff48` (2026-09-11). This section records
what the live checkout, the installed plugin cache and the open PR set actually
looked like when the packet was adopted. Where a requirement's assumptions
differ from reality, the correction is here and the requirement text is
unchanged.

### Verified revisions and versions

| Item                                                                                    | Verified value                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yellow-plugins` `main`                                                                 | `3812fc66` — `fix(hooks): remove hooks/hooks.json mirrors auto-loaded by Claude Code (#797)`; one commit after the packet's `05a6ff48`; working tree clean before this import                                                                                                                                                                                                                      |
| Marketplace clone used by Claude Code (`~/.claude/plugins/marketplaces/yellow-plugins`) | `3812fc6`, auto-update on, refreshed 2026-09-17                                                                                                                                                                                                                                                                                                                                                    |
| Installed `yellow-core@yellow-plugins`                                                  | 2.3.1, user scope, `~/.claude/plugins/cache/yellow-plugins/yellow-core/2.3.1`, source commit `4192ea57` (`chore: version packages (#756)`, an ancestor of `main`), refreshed 2026-09-05. `diff -rq` against `plugins/yellow-core/` in this checkout reports no differences. A leftover `2.3.0` cache directory exists but is not referenced by `installed_plugins.json`. No local copy was enabled |
| Claude Code client                                                                      | 2.1.274                                                                                                                                                                                                                                                                                                                                                                                            |
| `yellow-goal` engine clone                                                              | `main` `09bcd16` (`chore: prepare goal-gen 0.2.0 protocol release (#33)`), `goal-gen` 0.2.0; bridge pin in `plugins/yellow-goal/src/pin.ts` is `0.2.0` / tag `v0.2.0` / commit `09bcd16` / asset sha256 `7ad266b2…`                                                                                                                                                                                |
| Stacked-PR provider                                                                     | `gt-workflow@yellow-plugins` enabled, `github-workflow` not enabled (user settings)                                                                                                                                                                                                                                                                                                                |
| Statusline                                                                              | `~/.claude/settings.json` → `python3 ~/.claude/yellow-statusline.py`, generated 2026-06-02 by `/statusline:setup` (script version 1.0.0)                                                                                                                                                                                                                                                           |

### What already exists in yellow-core (foundation inputs)

- **Handoff skill.** `plugins/yellow-core/skills/session-handoff/SKILL.md`
  writes `plans/handoff/<YYYY-MM-DD>-<slug>.md` with six fields, redacts through
  `cs_redact_secrets` (`lib/compound-staging.sh`), and resumes from the _newest_
  file (`ls -t plans/handoff/*.md | head -n 1`). It has no test suite of its
  own; two legacy handoffs exist under `plans/handoff/` (2026-07-28 and
  2026-07-29, both retrospective). These are the R1 legacy fixtures.
- **Hooks.** Catalog source `catalog/plugins/yellow-core.json` declares `Stop`
  (5 s), `SessionStart` (3 s) and `PreCompact` (3 s); the generated
  `plugins/yellow-core/.claude-plugin/plugin.json` carries the same block.
  `PreCompact` prints a plain-text preservation instruction (contract verified
  against the 2.1.261 binary in
  `docs/solutions/integration-issues/precompact-hook-stdout-contract.md`) and is
  covered by `plugins/yellow-core/tests/pre-compact-hook.bats`. There is no
  `hooks/hooks.json` in yellow-core; #797 removed the last mirrors repo-wide.
  The Codex target excludes hooks (`targets.codex.includeHooks: false`).
- **Shared helpers.** `lib/compound-staging.sh` already has
  `cs_atomic_jsonl_write` (temp file + rename) and `cs_redact_secrets`;
  `lib/validate-fs.sh` is the canonical `validate_file_path`. R5 should reuse
  these rather than add a second atomic-write or redaction path.
- **Context observation.** The only host surface that reports context usage is
  the statusline payload. The installed script reads
  `context_window.used_percentage`, renders `ctx:--` when the value is null,
  clamps to 0–100 and colours at 70 % / 90 %. It records no session identity or
  observation time, and its baked-in plugin list is stale (it still names
  `yellow-chatprd` and `yellow-mempalace`). Hook inputs carry `session_id`,
  `transcript_path` and `cwd` but no context numbers. R7/R8 therefore need a
  new, session-bound observation record; "compose with the existing yellow
  observer" means regenerating through `/statusline:setup` or adding a segment,
  and any change to the user's `statusLine` setting is an explicit opt-in step,
  never a side effect of installing the plugin.
- **Planning commands.** `/flow:spec`, `/flow:decompose`,
  `/flow:pick-next-shell`, `/flow:expand-shell`, `/flow:work`, `/flow:plan`,
  `/plan:status` and `/plan:complete` exist as described in the packet.
  `/plan:complete` hard-requires `gt` (`command -v gt || exit 1`) before its
  provider routing; with Graphite enabled on this workstation that is not a
  blocker, but it is for a GitHub-only environment. `/flow:pick-next-shell`
  globs every `plans/shells/*.md` with no feature filter; today `plans/shells/`
  holds five `yellow-jules-integration-*` and three
  `yellow-council-v2-four-cli-*` shells, so exact-path expansion is mandatory
  (T30).
- **Decision records.** yellow-plugins has no ADR directory, only
  `docs/ADR_template.md`; durable decisions live in `docs/brainstorms/`,
  `plans/specs/` and `docs/solutions/`. "ADR amendment" in this PRD means a spec
  revision plus a solution/brainstorm note in this repository; numbered ADRs
  exist only in `yellow-goal/goal-gen`.
- **Validation entrypoints.** Every root script the packet lists exists
  (`validate:schemas`, `validate:generated`, `validate:versions`,
  `validate:doc-counts`, `build`, `typecheck`, `lint`, `test:unit`,
  `test:integration`, `lint:plugins`); `validate:plans`, `validate:agents` and
  the yellow-core bats suites (`bats tests/` and
  `bats skills/git-worktree/tests/` from `plugins/yellow-core/`) are the
  additional gates the foundation must run. Catalog edits require
  `pnpm generate:manifests` and a refresh of
  `tests/integration/generate-manifests-characterization.test.ts` (`vitest -u`).

### Corrections to packet assumptions

| Packet statement                                              | Live finding                                                                                                                         | Effect on requirements                                                                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R20 warns against `hooks/hooks.json` mirrors                  | Mirrors are already gone on `main` (#797) and #798 (open) makes any such file a validator error                                      | R20 stands; the guard is becoming mechanical, not advisory                                                                                              |
| R8 "compose with the existing yellow observer"                | The generated statusline has no session binding and a stale plugin list; regeneration would rewrite the user's script                | Observation output must be a separate, versioned record; statusline changes are an explicit setup step                                                  |
| Foundation may need catalog changes for a hook-based observer | #799 (open) rewrites the `hooks` block of `catalog/plugins/yellow-core.json` and the generated manifest for nine plugins             | Any foundation change to yellow-core's hooks block must land after #799 or be rebased onto it; prefer a first shell that does not touch the hooks block |
| "Relevant ADRs" in yellow-plugins                             | None exist                                                                                                                           | Use spec + solution docs here; engine-side ADRs are yellow-goal's                                                                                       |
| Root test commands are sufficient evidence                    | `pnpm test:unit` runs Vitest on `packages/` plus the yellow-cursor and yellow-goal packages only; yellow-core behaviour is bats-only | Foundation tests must be bats (shell) and, if a Node helper is introduced, Vitest under `tests/integration/`                                            |

### Overlap with in-flight work (checked 2026-09-17)

| PR                                                  | State                                                                                     | Touches                                                                                                                                               | Overlap with this feature                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| #797 hooks.json mirror removal                      | Closed, landed via the Graphite queue as `main` `3812fc66`                                | validator RULE 7, six plugins' `hooks/hooks.json`, docs                                                                                               | None remaining; it is the baseline                                                                           |
| #798 reject any `hooks/hooks.json`                  | Open, checks blocked (Codacy and `claude-review` failing; both advisory/credential-gated) | `scripts/lib/plugin-rules.js`, `validate-plugin.js`, docs, tests                                                                                      | Policy only; foundation must not add a hooks.json (already R20)                                              |
| #799 quote `${CLAUDE_PLUGIN_ROOT}` in hook commands | Open, checks blocked (same two)                                                           | `catalog/plugins/yellow-core.json`, `plugins/yellow-core/.claude-plugin/plugin.json`, eight other plugins, snapshot                                   | **Direct file collision** if the foundation edits yellow-core's hooks block or the characterization snapshot |
| #802 git-push guard reads `tool_input.command`      | Open, unstable (same two)                                                                 | gt-workflow / github-workflow hook libs and fixtures                                                                                                  | No path overlap; it is the model for R20's "real host envelope" fixtures                                     |
| #793 yellow-jules PR1 contract                      | Open                                                                                      | `plans/specs/yellow-jules-integration.md`, `plans/shells/yellow-jules-*`, `plans/yellow-jules-integration-01-*.md`, `docs/CONCEPTS.md`, solution docs | Shell namespace shares `plans/shells/`; `docs/CONCEPTS.md` collides if this feature adds glossary terms      |
| #750 CLAUDE.md currency sweep                       | Open (worktree `agent-docs-claude-md-currency`, one unpushed commit)                      | `docs/CLAUDE.md` and all plugin `CLAUDE.md` files                                                                                                     | Collides with any foundation edit to `plugins/yellow-core/CLAUDE.md`                                         |

None of these were merged, cherry-picked or rebased during the readiness pass.

## Overview

Make a coding task recoverable across a fresh model conversation without losing
its objective, evidence, workspace, authorization, budget, or cancellation
state. A logical worker role (a **seat**) may outlive a particular agent
conversation (a **generation**).

The first release improves explicit, validated human handoffs inside
`yellow-core`. A subsequent release lets the existing yellow-goal engine replace
one of its own managed workers at a safe boundary. Automatic rotation is a
policy on top of continuity, not the product's default behavior.

**Product outcome:** A supported worker can reconstruct its authorized task from
an explicit, validated checkpoint, and the runtime can replace its session
without creating a second managed writer, losing acknowledged task state, or
resetting its budget.

**Not a promised outcome:** Better reasoning merely because the context was
reset at 50%. Research supports evaluating handoff efficiency and task outcomes
separately; it does not establish a universally optimal threshold. See
[research ledger](../research/session-continuity-2026-09-17.md), SRC01–SRC05.

## Users and jobs

Brad needs to pause or replace long coding sessions without reconstructing their
history. The successor needs a small, trustworthy description of where to start
and pointers to evidence. The runtime needs deterministic authority and recovery
records independent of the model's narrative. Reviewers need reproducible tests
and precise statements about unsupported behavior.

## Current foundations and constraints

The inspected yellow-plugins main revision is
`05a6ff48450ebbf5d82194a98867febf871f39e4`. (Superseded for implementation
purposes by the live reconciliation above: `main` is `3812fc66` and the
installed yellow-core is 2.3.1 at `4192ea57`.) It already contains a
session-handoff skill and a spec → shells → plan → implementation workflow. Its
yellow-goal bridge consumes a pinned engine process and currently exposes
request operations and a zero-spend stub, not real execution. Those observations
are not proof of what is installed on Brad's machine; kickoff must reconcile the
live checkout and plugin cache. See SRC10–SRC16 in
[research ledger](../research/session-continuity-2026-09-17.md).

Two repositories remain independent. The plugin must not import engine source,
duplicate its canonical runtime schemas, create a sibling execution controller,
or put runtime state at a shared workspace root. Existing engine persistence is
the first choice. No Temporal, LangGraph, queue service, vector database, new
daemon, or third implementation repository is introduced by this proposal.

## Delivery scope

| Stage            | Repository and deliverable                                                                       | Observable value                                          | Explicit boundary                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| F — Foundation   | yellow-plugins / yellow-core: precise handoff selection, validation, advisory observation, tests | Brad resumes the intended task with verified references   | No launch, retirement, inbox transfer, automatic work, or engine ownership claims |
| E — Engine       | yellow-goal: versioned lifecycle contract, deterministic recovery and fake-executor tests        | Managed replacement is specified and fault-tested         | No paid calls in normal CI; no plugin-side runtime                                |
| P — Claude pilot | yellow-goal: one supported single-host executor and an authorized smoke/evaluation               | A real worker continues safely in a fresh session         | Serial replacement, same worktree, no native team-lead rotation                   |
| B — Bridge       | yellow-plugins / yellow-goal plugin: released-capability consumer and UX                         | Operator requests, inspects, or disables managed rotation | Requires a released engine version and verified compatibility                     |
| Later            | Additional adapters, policy tuning, durable peer messaging                                       | Broader portability and convenience                       | Separate scope and evidence; not necessary for F                                  |

## Requirements

IDs in this product document are stable. Implementation specs have their own
flat `R1..Rn` IDs and explicitly map to `PRD:R<N>`. A scoped spec must not
pretend to implement requirements owned by another repository.

### Foundation

**R1. Preserve existing behavior.** Foundation installs shall not enable
automatic rotation, change compaction settings, or start/stop sessions. Existing
manual handoffs remain readable. Acceptance: old fixtures still load; foundation
tests observe zero provider launch/stop calls.

**R2. Select the intended handoff explicitly.** Automated or command-driven
resume preparation shall use an explicit artifact reference, never directory
modification time. Bind the reference to task, repository/clone, worktree,
source session when available, and format version. Unknown identity is reported,
not fabricated. Acceptance: a newer unrelated handoff is never selected;
incompatible identities block continuation preparation.

**R3. Preserve useful narrative without duplicating canonical plans.** A handoff
shall include objective, plan/spec references, current step, unresolved
decisions, rejected approaches that matter, evidence references, pending or
uncertain operations, and the next proposed action. Link to plan checkboxes
rather than copying their entire state. Acceptance: a successor can identify its
first evidence-backed step; unknown facts are explicit.

**R4. Separate measured facts from model statements.** Workspace identity, Git
state, timestamps, source-session references and publication metadata shall be
captured by deterministic code where supported. Model-authored explanations
shall remain labeled reference material. Acceptance: changing narrative cannot
change the measured workspace or grant permissions; unavailable measurements
cannot become successful results.

**R5. Publish safely.** Handoff publication shall be bounded, collision-safe,
versioned and atomic for the selected supported storage. Validate paths and
symlinks; never interpolate untrusted content into executable shell. Redact
before named tracked output. Do not commit transcripts, credentials, raw dirty
patches or runtime inboxes. Acceptance: interruption exposes either the previous
complete artifact or the new complete artifact, not a resumable partial;
traversal, malicious filenames and planted credentials are tested. An integrity
digest detects change; it is not authentication.

**R6. Validate before manual continuation.** Resume preparation shall read the
explicitly selected handoff, inspect live workspace state, distinguish existing
completion from unfinished work, and report ready, mismatched, unsupported or
blocked with reasons. This preparation does not execute the narrative's next
action. Acceptance: moved HEAD, changed dirty state, missing evidence or an
already-completed task cannot silently trigger stale work. Broader user
authorization is required to continue actual work.

**R7. Observe context without inventing it.** When enabled, use supported host
observations bound to session identity and observation time. Missing, malformed,
stale or cross-session data is unknown. Statusline availability does not imply
headless availability. Acceptance: null or unknown never behaves as 0%
remaining; versioned real-host payload fixtures are used.

**R8. Keep observation cheap and advisory.** The observer shall not call a
model, spawn a worker, summarize a transcript or overwrite unrelated statusline
settings. Compose with the existing yellow observer or offer an explicit setup
change. Handle canceled/concurrent observer invocations without corrupting
observations. The proposed 50% watermark is an opt-in advisory threshold, not a
proven quality threshold. Acceptance: duplicate samples do not create duplicate
actions; measured execution fits the host's existing timeout budget.

### Managed runtime

**R9. Apply a bounded continuation policy.** The engine shall choose continue,
checkpoint, defer, rotate or stop from explicit state and configured policy.
Automatic rotation defaults off. Unknown telemetry disables context-triggered
rotation but not ordinary work or native compaction. An opt-in pilot must
configure finite rotation, retry and time budgets, and require productive
progress between automatic rotations. Acceptance: startup context pressure
cannot create an unbounded respawn loop. Completion and cancellation win over a
rotation request.

**R10. Keep one durable logical seat.** The engine shall own seat identity,
generation number, current owner and lifecycle transitions in its existing
durable store. Managed operations and late events must be attributable to a
generation. Acceptance: duplicate requests converge; stale-generation operations
cannot affect the active run through the managed interface.

**R11. Drain before transfer and enforce the writer boundary.** Stop assigning
new work, finish or explicitly cancel in-flight operations, retain cancellation
control, and establish that the old worker and relevant descendants no longer
have write access before activating the successor. Acceptance: the supported
pilot has at most one managed writer. A generation number, process name,
cooperative prompt or leader-only PID check is not sufficient enforcement.
Uncontrolled external writers are outside this guarantee and must be disclosed.

**R12. Recover every interrupted transition.** Journal intent before external
lifecycle actions and persist their results. A lost stop or launch response
becomes an uncertain operation requiring reconciliation, never an automatic
blind retry. A crash at any transition must recover to one identified owner or a
visible recoverable pause. Acceptance: fault injection does not produce a
duplicate worker, missing task state or a false completion result.

**R13. Start a genuinely fresh session.** A supported adapter shall prove a
fresh-start operation separately from resume/fork/respawn and report the actual
native session and model identity. Load only the authorized bootstrap package
and explicit checkpoint references. Acceptance: the old conversation is not
replayed as the purported clean context; missing capabilities block that adapter
rather than invoking a fabricated alternative.

**R14. Preserve authority and accounting.** Grants, approval scope,
cancellation, accumulated usage, configured ceilings and remaining budget come
from the engine, not the handoff prose or reset host counters. Include model and
billing mode in live-test approval. Acceptance: rotation never expands
authority, clears cancellation, or creates a new spending allowance; an
ambiguous provider charge is reconciled or conservatively reserved. An SDK or
headless CLI lacking a consent prompt is not approval.

**R15. Preserve managed task delivery.** The engine shall carry pending work and
operation receipts across generations, distinguishing queued, delivered and
applied work. Replay uses duplicate detection and reconciliation appropriate to
each operation. Acceptance: already-applied controlled operations are not
repeated. Do not promise exactly-once execution for arbitrary external APIs or
shell commands. Arbitrary native peer inbox migration is deferred.

**R16. Treat handoff content as reference data.** The successor shall recover
purpose and evidence without elevating embedded instructions, secrets or peer
assertions into user authorization. Acceptance: injected requests to change
permissions, exfiltrate secrets, ignore cancellation or bypass verification
cannot modify runtime authority.

**R17. Bind activation to the final workspace.** Capture a candidate checkpoint
at a safe boundary and verify the workspace again after retirement and before
successor activation. Account for stop hooks, background processes and external
changes. Acceptance: a changed post-stop fingerprint causes reconciliation or
pause; it is not silently accepted as the original checkpoint. Persist an
engine-owned finalized record only after its preconditions hold. No destructive
reset, automatic stash, forced checkout or hidden rollback is a recovery
default.

### Integration and operations

**R18. Keep the process boundary explicit.** The engine owns the canonical
checkpoint/lifecycle schema and emits a versioned process interface. The plugin
validates a pinned released artifact and capability declaration, using consumer
fixtures and compatibility tests, not copied canonical schemas or source
imports. Acceptance: missing or incompatible capability reports unsupported
without starting real work. Foundation notes cannot be promoted to engine
authority by merely changing a format label.

**R19. Expose truthful inspection and controls.** Provide a read-only dry run
and structured status with current generation, reason, checkpoint validity,
pending operations, next allowed action and blockers. Distinguish lifecycle
state from task outcome. Acceptance: dry run launches/stops nothing; deferred,
unsupported and unknown are not success. Command names are decided during scoped
design, not assumed to exist now.

**R20. Follow the catalog and host contracts.** Author hook/distribution
configuration in the existing catalog and regenerate artifacts. Do not introduce
`hooks/hooks.json` mirrors or manually patch generated manifests. Verify correct
payload field paths, quoted plugin paths, actual runtime packaging and single
registration. Acceptance: installed-host smoke verifies one callback per event
in the enabled profile; repeated delivery still remains idempotent. Unsupported
hosts are explicitly excluded.

### Verification and rollout

**R21. Make disabling and rollback safe.** Disabling automation shall reject new
automatic rotations and leave any in-flight transition reconciled or visibly
paused, not abruptly spawn or abandon workers. Reader compatibility or an
explicit migration gate must cover stored records. Acceptance: config changes
and restarts cannot orphan ownership. Retirement display names such as `-OLD`
are optional presentation only.

**R22. Verify faults before paid execution.** Use deterministic fake providers
and crash injection in CI, plus separately approved real-host smoke tests.
Acceptance: all claimed requirements map to behavioral tests; zero tests,
skipped tests and unavailable hosts are reported as not exercised, not passed. A
pilot that only blocks every request has not demonstrated continuation.

**R23. Evaluate the actual benefit.** Compare native continuation,
checkpoint-assisted native continuation, fixed-50% rotation and adaptive
boundary rotation on the same task set with actual model/client versions
recorded. Measure verified completion, preservation of already-solved state,
rediscovery actions, tokens, total cost, elapsed time and recovery reliability.
Acceptance: no critical invariant violation; inspect completion/cost trade-offs
before retaining a policy. A small pilot does not justify a universal default or
a Fable-specific performance claim.

**R24. Respect repository workflow boundaries.** Use feature-scoped specs,
explicit artifact paths, current approval gates and the active stacked-PR
provider. No cross-repository fake shell dependencies, auto-merge, self-approved
release, or automatic continuation after an intentional planning halt.
Acceptance: each shell has real in-repo consumers and requirement coverage; each
cross-repo gate is backed by a released artifact/capability and a consumer test.

## Design decisions

### Three kinds of state

1. **Human handoff note:** bounded redacted explanation; yellow-core owns the
   experience. Not a process lock or authorization record.
2. **Workspace/evidence manifest:** deterministic measurements and references
   used to validate continuation. Detailed private machine state stays out of
   tracked public notes.
3. **Operational checkpoint:** engine-owned durable state for managed runs,
   including authority, generation, budgets and uncertain operations. Stored
   privately by the existing engine, never in a shared workspace-root ledger.

Avoid duplicating entire plans or creating a second permanent-memory system.
Record only what is necessary to reconstruct this run; existing knowledge stores
may provide advisory context but are never the ownership oracle.

### Runtime lifecycle

Proposed transitions, subject to alignment with the engine's existing state
machine:

`ACTIVE → DRAIN_REQUESTED → CANDIDATE_SAVED → OLD_STOP_CONFIRMED → CHECKPOINT_FINALIZED → START_REQUESTED → SUCCESSOR_VALIDATED → ACTIVE(next generation)`

Any uncertain side effect leads to `RECONCILE_REQUIRED`; inability to prove
preconditions leaves `PAUSED_RECOVERABLE`. Cancellation takes precedence at
every point. These are conceptual states, not a new published schema.

A replacement is serial in the first supported pilot. The old process need not
still be available for recovery, so retain the candidate artifact and journal. A
started-but-unvalidated successor has no authorization to mutate task state. If
the chosen host cannot enforce a read-only bootstrap or equivalent isolation,
the adapter must establish all checks before handing over write access or remain
unsupported.

### Policy defaults

Automatic rotation: **off**. Advisory context observation: **explicit opt-in**.
Advisory watermark: **50% remaining as a provisional starting setting**. Native
compaction: **retained**. Context telemetry unavailable: **unknown, no
context-triggered rotation**. Actual rotation: **safe boundaries only** in the
first managed pilot.

Timeouts, retry ceilings and maximum rotations must be finite, persisted with
each opted-in run and approved in the engine spec. No specific numeric value
beyond the advisory watermark is represented as empirically optimal. A separate
decision is needed to change the default from off.

## Non-goals

No global terminal management, UI key injection, raw session-log rewriting,
native agent-team leader replacement, simultaneous warm successors, live
multi-host migration, automatic model switching, native peer inbox transfer,
full Codex/Cursor/Grok parity, automatic merging or infrastructure deployment.
Do not bypass provider limits, subscription controls or normal permission
checks.

## Acceptance and release gates

**Foundation exit:** explicit selection and read-only resume preflight work
against fixtures; legacy notes remain readable; observer is opt-in; no lifecycle
side effects occur; catalog/packaging checks and relevant behavioral suites
pass; any installed-host smoke not run is disclosed.

**Engine exit:** canonical contract is owned by yellow-goal; every transition
has crash tests; authority/cancellation/budgets persist; unsupported enforcement
fails visibly; no paid calls occur in normal CI.

**Pilot exit:** an authorized real worker actually continues a task in a new
native session; old-writer exclusion and post-stop revalidation are
demonstrated; no uncertain external actions are blindly retried; results and
exact versions are recorded. Failure pauses the rollout rather than being hidden
behind a mock result.

**Bridge exit:** released engine artifact and capability are available; pinned
compatibility tests pass; provider-neutral commands expose real engine results;
existing stub behavior remains correct; rollout remains opt-in.

See [acceptance tests](../testing/session-continuity-acceptance.md) for
scenarios and [build playbook](../development/session-continuity-playbook.md)
for the execution path.

## Decisions deliberately left to scoped implementation

Only implementation-shaped choices remain: exact note field serialization,
integration points discovered in the live tree, engine schema version naming,
supported process-isolation mechanism, finite timeout values from host probes,
and command names avoiding existing namespace collisions. Any finding that
changes ownership, authority, scope or the no-overlap guarantee requires an
explicit PRD/ADR amendment before implementation.
