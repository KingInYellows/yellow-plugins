<!-- anchor: blueprint-foundation -->
# 01_Blueprint_Foundation.md

<!-- anchor: 1-0-project-scale-directives -->
### **1.0 Project Scale & Directives for Architects**

*   **Classification:** Medium
    The work targets a personal marketplace yet covers multi-phase delivery, multiple schemas, and CI assets, placing it solidly beyond a quick utility but short of a platform rewrite.
*   **Rationale:** Specification targets a single-developer marketplace but spans ~29k words, 34 requirements, CI workflows, and a 9-week roadmap, aligning with a focused MVP that still demands disciplined modularity and multiple subsystems.
    The requirements emphasize git-native operations, atomic installs, and compatibility matrices, all of which require concerted architectural oversight even without a large team.
*   **Core Directive for Architects:** This is a **Medium-scale** project; every architectural decision MUST bias toward rapid iteration, explicit contracts, and moderate scalability rather than bespoke platforms—choose proven patterns, keep dependency surfaces tight, and avoid enterprise-only tooling.
    Adhere to strict Separation of Concerns, and document every interface so specialized architects can work in parallel without blocking one another.

The classification statement above is binding for all downstream artifacts and cannot be overridden without a revised specification issued by the owner.

---
<!-- anchor: 2-0-standard-kit -->
### **2.0 The "Standard Kit" (Mandatory Technology Stack)**

*   **Architectural Style:** Layered CLI-first monolith partitioned into packages (`cli`, `domain`, `infrastructure`) with strict internal interfaces so that future services can be carved out without rewrites.
    Each package exposes only TypeScript interfaces; cross-package imports must never jump layers, ensuring maintainable seams for later refactors.
*   **Frontend:** None; all interaction occurs through the CLI plus markdown docs, ensuring parity with git workflows and keeping scope focused on automation ergonomics.
    Any temptation to create a GUI must be deferred to a future scope change request and approved by the Foundation Architect equivalent.
*   **Backend Language/Framework:** Node.js 20 LTS with TypeScript, leveraging `yargs` (command routing), `zx`-style helpers for git shelling, and AJV for JSON Schema Draft-07 validation.
    Strict ESLint + tsconfig settings (ESM modules, `strict: true`) are mandatory to protect type boundaries and prevent runtime surprises.
*   **Database(s):** Git repository (single source of truth) plus local JSON registries under `.claude-plugin/` and a disk cache directory; no external DB is permitted to keep the marketplace git-native.
    Persistence helpers must write atomically using temp files + rename semantics to honor rollback guarantees.
*   **Cloud Platform:** GitHub hosts the canonical repo and Actions workflows; no additional cloud runtimes are introduced until Phase 2 expansion scenarios.
    Artifacts such as validation results or telemetry snapshots are stored as workflow artifacts rather than external buckets.
*   **Containerization:** Docker images (Node 20 slim) are required for CI reproducibility and local smoke tests, but runtime execution remains host-native.
    Dockerfiles must pin digest versions to guard against supply-chain drift while still enabling deterministic caching.
*   **Messaging/Queues:** None for Phase 1; intra-process events rely on typed emitters, and any future async coordination must route through the CLI event bus abstraction defined by the Behavior Architect.
    Should asynchronous needs emerge, they must be simulated through local queues persisted in JSON files before considering external brokers.
*   **Package Management:** `pnpm` is the package manager of record to ensure deterministic lockfiles and workspace support for modular packages.
    The lockfile is sacred; all merges must retain integrity or the CI workflow will block.
*   **Testing Framework:** `vitest` drives unit and integration suites with snapshot-based fixtures for marketplace and plugin schemas.
    Integration tests run through `npm run test:integration` and may spin up ephemeral git repos inside tmp directories to exercise install flows.
*   **Documentation Tooling:** `typedoc` for API surfaces, `markdownlint` + `doctoc` for Markdown consistency, and Mermaid diagrams are optional but must be stored under `docs/diagrams/`.
*   **CI/CD Tooling:** GitHub Actions is the sole orchestrator, invoking validation scripts, linting, tests, and Docker image builds under `.github/workflows/validate-schemas.yml`.
    Additional workflows must extend from the same shared composite actions to preserve consistency.

