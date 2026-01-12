<!-- anchor: iteration-4-plan -->
### Iteration 4: Publishing, CI/CD Hardening, and Release Readiness

*   **Iteration ID:** `I4`
*   **Goal:** Finalize publish workflow, expand GitHub Actions automation, document operational playbooks, and ensure metrics/quality gates meet release criteria.
*   **Prerequisites:** `I1` (workspace + tooling), `I2` (transaction core, telemetry, CLI contracts), `I3` (discovery/update/uninstall flows).

<!-- anchor: task-i4-t1 -->
*   **Task 4.1:**
    *   **Task ID:** `I4.T1`
    *   **Description:** Implement publish command (manifest validation, git status checks, lifecycle consent for publish hooks, optional push/tag actions) plus documentation for PAT/SSH expectations per assumptions.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 API style, assumption 2 (git auth), Section 4 security directives.
    *   **Input Files:** [`packages/cli/src/commands/publish.ts`, `docs/SPECIFICATION.md`, `.github/workflows/validate-schemas.yml`]
    *   **Target Files:** [`packages/domain/src/publish/publishService.ts`, `packages/cli/src/commands/publish.ts`, `docs/cli/publish.md`, `docs/operations/git-auth.md`]
    *   **Deliverables:** Publish service + CLI command, docs covering authentication prerequisites and rollback steps for failed pushes.
    *   **Acceptance Criteria:** Publish command validates manifests, prompts before push, logs actions, and records audit entries; docs map to FR-008.
    *   **Dependencies:** `I2.T3`, `I2.T4`, `I3.T5`.
    *   **Parallelizable:** No.

<!-- anchor: task-i4-t2 -->
*   **Task 4.2:**
    *   **Task ID:** `I4.T2`
    *   **Description:** Expand GitHub Actions workflow to include lint/tests/schema validation/contract drift checks/metrics export, leveraging Docker Node 20 slim with digest pinning and artifact uploads.
    *   **Agent Type Hint:** `DevOpsAgent`
    *   **Inputs:** Section 2 technology stack, Section 6 verification strategy, outputs from `I2.T4` and `I3.T5`.
    *   **Input Files:** [`.github/workflows/validate-schemas.yml`, `Dockerfile`, `package.json`]
    *   **Target Files:** [`.github/workflows/validate-schemas.yml`, `.github/workflows/publish-release.yml`, `Dockerfile`, `docs/operations/ci.md`]
    *   **Deliverables:** Updated workflow (matrix builds, caching, artifact uploads), optional release workflow, supporting documentation.
    *   **Acceptance Criteria:** CI run time under 1 minute for validation job; artifacts include logs/metrics; workflow docs highlight budgets + failure triage; Dockerfile pinned to digest.
    *   **Dependencies:** `I4.T1` (needs publish contract) and earlier iterations for tests.
    *   **Parallelizable:** Conditional (CI updates can start once publish command interface stable).

<!-- anchor: task-i4-t3 -->
*   **Task 4.3:**
    *   **Task ID:** `I4.T3`
    *   **Description:** Produce CI Validation Pipeline Spec (Section 2.1 artifact) describing job graph, caching, metrics, artifact retention, and integrate validation scripts + CLI smoke commands invoked within workflows.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Task `I4.T2` outputs, Section 2.1 artifact plan, Section 6 verification expectations.
    *   **Input Files:** [`.github/workflows/validate-schemas.yml`, `docs/operations/ci.md`, `docs/SPECIFICATION.md`]
    *   **Target Files:** [`docs/operations/ci-pipeline.md`, `docs/operations/runbook.md`, `docs/traceability-matrix.md` updates]
    *   **Deliverables:** Markdown spec (flow diagram references, job tables, runtime budgets), runbook updates.
    *   **Acceptance Criteria:** Document lists triggers, job steps, environment matrix, artifact locations; diagrams validated; traceability matrix references new artifact.
    *   **Dependencies:** `I4.T2`.
    *   **Parallelizable:** No.

<!-- anchor: task-i4-t4 -->
*   **Task 4.4:**
    *   **Task ID:** `I4.T4`
    *   **Description:** Build operational runbooks + metrics spec updates (cache recovery, registry repair, telemetry export, KPI dashboards) and finalize Section 6 verification plan deliverables.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 6 verification strategy, telemetry outputs from `I2.T5`, discovery/publish docs from `I3`/`I4.T1`.
    *   **Input Files:** [`docs/operations/runbook.md`, `docs/operations/metrics.md`, `.claude-plugin/audit/`]
    *   **Target Files:** [`docs/operations/runbook.md`, `docs/operations/metrics.md`, `docs/operations/postmortem-template.md`, `docs/traceability-matrix.md`]
    *   **Deliverables:** Updated runbook, metrics definitions (KPIs, alert thresholds), postmortem template, traceability updates.
    *   **Acceptance Criteria:** All KPIs enumerated with owners + review cadence; runbook covers lifecycle script incidents, cache recovery, publish rollback; docs cross-link Section 6.
    *   **Dependencies:** `I2.T5`, `I3.T4`, `I4.T1`.
    *   **Parallelizable:** Yes (documentation heavy but reliant on input data).

