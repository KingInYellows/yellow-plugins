<!-- anchor: iteration-plan -->
## 5. Iteration Plan

*   **Total Iterations Planned:** 4
*   **Iteration Dependencies:** `I1` seeds shared libraries and documentation; `I2` builds install/rollback core atop I1 capabilities; `I3` layers discovery, pinning, and update UX over the stabilized transaction engine; `I4` finalizes publishing + CI automation and hardens operational readiness before release.

<!-- anchor: iteration-1-plan -->
### Iteration 1: Workspace Foundations, Config, and Schema Guardrails

*   **Iteration ID:** `I1`
*   **Goal:** Establish the pnpm workspace, configuration/feature-flag services, schema validation harnesses, and initial documentation/diagram set so later iterations can focus on transactional logic rather than scaffolding.
*   **Prerequisites:** None.

<!-- anchor: task-i1-t1 -->
*   **Task 1.1:**
    *   **Task ID:** `I1.T1`
    *   **Description:** Bootstrap the pnpm workspace (root package, `cli/domain/infrastructure` packages, tsconfig bases), wire lint/test scripts, and ensure provided schemas/examples are referenced via path aliases.
    *   **Agent Type Hint:** `SetupAgent`
    *   **Inputs:** Section 3 directory tree, Section 4 directives, provided schemas and spec.
    *   **Input Files:** [`docs/SPECIFICATION.md`, `schemas/marketplace.schema.json`, `schemas/plugin.schema.json`, `package.json`]
    *   **Target Files:** [`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/cli/package.json`, `packages/domain/package.json`, `packages/infrastructure/package.json`, `.eslintrc.cjs`]
    *   **Deliverables:** pnpm workspace skeleton, lint/test scripts, strict tsconfig chain, ESLint config, initial README entry describing workspace usage.
    *   **Acceptance Criteria:** pnpm install/test succeed; `tsc --noEmit` works; package boundaries follow layered import rules; README quickstart updated.
    *   **Dependencies:** None.
    *   **Parallelizable:** Yes.

<!-- anchor: task-i1-t2 -->
*   **Task 1.2:**
    *   **Task ID:** `I1.T2`
    *   **Description:** Implement `config` and `feature-flag` modules (domain contracts + infrastructure adapters) that merge CLI flags, env vars, and `.claude-plugin/{config,flags}.json`, plus CLI bootstrap to surface flag states.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 architecture, Section 4 feature-flag directive, `.claude-plugin` layout.
    *   **Input Files:** [`docs/SPECIFICATION.md`, `.claude-plugin/config.json`, `.claude-plugin/flags.json`]
    *   **Target Files:** [`packages/domain/src/config/contracts.ts`, `packages/infrastructure/src/config/configProvider.ts`, `packages/cli/src/bootstrap/flags.ts`, `.claude-plugin/config.json`, `.claude-plugin/flags.json`]
    *   **Deliverables:** Typed config API, feature-flag reader, CLI preflight banner exposing flag states, updated docs explaining precedence.
    *   **Acceptance Criteria:** Unit tests simulate precedence order; CLI preflight prints accurate flag data; documentation section added under `docs/operations/feature-flags.md` referencing FR/NFR IDs.
    *   **Dependencies:** `I1.T1`.
    *   **Parallelizable:** Yes.

<!-- anchor: task-i1-t3 -->
*   **Task 1.3:**
    *   **Task ID:** `I1.T3`
    *   **Description:** Create the marketplace/plugin validation toolkit (AJV configuration, shared error catalog) and generate baseline Component Diagram + ERD artifacts referenced in Section 2.1.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 data models, Section 2.1 artifact plan, provided schemas.
    *   **Input Files:** [`schemas/marketplace.schema.json`, `schemas/plugin.schema.json`, `docs/SPECIFICATION.md`]
    *   **Target Files:** [`packages/domain/src/validation/index.ts`, `packages/infrastructure/src/validation/ajvFactory.ts`, `docs/diagrams/component-overview.mmd`, `docs/diagrams/data-erd.puml`, `docs/contracts/error-codes.md`]
    *   **Deliverables:** Shared validation service, error-code mapping table, Mermaid component diagram, PlantUML ERD.
    *   **Acceptance Criteria:** Validator executes against provided example files; diagrams render without syntax errors; error catalog cross-references Section 4 rulebook codes.
    *   **Dependencies:** `I1.T1`.
    *   **Parallelizable:** Conditional (runs after workspace skeleton and may proceed alongside `I1.T2`).

