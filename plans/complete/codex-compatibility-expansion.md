# Plan: Expand Codex support in yellow-plugins

Status: local implementation and acceptance complete October 6, 2026. Phase 1
historical receipts are preserved. Phases 2–3, one selected workflow in each
Phase 4 wave, and approved local Phase 5 deliverables are complete. Base:
`cb7469ffe5d7c5e455c53c65055dac1d0d7e35b0`; detached and uncommitted.

Final evidence:
[integrated report](../docs/research/codex-phases-2-5-2026-10-06/report.md) and
[acceptance audit](../docs/research/codex-phases-2-5-2026-10-06/acceptance-audit.json).

## Decision

Keep one repository with shared source skills and a neutral catalog. Maintain
explicit host outputs. Expand support per plugin after static and
installed-runtime evidence, instead of enabling all 20 at once.

The final Codex marketplace installs nine plugins exposing exactly 29 skills.
The original Phase 1 inventory was four plugins / 23 skills. The evaluation and
raw receipts are in
[Codex compatibility evaluation](../docs/research/codex-evaluation-2026-10-04/evaluation.md).

## Boundaries

- Phase 1 adds an isolated runtime discovery gate and suppresses unintended
  command migration. Its original 23-skill exposure is retained; six selected
  workflows are added under the Phase 4 approval.
- The original main checkout and all other worktrees remain preserved.
- The worktree remains detached. October 5 provider classification was
  READY_GRAPHITE; no branch/stack mutation was made. Re-resolve the provider
  before such mutations and use only its commands. Do not commit detached work
  by accident.
- Do not hand-edit generated manifests, hook configs or Codex skill copies.
- Do not copy secrets/configuration into evaluation profiles or automatically
  trust installed hooks.
- Use Ubuntu-24.04 WSL, Node 22.22.0 and pnpm 8.15.0 for repository work.
- No independent Codex source repository or new production dependency required.

## Phase 1: Establish a current Codex contract

- [x] Pin the supported Codex CLI version and separately record Windows desktop
      version/execution environment. Do not assume those surfaces behave
      identically.
- [x] Add a focused disposable Codex install smoke script alongside
      scripts/smoke-plugin-install.sh. Isolate HOME/CODEX_HOME/XDG in child
      processes; exclude credentials and remote discovery. Add hard failure for
      missing CLI in CI.
- [x] Install/list the four enabled plugins from a clean local marketplace.
      Verify the declared installed skill path and all 23 intended skills.
- [x] Capture loaded skill discovery and execute a harmless read-only skill from
      the installed copy. Test direct, indirect and unrelated prompts.
- [x] Test trusted and untrusted installed hooks in a disposable profile. Record
      actual SessionStart/PreToolUse/PostToolUse events and command inputs. Use
      a stubbed mutation command: a deny test must never contact a real remote.
- [x] Test installed Graphite MCP registration and startup separately from
      account authentication. The actual CLI initializes and advertises tools in
      the disconnected fixture with synthetic Git state.
- [x] Verify authenticated Graphite availability using a separately authorized,
      credential-safe runtime. Native config is read-only mounted, never copied;
      account authentication is separate from stdio MCP authentication support.
- [x] Replace obsolete inert-hook claims in docs/codex-distribution.md and
      plugin docs only after the runtime test establishes current behavior.

Implementation evidence:
[October 5 Phase 1 report](../docs/research/codex-phase-1-2026-10-05/report.md).
The pinned CLI is 0.157.0; Windows desktop 26.930.4958.0 was freshly inventoried
separately (the earlier checkpoint was 26.930.3930.0). Desktop runtime behavior
remains untested. The discovery gate found 26 loaded skills despite 23 selected
source skills. Emitting `commands: []` fixes the three unintended migrated
wrappers; the fresh install now loads exactly 23. This narrow exposure
correction is part of Phase 1 because installation-only receipts missed it.

The discovery gate reports three enabled/untrusted hooks. The separate optional
lifecycle gate trusts only the exact disposable hashes: SessionStart runs,
PreToolUse blocks a push before its stub runs, and PostToolUse warns after a
modify stub runs. The untrusted control executes both stubs and no hooks. A
loopback Responses fixture drives actual host events; it proves no semantic
skill activation. Graphite MCP is disabled during both controls.

A separate no-model-turn probe registers the installed `graphite` server,
launches actual Graphite CLI 1.7.20 and observes a connected server with two
tools. Its Git context is synthetic, networking is disconnected, and no MCP tool
or authenticated account operation runs in the startup fixture. Separate native
WSL CLI acceptance passed direct, indirect and unrelated installed plan-status
cases with immutable fixture/plugin hashes. A separate native Graphite auth
check returned ok for the existing account and repository. Native credential
stores were read-only mounted for CLI use, never copied or read by the harness.