<!-- anchor: task-i4-t5 -->
*   **Task 4.5:**
    *   **Task ID:** `I4.T5`
    *   **Description:** Package release artifacts (npm publish or git tag flow), ensure README/CHANGELOG highlight feature flags + instructions, run final smoke tests, and prepare release checklist referencing Section 4 directives.
    *   **Agent Type Hint:** `ReleaseEngineer`
    *   **Inputs:** Outputs of prior iterations, CI pipeline, publication docs.
    *   **Input Files:** [`README.md`, `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/`, `docs/operations/release-checklist.md`]
    *   **Target Files:** [`CHANGELOG.md`, `docs/operations/release-checklist.md`, `README.md`, `.github/releases.md`]
    *   **Deliverables:** Release notes, documented flag states, smoke test report, release checklist updates.
    *   **Acceptance Criteria:** Release checklist signed, tags/publish instructions validated, smoke tests run per matrix (macOS/Linux/WSL), docs updated with anchors for FR/NFR coverage.
    *   **Dependencies:** `I4.T1`–`I4.T4`.
    *   **Parallelizable:** No.

<!-- anchor: iteration-4-validation -->
*   **Iteration 4 Validation Focus:** GitHub Actions dry-run for release workflow, publish command integration tests with simulated git repos, metrics exporter verifying KPI data, docs linting/typedoc builds, manual review of security prompts.
*   **Iteration 4 Exit Criteria:**
    - Publish command functional with rollback instructions and audited lifecycle logs.
    - CI workflows produce artifacts (logs, metrics, diagrams) and enforce lint/test/contract checks under budget.
    - Operational runbooks + KPI definitions approved; release checklist signed.
    - README + docs updated to describe usage, feature flags, metrics commands, publish/release expectations.
*   **Iteration 4 Risks & Mitigations:**
    - Risk: Publish command may mutate git unexpectedly. Mitigation: implement dry-run + confirm prompt referencing target remote.
    - Risk: CI runtime regressions. Mitigation: add pipeline-level timers + automated alerts when >60s.
    - Risk: Documentation lag. Mitigation: block release until runbooks + traceability entries merge.
*   **Iteration 4 Metrics Targets:**
    - CI validation job < 60s median.
    - Publish command end-to-end (with git push) < 10 minutes.
    - Metrics exporter surfaces KPIs (install success, rollback duration, cache size) for release baseline.
*   **Iteration 4 Collaboration Notes:** Coordinate DevOps + ReleaseEngineer for workflow rollouts; share telemetry snapshots for doc embedding; schedule go/no-go review referencing KPI readiness.
*   **Iteration 4 Testing Scope Expansion:** Add release rehearsal pipeline triggered nightly, run CLI smoke tests in Docker + host OS, validate `publish` command using sandbox repo; incorporate contract drift test comparing CLI metadata with JSON specs.
*   **Iteration 4 Knowledge Transfer:** Update onboarding doc with release playbook, CI diagrams, publish command tutorial; archive meeting notes + recorded demos under `docs/operations/` for future maintainers.
*   **Iteration 4 Tooling Follow-Ups:**
    - Implement `pnpm release:check` bundling lint/test/docs/metrics/publish dry-run.
    - Add script to verify `.claude-plugin` artifacts included/excluded as intended (audit logs tracked, cache excluded) before packaging.
    - Configure GitHub Issue templates referencing release checklist + KPIs for faster triage.
*   **Iteration 4 Documentation Tasks:** Create `docs/operations/release-checklist.md`, `docs/operations/kpi-review.md`, update `docs/diagrams/ci-flow.mmd`, ensure doctoc includes new anchors, and refresh traceability entries for FR-011..FR-013 + all NFRs.
*   **Iteration 4 Readiness Review Checklist:**
    - Publish, rollback, uninstall commands share consistent logging + telemetry metadata.
    - CI pipeline spec stored with PlantUML diagram and zipped artifact references.
    - Release notes cite feature flags, security warnings, and dependencies per Section 4 directive.
    - Postmortem template circulated and linked from onboarding doc.
