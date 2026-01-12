<!-- anchor: 3-0-proposed-architecture -->
## 3. Proposed Architecture (Operational View)
The operational model centers on a CLI-first Node.js 20 LTS application organized into `cli`, `domain`, and `infrastructure` packages so runtime contracts remain explicit and auditable.
Each package ships as TypeScript compiled artifacts with strict ESM settings, and pnpm workspaces guarantee deterministic dependency graphs even when contributors run commands offline.
Operations treat the git repository plus `.claude-plugin/` directory as the canonical datastore, so every workflow is designed to tolerate local filesystem failures and recover through git history.
The CLI favors streaming structured JSON logs to stdout for machine parsing while simultaneously emitting succinct human-readable summaries to stderr for day-to-day ergonomics.
Offline-first behavior is reinforced by caching plugin manifests, tarballs, and changelog fetches so network volatility never blocks installs longer than the two-minute success criterion.
All operational practices refer back to the foundation directives to ensure every change request cites a requirement identifier, maintains traceability, and keeps the medium-scale footprint manageable without sacrificing rigor.

<!-- anchor: 3-1-operational-tenets -->
### 3.1 Operational Tenets
Operational tenets prioritize atomicity, determinism, and self-healing so solo developers can trust every CLI action without manual cleanup.
Tenet one enforces staged filesystem writes using temp directories plus rename semantics, thereby guaranteeing rollbacks leave cache state coherent even when interrupts occur mid-install.
Tenet two mandates feature-flag gating for high-risk journeys stored in `.claude-plugin/flags.json`, with evaluation executed before command handlers mutate any state.
Tenet three insists that every CLI invocation carries a `correlationId` propagated through domain services, letting logs, metrics, and audit entries line up during adversarial reviews or incident retrospectives.
Tenet four keeps configuration centralized inside `config.ts` where CLI flags override environment variables, and environment variables override config files; this prevents drift across packages.
Tenet five demands that operations degrade gracefully: when remote changelog URLs time out or GitHub is offline, the CLI documents the failure with `ERROR-DISC-00x` codes but allows installs to proceed if integrity checks pass.
Tenet six underscores portability by requiring Docker-based validation and tests so GitHub Actions and local machines run identical Node 20 slim environments pinned by digest, reducing "works on my machine" risk.
Tenet seven ensures documentation parity: every operational switch, flag, cache directory, or error code must appear in Markdown references under `docs/` so maintainers never hunt through code to understand behavior.
Tenet eight affirms that default operations assume untrusted plugin content, so lifecycle scripts run in a sandbox even when the repository itself is trusted; this avoids accidental privilege escalation.
Tenet nine clarifies that GitHub remains the source of truth for releases, while developer machines are ephemeral execution environments; any divergence automatically triggers warnings urging a git pull or manual conflict resolution.
Tenet ten codifies that observability artifacts (logs, metrics snapshots, telemetry JSON) must be retained inside the repository or as GitHub Actions artifacts, never in unmanaged cloud buckets, ensuring long-term reproducibility without data sprawl.