Every specialized architect must treat this section as immutable; deviations require explicit change control recorded in the traceability matrix.

---
<!-- anchor: 3-0-rulebook -->
### **3.0 The "Rulebook" (Cross-Cutting Concerns)**

*   **Feature Flag Strategy:** Implement config-driven flags stored in `.claude-plugin/flags.json`; every net-new or high-risk user journey (browse, publish, rollback variants) MUST be wrapped in a flag evaluated before command execution, defaulting to off in production releases and toggled via semantic version tags.
    Flag evaluation occurs in the command preflight stage so that downstream services never need to branch again.
*   **Observability (Logging, Metrics, Tracing):** Commands output structured JSON logs (level, command, correlationId, pluginId) to stdout, optional human-readable summaries to stderr; metrics originate from a lightweight collector exposing Prometheus-format snapshots via `npm run metrics`, and OpenTelemetry traces are exported locally for CI artifacts.
    Log correlation IDs must propagate through every domain service call to support adversarial review audits.
*   **Security:** All shell executions MUST pass through a sandbox helper enforcing allowlists, lifecycle scripts MUST be shown to the user prior to execution with the "I TRUST THIS SCRIPT" confirmation, and permission disclosures in `plugin.json` are mandatory even though enforcement is deferred to Phase 2.
    Secrets are not stored by the system; any required tokens must come from the caller's environment with zero persistence.
*   **Configuration Management:** Use a single `config.ts` module providing typed accessors backed by `.claude-plugin/config.json`, `.env`, and CLI flags with precedence rules (CLI > env > file); no component may read `process.env` directly.
    Default values must be centralized here to avoid diverging assumptions across services.
*   **Error Handling & Recovery:** Every command must implement the 23 canonical error scenarios with actionable remediation, bubble typed `Result` objects instead of thrown errors, and guarantee atomic rollback semantics where cache state and symlinks remain consistent.
    User-facing errors must cite the exact error code (`ERROR-INST-007`, etc.) and link to documentation anchors.
*   **Versioning & Compatibility:** Semantic versioning controls apply across marketplace index entries, cached artifacts, and CLI releases; compatibility checks MUST validate `nodeMin`/`nodeMax`, OS, arch, and Claude Code dimensions before mutating the install state.
    Downgrades and rollbacks reuse the same compatibility engine, and results must be cached to avoid redundant work.
*   **Documentation & Traceability:** Every public contract, error code, and interface change must be reflected in `docs/SPECIFICATION.md` addenda plus the traceability matrix, keeping the 100% coverage metric intact.
    Architects must annotate pull requests with direct references (e.g., FR-004) to preserve requirement lineage.
*   **Performance Guardrails:** CLI operations must meet success criteria (install ≤ 2 minutes, publish ≤ 10 minutes) under normal network conditions; profiling instrumentation should be toggled via a flag to capture timings without re-running commands.
*   **Compliance with Review Findings:** Corrections CRIT-001 through CRIT-021 are non-negotiable constraints; any code touching atomic operations, permission disclosures, changelog handling, rollback scope, or CI execution time must reference the corresponding fix documentation.

Cross-cutting rules override local optimizations; when in doubt, consult this section before implementing feature-specific logic.

---
<!-- anchor: 4-0-blueprint -->
### **4.0 The "Blueprint" (Core Components & Boundaries)**

*   **System Overview:** The marketplace is a git-native CLI ecosystem where curated plugin manifests, local caches, and deterministic install flows coexist; the CLI orchestrates schema validation, compatibility evaluation, transactional cache updates, and documentation surfacing while GitHub Actions continuously enforces integrity.
    The entire system must favor offline-first behavior by caching manifests and artifacts so developers can keep working without constant network access.