Acceptance: reproducible receipts identify source revision, CLI version,
installed paths, skill discovery, safe invocation and hook/MCP states.
Unsupported events are explicit. Existing Claude install smoke stays intact.

Primary changes: new Codex smoke harness, focused integration/Bats tests,
docs/codex-distribution.md, docs/runtime-install-smoke.md, affected README.md /
CLAUDE.md / docs/security.md.

## Phase 2: Harden manifests and skill resources

- [x] Update schemas/codex-plugin.schema.json and
      scripts/lib/generate/emit-codex.js together. Carry shared author and
      sensible optional identity metadata from catalog; validate current
      documented fields.
- [x] Distinguish runtime package validation, catalog presentation and public
      submission requirements. Preserve the observed local install acceptance;
      do not make every public MCP-review field mandatory for local skills.
- [x] Evaluate target-specific presentation metadata: shared author and existing
      homepage suffice; no new catalog-specific identity or assets are required.
      Add target-specific metadata only where needed. Include real assets if
      declaring icon paths; never invent URLs or policies.
- [x] Add narrowly validated per-skill agents/openai.yaml copying. Keep path
      containment, no symlinks, deterministic output and stale artifact
      checking.
- [x] Express explicit-only invocation for yellow-thermonuclear-review using
      policy.allow_implicit_invocation: false and test positive/negative
      activation.
- [x] Extend exposure lint to policy/sidecar resources as appropriate.
- [x] Evaluate scripts/assets support: no selected skill requires new resource
      kinds. Cursor uses its existing tracked runtime and debt uses a flat
      reference with executable instructions. Verify packaging preserves runtime
      permissions and excludes unrelated sidecars.
- [x] Regenerate outputs using pnpm generate:manifests; add plugin changesets.

Acceptance: manifest schema tests agree with installed parser behavior.
Generation twice is byte-identical; --check detects drift; traversal, symlink
escapes and unselected skills remain rejected. Claude/Cursor outputs change only
as intended. Explicit-only policy reaches the installed copy.

## Phase 3: Improve the current pilot skills

- [x] Split ci-runner-health (995 generated lines) and ci-diagnose (612) into
      concise SKILL.md workflows plus existing flat references.
- [x] Preserve host validation, shell self-containment, redaction and explicit
      approval gates while splitting; test the behavior, not just file size.
- [x] Consider gt-setup progressive disclosure after the CI splits.
- [x] Review the 414-line thermonuclear rubric without deleting attribution or
      expanding its opt-in trigger. Preserve the report-only output contract.
- [x] Evaluate individual skills and the installed Codex exposure, separately
      from whole-plugin source-tree token estimates.
- [x] Capture task-level tokens, outcomes and tool usage for representative
      tasks after the structural fixes. No claim of savings from static totals
      alone.

Acceptance: representative tasks preserve output and approval behavior; negative
prompts do not activate strict review; reference loads resolve from installed
paths; shell lint, parsing and relevant behavior tests pass.

## Phase 4: Add useful workflows in bounded waves

The groups below are implementation complexity assessments from catalog and
source inspection, not measured runtime compatibility.

| Wave                         | Candidate plugins                                                | Work required before enabling                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: developer workflow        | github-workflow; selected yellow-core setup/plan/worktree skills | Host-neutral status/provider resolution; package local scripts; adapt command entrypoints; avoid copying env files into worktrees without authorization |
| 2: review and docs           | yellow-review orchestration; yellow-docs                         | Convert selected commands/agent procedures to skills; native Codex dispatch or sequential fallback; preserve schemas and read-only roles                |
| 3: local analysis            | yellow-debt; yellow-browser-test; yellow-semgrep                 | Audit local CLI dependencies and host browser tools; separate findings from fixes; credential path for Semgrep                                          |
| 4: integrations              | yellow-linear; yellow-research; yellow-composio; yellow-morph    | Explicit MCP/auth transport and config mappings; supported tools; no Claude userConfig expansion on Codex                                               |
| 5: remote agents and memory  | yellow-cursor; yellow-devin; yellow-jules; yellow-ruvector       | Package runtimes, explicit credential/context resolution, state isolation, lifecycle and memory opt-in                                                  |
| 6: specialized orchestration | yellow-council; yellow-codex; yellow-goal                        | Re-express Claude dispatch/loop semantics; prevent recursive Codex spawning; retain budgets and approvals                                               |