<!-- anchor: 3-2-package-responsibilities -->
### 3.2 Package Responsibilities
The CLI package exposes yargs-based command wiring, command preflights, user prompts, and telemetry capture, and it never reaches into filesystem primitives directly; instead, it invokes domain interfaces for installers, validators, cache managers, and feature flag readers.
Command handlers orchestrate complex flows such as install or rollback by sequencing domain services, injecting correlation identifiers, and terminating with structured `Result` output that includes success metadata or failure codes.
The domain package defines pure business logic interfaces and orchestrators such as `InstallTransaction`, `MarketplaceIndexService`, `CompatibilityEngine`, and `LifecycleSandbox`, each returning typed results rather than throwing exceptions.
Domain entities encapsulate JSON schema knowledge and permission disclosure logic so infrastructure details (AJV configuration, file IO) can be swapped without altering the business rules or tests that enforce FR-001 through FR-013.
The infrastructure package implements adapters for git IO, filesystem persistence, terminal UI, network fetches, metrics storage, and sandboxed shell execution while honoring the security allowlists mandated by CRIT-004.
Adapters such as `GitHubIndexFetcher` or `CacheFilesystem` respect the layered dependency rules, meaning they can only depend on Node built-in modules, vetted npm dependencies, and shared interfaces provided by the domain layer.
Infrastructure also ships helpers for deterministic testing: ephemeral git repositories spin up under `/tmp` directories, caches can be pointed to stub directories, and network calls can be replaced with fixture readers to keep vitest suites fast.
Dependency linting runs as part of `npm run lint:layers`, reinforcing that no circular imports or cross-layer leaks slip into the codebase and that each package publishes only what downstream layers need.
Documentation for each package resides under `docs/packages/<name>.md`, capturing operational responsibilities so new contributors comprehend boundaries before writing code.
The package responsibilities are mirrored in Docker build stages: base dependencies install once, followed by domain compilation, infrastructure bundling, and CLI packaging, keeping container layers cache-friendly for GitHub Actions.

<!-- anchor: 3-3-cli-workflow-control -->
### 3.3 CLI Workflow Control
Command routing is defined declaratively: each CLI command registers metadata (description, feature flag key, required config, error mappings) consumed by the preflight engine before execution.
Preflights ensure Node version compatibility, confirm required files exist, parse `.claude-plugin/flags.json`, and load `.claude-plugin/config.json` overrides, failing fast when prerequisites are missing.
The CLI surfaces interactive prompts only when necessary, such as requesting typed confirmation for lifecycle scripts or selecting rollback targets if multiple cached versions exist.
All prompts display contextual warnings referencing specification sections and error codes so users understand consequences, satisfying CRIT-004 and CRIT-010 simultaneously.
Command results emit JSON logs that include timing data, cache usage, git commit hash, CLI version, and command outcome; this enables metrics aggregation without extra instrumentation.
When commands spawn subprocesses (git fetch, plugin tests, lifecycle scripts), they use a sandbox helper that enforces allowlists, timeouts, environment variable filters, and log redaction to prevent inadvertent credential leaks.
CLI workflow control also manages changelog fetching with timeouts: fifteen-second budgets guard against command stalls, and fallback logic documents whether the changelog was missing, timed out, or returned an error.
Rollback commands share the same code paths as install commands but start by verifying cache integrity and symlink state, ensuring 100% success for cached versions per CRIT-018 while providing remediation guidance when older versions were never cached.
Publish commands integrate with git by staging manifest changes, running schema validation, and optionally pushing via the developer's configured Git remote if the user passes the `--push` flag and confirms they already authenticated.
All workflow definitions live in a central manifest so documentation and tooling can generate reference pages, ensuring traceability between command behavior and specification requirements such as FR-006 or NFR-MAINT-002.

<!-- anchor: 3-4-data-persistence -->
### 3.4 Data Persistence & Cache Layout
Data persistence relies entirely on the developer's filesystem plus git history, meaning operations must enforce atomic writes and provide recovery paths for corrupted files through schema validation and backups.
The `.claude-plugin/marketplace.json` file mirrors the remote marketplace index; updates run through schema validation and checksum verification before the CLI replaces the local file.
`plugin.json` manifests live inside each plugin repository, validated both by schema and by business rules such as permission disclosure justifications and compatibility matrices.
Installed plugins are tracked inside `.claude-plugin/registry.json`, which stores transaction identifiers, installation dates, cache paths, and pinning metadata; updates occur via temp files that replace the registry only after writes succeed.
Cache artifacts reside under `.claude-plugin/cache/<pluginId>/<version>/`, storing downloaded archives, extracted payloads, symlink metadata, and checksums; the cache manager enforces a 500 MB cap and retains the last three versions per plugin.
Cache eviction decisions are logged and written into `.claude-plugin/cache/index.json` so future rollbacks know why an artifact disappeared and can instruct the user to re-fetch from git if necessary.
Symlink activation uses `.claude-plugin/active/<pluginId>` pointing to the extracted version directory; before updates, the CLI records the previous symlink target to enable instant rollbacks even if the command fails mid-way.
Temporary directories live under `.claude-plugin/tmp/<transactionId>`; they are cleaned automatically after installs succeed, yet cleanup routines also run on startup to remove orphaned temp directories left by crashes.
The CLI records telemetry snapshots (command type, duration, success, error code) inside `.claude-plugin/logs/*.jsonl` for local review and optional upload as GitHub Actions artifacts during CI validation runs.
All persistence structures include version metadata so migrations can be applied explicitly; for instance, registry version `1` may become `1.1` to support new fields, and the CLI will rewrite the file with upgrade markers referencing docs addenda.

