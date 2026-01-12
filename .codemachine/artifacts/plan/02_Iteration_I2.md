<!-- anchor: iteration-2-plan -->
### Iteration 2: Compatibility, Cache, and Transaction Core

*   **Iteration ID:** `I2`
*   **Goal:** Implement compatibility policy enforcement, cache/registry infrastructure, install/rollback orchestrators (with lifecycle sandbox integration), and the first version of the CLI contract catalog so transactional flows satisfy CRIT-001/002/004/010/018.
*   **Prerequisites:** Completion of `I1` (workspace, config/flags, validation toolkit, CLI scaffolding, diagrams, documentation tooling).

<!-- anchor: task-i2-t1 -->
*   **Task 2.1:**
    *   **Task ID:** `I2.T1`
    *   **Description:** Build the Compatibility & Policy Engine that ingests host fingerprint data, manifest compatibility matrices, and conflict policies, producing deterministic verdicts (`compatible|warn|block`) with evidence payloads.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 components, Section 5 iteration goals, `I1` validation services.
    *   **Input Files:** [`packages/domain/src/compatibility/contracts.ts`, `packages/infrastructure/src/system/fingerprint.ts`, `docs/SPECIFICATION.md`]
    *   **Target Files:** [`packages/domain/src/compatibility/index.ts`, `packages/infrastructure/src/system/fingerprint.ts`, `packages/cli/src/lib/compatCommandBridge.ts`, `docs/contracts/compatibility.md`]
    *   **Deliverables:** Compatibility service, host fingerprint adapter, CLI integration helper, documentation describing policies + error codes.
    *   **Acceptance Criteria:** Unit tests cover Node min/max, OS/arch, Claude runtime, and plugin conflict cases; CLI commands log verdict evidence; docs link to CRIT-019 + FR-004 references.
    *   **Dependencies:** `I1.T2`, `I1.T3`, `I1.T4`.
    *   **Parallelizable:** Yes.

<!-- anchor: task-i2-t2 -->
*   **Task 2.2:**
    *   **Task ID:** `I2.T2`
    *   **Description:** Implement cache manager + registry persistence (atomic writes, eviction policy, temp directories) and align JSON schema for `registry.json` with instrumentation fields (transactionId, telemetry snapshots, lifecycle consent references).
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 data models, `.claude-plugin` layout, Section 4 atomic persistence directive.
    *   **Input Files:** [`docs/SPECIFICATION.md`, `.claude-plugin/registry.json`, `.claude-plugin/cache/`, `docs/diagrams/data-erd.puml`]
    *   **Target Files:** [`packages/domain/src/cache/cacheService.ts`, `packages/domain/src/registry/registryService.ts`, `packages/infrastructure/src/fs/cacheAdapter.ts`, `.claude-plugin/registry.schema.json`, `docs/contracts/registry-format.md`]
    *   **Deliverables:** Cache manager, registry writer with temp rename semantics, schema for registry, docs describing eviction + rollback semantics.
    *   **Acceptance Criteria:** Integration tests simulate staging/promote/evict flows; registry schema validates sample data; eviction logs capture pinned protection.
    *   **Dependencies:** `I1.T1`–`I1.T3`.
    *   **Parallelizable:** Conditional (requires compatibility outputs for final handshake).

<!-- anchor: task-i2-t3 -->
*   **Task 2.3:**
    *   **Task ID:** `I2.T3`
    *   **Description:** Implement Install Transaction Orchestrator (staging directories, checksum verification, lifecycle sandbox invocation, rollback script) and author PlantUML sequence diagram documenting the install/update/rollback flow per Section 2.1.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 communication patterns, Section 2.1 artifact plan, tasks `I2.T1` & `I2.T2` outputs.
    *   **Input Files:** [`packages/domain/src/install/installService.ts`, `packages/infrastructure/src/fs/tempWorkspace.ts`, `docs/diagrams/component-overview.mmd`, `docs/diagrams/data-erd.puml`]
    *   **Target Files:** [`packages/domain/src/install/installService.ts`, `packages/cli/src/commands/install.ts`, `packages/cli/src/commands/rollback.ts`, `docs/diagrams/install-sequence.puml`, `docs/operations/transaction-boundaries.md`]
    *   **Deliverables:** Working install/update/rollback services (without discovery UI), lifecycle sandbox integration, PlantUML sequence diagram, transaction boundary doc.
    *   **Acceptance Criteria:** Integration tests cover success/failure/rollback; lifecycle scripts obey typed consent; diagram renders; doc maps steps to FR/NFR IDs.
    *   **Dependencies:** `I2.T1`, `I2.T2`.
    *   **Parallelizable:** No (central orchestrator).