<!-- anchor: task-i1-t4 -->
*   **Task 1.4:**
    *   **Task ID:** `I1.T4`
    *   **Description:** Scaffold the CLI command manifest (yargs wiring, help templates, structured logging utilities) supporting placeholder commands for install/update/rollback/publish/browse/search/pin/check-updates/uninstall.
    *   **Agent Type Hint:** `BackendAgent`
    *   **Inputs:** Section 2 communication patterns, Section 6 observability expectations.
    *   **Input Files:** [`packages/cli/src/index.ts`, `docs/SPECIFICATION.md`]
    *   **Target Files:** [`packages/cli/src/commands/*.ts`, `packages/cli/src/lib/logger.ts`, `docs/cli/help-baseline.md`]
    *   **Deliverables:** CLI entrypoint with stubbed commands, structured logger that prints correlation IDs, Markdown help baseline.
    *   **Acceptance Criteria:** `pnpm cli -- --help` lists all commands; logging helper emits JSON + human-readable outputs; help doc generated from command metadata.
    *   **Dependencies:** `I1.T1`, `I1.T2`.
    *   **Parallelizable:** No (wires outputs from prior tasks).

<!-- anchor: task-i1-t5 -->
*   **Task 1.5:**
    *   **Task ID:** `I1.T5`
    *   **Description:** Establish documentation scaffolding (typedoc, doctoc, markdownlint configs) and seed traceability + ADR templates referencing FR/NFR catalog.
    *   **Agent Type Hint:** `DocumentationAgent`
    *   **Inputs:** Section 2.1 artifact expectations, Section 4 documentation directive.
    *   **Input Files:** [`docs/SPECIFICATION.md`, `docs/traceability-matrix.md`, `README.md`]
    *   **Target Files:** [`typedoc.json`, `.markdownlint.json`, `docs/traceability-matrix.md`, `docs/plans/ADR-template.md`, `package.json` scripts]
    *   **Deliverables:** Documentation tooling configs, updated traceability matrix placeholders, ADR template, package scripts (`docs:build`, `docs:lint`).
    *   **Acceptance Criteria:** `pnpm docs:build` and `pnpm docs:lint` succeed; traceability matrix has entries for FR/NFR coverage referencing planned tasks; ADR template linked from CONTRIBUTING.
    *   **Dependencies:** `I1.T1`.
    *   **Parallelizable:** Yes.

<!-- anchor: iteration-1-validation -->
*   **Iteration 1 Validation Focus:** Unit tests cover config precedence, feature-flag gating, schema validation happy/sad paths, and CLI help rendering snapshots; integration smoke ensures pnpm scripts execute inside Docker Node 20 slim; documentation linting enforces doctoc + markdownlint pipelines.
*   **Iteration 1 Exit Criteria:**
    - Workspace build, lint, and test commands pass locally and in CI dry run.
    - Feature-flag banner surfaces at CLI startup with accurate states from `.claude-plugin/flags.json`.
    - Component diagram, ERD, and error catalog committed under `docs/diagrams/` with anchors referenced by traceability matrix entries.
    - CLI command skeleton honors structured logging contract and prints correlation IDs for every invocation.
*   **Iteration 1 Risks & Mitigations:**
    - Risk: pnpm workspace boundaries might allow accidental cross-imports. Mitigation: add dependency-cruiser lint job plus ESLint import rules before merging tasks.
    - Risk: AJV cold-start compilation may inflate iteration budgets. Mitigation: build schema cache module with memoization inside `packages/infrastructure` and benchmark.
    - Risk: Documentation drift as diagrams evolve. Mitigation: add `docs:verify` script that ensures diagrams listed in Section 2.1 are present and referenced.
*   **Iteration 1 Metrics Targets:**
    - `yellow_plugins_workspace_bootstrap_seconds` ≤ 45s on fresh install.
    - `yellow_plugins_schema_validation_failures_total` = 0 on baseline examples.
    - Documentation coverage checklist updated with at least five traceability links (FR-001..FR-005) referencing new assets.
    - pnpm lockfile hashed and stored to confirm deterministic installs for later phases.
*   **Iteration 1 Collaboration Notes:** Coordinate between SetupAgent and DocumentationAgent via shared issue board; diagram reviewers must sign off before moving to `I2` to avoid inconsistent interface assumptions.
*   **Iteration 1 Testing Scope Expansion:** Add vitest suites for config precedence (table-driven), CLI help snapshot tests per command, and AJV validation fixtures referencing `examples/*.json`; integrate these into `pnpm test:unit` and ensure GitHub Actions dry run includes them.
*   **Iteration 1 Knowledge Transfer:** Record a short CLI bootstrap walkthrough in `docs/operations/onboarding.md`, summarizing workspace commands, feature-flag editing, and diagram locations so downstream agents can self-serve. Include checklist verifying Section 4 directives are understood prior to picking up `I2` tasks.
*   **Iteration 1 Tooling Follow-Ups:**
    - Add `scripts/bootstrap.ts` automation to verify Node 20, pnpm, and git versions before enabling later tasks.
    - Configure Husky or simple git hooks to run schema checks pre-commit; document opt-out instructions per directive.
    - Schedule review with Ops lead to approve diagrams and validation outputs prior to iteration close.