<!-- anchor: 3-5-observability-fabric -->
### 3.5 Observability Fabric
Logging consists of two channels: structured JSON logs for automation and friendly summaries for humans; the JSON logs include fields like `timestamp`, `level`, `command`, `correlationId`, `pluginId`, `errorCode`, and `durationMs`.
Logs stream to stdout and can be redirected to files, while warnings and prompts appear on stderr so shell scripting remains predictable.
Metrics collection relies on a lightweight in-process collector that tracks counts (installs, rollbacks, validation failures), histograms (command duration, cache read times), and gauges (cache size, symlink count).
A `npm run metrics` command emits Prometheus-format text that developers or CI can scrape; during GitHub Actions runs the output is stored as an artifact for historical trend analysis.
Tracing uses OpenTelemetry exporters configured to write JSON spans locally; spans cover major operations such as schema validation, compatibility checks, cache promotion, and lifecycle script execution.
Correlation IDs propagate into spans so logs, metrics, and traces align, fulfilling the observability requirements described in the rulebook.
Audit logs capture lifecycle script consent events, including the digest shown to the user, the typed confirmation string, and execution exit codes, providing forensic data if a script misbehaves later.
Incident review templates stored under `docs/operations/postmortem-template.md` instruct maintainers how to pull logs, metrics snapshots, and registry diffs to reconstruct events quickly.
Observability features default to on but can be tuned via config for performance-sensitive contexts; for example, high-volume metrics export can be disabled to conserve resources on constrained machines.
All observability artifacts exclude sensitive content: plugin secrets never appear, and file paths are normalized to avoid leaking developer usernames when sharing logs publicly.

<!-- anchor: 3-6-security-posture -->
### 3.6 Security Posture
Security coverage starts with the lifecycle sandbox, which displays script contents, requires typed confirmation (`I TRUST THIS SCRIPT`), redacts environment variables, enforces CPU and wall-clock limits, and records exit statuses for auditing.
The CLI never stores secrets; git authentication relies on existing SSH keys or PATs configured by the developer, and commands simply shell out to git, surfacing Git's own errors if auth fails.
Permission disclosures in `plugin.json` must include `reason` strings for each requested capability; installers warn when reasons are missing and block execution if justification is absent, honoring assumption six in the safety net.
All inputs pass through JSON schema validation plus semantic validation; the CLI refuses to process manifests that fail compatibility checks or reference files outside the repository root.
Network operations (downloading changelogs or supplemental assets) use HTTPS with certificate validation, and caching includes checksum verification so tampering is detectable even when offline.
Feature flags controlling experimental functionality default to `false` and are versioned; enabling them requires editing `.claude-plugin/flags.json`, making it obvious when a developer opts into potentially unstable behavior.
Docker images pin digest versions of the Node 20 slim base and include only necessary tooling (pnpm, git, AJV, vitest); scanning occurs via `npm audit` and optional container scanners executed during CI.
Security documentation covers hardening steps such as verifying plugin checksums before publishing, avoiding shared directories with lax permissions, and using OS-level sandboxing (e.g., macOS sandbox-exec) for additional defense-in-depth.
Auditability is enhanced by storing transaction IDs and registry diffs so users can see exactly which files changed during an install, enabling rapid detection of malicious modifications.
The CLI enforces that deprecated plugins display warnings and require explicit confirmation before installation, reducing the chance of deploying unmaintained or insecure code inadvertently.

