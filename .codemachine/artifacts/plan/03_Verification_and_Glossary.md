<!-- anchor: verification-and-integration-strategy -->
## 6. Verification and Integration Strategy

*   **Testing Levels:**
    - **Unit Tests:** Vitest suites per package; config/flag precedence (I1), compatibility verdicts (I2), discovery/update flow formatters (I3), publish command/pipeline wrappers (I4). Snapshot tests enforce CLI help, structured logs, and contract JSON output.
    - **Integration Tests:** Temp git repos verifying install/update/rollback/uninstall/publish flows, cache promotion and eviction, registry persistence, lifecycle sandbox consent logging, changelog fallback logic, and metrics exports. Sequence diagram ensures orchestrator steps align with tests.
    - **End-to-End / Smoke:** CLI-driven scripts under `tests/smoke/` triggered in CI matrix (macOS/Linux/WSL) that install sample plugins, run update/pin/uninstall commands, publish to sandbox remote, and ensure telemetry artifacts recorded.
*   **CI/CD:**
    - GitHub Actions `validate-schemas.yml` orchestrates lint (ESLint + markdownlint), unit/integration tests (vitest + smoke), schema validation (AJV vs provided schemas/examples/registry), CLI contract drift checks, and Docker image build for reproducibility. Workflow caches pnpm store, collects logs/metrics as artifacts, and enforces runtime budget (<60s validation stage).
    - Optional `publish-release.yml` triggered manually or on tagged commits to run full validation, upload release artifacts, and publish npm/gittag packages. All jobs use pinned Node 20 slim images.
*   **Code Quality Gates:**
    - ESLint + TypeScript strict compile must pass with zero warnings; dependency-cruiser ensures layered imports (`cli ➜ domain ➜ infrastructure`).
    - Coverage thresholds: ≥85% for domain/infrastructure units; CLI snapshot coverage tracked qualitatively via diff-based approvals.
    - `pnpm docs:lint` and `pnpm docs:build` enforced to keep typedoc/markdown consistent; doctoc ensures anchors up to date.
    - Feature-flag audit script verifies `.claude-plugin/flags.json` entries declare owner, purpose, default state, and expiry before merge.
*   **Artifact Validation:**
    - Diagrams (Mermaid/PlantUML) validated via CI script (`pnpm docs:diagrams`) to prevent syntax regressions; anchors referencing Section 2.1 must exist.
    - CLI Contract JSON schemas linted with AJV; automation diff ensures CLI metadata matches spec to avoid drift.
    - Registry/cache schemas validated using fixture data each CI run; corruption triggers blocking failure with remediation docs.
    - Telemetry snapshots compared against KPI spec to confirm required counters/histograms appear; metrics script fails when missing.
    - Release checklist requires manual review of audit logs, lifecycle consent transcripts, and documentation anchors before tagging.
*   **Integration Strategy:**
    - Feature work lands behind flags; integration begins by enabling flags in staging branch, running CLI smoke tests, then flipping defaults post-verification.
    - Modules integrate via contract-first PRs referencing CLI schema updates; domain adapter mocks used for contract testing without hitting filesystem.
    - Ops/Docs review gates ensure Section 6 assets (runbooks, metrics specs) updated before merging functional code.
    - Traceability matrix updated iteratively; CI job verifies FR/NFR references exist for files touched, preventing orphaned changes.

<!-- anchor: glossary -->
## 7. Glossary

*   **AJV:** JSON Schema validator used for marketplace and plugin manifests as well as CLI contract schemas.
*   **Audit Artifact:** Structured JSON log or metrics snapshot stored under `.claude-plugin/audit/` and uploaded in CI; proves lifecycle consent and transaction steps.
*   **Cache Promotion:** Process of moving verified plugin assets from staging to `.claude-plugin/cache/`, logging bytes + eviction decisions.
*   **CLI Contract Catalog:** Collection of JSON/Markdown files describing CLI request/response envelopes, feature flags, and telemetry metadata for automation.
*   **Compatibility Verdict:** Result from Compatibility & Policy Engine containing `state`, `warnings`, `blockingReasons`, and `evidence` arrays used by CLI to halt or continue operations.
*   **Feature Flag Audit:** Script + checklist verifying every `.claude-plugin/flags.json` entry has owner, purpose, default, expiry, and documentation link before enabling.
*   **Lifecycle Sandbox:** Controlled subprocess runner showing lifecycle scripts, recording typed consent digest, enforcing resource/time limits, and emitting audit logs.
*   **Marketplace Index Manager:** Domain service responsible for syncing `marketplace.json`, validating signatures, caching commit hashes, and powering browse/search/info commands.
*   **Metrics Snapshot:** Output of `pnpm metrics` / `npm run metrics` that exports Prometheus-format counters/histograms capturing KPIs (install duration, cache usage, etc.).
*   **Registry Schema:** JSON definition for `.claude-plugin/registry.json` capturing installs, pins, telemetry references, and transaction metadata to enable deterministic rollback.
*   **Release Checklist:** Document enumerating pre-release verification steps (tests, docs, audit review, flag status) signed during `I4` to approve distribution.
*   **Sequence Diagram:** PlantUML depiction of install/update/rollback flows showing CLI, domain services, adapters, sandbox, cache, and telemetry interactions.
*   **Telemetry Event:** Structured log entry containing correlationId, command, pluginId, cache metrics, lifecycle consent status, and references to documentation anchors; forwarded to Prometheus/OpenTelemetry sinks.

