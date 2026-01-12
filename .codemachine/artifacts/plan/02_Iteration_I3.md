<!-- anchor: iteration-3-plan -->
### Iteration 3: Discovery, Update Intelligence, and Lifecycle UX

*   **Iteration ID:** `I3`
*   **Goal:** Deliver browse/search/info experiences, changelog-aware update flows, pin management, and uninstall enhancements—leveraging the transaction core to satisfy the ten user journeys and extended error catalog.
*   **Prerequisites:** `I1` (tooling, diagrams, CLI scaffolding) and `I2` (compatibility, cache, install/rollback, telemetry, CLI contracts).

<!-- anchor: task-i3-t1 -->
*   **Task 3.1:**
    *   **Task ID:** `I3.T1`
    *   **Description:** Implement marketplace ingestion & caching (git fetch, signature verification, stale index warnings), plus browse/search/info commands with deterministic ranking (category ➜ name ➜ version) and documentation anchors.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 data models, assumption 1 (deterministic ranking), CLI scaffolding from `I1`.
    *   **Input Files:** [`docs/SPECIFICATION.md`, `docs/diagrams/component-overview.mmd`, `.claude-plugin/marketplace.json`, `packages/cli/src/commands/browse.ts`]
    *   **Target Files:** [`packages/domain/src/marketplace/indexService.ts`, `packages/cli/src/commands/browse.ts`, `packages/cli/src/commands/search.ts`, `packages/cli/src/commands/info.ts`, `docs/contracts/marketplace-queries.md`]
    *   **Deliverables:** Marketplace service with cache validation, CLI browse/search/info commands, contract doc describing filters + sorting.
    *   **Acceptance Criteria:** Commands render results offline using cached index; stale index warnings include remediation; documentation references FR-001/002; tests cover signature mismatch + stale hash paths.
    *   **Dependencies:** `I2.T3`, `I2.T4`.
    *   **Parallelizable:** Yes.

<!-- anchor: task-i3-t2 -->
*   **Task 3.2:**
    *   **Task ID:** `I3.T2`
    *   **Description:** Build changelog-aware update/check-updates pipeline (parallelizable fetch with timeout fallback, changelog metadata cache) and integrate warnings per CRIT-008; extend CLI contract catalog with update payloads.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 communication patterns, Section 2.1 artifact references, Task `I2.T3` instrumentation.
    *   **Input Files:** [`packages/cli/src/commands/update.ts`, `packages/domain/src/install/installService.ts`, `docs/contracts/cli-contracts.md`, `.claude-plugin/audit/`]
    *   **Target Files:** [`packages/domain/src/update/updateService.ts`, `packages/cli/src/commands/check-updates.ts`, `packages/domain/src/changelog/changelogService.ts`, `api/cli-contracts/update.json`]
    *   **Deliverables:** Update service with fallback logic, CLI command for `check-updates`, CLI contract update schema revision, docs summarizing fallback statuses.
    *   **Acceptance Criteria:** Update command displays changelog status, continues on fetch failures, logs metadata; tests simulate timeout/404; CLI contract updated accordingly.
    *   **Dependencies:** `I3.T1` (for marketplace data) and `I2.T5` (telemetry hooks).
    *   **Parallelizable:** No.

<!-- anchor: task-i3-t3 -->
*   **Task 3.3:**
    *   **Task ID:** `I3.T3`
    *   **Description:** Implement pin management (pin/unpin commands, pinned priority ordering, registry persistence) and ensure cache eviction respects pins; add docs describing workflows + CLI usage.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 data model, Section 4 directives, registry schema from `I2.T2`.
    *   **Input Files:** [`packages/domain/src/registry/registryService.ts`, `docs/contracts/registry-format.md`, `.claude-plugin/registry.json`]
    *   **Target Files:** [`packages/cli/src/commands/pin.ts`, `packages/domain/src/pins/pinService.ts`, `packages/domain/src/cache/cacheService.ts`, `docs/cli/pin.md`]
    *   **Deliverables:** Pin service, CLI command, cache guard integration, documentation.
    *   **Acceptance Criteria:** Pins survive eviction; CLI lists pin states; docs tie flows to FR-007; tests cover priority + expiry logic.
    *   **Dependencies:** `I2.T2`.
    *   **Parallelizable:** Yes.