<!-- anchor: 3-7-operational-processes -->
### 3.7 Operational Processes
Build processes rely on pnpm scripts: `pnpm install`, `pnpm build`, `pnpm lint`, `pnpm test`, and `pnpm validate`; these commands run locally and inside Docker so artifacts remain consistent.
Release processes follow git tagging conventions; semantic versions update `package.json`, changelog entries, and `docs/SPECIFICATION.md` addenda before tags are pushed to GitHub.
CI pipelines defined in `.github/workflows/validate-schemas.yml` run linting, testing, schema validation, duplicate detection, dependency scanning, and Docker build verification in under one minute for validation-specific steps.
Deployments in this context mean publishing CLI releases or updating documentation; GitHub Actions signs release artifacts, attaches metrics snapshots, and records the Docker image digest used for validation.
Incident response begins with reproduction using cached artifacts, verifying registry consistency, and analyzing audit logs; a runbook under `docs/operations/runbook.md` lists commands to gather diagnostics quickly.
Operational readiness reviews include verifying that flags default correctly, cache directories respect size limits, and documentation references align with actual CLI options.
Backups rely on git clones and manual copies of `.claude-plugin/` directories; instructions encourage developers to store these directories inside version-controlled repositories or secure backups when operating multiple machines.
Operational monitoring includes scheduled CI jobs that run validation commands nightly against the main branch, ensuring regressions are caught even without active development.
Dependency updates follow a controlled process: dependabot (or manually curated updates) runs inside a dedicated branch, executes the full validation pipeline, and requires manual review focusing on security and compatibility impacts.
Operational documentation includes diagrams, glossary entries, and rationale sections generated by the Operational Architect role, providing future contributors with context for every decision.

<!-- anchor: 3-8-cross-cutting-concerns -->
### 3.8 Cross-Cutting Concerns
**Authentication & Authorization:** The CLI depends on the developer's existing GitHub authentication (SSH keys or PATs) and local OS permissions; no centralized auth service exists in Phase 1, but command preflights verify the git remote is reachable and warn if credentials fail.
Role-based access manifests through git repo permissions: only maintainers can push marketplace updates, while local CLI commands operate under the user's OS privileges, ensuring separation between trusted maintainers and general users.
Feature flags double as access controls for risky workflows (publish, browse experiments, rollback variants); enabling a flag records the user ID and timestamp inside `.claude-plugin/flags.json` so auditors know who activated what.
**Logging & Monitoring:** Structured JSON logging plus metrics snapshots ensure every command outcome is traceable; GitHub Actions uploads logs and metrics as workflow artifacts, and local operators can point tools like Prometheus plus Grafana at `npm run metrics` output for dashboards.
Incident alerts rely on GitHub status checks; when validation workflows fail, maintainers receive notifications with direct links to log artifacts, eliminating guesswork.
**Security Considerations:** End-to-end HTTPS for remote fetches, checksum validation, sandboxed lifecycle scripts, typed permission disclosures, and zero secret storage represent the baseline security posture.
Docker images use non-root users and minimal packages, and CI enforces `npm audit --production` to catch vulnerable dependencies before releases.
**Scalability & Performance:** The layered monolith stays stateless with respect to remote services, meaning multiple developers can run the CLI independently without coordination, while caches and symlinks keep installs within the two-minute SLA even on slow networks.
Validation and install logic reuse deterministic pipelines so results are reproducible; parallel installs are avoided to keep operations simple, but transaction queues can be introduced later under feature flags if concurrent operations become necessary.
**Reliability & Availability:** GitHub hosts the canonical repo with built-in redundancy, Dockerized CI ensures reproducible environments, and local caches plus registry backups provide rapid recovery paths for offline or failed installs.
Health checks exist in two forms: CLI self-check commands validate environment readiness, and GitHub Actions status badges confirm the latest commits passed validation, guiding users toward safe revisions.