<!-- anchor: task-i2-t4 -->
*   **Task 2.4:**
    *   **Task ID:** `I2.T4`
    *   **Description:** Draft the CLI Contract Catalog detailing JSON envelopes for install/update/rollback commands, feature-flag annotations, telemetry metadata, and error code schemas, then wire CLI to emit/accept these contracts via `--input/--output` flags.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 2 API style, Task `I2.T3` behavior, Section 4 documentation directive.
    *   **Input Files:** [`docs/SPECIFICATION.md`, `docs/contracts/error-codes.md`, `packages/cli/src/commands/`]
    *   **Target Files:** [`docs/contracts/cli-contracts.md`, `api/cli-contracts/install.json`, `api/cli-contracts/update.json`, `api/cli-contracts/rollback.json`, `packages/cli/src/lib/io.ts`]
    *   **Deliverables:** Markdown overview, JSON schema files for command I/O, CLI helper for `--input/--output`, doc references linking to SPEC anchors.
    *   **Acceptance Criteria:** Schemas validate with AJV; CLI accepts JSON input to drive dry runs; contract doc cross-links FR/NFR IDs; automation snippet included in docs.
    *   **Dependencies:** `I2.T3`.
    *   **Parallelizable:** No (needs orchestrator interface stability).

<!-- anchor: task-i2-t5 -->
*   **Task 2.5:**
    *   **Task ID:** `I2.T5`
    *   **Description:** Integrate telemetry & audit logging across compatibility, cache, and install paths (JSON logs, Prometheus counters, OTEL spans) and expose metrics snapshot command plus docs referencing Section 6 strategy.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 components, Section 6 observability plan, outputs of `I2.T1`–`I2.T3`.
    *   **Input Files:** [`packages/cli/src/lib/logger.ts`, `packages/domain/src/install/installService.ts`, `docs/operations/metrics.md`]
    *   **Target Files:** [`packages/domain/src/telemetry/events.ts`, `packages/infrastructure/src/telemetry/prometheus.ts`, `packages/cli/src/commands/metrics.ts`, `docs/operations/metrics.md`, `.claude-plugin/logs/.gitkeep`]
    *   **Deliverables:** Telemetry event contracts, Prometheus exporter, CLI metrics command, docs describing counters/histograms and retention.
    *   **Acceptance Criteria:** Metrics snapshot validated via tests; structured logs include correlationId + transactionId; docs reference CRIT-004/008/021 mitigations.
    *   **Dependencies:** `I2.T3`.
    *   **Parallelizable:** Conditional (after orchestrator integration).

<!-- anchor: iteration-2-validation -->
*   **Iteration 2 Validation Focus:** Integration tests spin up temp plugin repos exercising install/update/rollback success/failure; lifecycle sandbox tests enforce consent digest + environment filtering; contract schemas validated via AJV; telemetry snapshot command snapshot-tested.
*   **Iteration 2 Exit Criteria:**
    - Install/update/rollback CLI commands succeed end-to-end with actual cache promotions and symlink activation on supported OS targets.
    - Sequence diagram committed and referenced by docs+traceability entries; CLI contract catalog published with anchors.
    - Metrics command exports `yellow_plugins_*` series aligned with Section 6 KPIs.
    - Registry schema validated and documented, ensuring 100% rollback for cached versions via recorded transactionIds.
*   **Iteration 2 Risks & Mitigations:**
    - Risk: Sandbox timeouts may deadlock installs. Mitigation: implement timeout + cancellation with fallback to rollback.
    - Risk: Cache eviction may remove pinned versions. Mitigation: add guard rails + tests verifying pinned entries survive eviction.
    - Risk: CLI contract drift. Mitigation: add CI step that compares CLI metadata with JSON schemas.
*   **Iteration 2 Metrics Targets:**
    - Install duration ≤ 120 seconds in integration tests.
    - Telemetry log size per install ≤ 200 KB to keep audit storage reasonable.
    - Cache hit ratio ≥ 0.6 when reinstalling same plugin versions in test suite.
*   **Iteration 2 Collaboration Notes:** Pair Backend + Documentation agents to ensure CLI contract catalogs and telemetry docs describe identical fields; run weekly review to demo instrumentation and update risk register.
*   **Iteration 2 Testing Scope Expansion:** Add vitest suites for compatibility verdicts, eviction policy decisions, telemetry exporter outputs, and CLI contract schema validation; ensure GitHub Actions workflow executes these suites under Node 20 + latest pnpm.
*   **Iteration 2 Knowledge Transfer:** Update `docs/operations/transaction-boundaries.md` with annotated log samples, CLI snippets, and decision trees so discovery-focused agents in `I3` can reuse orchestrators without reverse engineering internals.
*   **Iteration 2 Tooling Follow-Ups:**
    - Extend `scripts/validate-marketplace.js` to reuse compatibility verdict cache, logging mismatches as warnings.
    - Add CLI replay fixtures under `tests/integration/install/*` to document command transcripts for regression checking.
    - Configure dependency-cruiser rules ensuring CLI never imports infrastructure modules directly.
*   **Iteration 2 Documentation Tasks:** Expand `docs/operations/runbook.md` with install/rollback troubleshooting, update `docs/traceability-matrix.md` for FR-004/005/012 coverage, and embed anchors pointing to new diagrams + CLI contract files.
*   **Iteration 2 Readiness Review Checklist:**
    - All lifecycle sandbox code paths include consent digest storage + typed confirmation prompts.
    - Registry snapshots demonstrate `transactionId`, `cachePath`, `symlinkTarget`, and telemetry references for at least two sample plugins.
    - GitHub Actions dry run proves validation workflow stays under one minute with new suites.
    - Sequence diagram verified by Structural_Data_Architect with sign-off recorded in ADR.
