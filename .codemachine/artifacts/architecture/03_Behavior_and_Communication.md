<!-- anchor: 3-0-proposed-architecture-behavioral-view -->
## 3. Proposed Architecture (Behavioral View)

*   **3.7. API Design & Communication:**
    *   **API Style:** CLI-first command contracts follow the command schemas defined for install, update, rollback, browse, search, publish, pin, check-updates, and uninstall flows.
        yargs dispatchers interpret every command definition and emit structured JSON envelopes that the domain interfaces can consume without touching process globals.
        Each CLI entrypoint exposes a declarative schema where options, positional arguments, and environment fallbacks are typed so that downstream services can rely on deterministic shapes.
        Commands express their payloads through JSON documents stored under `docs/contracts/`, ensuring that implementers across packages can reason about requests and responses without extra adapters.
        Request payloads align tightly with the MarketplaceIndex, PluginEntry, PluginManifest, and InstalledPluginRegistry entities, preventing accidental divergence between user input and domain state.
        The CLI captures `correlationId`, `command`, `pluginId`, and `transactionId` fields as part of the top-level envelope before handing control to the domain service boundary.
        Structured JSON logs emitted to stdout share the same envelope definition so that telemetry consumers and audit reviewers can replay command history deterministically.
        The CLI intentionally serializes payloads into domain DTOs before invoking services to uphold the cross-layer import restrictions mandated by the layered monolith style.
        Each command implements Feature Flag preflights, gating high-risk operations via `.claude-plugin/flags.json` values and ensuring the contract includes `flagEvaluations[]` for traceability.
        Validation-focused commands embed schema references, meaning the CLI attaches `$schema` URIs in the request metadata so the Plugin Metadata Validator knows which Draft-07 variant to load.
        Install and update commands ship `compatibilityIntent` objects summarizing OS, arch, Node, and Claude Code context derived from the local host, creating a reproducible snapshot for the compatibility engine.
        Publish and pin commands attach Git provenance objects containing repo URL, current commit, dirty flag, and remote-tracking status to uphold the git-native requirement.
        Browse and search commands provide pagination cursors and deterministic sorting parameters but never mutate system state, keeping their DTOs read-only and cache-friendly.
        Rollback and uninstall commands require `targetVersion`, `cachePreference`, and `confirmationToken` fields so that the Install Transaction Orchestrator can replay atomic sequences confidently.
        All commands define explicit result envelopes with `status`, `errorCode`, `messages[]`, and `artifacts[]`, and success responses embed snapshots of the InstalledPluginRegistry deltas produced.
        The CLI routes success, warning, and failure states through typed discriminated unions, preventing downstream clients from relying on string matching or position-based parsing.
        Command schemas mandate that lifecycle scripts cannot execute until the request envelope contains `scriptReviewDigest`, proving that the CLI surfaced the hook contents to the user.
        API style decisions ensure that no hidden RPCs exist; everything routes through a predictable command invocation triggered by a local operator following the documented contract.
        Since the foundational directive bans GUI layers, the CLI contract doubles as the public API, meaning automation scripts can safely pipe JSON requests into the CLI using stdin.
        The CLI also exposes dry-run flags that switch result envelopes into `diagnosticOnly` mode, allowing installers to rehearse compatibility decisions before mutating cache directories.
        Undo semantics are expressed by including `rollbackPlan` arrays in the install request envelope, giving the orchestrator explicit steps to follow if any downstream adapter fails.
        Observability requirements push the CLI to attach `logLevel` preferences and `metricsConsent` booleans per request, letting operators control verbosity without editing global config files.
        The CLI serializes `timestamp`, `timezone`, and `locale` metadata into each envelope so telemetry dashboards can remain coherent across different machines and daylight savings transitions.
        Request envelopes integrate `securityContext` descriptions referencing the permission disclosure model, ensuring each install attempt logs the difference between declared and enforced permissions.
        For update flows, the CLI transmits both the currently installed manifest digest and the candidate manifest digest, enabling diff-based telemetry generation downstream.
        Publish commands encapsulate `releaseNotesPath`, `signature`, and `releaseChannel` fields to keep the documentation and CI triggers aligned with the specification's structured release cadence.
        Pinning commands include `pinScope`, `pinPriority`, and `pinExpiry` data so the registry can coordinate deterministic upgrade decisions across future sessions.
        Uninstall commands wrap `cacheRetentionPolicy` and `symlinkTombstone` options, letting the orchestrator know exactly how aggressively to clean caches and whether to leave audit breadcrumbs.
        Search commands optionally embed `telemetryOptIn` toggles, enabling experimentation without forcing data collection when operators prefer offline modes.
        The CLI contract insists that `--output json` remains the canonical rendering; human-readable summaries printed to stderr are derived from the JSON envelope rather than introducing parallel code paths.
        Command implementations reference FR-004 through FR-008 as traceability tags within the schema definitions to meet the documentation and auditability mandates.
        Schema metadata includes `version`, `lastUpdated`, and `approvalSignature` fields, mirroring the specification's emphasis on version control and change tracking.
        Each command exposes `retryToken` identifiers to prevent duplicate operations when operators rerun commands after transient failures.
        Install requests also carry `changelogExpectation` objects that direct the CLI to either fetch, skip, or fallback to cached changelog metadata before proceeding.
        Compatibility-focused commands include `policyOverrides` arrays that record which optional warnings the operator chose to ignore, enabling the compliance engine to log decisions.
        The CLI API style enforces `--config` overrides that feed into the centralized `config.ts` module, ensuring contract-driven configuration resolution before the domain boundary.
        Lifecycle confirmations embed `consentPhrase`, `scriptType`, and `scriptDigest`, satisfying CRIT-004 by proving the typed confirmation occurred.
        Update flows integrate `deltaStrategy` settings describing whether the orchestrator should stage files via rsync, full copy, or cached diff approach.
        Rollback commands provide `fallbackOrder[]` arrays listing versions to attempt if the primary target is unavailable, aligning with the cache-dependent rollback limitation clarifications.
        Each command envelope tracks `cacheStateSummary` data referencing used disk space, last eviction timestamp, and pinned versions to keep the cache manager's decisions transparent.
        Publish requests include `validationMatrix` attachments referencing schema versions, linting rules, and tests executed locally before pushing to the marketplace.
        The CLI maintains `documentationLinks[]` within responses so documentation tooling can automatically hyperlink error codes back to SPECIFICATION anchors.
        Install commands optionally specify `sandboxProfile` selections, instructing the lifecycle sandbox about CPU, memory, and timeout budgets backed by configuration defaults.
        For atomicity, the CLI also marshals `transactionChecklist` arrays enumerating each stage, allowing the orchestrator to log step-level successes and failures consistently.
        Requests originating from automation pipelines can embed `automationContext` metadata, clarifying whether the invocation is interactive, CI-driven, or part of a smoke test.
        The API style rejects hidden global state by forcing every command to pass the `workspaceRoot` explicitly when different repositories need to be managed in parallel.
        Commands include `gitStatusDigest` snapshots recorded prior to mutation so that rollback sequences can restore the repository to a known-safe baseline if needed.
        Every envelope stores `schemaVersion` plus `minimumCliVersion`, allowing compatibility checks between CLI releases and stored requests.
        The CLI modeling also ensures that errors always present `errorCategory`, `severity`, and `nextActions[]`, preventing ambiguous remediation instructions.
        Feature flags embedded in the envelope log whether each capability is `enabled`, `disabled`, or `forced`, supporting compliance audits for experimental features.
        The CLI commands include `cancellationSignal` metadata for future asynchronous expansions even though the current implementation executes sequentially.
        Result envelopes embed `installedPlugins[]` snapshots capturing pluginId, version, checksum, and symlink target, aligning responses with the InstalledPluginRegistry schema.
        Responses also provide `cacheChanges[]` records showing bytes added or evicted plus the rationale to maintain deterministic cache accountability.
        Publish responses list the updated marketplace entries, commit IDs, and any generated PR or tag references, reinforcing the git-native workflow.
        Each command concludes with `documentationAnchor` references, ensuring that CLI output points back to the SPECIFICATION, traceability matrix, or adversarial review entry that governs the behavior.
    *   **Communication Patterns:** The CLI Command Layer orchestrates synchronous request/response flows with every domain service, respecting the layered monolith rule that upward dependencies never leak.
        Command handlers immediately consult the Feature Flag evaluator before doing anything else, short-circuiting the request if the relevant capability is disabled.
        Once a command is authorized, the CLI queries the Config module, which acts as a synchronous provider of typed settings drawn from `.claude-plugin/config.json`, environment variables, and CLI overrides.
        The CLI then streams log context into the Telemetry & Audit Logger, establishing the correlation ID that all downstream calls must include.
        For discovery flows, the CLI consults the Marketplace Index Manager, which in turn performs local file reads or git fetches to acquire the latest `marketplace.json` before returning parsed entries.
        The Marketplace Index Manager validates the index via AJV by delegating to the Plugin Metadata Validator's schema cache, ensuring consistent Draft-07 handling.
        Search and browse commands rely on synchronous iteration over the cached index, meaning the CLI simply requests filtered views without additional network hops.
        Install and update flows start by asking the Marketplace Index Manager for the selected PluginEntry, retrieving metadata such as latest version, checksum, and manifest path.
        The CLI forwards the PluginEntry plus the local configuration context to the Plugin Metadata Validator, which validates the referenced `plugin.json` manifest before any file operations occur.
        The Plugin Metadata Validator emits typed `ValidationResult` objects containing severity, errorCode, and fix suggestions, letting the CLI decide whether to halt or continue.
        When validation succeeds, the CLI packages compatibility inputs and syncs with the Compatibility & Policy Engine, which produces a `CompatibilityVerdict` with states `compatible`, `warn`, or `block`.
        If the verdict is `warn`, the CLI prompts for confirmation but still treats the interaction as synchronous; no asynchronous queue is introduced.
        After compatibility passes, the CLI notifies the Cache & Storage Manager to allocate staging space, a synchronous call returning the path to a temp directory.
        The Install Transaction Orchestrator then coordinates actual file transfers, invoking infrastructure adapters that fetch plugin artifacts, verify checksums, and populate staging directories.
        Lifecycle Script Sandbox interactions occur only after files are staged and validated; the orchestrator hands the sandbox the script content, digest, environment map, and timeout budget.
        The sandbox executes scripts in subprocesses, returning structured results that include exit code, stdout, stderr, duration, and any flagged security anomalies.
        Upon sandbox completion, the orchestrator either promotes staged files to the cache or rolls back depending on script outcomes, always logging each step via the Telemetry & Audit Logger.
        Cache promotion triggers the Cache & Storage Manager to update its ledger, enforce the 500 MB ceiling, and report any evictions triggered by the new artifact.
        Symlink activation occurs once the cache entry is finalized; the Symlink Activation Layer receives the target path, plugin metadata, and desired activation policy to create or update symlinks atomically.
        Should symlink creation fail, the Symlink Activation Layer publishes an error with rollback instructions so the orchestrator can revert to the previous symlink state.
        After activation, the CLI updates the InstalledPluginRegistry by delegating to an infrastructure adapter that writes the registry JSON using temp files plus rename semantics.
        The Telemetry & Audit Logger captures the final state, bundling the request, verdicts, cache changes, and any lifecycle transcript for downstream analytics.
        For rollback flows, the CLI begins by consulting the InstalledPluginRegistry to identify candidate versions, verifying cache availability, and retrieving prior lifecycle consent records.
        The Install Transaction Orchestrator replays the recorded `transactionChecklist`, invoking the Cache & Storage Manager to materialize the desired version while logging each stage.
        Uninstall commands coordinate with the Lifecycle Script Sandbox first, ensuring `lifecycle.uninstall` executes with the same sandboxing protections used during install.
        After uninstall scripts finish, the orchestrator instructs the Symlink Activation Layer to remove or repoint symlinks, followed by cache cleanup per policy.
        Publish flows pivot toward git interactions; the CLI requests the Plugin Metadata Validator to confirm manifest compliance, then leverages shell helpers to commit and push marketplace index changes.
        During publish, documentation generation hooks notify the Ops_Docs tooling through file writes rather than network calls, adhering to the git-native persistence directive.
        Pin commands interact with the InstalledPluginRegistry to set `activePins[]`, and the Compatibility Engine references these pins when evaluating auto-update eligibility.
        Check-updates commands schedule sequential compatibility evaluations across all installed plugins, caching verdicts to avoid repeated work until something changes.
        Error handling remains synchronous; if any adapter returns a failure, the orchestrator triggers rollback steps immediately rather than queuing compensating actions.
        Observability pipelines rely on structured log streaming; each component logs through a shared logger but adds component-specific fields such as cachePath, scriptDigest, or schemaVersion.
        Metrics collection occurs via counters and histograms updated by each component; the CLI can request a metrics snapshot through a dedicated command, but the underlying interactions still occur synchronously.
        Feature flag evaluations use a read-only JSON file; once loaded, the results are memoized for the duration of the command to keep evaluations deterministic.
        Configuration resolution merges CLI arguments, environment variables, and config files; the Config module exposes typed getters, and the CLI never reads environment variables directly.
        Schema validation reuses cached AJV instances provided by the Plugin Metadata Validator, preventing redundant schema compilation and preserving performance budgets.
        Compatibility checks involve deterministic evaluation of OS, arch, Node.js, and Claude compatibility; results include a list of evidence statements logged for review.
        Cache eviction decisions emit `EvictionDecision` events to the Telemetry & Audit Logger so future rollback operations can explain why requested versions are unavailable.
        Symlink activation uses atomic rename semantics; before updating, it creates a new symlink and then swaps pointers, with failure causing automatic rollback to the previous symlink.
        Lifecycle script execution enforces `I TRUST THIS SCRIPT` confirmations stored in the LifecycleScriptRecord; sandbox refusal occurs if the digest does not match the previously reviewed content.
        Telemetry logs differentiate between user-initiated commands and CI-triggered validations by capturing the `automationContext` field in every record.
        CI validation uses the same communication patterns but runs inside GitHub Actions, where the CLI is invoked by workflow steps and outputs structured logs as job artifacts.
        Duplicate detection and dependency scans run sequentially inside the CI validation runner, invoking the Plugin Metadata Validator and Marketplace Index Manager without user prompts.
        When browsing or searching offline, the CLI uses the cached marketplace file and attaches a `staleIndex` flag if the git commit hash is older than the configured stale threshold.
        The Compatibility Engine depends on host introspection from the infrastructure layer, which returns OS, architecture, and Node.js info in a synchronous call.
        Cache & Storage Manager interacts with the filesystem via infrastructure adapters that ensure writes are atomic and concurrency-safe even though commands run sequentially.
        InstalledPluginRegistry updates bundle transaction IDs so that later commands can reference them when building rollback narratives.
        For rollback operations lacking cached artifacts, the CLI triggers documented fallback flows that prompt the user to fetch older versions from git or the marketplace.
        Communication flows intentionally avoid background threads, aligning with the medium-scale directive favoring clarity over concurrency.
        Temporal ordering is documented; each orchestration step logs `start`, `finish`, and `duration`, ensuring audits can reconstruct the precise timeline.
        When permissions or lifecycle scripts change, the Plugin Metadata Validator returns `consentRequired` flags, prompting the CLI to re-display scripts even if the plugin was previously trusted.
        Dependency conflicts between plugins are handled by the Compatibility Engine, which inspects InstalledPluginRegistry state and returns actionable conflict reports.
        The CLI caches compatibility verdicts per plugin version, and subsequent commands reuse cached verdicts until environment data changes.
        Publish flows produce git diffs and require manual confirmation before pushing; these diffs are shared with the Telemetry & Audit Logger for accountability.
        When commands run with `--dry-run`, downstream services operate in simulation mode, returning predicted state changes but refusing to mutate files or caches.
        Error scenarios reference the canonical 23 error codes, and each component maps local failure reasons to those codes before bubbling messages up.
        Validation scripts invoked during CI mirror local CLI behavior but stream logs to GitHub artifacts, making remote debugging consistent with local diagnostics.
        Documentation generation listens for command completion events and reads structured logs rather than relying on ad-hoc output parsing.
        Observability components also capture environment fingerprints such as Node.js version and CLI version, ensuring compatibility regressions are diagnosable.
        Performance guardrails rely on instrumentation toggled by feature flags; when enabled, the CLI records per-step durations and writes them to a metrics snapshot file.
        Config-driven feature flags support staged rollouts by enabling experimental commands on a per-user basis, with evaluations recorded in the Telemetry stream.
        When multiple components must coordinate, the Install Transaction Orchestrator acts as the central mediator, invoking each collaborator sequentially while retaining rollback authority.
        Data integrity flows require checksum verification before caching artifacts; the orchestrator obtains checksums from the PluginEntry and cross-checks them post-download.
        Git interactions rely on `zx` helpers; command handlers call shell helpers with sanitized arguments, capturing stdout/stderr and returning typed results.
        If git operations fail, the CLI surfaces the native git error while also wrapping it in an `ERROR-PUBLISH-*` or `ERROR-SYNC-*` code as specified.
        The Marketplace Index Manager monitors git commit hashes; when a new commit is detected, it revalidates the index and notifies the CLI about possible drift.
        Plugin Manifest validation caches schema compilation results keyed by schema version, providing deterministic performance under repeated commands.
        Search ranking uses deterministic sorting (category, plugin name, semantic version), and the CLI logs the comparator decisions for transparency.
        Cache eviction respects pins; the Cache & Storage Manager consults the InstalledPluginRegistry's `activePins[]` before deleting any cached versions.
        When telemetry upload is requested, the CLI writes JSON snapshots for later collection instead of transmitting data live, keeping the system offline-friendly.
        Sequence flows for install and rollback share the same orchestrator code path, reducing branching while still logging the role of each stage.
        The CLI ensures that each domain service receives immutable DTOs, preventing downstream components from mutating requests and causing hidden coupling.
        Observability includes structured JSON logs plus optional human-readable summaries, but only the JSON variant is considered authoritative for automation.
        Error documentation anchors are inserted into logs as `docAnchor` fields, allowing other architects to cross-reference the SPECIFICATION automatically.
        Every interaction concludes with the CLI persisting audit artifacts under `.claude-plugin/audit/`, ensuring that behavior-level documentation remains available offline.
    *   **Key Interaction Flow (Sequence Diagram):**
        *   **Description:** The diagram narrates the critical install journey where the CLI Command Layer installs a new plugin from the curated marketplace.
            The flow begins the moment a developer issues `cli install <pluginId>`, prompting the command handler to initialize telemetry context.
            The CLI fetches the latest marketplace index and validates the selected PluginEntry before proceeding.
            It then validates the plugin manifest and compatibility boundaries so that unsupported environments are rejected early.
            After validation, the Install Transaction Orchestrator allocates staging space, downloads the plugin artifact, and enforces checksum verification.
            The Lifecycle Script Sandbox shows lifecycle scripts, requires typed confirmation, and executes hooks with sandboxed resource guarantees.
            Cache & Storage Manager promotes the staged artifact into the shared cache while enforcing capacity ceilings and eviction policies.
            Symlink Activation Layer switches the active plugin pointer using atomic rename semantics.
            Telemetry & Audit Logger records each stage with the correlation ID, ensuring traceability for audits and adversarial review follow-ups.
            The flow also illustrates error hand-offs; when any participant reports failure, the orchestrator invokes rollback sequences and documents the error code.
            Compatibility & Policy Engine participates twice, first to block incompatible versions and later to log final compatibility outcomes for analytics.
            The diagram portrays how Marketplace Index Manager and Plugin Metadata Validator feed upstream data into the orchestrator without ever bypassing the domain contracts.
            Cache interactions highlight eviction notifications that keep rollback logic aware of available versions.
            Lifecycle Script Sandbox documents user consent and shares script digests with Telemetry to satisfy CRIT-004 requirements.
            Telemetry & Audit Logger persists a summary object containing request metadata, compatibility verdicts, lifecycle transcripts, cache actions, and symlink operations.
            The Install Transaction Orchestrator ensures rollback instructions accompany every external effect, even though the diagram focuses on the success path.
            Marketplace Index Manager surfaces the plugin's changelog URL, allowing the CLI to display release notes during installation.
            Plugin Metadata Validator attaches schema version information to its response so the CLI can cite it when logging validation success.
            Compatibility & Policy Engine logs policy overrides if the operator chooses to proceed despite warnings.
            Cache & Storage Manager provides disk usage telemetry, letting the CLI warn when the cache nears the 500 MB limit.
            Symlink Activation Layer records previous and new symlink targets to ensure the CLI can revert accurately.
            Telemetry & Audit Logger writes audit files referencing SPECIFICATION anchors for each command stage.
            The flow demonstrates how the CLI remains the sole orchestrator, calling each component sequentially and handling rollbacks internally.
            Lifecycle Script Sandbox reports environment sanitization details, confirming that only allowed variables were exposed.
            Cache manager notes when eviction occurs as a result of inserting the new plugin, providing transparency around rollback viability.
            The diagram also shows Telemetry receiving completions to finalize metrics counters required by the observability rulebook.
            CLI ensures that the InstalledPluginRegistry update happens only after symlink activation completes.
            Compatibility Engine returns final verdicts that include `compatibleSince` timestamps for historical tracking.
            The orchestrator merges all component outputs into the final response envelope returned to the operator.
            Failure branches propagate `errorCode` and `recoverySteps`, enabling the CLI to message users with actionable instructions.
            The flow cements how structured interactions uphold FR-001 through FR-010 requirements for install reliability.
            It captures atomic staging boundaries demanded by CRIT-001, demonstrating that caches are updated only after every check passes.
            It reiterates that lifecycle hooks cannot execute without user consent and sandbox confirmation, closing the loop on CRIT-004.
            The diagram also communicates that Telemetry finalization is mandatory, ensuring the audit trail remains complete even if downstream tasks succeed or fail.
        *   **Diagram (PlantUML):**
            ~~~plantuml
            @startuml
            title Install Command Interaction Flow
            ' Sequence ensures components align with foundation
            participant "CLI Command Layer" as CLI
            participant "Marketplace Index Manager" as MIM
            participant "Plugin Metadata Validator" as PMV
            participant "Compatibility & Policy Engine" as CPE
            participant "Install Transaction Orchestrator" as ITO
            participant "Cache & Storage Manager" as CSM
            participant "Lifecycle Script Sandbox" as LSS
            participant "Symlink Activation Layer" as SAL
            participant "Telemetry & Audit Logger" as TAL
            ' Preflight preparation captured for audits
            == Preflight Context Initialization ==
            CLI -> TAL : initSession(correlationId,command="install")
            TAL --> CLI : sessionAck
            CLI -> CLI : loadConfigAndFlags()
            CLI -> MIM : requestIndex(currentCommit)
            MIM -> MIM : checkCacheFreshness()
            MIM -> CLI : indexSnapshot(version,staleFlag)
            CLI -> PMV : preflightValidateIndexSignature(indexSnapshot)
            PMV --> CLI : indexSignatureStatus(ok)
            CLI -> CLI : selectPluginEntry(pluginId)
            ' Index sync ensures deterministic discovery
            == Marketplace Entry Acquisition ==
            CLI -> MIM : fetchPluginEntry(pluginId)
            MIM -> MIM : verifyEntryAgainstSchema()
            MIM --> CLI : pluginEntry(metadata,checksum)
            CLI -> TAL : logEvent(stage="entry-resolved")
            TAL --> CLI : logged
            ' Manifest validation protects schema fidelity
            == Manifest Validation Sequence ==
            CLI -> PMV : validateManifest(pluginEntry.manifestPath)
            PMV -> PMV : loadSchema(pluginSchemaVersion)
            PMV -> PMV : runDraft07Validation()
            PMV -> CLI : manifestValidated(result=pass,docAnchor="FR-002")
            CLI -> TAL : logEvent(stage="manifest-pass")
            TAL --> CLI : logged
            ' Compatibility analysis ensures safe installs
            == Compatibility Evaluation ==
            CLI -> CPE : evaluateCompatibility(pluginEntry,hostFingerprint)
            CPE -> CPE : compareOSArchitecture()
            CPE -> CPE : compareNodeRange(nodeMin,nodeMax)
            CPE -> CPE : checkClaudeVector()
            CPE -> CLI : verdict(state="compatible",warnings=[])
            CLI -> TAL : logEvent(stage="compatibility",verdict="compatible")
            TAL --> CLI : logged
            ' Transaction orchestrator takes control after approvals
            == Transaction Preparation ==
            CLI -> ITO : beginTransaction(pluginEntry,verdict)
            ITO -> CSM : allocateStaging(pluginId,version)
            CSM -> CSM : reserveTempDirectory()
            CSM --> ITO : stagingAllocated(path)
            ITO -> TAL : logEvent(stage="staging-ready")
            TAL --> ITO : logged
            ' Artifact retrieval uses git-native fetch helpers
            ITO -> ITO : fetchArtifact(repo,manifestPath)
            ITO -> ITO : verifyChecksum(expectedChecksum)
            ITO -> TAL : logEvent(stage="artifact-downloaded")
            TAL --> ITO : logged
            ' Lifecycle scripts demand consent before execution
            == Lifecycle Script Review ==
            ITO -> LSS : presentScripts(pluginEntry.lifecycle)
            LSS -> CLI : requestConsent(summary,scriptDigest)
            CLI -> CLI : displayScriptToOperator()
            CLI -> LSS : provideConsent(phrase="I TRUST THIS SCRIPT")
            LSS -> LSS : sanitizeEnvironment(allowedVariables)
            LSS -> ITO : consentRecorded(recordId)
            ITO -> LSS : executeScript(type="preInstall",timeoutPolicy)
            LSS -> LSS : runSandboxedProcess()
            LSS --> ITO : scriptResult(success,exitCode=0,duration)
            ITO -> TAL : logEvent(stage="scripts",status="success")
            TAL --> ITO : logged
            ' Cache promotion occurs only when scripts succeed
            == Cache Promotion ==
            ITO -> CSM : promoteToCache(stagingPath)
            CSM -> CSM : calculateCacheImpact(bytes)
            CSM -> CSM : enforceEvictionPolicy(lastThreeVersions,500MB)
            CSM --> ITO : cachePromotion(status="complete",evictions=maybe)
            ITO -> TAL : logEvent(stage="cache-promotion",evictions)
            TAL --> ITO : logged
            ' Symlink activation ensures deterministic switching
            == Symlink Activation ==
            ITO -> SAL : activatePlugin(pluginId,cachePath)
            SAL -> SAL : createNewSymlink(target)
            SAL -> SAL : swapSymlinkAtomically()
            SAL --> ITO : activationResult(status="active")
            ITO -> TAL : logEvent(stage="symlink",status="active")
            TAL --> ITO : logged
            ' Registry update closes the transaction loop
            == Registry Update ==
            ITO -> ITO : updateInstalledPluginRegistry(pluginId,version)
            ITO -> TAL : logEvent(stage="registry-update")
            TAL --> ITO : logged
            ' Post-install compatibility check logs final verdict
            ITO -> CPE : confirmCompatibilityRecorded(pluginId,version)
            CPE --> ITO : confirmationAck
            ITO -> TAL : logEvent(stage="compatibility-finalized")
            TAL --> ITO : logged
            ' Lifecycle postInstall hook executes with same protections
            == Post-Install Lifecycle Execution ==
            ITO -> LSS : executeScript(type="postInstall")
            LSS -> LSS : runSandboxedProcess()
            LSS --> ITO : scriptResult(success,exitCode=0)
            ITO -> TAL : logEvent(stage="post-install-script")
            TAL --> ITO : logged
            ' Telemetry finalization ensures auditability
            == Telemetry Finalization ==
            ITO -> TAL : finalizeTransaction(transactionId)
            TAL -> TAL : persistAuditArtifacts(indexSnapshot,manifestDigest)
            TAL -> TAL : persistLifecycleTranscript(scriptDigests)
            TAL -> TAL : persistCacheReport(cacheUsage)
            TAL --> ITO : auditComplete
            ITO --> CLI : transactionSummary(status="success")
            CLI -> TAL : logEvent(stage="cli-summary")
            TAL --> CLI : logged
            ' Result envelope delivered to the operator
            CLI -> CLI : buildResponseEnvelope()
            CLI -> TAL : logEvent(stage="response-ready")
            TAL --> CLI : logged
            CLI -> CLI : printJsonResult()
            ' Error handling branch placeholder for clarity
            == Failure Handling Example ==
            CLI -> ITO : requestRollbackIfNeeded(errorDetected?)
            ITO -> CSM : restorePreviousCacheVersion()
            CSM --> ITO : cacheRestored(status)
            ITO -> SAL : revertSymlink(previousTarget)
            SAL --> ITO : revertComplete
            ITO -> TAL : logEvent(stage="rollback",result)
            TAL --> ITO : logged
            ITO --> CLI : rollbackSummary(errorCode)
            CLI -> TAL : logEvent(stage="rollback-report")
            TAL --> CLI : logged
            ' Diagram also highlights eviction telemetry
            == Cache Telemetry Loop ==
            CSM -> TAL : reportEviction(pluginId,evictedVersion)
            TAL --> CSM : evictionLogged
            CSM -> ITO : notifyEvictionResult(evictedVersion)
            ITO -> CLI : warnAboutRollbackLimit(evictedVersion)
            ' Lifecycle consent record persistence
            == Lifecycle Audit ==
            LSS -> TAL : storeConsentRecord(pluginId,scriptDigest)
            TAL --> LSS : consentStored
            ' Compatibility override logging ensures compliance
            == Policy Override Logging ==
            CPE -> TAL : recordPolicyOverride(pluginId,warningsAcknowledged)
            TAL --> CPE : overrideLogged
            ' Marketplace index freshness warning path
            == Index Freshness Handling ==
            MIM -> CLI : warnIfIndexStale(staleFlag)
            CLI -> TAL : logEvent(stage="index-stale-check",staleFlag)
            TAL --> CLI : logged
            ' Documentation anchor propagation across components
            == Documentation Anchors ==
            CLI -> TAL : attachDocAnchor(anchor="SPEC-KIY-MKT-001:FR-004")
            TAL --> CLI : anchorStored
            ' Transaction closure indicates completion
            == Completion ==
            CLI -> TAL : closeSession(correlationId)
            TAL --> CLI : sessionClosed
            @enduml
            ~~~
    *   **Data Transfer Objects (DTOs):** InstallCommandRequest DTO mirrors the CLI envelope, containing `command`, `pluginId`, `versionHint`, `compatibilityIntent`, `flagEvaluations[]`, and `securityContext`.
        The `compatibilityIntent` object stores `os`, `arch`, `nodeVersion`, `claudeVersion`, and `policyOverrides[]`, all derived from the host fingerprint provider.
        Install requests also embed `changelogExpectation` fields, referencing remote URLs, timeout budgets, and fallback modes to capture CRIT-008 behavior.
        Lifecycle consent proofs appear as `scriptReviewDigest`, `consentPhrase`, and `consentTimestamp`, tying the request to the LifecycleScriptRecord schema.
        Cache preferences live inside `cachePolicy`, which declares whether to retain staged files, enforce strict eviction, or honor pinned versions before deletion.
        The DTO includes `rollbackPlan[]`, with each entry listing `step`, `component`, and `operation`, ensuring the Install Transaction Orchestrator knows how to revert.
        Responses use InstallCommandResult DTOs containing `status`, `transactionId`, `installedPlugins[]`, `cacheChanges[]`, `symlinkState`, and `telemetryArtifacts[]`.
        Each `installedPlugins[]` element conforms to the InstalledPluginRegistry definition, featuring `pluginId`, `version`, `source`, `installState`, `cachePath`, `symlinkTarget`, and `lastValidatedAt`.
        Cache change entries document `action`, `pluginId`, `version`, `bytes`, and `evictionReason`, enabling documentation to explain rollback limits.
        Telemetry artifacts list file paths under `.claude-plugin/audit/`, along with checksums proving tamper detection.
        PublishCommandRequest DTOs contain `repository`, `branch`, `manifestPath`, `marketplaceIndexPath`, `releaseChannel`, `signature`, and `documentationLinks[]`.
        Publish requests also include `validationMatrix`, enumerating schemas, linting rules, and tests executed locally, supporting the CI alignment requirement.
        Response DTOs for publish include `gitCommitId`, `tag`, `pullRequestUrl`, and `artifactPaths`, ensuring git-native behavior is traceable.
        BrowseCommandRequest uses `pagination`, `sort`, `categoryFilters[]`, and `searchQuery`, while its response returns `entries[]`, `indexVersion`, and `staleFlag`.
        Each `entries[]` item in browse responses matches the PluginEntry schema, providing `id`, `name`, `category`, `repo`, `manifestPath`, `latestVersion`, `checksum`, `changelogUrl`, `deprecated`, and `pinPriority`.
        Search responses also attach `recommendationReason` fields referencing deterministic ranking heuristics from the assumptions ledger.
        RollbackCommandRequest includes `targetVersion`, `fallbackOrder[]`, `cachePreference`, and `auditContext`, guaranteeing deterministic rollback instructions.
        Rollback responses produce `revertedVersion`, `cacheState`, `symlinkState`, and `lifecycleEvents[]`, ensuring every effect is recorded.
        UninstallCommandRequest contains `pluginId`, `retainCache`, `removePins`, and `confirmationToken`, while responses include `filesRemoved[]` and `scriptsExecuted[]`.
        DTOs also share a `documentationAnchor` field referencing SPECIFICATION or traceability entries, simplifying doc generation.
        Every request carries `correlationId` and `requestTimestamp`, enabling telemetry alignment.
        DTO validation occurs through TypeScript zod-like schemas or TypeScript interfaces enforced by `tsc --noEmit`, giving compile-time guarantees.
        DTOs map directly to JSON Schema definitions stored alongside contracts, ensuring CLI automation can rely on the same formats.
        The CLI exposes `--input request.json` so that DTOs can be pre-assembled and piped into commands for scripted workflows.
        Responses always include `errorCode` even on success, defaulting to `null`, preventing consumers from inferring absence of error keys.
        DTOs adopt ISO 8601 timestamps and semantic version strings, matching the schema constraints defined in the appendices.
        Permission disclosures appear as arrays of `{scope, justification, required}` so documentation can highlight informational-only permissions.
        Compatibility results provide `state`, `warnings[]`, `blockingReasons[]`, and `evidence[]`, matching the Compatibility & Policy Engine contract.
        Cache telemetry objects share `beforeBytes`, `afterBytes`, and `limitBytes`, enabling quick compliance checks against the 500 MB rule.
        Lifecycle script transcripts embed `scriptType`, `digest`, `executionState`, and `stdoutPath` for reproducibility.
        DTO design ensures that GitHub Actions can capture CLI output and feed it into subsequent workflow steps without parsing human text.
        When DTOs include file paths, they always use repository-relative paths to keep git-native operations portable.
        All DTOs include `cliVersion` and `apiSchemaVersion`, enabling evolution while preserving backward compatibility.
        Errors propagate through `Result` discriminated unions, where `success` payloads include `value`, and `failure` payloads include `errorCode`, `message`, and `remediation`.
        DTO documentation references FR and NFR identifiers inline, keeping traceability at parity with the foundational directives.