<!-- anchor: 3-9-deployment-view -->
### 3.9 Deployment View
**Target Environment:** GitHub remains the authoritative cloud platform, providing repository hosting, issue tracking, release distribution, and GitHub Actions runners that execute Docker-based validation workflows.
Local developer machines (macOS, Linux, Windows with WSL) host the CLI runtime, caches, and telemetry artifacts; they synchronize with GitHub via git pulls and pushes.
**Deployment Strategy:** The CLI is packaged as a pnpm workspace published to npm (or distributed via git tags) but validated inside Docker images pinned to Node 20 slim digests; GitHub Actions builds the Docker image, runs validation scripts, and attaches artifacts to releases.
Operational deployments equate to tagging releases, publishing documentation, and updating schema files; no runtime services are deployed beyond GitHub workflows, keeping the footprint minimal yet reproducible.
**Deployment Diagram (PlantUML):**
```plantuml
@startuml
!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Deployment.puml
LAYOUT_WITH_LEGEND()
Deployment_Node(cloud, "GitHub", "Cloud Platform") {
  Deployment_Node(actions, "GitHub Actions", "CI/CD") {
    Container(ciRunner, "Validation Runner", "Docker (Node 20 slim)", "Runs linting, tests, schema validation, Docker builds, and publishes artifacts")
  }
  Deployment_Node(repo, "yellow-plugins Repo", "Git Repository") {
    ContainerDb(marketplaceRepo, "Marketplace Source", "Git", "Stores CLI code, schemas, docs, and cache documentation")
  }
}
Deployment_Node(devLaptop, "Developer Machine", "macOS/Linux/WSL") {
  Container(cliRuntime, "Yellow Plugins CLI", "Node 20 + pnpm", "Executes install/update/rollback workflows, manages caches, enforces feature flags")
  ContainerDb(localCache, ".claude-plugin Cache", "Filesystem", "Holds registry.json, caches, logs, and feature flag settings")
}
Rel(devLaptop, repo, "git clone/push", "SSH or HTTPS with PAT")
Rel(ciRunner, repo, "checkout", "GitHub App")
Rel(ciRunner, cliRuntime, "Docker image references", "Release artifacts")
Rel(cliRuntime, localCache, "atomic writes", "fs APIs")
@enduml
```

<!-- anchor: 3-10-install-transaction-lifecycle -->
### 3.10 Install Transaction Lifecycle
Each install begins with a `transactionId` generated from timestamp plus randomness, recorded in the audit log before any files move so postmortems can trace partial runs.
Step one validates marketplace index freshness, ensures the target plugin entry matches the requested version, and checks compatibility vectors across Node, OS, arch, and Claude Code dimensions.
Step two downloads or reuses cached artifacts, verifying checksums before extraction; corrupted caches trigger automatic invalidation and a re-download while logging `ERROR-CACHE-001` events.
Step three extracts files into a temp directory, runs schema validation on embedded manifests, and executes optional plugin tests inside the sandboxed environment if the plugin declares them.
Step four pauses to display lifecycle scripts, requiring typed confirmation; if the user declines, the CLI aborts the transaction gracefully and reverts any staged filesystem changes.
Step five promotes the extracted directory into the cache, updates symlinks atomically, and writes registry updates into a temp file so the prior registry remains untouched until success is certain.
Step six emits telemetry summarizing cache hits, duration, lifecycle decisions, and changelog statuses, ensuring the metrics catalog gets new data without additional instrumentation.
Step seven cleanup removes temp directories, resets file permissions to match repository defaults, and rotates audit logs if thresholds are exceeded, preventing disk bloat.
Rollback transactions reuse the same lifecycle but skip download phases, focusing on cache verification, symlink swaps, lifecycle uninstall script execution, and documentation of any missing versions.
Every phase exposes hook points for future automation, but hooks default to no-ops until feature flags enable them, keeping Phase 1 operations deterministic and simple to reason about.