- [x] Select one concrete workflow in each wave; port only its required files.
- [x] For each selected workflow, specify inputs, output schema, required tools,
      mutation boundary, host differences and unsupported states before editing.
- [x] Add or refine the shared source skill. Use a small host adapter/reference
      where execution contracts differ; avoid large vendor-specific prompt
      forks.
- [x] Enable targets.codex.enabled and its skillAllowlist only after tests.
- [x] Keep mutation-capable expansion workflows excluded; no new stack mutation
      workflow is exported. Provider checks remain required before exporting or
      executing a mutation workflow. Do not rely on Claude's plugin inventory on
      the Codex host.
- [x] Update affected plugin README.md and CLAUDE.md, root inventory/setup docs,
      canonical Codex support table, docs/security.md, and changeset.
- [x] Validate from the installed cache with siblings/config unavailable where
      they are not declared, so checkout-relative paths cannot hide package
      gaps.

Acceptance per plugin: explicit support scope, valid generated artifacts,
installed discovery/invocation, safe missing-tool/auth behavior, and expected
confirmation behavior. Do not advertise repository-wide compatibility.

## Phase 5: Distribution choices after local support

- [x] Keep .agents/plugins/marketplace.json as the repo/private marketplace.
- [x] Document Windows desktop installation versus WSL CLI installation,
      including the fact that cached installs must be refreshed after source
      edits.
- [x] Decision: public publication deliberately deferred under user defaults. If
      later desired, treat it as a separate release target: confirm submission
      access, metadata, assets, allowed MCP transport and hook restrictions.
      Local install success is not public-directory acceptance.
- [x] Decision: portable root plugin.json not applicable; no demonstrated need.
      If later desired, generate a staged Codex-only package. Never add it to
      current source plugin roots without a component exposure review: portable
      default skills discovery overrides overlay choices.
- [x] Decision: generated distribution repository not applicable; no
      demonstrated constraint. Reconsider only for a demonstrated release/access
      constraint. Keep authoring and fixes in this repository.

Acceptance: a repeatable install path for the intended surface, with no new
source-of-truth fork and no accidental Claude skill exposure.

## Required validation for implementation

For catalog/manifests/generator changes:

- pnpm validate:schemas
- pnpm validate:versions
- Focused generate-manifests-codex, codex-schema-examples and relevant validator
  integration tests, followed by pnpm test:integration
- New isolated Codex smoke contract, with real runtime receipts

For shared skill changes:

- pnpm validate:agents and pnpm lint:plugins
- pnpm validate:shell-compat and pnpm check:shell-parse when shell fences change
- Relevant plugin Bats suites and pnpm test:shell-compat for sourced libraries
- pnpm validate:generated and pnpm validate:codex after generation

Before a development PR: pnpm test:unit, pnpm lint and pnpm typecheck. Every
plugins/ change requires a changeset unless explicitly release-neutral.

## Historical Phase 1 completion

At the October 5 checkpoint, runtime gates had independent receipts and Phases
2–5 had not begun. The October 6 explicit user request authorized their local
implementation and superseded that phase boundary. Historical receipts were
preserved.

## Final acceptance

- Phase 2: pinned CLI/schema contract, shared identity, narrow policy sidecar,
  explicit-only installed controls, exposure/security regressions and two
  byte-identical consecutive generations pass.
- Phase 3: CI diagnosis/runner health and Graphite setup use flat references;
  original shell blocks remain byte-identical; the cohesive thermonuclear rubric
  stays intact. Seven before and seven after model cases pass. Provider task
  metrics are recorded without a causal savings claim.
- Phase 4 selections: yellow-core/worktree-inventory, yellow-docs/docs-audit,
  yellow-debt/debt-complexity-scan, yellow-research/research-public-repo,
  yellow-cursor/cursor-plan and yellow-codex/codex-readiness. Installed
  candidate acceptance preceded enablement. Final discovery is exactly nine
  plugins / 29 skills. All 32 expansion model cases and three plan-status
  regression cases pass.
- Phase 5: repeatable WSL private/local install and tested cache refresh are
  documented; desktop differences are documented but desktop runtime is
  untested. Public publication is deferred, and optional
  root-package/second-repository choices are not applicable.
- Required schema/version/generated, unit/integration, lint/typecheck, markdown,
  bash/zsh parsing, shell compatibility and CI/GT/review Bats checks pass. The
  first integrated test run's stale inventory expectations were repaired; the
  full rerun passes 1,876 tests with one existing skip. Unit tests pass 787.
- No blocker remains within the authorized local goal. Changes and changesets
  remain uncommitted and unapplied. Release/profile/live mutation authority
  remains separate.