*   **Core Architectural Principle:** Separation of Concerns is enforced through package boundaries (`cli`, `domain`, `infrastructure`), dependency direction (CLI -> domain interfaces -> infra adapters), and typed contracts so that, for example, enhancing the validation engine never requires code churn inside the lifecycle sandbox.
    Each component exposes a minimal interface defined in the domain layer, and adapter swaps require zero upstream modifications.
*   **Key Components/Services:**
    *   **CLI Command Layer:** Presents install/update/rollback/publish commands, handles UX, flag parsing, and delegates to domain services via explicit command handlers.
        It is also responsible for user confirmations, colored output, and capturing telemetry context for downstream steps.
    *   **Marketplace Index Manager:** Pulls `marketplace.json`, validates it against `marketplace.schema.json`, and exposes read-only queries for search/browse journeys.
        The manager caches signatures and ensures that stale indexes trigger warnings when the git commit hash drifts.
    *   **Plugin Metadata Validator:** Applies `plugin.schema.json`, schema drafts, and business rules (duplicate IDs, permission requirements) before any install or publish action proceeds.
        Validation results feed into documentation by attaching remediation hints and linking to schema sections.
    *   **Compatibility & Policy Engine:** Evaluates OS/arch/Node/Claude compatibility vectors plus conflict rules, emitting deterministic advisories (`ERROR-COMPAT-*`) consumed by CLI flows.
        The engine produces structured verdicts (compatible, warn, block) so the CLI can decide whether to halt, warn, or continue.
    *   **Install Transaction Orchestrator:** Executes atomic install/update/rollback sequences with staging directories, checksum verification, and lifecycle hooks ensuring 100% rollback for cached versions.
        It coordinates with cache management to ensure files are only promoted after every validation passes.
    *   **Cache & Storage Manager:** Maintains the `.claude-plugin/cache/` hierarchy, enforces the 500 MB ceiling, and performs eviction per the last-three-versions rule.
        The manager records eviction decisions, enabling reproducibility when diagnosing missing rollback artifacts.
    *   **Symlink Activation Layer:** Creates and verifies symlinks into the active plugin directory, ensuring activation/deactivation is idempotent and reversible.
        All symlink operations log before-and-after states to guard against partially updated installations.
    *   **Lifecycle Script Sandbox:** Displays script contents, demands trust confirmation, runs hooks in a controlled subprocess with timeouts, and reports side effects to the audit log.
        Sandbox policies include resource limits and environment variable filtering so scripts cannot escalate privileges inadvertently.
    *   **Telemetry & Audit Logger:** Persists structured events (installs, updates, errors) for local analysis and CI uploads, providing traceability that aligns with Appendix F findings.
        Audit logs also capture user confirmations for lifecycle scripts to satisfy CRIT-004 requirements.
    *   **CI Validation Runner:** The GitHub Actions workflow bundles schema validation, duplicate detection, and dependency scans; it is treated as a first-class component because failures must map back to concrete error contracts exposed to contributors.
        Runner outputs become documentation artifacts for Ops_Docs_Architect to publish.

Component boundaries must be enforced through dependency linting to ensure no circular imports or hidden coupling creeps into the codebase.

---
<!-- anchor: 5-0-contract -->
### **5.0 The "Contract" (API & Data Definitions)**

*   **Primary API Style:** Command-based interface surfaced via CLI subcommands whose schemas are defined in OpenAPI-like JSON for documentation; data interchange relies on JSON files adhering to Draft-07 schemas ensuring deterministic validation.
    Each command must publish its request/response contract inside `docs/contracts/` so every architect builds against the same expectations.