<!-- anchor: 3-11-operational-metrics-catalog -->
### 3.11 Operational Metrics Catalog
Metrics names follow a `yellow_plugins_*` namespace so dashboards remain organized across CLI and CI contexts.
`yellow_plugins_command_duration_ms` captures histograms for install, rollback, publish, validate, and browse commands, enabling SLO tracking against the two-minute install and ten-minute publish targets.
`yellow_plugins_cache_hit_ratio` records how often installs reuse cached artifacts compared to fresh downloads; low ratios highlight network or cache pruning issues.
`yellow_plugins_schema_validation_failures_total` counts validation errors grouped by schema type (marketplace, plugin, registry), letting maintainers detect systemic regressions quickly.
`yellow_plugins_lifecycle_prompt_declines_total` tracks how often users reject lifecycle scripts, providing insight into trust levels and potentially unvetted plugins.
`yellow_plugins_feature_flag_usage_total` increments when experimental flags toggle on, informing architects which hidden features merit promotion into supported flows.
`yellow_plugins_ci_duration_seconds` monitors GitHub Actions validation run time, ensuring the workflow meets CRIT-021 expectations and does not creep beyond the one-minute target.
`yellow_plugins_cache_size_bytes` exports the current cache footprint, allowing automation to warn when the 500 MB ceiling approaches and preemptively evict stale artifacts.
`yellow_plugins_registry_corruption_incidents_total` remains ideally zero, but tracking it ensures corrupted registries prompt deeper investigation and documentation of remediation steps.
Metrics default to in-memory storage but can be scraped to text files and uploaded; integration tests confirm counters increment as expected, preventing silent telemetry failures.

<!-- anchor: 3-12-documentation-and-training -->
### 3.12 Documentation & Training Patterns
Operational documentation resides under `docs/operations/` and includes runbooks, onboarding guides, troubleshooting FAQs, and diagrams; updates must accompany code changes that impact behavior.
Each command ships with a doc page referencing specification anchors (e.g., FR-004) so requirement traceability stays intact even as implementation details evolve.
Training materials describe how to configure git credentials, set up pnpm and Node 20, enable optional Docker-based workflows, and interpret structured logs for debugging.
Documentation emphasizes hands-on snippets: sample install sessions, rollback transcripts, feature flag toggling examples, and metrics scraping walkthroughs.
A living glossary ensures terms like "transaction boundary", "cache promotion", or "lifecycle sandbox" have precise definitions, preventing miscommunication between architects and implementers.
Markdown files use doctoc for table-of-contents generation and markdownlint for consistent style; CI enforces both to maintain readability.
Operational notes highlight security expectations, such as verifying plugin permission reasons or double-checking lifecycle scripts before trusting them.
Video walkthroughs or terminal recordings may be stored as GitHub issue attachments or release assets, but transcripts must accompany them for accessibility and searchability.
Documentation review occurs alongside code review: pull requests cannot merge unless associated docs are updated or explicitly deferred via a tracked issue referencing the relevant requirement ID.
Quarterly reviews revisit documentation, ensuring stale guidance does not mislead future contributors and that new assumptions get recorded in the safety net section.