*   **Release Verification Steps:**
    - Run `pnpm release:check` (lint, test, docs, metrics, contract drift) and capture report as artifact.
    - Execute CLI smoke tests using sample plugins (install/update/pin/uninstall/publish) with telemetry capture for audit.
    - Review lifecycle consent transcripts to ensure typed confirmations recorded for each script.
    - Validate changelog metadata and ensure release notes cite CRIT corrections and open assumptions.
    - Confirm feature flags default to documented states; update `docs/operations/feature-flags.md` to reflect release toggles.
    - Perform manual walkthrough of publish/rollback/uninstall to confirm documentation accuracy.
*   **Integration Environments:**
    - Local developer machines (macOS, Linux, WSL) serve as primary environments; `scripts/bootstrap.ts` validates prerequisites before running tests.
    - GitHub Actions matrices cover Ubuntu, macOS, and Windows runners for smoke tests to spot platform divergences early.
    - Optional Docker Compose file may spin up ephemeral git remotes to test publish flows without touching production repos.
*   **Bug Triage & Incident Response:**
    - Triage uses GitHub Issues with templates referencing FR/NFR IDs, reproduction steps, log snippets, and correlationId; severity mapping ties back to success metrics.
    - Incident response leverages runbook sections (cache recovery, registry repair, lifecycle failure) plus postmortem template to capture timeline, contributing factors, and follow-up tasks.
    - Metrics dashboards reviewed weekly; anomalies trigger backlog items or emergency fixes documented via ADR + traceability updates.
*   **Residual Risks:**
    - **Offline Edge Cases:** Extended offline operation may fall behind remote security fixes; mitigation is periodic `marketplace sync` reminders and stale index warnings.
    - **Plugin-Supplied Scripts:** Despite sandboxing, scripts may attempt creative exploits; mitigation is digest comparison, typed consent, and audit logging; future enforcement flagged as Phase 2.
    - **Git Conflicts:** Publishing from divergent branches may cause push failures; mitigation is preflight git status check + instructions for resolving conflicts.
    - **Performance Drift:** Install/update durations might degrade as plugin count grows; mitigation is telemetry alerts when budgets exceeded, plus targeted profiling toggles.
*   **Quality Gates Summary:**
    - Merge blocked unless CI green, docs updated, traceability matrix entries added, and feature-flag audit script passes.
    - ADR required for architecture deviations; review ensures Section 2/4 directives remain satisfied.
    - Artifact diff check ensures diagrams + schemas referenced in Section 2.1 exist and match anchors recorded in manifest.
*   **Governance Hooks:**
    - Monthly KPI review uses metrics snapshots to evaluate install success rate, rollback duration, cache eviction frequency, doc update latency; action items committed to backlog.
    - Feature flags tracked via `flags.json` plus doc table; enabling/disabling requires issue comment referencing rationale + expected disable date.
    - Release approvals recorded via signed checklist stored in repo; ensures compliance with spec and adversarial review feedback.
*   **Glossary Additions:**
    - **ADR (Architectural Decision Record):** Markdown file capturing decision context and consequences; required for deviations from directives.
    - **Cache Eviction Log:** JSON artifact describing reasons for removing cached plugin versions, referenced when rollback targets missing.
    - **Changelog Metadata Cache:** Store of changelog fetch statuses/timeouts ensuring CLI can explain fallback behavior offline.
    - **Compatibility Evidence:** Structured object listing OS/arch/node data plus manifest claims that produced a given verdict; stored with telemetry for auditing.
    - **Dry-Run Mode:** CLI flag causing commands to simulate all validations/compatibility checks without mutating filesystem.
    - **GitHub Actions Artifact Bundle:** Collected logs/metrics/diagrams zipped per workflow run to support adversarial review + future audits.
    - **KPI Review:** Scheduled session analyzing metrics snapshots for install success, rollback duration, cache usage, documentation latency, triggering actions when thresholds missed.
    - **Lifecycle Consent Transcript:** JSON record of script digest, display content hash, typed phrase, timestamp, exit code; ensures CRIT-004 compliance.
    - **PnPM Workspace Guard:** ESLint/dependency-cruiser rule set preventing cross-layer imports and enforcing strict boundaries.
    - **Traceability Matrix:** Living spreadsheet-like Markdown enumerating FR/NFR mapping to code, tests, docs, and artifacts; updates mandatory per change.