*   **Data Model - Core Entities:**
    *   **MarketplaceIndex:** `version`, `generatedAt`, array of `entries`, `signature`; canonical source for discovery and update notifications.
        Additional metadata includes `generatorVersion` and `checksumAlgorithm` to make provenance explicit.
    *   **PluginEntry:** `id`, `name`, `category`, `repo`, `manifestPath`, `latestVersion`, `checksum`, `changelogUrl`, `deprecated` flag, `pinPriority`.
        Relationships point to `PluginManifest` revisions so delta updates can be streamed efficiently.
    *   **PluginManifest:** `id`, `version`, `description`, `entry`, `permissions[]`, `lifecycle` hooks, `compatibility` object (`nodeMin`, `nodeMax`, `claude`, `os`, `arch`), plus optional `configSchema`.
        The manifest also stores `installNotes`, `hashes`, and `signing` metadata to satisfy security warnings.
    *   **InstalledPluginRegistry:** `installed[]` (pluginId, version, source, installState, cachePath, symlinkTarget, `lastValidatedAt`), `activePins[]`, and `telemetry` snapshots for rollback auditing.
        Registry mutations must be atomic and carry `transactionId` values for diffing.
    *   **LifecycleScriptRecord:** `pluginId`, `version`, `scriptType` (preInstall/postInstall/uninstall), `digest`, `lastConsentAt`, enabling verification that future runs match the consented content.
        Records also note execution duration and exit code for observability.
    *   **ChangelogMetadata:** `pluginId`, `version`, `url`, `retrievedAt`, `status`, capturing the fallback logic described in CRIT-008.
        If retrieval fails, the status field documents the failure reason for downstream analytics.

Contracts are immutable once published; all modifications require versioned schemas and migration notes included in the traceability matrix.

---
<!-- anchor: 6-0-safety-net -->
### **6.0 The "Safety Net" (Ambiguities & Assumptions)**

*   **Identified Ambiguities:**
    *   The spec references discovery features in Phase 2 but leaves the exact search criteria ranking rules undefined.
    *   Publishing workflow steps cite "typed confirmation" but do not specify how remote repository authentication is handled when pushing manifests.
    *   CI performance targets separate validation and plugin tests, yet the boundaries between required versus optional plugin-level tests remain vague.
    *   No explicit policy defines how deprecated plugins should appear in install/browse flows beyond a `deprecated` flag.
    *   The role of example files during automated validation (warnings vs blocking errors) is not formally specified.
*   **Governing Assumptions:**
    *   Assumption 1: Search ranking defaults to deterministic ordering (category > plugin name > semantic version), and the Structural_Data_Architect will define only these comparators until new heuristics are approved.
        Discovery experiments will live behind feature flags and rely on telemetry to justify revisions.
    *   Assumption 2: Publishing relies on the developer's existing Git credentials; the Ops_Docs_Architect must document PAT/SSH setup but no bespoke auth service will be built in Phase 1.
        If authentication fails, the CLI surfaces a standardized error referencing Git's own message for troubleshooting.
    *   Assumption 3: CI workflows MUST keep schema validations under one minute, while plugin-specific tests are opt-in and reported separately; Behavior_Architect will expose a flag to skip long-running plugin suites by default.
        Optional plugin tests failing should warn but not block unless the contributor marks them as required in metadata.
    *   Assumption 4: Deprecated plugins remain visible in browse/search but carry a high-severity warning banner and are excluded from automated install recommendations.
    *   Assumption 5: Example files validate under the same schemas but only emit warnings if they drift; they are teaching artifacts, not release blockers unless the schema version changes.

This safety net locks in interim decisions so that specialized architects do not reinvent policies or diverge from stakeholder expectations.
    *   Assumption 6: Lifecycle scripts that request elevated permissions must explicitly declare why within the manifest, and installers will refuse execution if the justification string is missing.
        Behavior_Architect will define the prompt template while Ops_Docs_Architect documents acceptable justification patterns for contributors.
    *   Assumption 7: Future remote marketplace mirrors will treat GitHub as the source of truth; until mirrors exist, Structural_Data_Architect should optimize data contracts for single-origin distribution only.
        Any replication experiments must live behind an `experimentalMirrorSync` feature flag with telemetry opt-in.

These addenda keep the ambiguity ledger transparent and ensure every architect marches toward the same clearly bounded implementation horizon.
Future deviations from these assumptions require a written change request reviewed by the Foundation Architect role.
Parallel architects must log any newly discovered ambiguities immediately so this safety net remains authoritative.
Quarterly retrospectives (or equivalent milestones) should revisit this section to retire assumptions that become verified behaviors.