<!-- anchor: 3-13-scaling-pathways -->
### 3.13 Scaling Pathways
Scaling focuses on process and tooling rather than server fleets because the CLI runs locally; improvements center on caching efficiency, modularization, and automation.
Short term, scaling introduces additional CLI packages (e.g., `telemetry` or `analysis`) carved out from the monolith while respecting the layered architecture so teams can work independently without collisions.
Medium term, Docker-compose files could simulate multi-user scenarios, letting developers test marketplace synchronization or mirror experiments without hitting production GitHub data.
Feature flags already gate advanced discovery journeys, meaning enabling them for pilot users provides data before fully rolling out functionality.
If concurrent installs become necessary, a queue manager could serialize transactions or implement optimistic concurrency with lock files stored under `.claude-plugin/locks/`.
Future remote mirrors would live behind the `experimentalMirrorSync` flag, replicating marketplace data to additional git repositories; operations would document synchronization cadence, conflict resolution, and rollback strategies.
Scalability also involves cross-platform testing: GitHub Actions matrix builds across Linux, macOS runners, and Windows via WSL confirm CLI behavior remains consistent as adoption widens.
Operational automation might eventually package CLI releases into signed binaries or provide Homebrew taps, but Phase 1 remains npm-focused to limit supply-chain risk.
Should plugin volume balloon, caching policies could switch from "last three versions" to LRU across plugins, and metrics would guide the threshold adjustments.
Scaling decisions always return to the medium-scale directive: prioritize proven workflows, keep dependencies minimal, and document interfaces so future services can emerge without rewriting the CLI core.

<!-- anchor: 3-14-operational-faq -->
### 3.14 Operational FAQ
**What happens if a lifecycle script fails after activation?** The CLI halts, reports the exit code, reverses the symlink to the previous version, replays uninstall hooks if defined, and logs the incident with `ERROR-LIFE-00x`, ensuring the system remains consistent.
**How are conflicting installs resolved?** If a plugin is already active, the installer offers choices (upgrade, downgrade, reinstall) while referencing CRIT-010 instructions; user selections are logged along with resulting registry updates.
**Can cache directories be relocated?** Yes; the `cacheRoot` config option in `config.ts` lets users move `.claude-plugin/cache` to faster disks, and migrations happen automatically with checksum verification and audit logging.
**How are deprecated plugins surfaced?** Browse and search commands display warning banners, require explicit confirmation before installs, and annotate registry entries with `deprecatedSince`, making it easy to audit riskier selections.
**What if GitHub is unreachable?** The CLI encourages using cached data, warns about stale indexes, and provides commands to verify local integrity until network access returns; once available, it replays pending validations automatically.
**How are schema updates rolled out?** Schema version bumps increment file headers, the CLI bundles migration routines, documentation calls out breaking changes, and GitHub Actions ensures contributors update their manifests before merging.
**What supports multi-machine setups?** Registry export/import commands serialize `.claude-plugin/` metadata, enabling developers to synchronize caches or share setups between workstations without manual copying.
**How do operators test feature flags safely?** They duplicate the repository, enable flags locally, run validation commands, and review structured logs; feature flag status indicators appear in CLI banners to prevent forgetting an active experiment.
**How is performance optimized?** Profiling toggles behind a feature flag collect CPU and IO timings, writing results to `profiles/*.json`; maintainers analyze them to detect slow schema validations or inefficient file copies.
**Who approves operational changes?** Pull requests referencing operational docs must tag the Operational Architect for review, guaranteeing new runbooks or automation scripts align with the foundation's directives and traceability requirements.