<!-- anchor: task-i3-t4 -->
*   **Task 3.4:**
    *   **Task ID:** `I3.T4`
    *   **Description:** Enhance uninstall experience (lifecycle uninstall scripts, cache retention options, telemetry updates, uninstall documentation) and ensure rollback/resolution instructions align with 23 error scenarios.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 components, Section 4 security directive, error catalog from `I1.T3`.
    *   **Input Files:** [`packages/domain/src/install/installService.ts`, `packages/cli/src/commands/uninstall.ts`, `docs/contracts/error-codes.md`]
    *   **Target Files:** [`packages/domain/src/install/uninstallService.ts`, `packages/cli/src/commands/uninstall.ts`, `docs/operations/uninstall.md`, `.claude-plugin/audit/README.md`]
    *   **Deliverables:** Uninstall service with lifecycle sandbox + cache retention controls, CLI command, documentation cross-linking error codes.
    *   **Acceptance Criteria:** Uninstall runs lifecycle hooks with consent checks, removes symlink atomically, optionally purges cache per flag; docs map flows to CRIT-011 + FR-010.
    *   **Dependencies:** `I2.T3`.
    *   **Parallelizable:** No.

<!-- anchor: task-i3-t5 -->
*   **Task 3.5:**
    *   **Task ID:** `I3.T5`
    *   **Description:** Polish CLI UX + docs (ANSI palettes, help examples, onboarding walkthroughs), update CLI contract catalog with discovery/update/uninstall payloads, and ensure docs/traceability entries tracked for FR-001..FR-010 coverage.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 2 API style, Section 6 accessibility notes, tasks `I3.T1`–`I3.T4` outputs.
    *   **Input Files:** [`docs/cli/help-baseline.md`, `docs/contracts/cli-contracts.md`, `docs/operations/onboarding.md`, `packages/cli/src/lib/ui.ts`]
    *   **Target Files:** [`docs/cli/browse.md`, `docs/cli/update.md`, `docs/cli/uninstall.md`, `docs/ui/style-guide.md`, `packages/cli/src/lib/ui.ts`]
    *   **Deliverables:** Updated CLI help pages, UI style guide, contract expansions, accessible color/voice guidelines.
    *   **Acceptance Criteria:** Help output matches docs; ANSI fallback documented; contract files validated; glossary references updated; doc linting passes.
    *   **Dependencies:** `I3.T1`–`I3.T4`.
    *   **Parallelizable:** No.

<!-- anchor: iteration-3-validation -->
*   **Iteration 3 Validation Focus:** Snapshot tests for browse/search output, deterministic ranking unit tests, changelog fetch integration tests (success + fallback), pin eviction property tests, uninstall path coverage including lifecycle hooks and telemetry entries.
*   **Iteration 3 Exit Criteria:**
    - All ten user journeys executable end-to-end in CLI (publish remains stubbed until `I4`).
    - CLI docs + help reflect discovery/update/uninstall flows with anchors referencing specification IDs.
    - Audit logs show uninstall lifecycle consent entries and changelog fetch statuses.
    - Pins appear in registry + CLI listing; eviction logs mention pinned bypass statuses.
*   **Iteration 3 Risks & Mitigations:**
    - Risk: Marketplace fetch latency may block CLI. Mitigation: caching + `--offline` flag.
    - Risk: Sorting logic drift. Mitigation: freeze deterministic comparator tests + doc references.
    - Risk: Changelog fetch hitting rate limits. Mitigation: add exponential backoff + cache results.
*   **Iteration 3 Metrics Targets:**
    - `browse` command < 3s using cached index.
    - `update` command shows changelog statuses within 15s (timeout limit) and logs reason when skipping.
    - Root CLI help size < 120 lines to maintain readability; docs contain at least four accessibility notes.
*   **Iteration 3 Collaboration Notes:** Synchronize with Ops/Docs to ensure new help pages integrate with typedoc; share transcripts for browse/search/uninstall flows so QA can craft exploratory scenarios.
*   **Iteration 3 Testing Scope Expansion:** Introduce contract tests verifying CLI JSON output matches docs, add CLI-driven smoke tests across Linux/macOS via matrix build, and record transcripts for doc embedding.
*   **Iteration 3 Knowledge Transfer:** Host showcase recording demonstrating discovery/pin/update/uninstall flows; annotate `docs/operations/onboarding.md` with new steps; update traceability matrix for FR-001..FR-010 to ready `I4` publish/CI efforts.
*   **Iteration 3 Tooling Follow-Ups:**
    - Add caching instrumentation counters (index freshness, changelog fetch success) to metrics exporter.
    - Extend CLI contract catalog to include discovery/pin/uninstall entries with JSON schemas stored under `api/cli-contracts/`.
    - Update `docs/operations/runbook.md` with troubleshooting for stale caches and changelog failures.
*   **Iteration 3 Documentation Tasks:** Generate walkthroughs (`docs/tutorials/install-and-browse.md`, `docs/tutorials/update-and-pin.md`), embed annotated screenshots/log snippets, and refresh doctoc to capture new anchors.
*   **Iteration 3 Readiness Review Checklist:**
    - Marketplace ingestion caches signed commit hash; CLI warns when local git status diverges.
    - Changelog metadata persisted with status + timestamp for each installed plugin.
    - Pin/unpin commands documented with priority examples and automated tests verifying behavior.
    - Uninstall runbook updated with recovery steps for lifecycle script failures.