<!-- anchor: 3-15-toolchain-integration -->
### 3.15 Toolchain Integration & Automation Hooks
Automation hooks integrate with editors and scripts so operational workflows stay ergonomic even as complexity grows.
VS Code tasks reference pnpm scripts, enabling single-key execution of build, test, and validate commands; these tasks also inject correlation IDs for local observability parity.
Git hooks (pre-commit, pre-push) run schema validation and linting to catch errors before CI, and they can block commits unless bypassed explicitly with documented rationale.
A `scripts/bootstrap.sh` file installs pnpm, verifies Node version, configures git hooks, and initializes `.claude-plugin/` scaffolding, reducing onboarding friction for new contributors.
Task runners like `just` or npm scripts orchestrate multi-step operations (e.g., `validate:full` runs linting, unit tests, integration tests, schema validation, and metrics export) so human error does not derail reproducibility.
The CLI exposes a machine-readable status command that outputs environment health, feature flag states, cache statistics, and git status; external monitoring tools or shell prompts can parse it for quick checks.
Integration with GitHub Issues uses templates that require referencing requirement IDs, linking logs, and citing impacted commands, ensuring ticket triage stays aligned with documentation and traceability.
Scripts for generating docs (typedoc, doctoc, markdownlint) run inside Docker to ensure identical results regardless of local platform quirks; failure logs include reproduction steps for consistent debugging.
When releasing, automation updates version numbers, regenerates docs, rebuilds Docker images, and pushes git tags, minimizing manual steps that could introduce inconsistencies.
Future integrations might include shell completions, telemetry uploaders, or plugin marketplaces, but they will follow the same operational guardrails: feature flags, documentation updates, and deterministic scripts.

<!-- anchor: 3-16-operational-kpis -->
### 3.16 Operational KPIs & Review Cadence
Quarterly operational reviews examine KPIs such as install success rate, average rollback duration, cache eviction frequency, and doc update latency, ensuring continuous improvement.
`Install Success Rate` measures successful installs divided by attempts per release; the target remains ≥ 99%, and deviations trigger root-cause analysis documented in postmortems.
`Rollback Duration` tracks time between rollback command start and registry restoration; maintaining < 60 seconds verifies cache efficacy and symlink discipline.
`Cache Eviction Frequency` monitors automatic prunes; sudden spikes suggest mis-sized cache thresholds or unusually large plugin packages requiring tailored policies.
`Doc Update Latency` measures days between code changes merging and associated documentation updates; the goal is ≤ 2 days to keep knowledge fresh.
Monthly review meetings (or asynchronous docs) summarize KPI trends, discuss upcoming feature flag graduations, and capture new risks or assumptions for the safety net ledger.
These reviews also audit audit logs, verifying lifecycle script confirmations and sandbox exit codes align with security expectations.
Action items from reviews become GitHub issues referencing requirement IDs, ensuring accountability and traceability across release cycles.

<!-- anchor: 3-17-dependency-governance -->
### 3.17 Dependency Governance
Dependency governance enforces strict version pinning via pnpm lockfiles and Renovate-style workflows that batch updates for review, preventing surprise upgrades from breaking operational guarantees.
All npm dependencies require SPDX license review documented in `docs/legal/dependencies.md`, and new additions must justify why built-in Node modules or existing packages cannot satisfy the requirement.
Node 20 LTS remains mandatory until the foundation document is amended; scripts verify the runtime version and halt execution if a different major release is detected.
Docker images mirror the dependency governance by pinning base image digests and capturing them in release notes so future rebuilds can reproduce the exact environment even if upstream tags change.
Third-party CLI tools (git, unzip, tar) must meet minimum versions recorded in the bootstrap script; CI validates versions to align local and remote behavior.
When vulnerabilities appear, security advisories reference impacted dependencies, remediation plans, and expected release timelines, ensuring transparent operational governance.

<!-- anchor: 3-18-change-control -->
### 3.18 Operational Change Control
Change control mandates that every operational modification references a GitHub issue describing scope, risks, rollback plan, and traceability links to specification requirements.
Pull requests require dual approval: one reviewer for code correctness and one for operational/documentation accuracy, even on a solo project, by using self-review checklists stored in `docs/reviews/`.
Change logs summarize operational impacts, highlighting new commands, deprecated flags, cache format adjustments, or documentation migrations so users can adapt quickly.
Emergency fixes follow a lightweight protocol: branch from the last release tag, apply targeted corrections, run the validation pipeline, publish an annotated tag, and document the incident within twenty-four hours.
Post-change monitoring ensures metrics, logs, and user feedback confirm the intended behavior; if anomalies appear, the change is rolled back via git revert plus cache restoration steps outlined earlier.
