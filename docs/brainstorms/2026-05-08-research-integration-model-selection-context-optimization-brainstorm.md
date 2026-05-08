# Brainstorm: Model Selection and Token/Context Optimization Research Integration

**Date:** 2026-05-08
**Source research:** `docs/research/model-selection-token-context-optimization.md`
**Status:** Decisions resolved — ready for `/workflows:plan`

---

## What We're Building

Incorporate the model-selection and token/context-optimization research findings into
the yellow-plugins system by assigning explicit `model:` and `effort:` frontmatter values
to every agent where `model: inherit` is either wasteful or wrong, and by extending
`validate-agent-authoring.js` with lint rules that prevent the inheritance trap from
silently reappearing in future agents.

The work is delivered across 5 Graphite-stackable PRs so `/workflows:plan` can peel off
one stage at a time. The staging is ordered by risk and coordination cost — not by value,
which is roughly equal across phases.

---

## Why This Approach

**The inheritance trap is real and measurable.** 71 of 79 agents (90%) use `model: inherit`.
When a user runs `/review:pr` from an Opus session, all dispatched reviewers inherit Opus
at ~5-8x the cost of an equivalent Sonnet invocation — for pattern-matching tasks that have
no quality ceiling above Sonnet. The yellow-docs plugin already demonstrates the correct
pattern (explicit haiku/sonnet tiering across 6 of 7 reviewers); the rest of the system
should converge to that pattern.

**Code quality is preserved by:**
1. Keeping all agents that require genuine synthesis, adversarial reasoning, or
   cross-domain orchestration on `model: opus` (no downgrades for those).
2. Adding `effort: high` to synthesizers and orchestrators, not reducing it from default.
3. Extending the validator so future agents authored without explicit `model:` on
   narrow-role agents produce a CI warning rather than silently inheriting.
4. No schema changes required — `model:` and `effort:` are already valid recognized
   frontmatter fields per the subagent frontmatter catalog.

---

## Key Decisions

1. **No golden-set testing gates.** Model assignments are made on the basis of the
   research doc's evidence and each agent's documented role. The right assignment is
   chosen up front, not validated experimentally before merge.

2. **`model: inherit` is retained where correct** — CLI wrappers for external tools
   (yellow-codex, yellow-devin, yellow-composio, yellow-morph, yellow-ruvector, yellow-mempalace)
   where the parent's model choice should flow through, and integration-only agents
   whose quality is bounded by the external API they call.

3. **`effort:` is only set where there's a clear behavioral reason** — `effort: low`
   for single-pass mechanical tasks, `effort: high` for synthesizers and orchestrators
   that benefit from extended chain-of-thought. Agents at the default (`effort: medium`
   implicit) are left unset to avoid noise.

4. **Validator additions are warning-not-error for `model: inherit` on narrow agents**
   initially, to avoid blocking existing external contributors. Strict error level is a
   follow-on decision after Phase 4 is in and patterns are established.

5. **Staging — 5 Graphite-stackable PRs:**
   - **PR 1 (Phase 1):** ~8 agents across yellow-docs, yellow-council, yellow-core, yellow-ci, yellow-debt, yellow-research — no-risk frontmatter additions only.
   - **PR 2 (Phase 2):** All 5 yellow-debt scanners + `debt-fixer` + `knowledge-compounder` + `session-historian` — single PR, single changeset for the yellow-debt and yellow-core plugins touched.
   - **PR 3 (Phase 3a):** yellow-review reviewer-tier agents (~13 agents) — scoped to yellow-review plugin only.
   - **PR 4 (Phase 3b):** yellow-core review/research/workflow persona agents (~10 agents) — scoped to yellow-core plugin only. Keeps blast radius for the `/review:pr` pipeline split across two reviewable PRs.
   - **PR 5 (Phase 4):** `validate-agent-authoring.js` V1–V4 rules + tests — tooling-only, no plugin file changes.

---

## Per-Agent Assignment Table

All assignments approved. Legend: `(no change)` = current value is correct, explicitly confirming it.
Agents not listed are `model: inherit` with no change recommended.

---

### Phase 1 — No-Risk, No-Schema-Change Wins

These are single-line frontmatter additions with zero quality risk. Changeset per plugin.

| Agent | File | Current | Proposed `model:` | Proposed `effort:` | Rationale |
|---|---|---|---|---|---|
| `product-lens-reviewer` | `plugins/yellow-docs/agents/review/product-lens-reviewer.md` | `inherit` | `sonnet` | — | Premise-challenging and strategic-consequence analysis — same job as `design-lens-reviewer` and `scope-guardian-reviewer` siblings which are already `model: sonnet`. Aligns to yellow-docs's own explicit tiering pattern. |
| `gemini-reviewer` | `plugins/yellow-council/agents/review/gemini-reviewer.md` | `inherit` | `haiku` | `low` | CLI relay agent — constructs a `gemini -p "..."` shell invocation and fences the output. Does zero reasoning. Haiku + effort:low is correct for relay tasks. |
| `opencode-reviewer` | `plugins/yellow-council/agents/review/opencode-reviewer.md` | `inherit` | `haiku` | `low` | Identical reasoning to gemini-reviewer: invokes `opencode run --format json` and parses the JSON event stream. The agent itself does not analyze code. |
| `learnings-researcher` | `plugins/yellow-core/agents/research/learnings-researcher.md` | `inherit` | `haiku` | `low` | BM25-style keyword search over `docs/solutions/` using Read/Grep/Glob only — structured retrieval with no multi-step reasoning. Called on every `/review:pr` and `/workflows:plan` invocation, making this one of the highest-frequency agents in the system. |
| `runner-assignment` | `plugins/yellow-ci/agents/ci/runner-assignment.md` | `inherit` | `haiku` | `low` | Deterministic label-matching: workflow job labels → runner capability → `runs-on` recommendation. Fixed taxonomy, no ambiguous judgment. |
| `audit-synthesizer` | `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` | `opus` (no change) | `opus` | `high` | Correctly Opus (no model change). Add `effort: high` — cross-scanner deduplication, confidence gating, and multi-axis severity scoring benefit from extended chain-of-thought. Pure quality improvement with no cost regression. |
| `research-conductor` | `plugins/yellow-research/agents/research/research-conductor.md` | `opus` (no change) | `opus` | `high` | Correctly Opus (no model change). Add `effort: high` — complexity triage and multi-source fan-out decisions involve ambiguous decomposition problems where extended reasoning reduces routing errors. |
| `brainstorm-orchestrator` | `plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md` | `inherit` | `sonnet` | `high` | Iterative dialogue with research integration, AskUserQuestion orchestration, approach synthesis, and doc write. Sonnet is the quality ceiling for this structured orchestration task; effort:high adds deliberation for approach exploration. |

---

### Phase 2 — Parallel Scanner Tier + yellow-debt Remediation + yellow-core Workflow Agents

One PR covering all files in this phase (yellow-debt scanners + debt-fixer + yellow-core workflow agents).

#### yellow-debt scanners + remediation agent

All five scanners are single-pass, taxonomy-driven analysis agents using Read/Grep only.
They are dispatched in parallel by `/debt:audit` and their output is fed to `audit-synthesizer`.
The research doc's finding: Sonnet is the quality ceiling for fixed-taxonomy pattern matching;
there is no creative synthesis and no multi-domain cross-referencing in these agents.

| Agent | File | Current | Proposed `model:` | Proposed `effort:` | Rationale |
|---|---|---|---|---|---|
| `ai-pattern-scanner` | `plugins/yellow-debt/agents/scanners/ai-pattern-scanner.md` | `inherit` | `sonnet` | `low` | Matches AI-generated code patterns (excessive comments, boilerplate, over-specification) against a fixed taxonomy. Structured single-pass scan. |
| `complexity-scanner` | `plugins/yellow-debt/agents/scanners/complexity-scanner.md` | `inherit` | `sonnet` | `low` | Cyclomatic/cognitive complexity analysis via Grep/Bash against defined thresholds. Deterministic metric extraction. |
| `duplication-scanner` | `plugins/yellow-debt/agents/scanners/duplication-scanner.md` | `inherit` | `sonnet` | `low` | Near-duplicate detection over defined code blocks. Pattern-matching task with no synthesis requirement. |
| `architecture-scanner` | `plugins/yellow-debt/agents/scanners/architecture-scanner.md` | `inherit` | `sonnet` | `low` | Circular dependency and boundary violation detection — structural graph analysis against declared module boundaries. |
| `security-debt-scanner` | `plugins/yellow-debt/agents/scanners/security-debt-scanner.md` | `inherit` | `sonnet` | `low` | Security tech debt patterns (deprecated crypto, missing validation, hardcoded config) — NOT active vulnerabilities. Taxonomy application, not adversarial reasoning. Distinguished from `security-sentinel` which stays on Opus for active vulnerability audits. |
| `debt-fixer` | `plugins/yellow-debt/agents/remediation/debt-fixer.md` | `inherit` | `sonnet` | — | Implements concrete code edits from an accepted debt-item spec in an isolated worktree. Real code editing from a structured spec — Sonnet is the appropriate model for well-bounded implementation tasks. |

#### yellow-core workflow agents

| Agent | File | Current | Proposed `model:` | Proposed `effort:` | Rationale |
|---|---|---|---|---|---|
| `knowledge-compounder` | `plugins/yellow-core/agents/workflow/knowledge-compounder.md` | `inherit` | `sonnet` | — | Orchestration logic for deciding what to document, detecting novelty, and dispatching sub-agents. Requires reasoning but not Opus-level synthesis — sub-agents handle the writing. |
| `session-historian` | `plugins/yellow-core/agents/workflow/session-historian.md` | `inherit` | `sonnet` | — | Cross-vendor session search with BM25 + cosine + RRF fusion. Sophisticated retrieval with ranking logic, but no creative synthesis — ranking and returning is a Sonnet-ceiling task. |

---

### Phase 3 — yellow-review and yellow-core Reviewer Tier

This is the highest file-count change (12+ agents) and the most user-visible pipeline.
The research doc's analysis: `architecture-strategist` and `adversarial-reviewer` are
correctly Opus; the pattern-matching and single-axis review agents should be Sonnet.

Split into two PRs (PR 3 and PR 4) for blast-radius management:
- **PR 3 (Phase 3a):** yellow-review plugin agents only
- **PR 4 (Phase 3b):** yellow-core review/research/workflow persona agents + yellow-docs feasibility/adversarial reviewers

#### Agents to downgrade from `inherit` to `sonnet`

These agents apply a defined review lens (single axis) with no cross-domain synthesis.
The research doc's rationale: Sonnet reliably catches real issues within each agent's scope.

| Agent | File | Current | Proposed `model:` | Proposed `effort:` | Rationale |
|---|---|---|---|---|---|
| `correctness-reviewer` | `plugins/yellow-review/agents/review/correctness-reviewer.md` | `inherit` | `sonnet` | — | Always-on logic-error and edge-case reviewer. Single-axis analysis (correctness) against a defined review lens. Sonnet is the quality ceiling for structured code review with well-defined evaluation criteria. |
| `maintainability-reviewer` | `plugins/yellow-review/agents/review/maintainability-reviewer.md` | `inherit` | `sonnet` | — | Always-on dead code, coupling, and naming reviewer. Pattern-matching against maintainability anti-patterns — defined taxonomy, single axis. |
| `project-standards-reviewer` | `plugins/yellow-review/agents/review/project-standards-reviewer.md` | `inherit` | `sonnet` | — | Always-on CLAUDE.md/AGENTS.md compliance reviewer. Rule-application against documented project standards — no judgment beyond what the standards docs say. |
| `project-compliance-reviewer` | `plugins/yellow-review/agents/review/project-compliance-reviewer.md` | `inherit` | `sonnet` | — | Always-on naming and convention adherence reviewer. Complements project-standards-reviewer; same reasoning applies. |
| `reliability-reviewer` | `plugins/yellow-review/agents/review/reliability-reviewer.md` | `inherit` | `sonnet` | — | Conditional error-handling, retries, and async-safety reviewer. Structured review of error propagation and reliability patterns — Sonnet-ceiling task. |
| `silent-failure-hunter` | `plugins/yellow-review/agents/review/silent-failure-hunter.md` | `inherit` | `sonnet` | — | try-catch and error-suppression detector. Pattern-matching for identifiable silent-failure antipatterns — single-pass structured scan. |
| `pr-test-analyzer` | `plugins/yellow-review/agents/review/pr-test-analyzer.md` | `inherit` | `sonnet` | — | Test coverage and behavioral completeness analysis scoped to the PR diff. Coverage gap detection against defined criteria. |
| `comment-analyzer` | `plugins/yellow-review/agents/review/comment-analyzer.md` | `inherit` | `sonnet` | — | Comment accuracy and rot detection. Structural comparison of comments to adjacent code — pattern-matching, no synthesis. |
| `type-design-analyzer` | `plugins/yellow-review/agents/review/type-design-analyzer.md` | `inherit` | `sonnet` | — | Type invariant and encapsulation analysis. Well-defined evaluation criteria per language (TS/Py/Rust/Go). |
| `code-simplifier` | `plugins/yellow-review/agents/review/code-simplifier.md` | `inherit` | `sonnet` | — | Post-fix YAGNI and simplification pass. Rule-application (YAGNI) against code that has already been reviewed — Sonnet is sufficient for identifying unnecessary abstractions in-context. |
| `plugin-contract-reviewer` | `plugins/yellow-review/agents/review/plugin-contract-reviewer.md` | `inherit` | `sonnet` | — | Plugin manifest breaking-change detector. Structured comparison of before/after frontmatter and plugin.json surface — defined schema rules, no ambiguous judgment. |
| `cli-readiness-reviewer` | `plugins/yellow-review/agents/review/cli-readiness-reviewer.md` | `inherit` | `sonnet` | — | Conditional CLI agent-readiness reviewer. Applies the 7-principle rubric from `agent-cli-readiness-reviewer` to CLI code diffs — rule-application task. |
| `pr-comment-resolver` | `plugins/yellow-review/agents/workflow/pr-comment-resolver.md` | `inherit` | `sonnet` | — | Implements a single coherent fix for a cluster of PR review comments in the same file region. Localized edit with clear constraints — Sonnet is sufficient for in-context reconciliation. |
| `code-simplicity-reviewer` | `plugins/yellow-core/agents/review/code-simplicity-reviewer.md` | `inherit` | `sonnet` | — | YAGNI enforcement pre-fix pass. Same reasoning as code-simplifier — rule-application against defined YAGNI criteria. |
| `pattern-recognition-specialist` | `plugins/yellow-core/agents/review/pattern-recognition-specialist.md` | `inherit` | `sonnet` | — | Anti-pattern, naming, and convention inconsistency detector. Pattern-matching against codebase conventions — defined taxonomy, no creative synthesis. |
| `test-coverage-analyst` | `plugins/yellow-core/agents/review/test-coverage-analyst.md` | `inherit` | `sonnet` | — | Full test-suite audit for coverage gaps and assertion quality. Structured analysis against test quality criteria — Sonnet-ceiling task. |
| `polyglot-reviewer` | `plugins/yellow-core/agents/review/polyglot-reviewer.md` | `inherit` | `sonnet` | — | Language-idiomatic review (TS/Py/Rust/Go). Sonnet has reliable coverage of language idioms across all four target languages. Research doc confirms this as a Sonnet-ceiling task. |
| `spec-flow-analyzer` | `plugins/yellow-core/agents/workflow/spec-flow-analyzer.md` | `inherit` | `sonnet` | — | User experience flow analysis and requirements review. Structured evaluation of UX flows against completeness criteria — analysis with defined axes, not open-ended synthesis. |
| `security-lens` | `plugins/yellow-core/agents/review/security-lens.md` | `inherit` | `sonnet` | — | Plan-level security architect reviewing auth/authz assumptions and attack surface in planning docs. Plan-level review with defined threat-model dimensions — Sonnet is the quality ceiling for this structured assessment. |
| `security-reviewer` | `plugins/yellow-core/agents/review/security-reviewer.md` | `inherit` | `sonnet` | — | Conditional persona adding calibrated confidence on top of security-sentinel's broader audit. This agent synthesizes security-sentinel output — it does not independently discover vulnerabilities. Sonnet is appropriate for this synthesis/calibration role. |
| `performance-reviewer` | `plugins/yellow-core/agents/review/performance-reviewer.md` | `inherit` | `sonnet` | — | Conditional performance persona that adds anchored confidence calibration on top of `performance-oracle`'s deeper analysis. Calibration/synthesis role, not primary discovery. |
| `feasibility-reviewer` | `plugins/yellow-docs/agents/review/feasibility-reviewer.md` | `inherit` | `sonnet` | — | Evaluates whether proposed technical approaches survive contact with reality — architecture conflicts, migration risks, implementability. Structured feasibility assessment with defined evaluation criteria, matching the yellow-docs sibling pattern. |
| `adversarial-document-reviewer` | `plugins/yellow-docs/agents/review/adversarial-document-reviewer.md` | `inherit` | `sonnet` | `high` | Premise-challenging and stress-testing of high-stakes planning documents (5+ requirements, auth/payments/migrations/compliance). The adversarial angle requires deliberation — `effort: high` adds reasoning depth. Sonnet rather than Opus because this reviewer applies a structured challenge protocol, not open-ended novel synthesis. |

#### Agents that stay on `opus` (confirming existing or implicit assignments)

| Agent | File | Current | Proposed `model:` | Rationale |
|---|---|---|---|---|
| `architecture-strategist` | `plugins/yellow-core/agents/review/architecture-strategist.md` | `opus` | `opus` (no change) | SOLID, dependency direction, API contract stability — architectural judgment is the canonical Opus use case. Cross-domain synthesis with high downstream cost if wrong. |
| `security-sentinel` | `plugins/yellow-core/agents/review/security-sentinel.md` | `opus` | `opus` (no change) | Active vulnerability audit (OWASP top 10, injection, XSS, auth/authz flaws). Adversarial reasoning requiring deep multi-step inference — false negatives here are high-cost. Opus is correct. |
| `performance-oracle` | `plugins/yellow-core/agents/review/performance-oracle.md` | `opus` | `opus` (no change) | Primary performance bottleneck analysis — algorithmic complexity, N+1, memory management. This is the discovery agent (not the calibration persona); Opus earns its cost for novel complexity reasoning. |
| `adversarial-reviewer` | `plugins/yellow-review/agents/review/adversarial-reviewer.md` | `opus` | `opus` (no change) | Constructs failure scenarios to break the implementation rather than checking patterns. Active adversarial reasoning is Opus territory — this agent's value is in finding failures that pattern-matching misses. |
| `agent-cli-readiness-reviewer` | `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md` | `opus` | `opus` (no change) | 7-principle severity rubric including nuanced distinctions (Blocker vs. Friction vs. Optimization) and architectural CLI design judgment. Opus is defensible for this level of compound judgment. |
| `agent-native-reviewer` | `plugins/yellow-review/agents/review/agent-native-reviewer.md` | `opus` | `opus` (no change) | Agent-native parity review: UI/agent action parity, context parity, primitive-vs-workflow tool design, dynamic context injection in system prompts. Multi-axis novel reasoning — correctly Opus. |

---

### Phase 4 — Validator Layer

> **Note (2026-05-08):** This section captures the brainstorm-time sketch of V1–V4. The
> canonical implementation spec — including the final `effort:` enum (which adds `xhigh`)
> and V4's match on the agent `name:` field rather than `description:` keywords — lives
> in `plans/model-selection-frontmatter-rollout.md` Phase 5. Refer to the plan, not this
> section, when implementing or auditing the validator rules.

Add lint rules to `validate-agent-authoring.js` that make the inheritance trap a CI signal
rather than a silent default. No schema changes required — the validator already parses
frontmatter scalars via `parseScalar()`.

#### Rule V1: `effort:` enum validation

If `effort:` is present in agent frontmatter, its value must be one of `low | medium | high | xhigh | max`.
Any other value is a hard error. This prevents typos (`hight`, `lo`) from silently falling
back to default behavior.

**Implementation:** Add `parseScalar(frontmatter, 'effort')` → if not null, check against
`['low', 'medium', 'high', 'xhigh', 'max']` → push error on mismatch.

#### Rule V2: `model:` enum validation

If `model:` is present, its value must be one of `inherit | haiku | sonnet | opus` (or a
versioned form like `sonnet-4-5`, `opus-4-6`). Any other value is a hard error. This catches
misspellings and invalid model IDs before they silently fall back to the session default.

**Implementation:** Add `parseScalar(frontmatter, 'model')` → validate against known enum
(allow prefix match for versioned IDs like `haiku-4-5`).

#### Rule V3: `model: inherit` warning for narrow-role agents (warning, not error)

Agents in the following subdirectory patterns that use `model: inherit` produce a
non-blocking CI warning (not error) to nudge authors toward explicit assignment:
- `agents/scanners/` — single-pass taxonomy scanners
- `agents/ci/` — CI analysis agents

The warning message: `[V3 advisory] {file}: model: inherit on a scanner/CI agent — consider
explicit model: sonnet or model: haiku based on task complexity.`

**Rationale for warning-not-error:** External contributors shouldn't be blocked; this is
nudge behavior until the pattern is established. Escalation to error is a follow-on decision.

#### Rule V4: `effort: high` advisory for synthesizer/orchestrator agents (warning, not error)

Agents whose `name:` field matches keywords `synthesizer`, `orchestrator`, `conductor`,
`aggregator`, or `compounder` that lack `effort: high`, `effort: xhigh`, or `effort: max`
produce a non-blocking advisory. This surfaces the recommendation without blocking.

**Note:** Rules V3 and V4 produce warnings via a new `warnings` array (alongside the existing
`errors` array). The exit code remains 0 if only warnings are present. CI output prints
warnings in yellow, errors in red.

---

## Agents with No Change Recommended

The following agents correctly use `model: inherit` because:
- They are pure CLI/API wrappers for external tools where the parent model choice
  should flow through (`yellow-codex`, `yellow-devin`, `yellow-composio`, `yellow-morph`)
- They are integration agents whose output quality is bounded by the external service
  (`yellow-linear`, `yellow-mempalace`, `yellow-ruvector`, `yellow-chatprd`)
- They are runner/diagnostic agents where inherit is appropriate (`yellow-browser-test`,
  yellow-ci `runner-diagnostics`, `workflow-optimizer`, `failure-analyst`)
- Their role is primarily workflow orchestration that benefits from the parent session's
  full model quality (e.g., `devin-orchestrator`, `repo-research-analyst`,
  `best-practices-researcher`, `git-history-analyzer`, `code-researcher`)
- They are generation agents (doc-generator, diagram-architect) where output quality
  scales with model capability and inherit is intentional
- They are the yellow-docs `doc-auditor` (scanning, but within a docs-generation context
  where inherit from the parent session is appropriate)

Specific no-change list:
`app-discoverer`, `test-reporter`, `test-runner`, `document-assistant`, `document-reviewer`,
`linear-prd-bridge`, `project-dashboard`, `failure-analyst`, `workflow-optimizer`,
`runner-diagnostics`, `codex-analyst`, `codex-reviewer`, `codex-executor`,
`best-practices-researcher`, `git-history-analyzer`, `repo-research-analyst`,
`devin-orchestrator`, `doc-auditor`, `diagram-architect`, `doc-generator`,
`linear-explorer`, `linear-issue-loader`, `linear-pr-linker`, `memory-archivist`,
`palace-navigator`, `code-researcher`, `ruvector-memory-manager`, `ruvector-semantic-search`,
`finding-fixer`, `coherence-reviewer` (already `model: haiku`, no change).

`scan-verifier` (yellow-semgrep) is already `model: sonnet` — no change.

---

## Resolved Decisions

These questions were raised during the brainstorm and answered by the user. Recorded here
for traceability by future readers and `/workflows:plan`.

1. **`adversarial-document-reviewer`: `sonnet` + `effort: high` confirmed.**
   This reviewer challenges document premises using a structured protocol (defined challenge
   axes, conditional triggers). `adversarial-reviewer` in yellow-review constructs novel
   failure scenarios for code — open-ended adversarial reasoning that warrants Opus. The
   structured-vs-novel-failure-scenarios distinction is the rationale for the split.

2. **`performance-oracle` stays on `opus` confirmed.**
   Primary performance discovery agent — algorithmic complexity, N+1, memory management.
   This is the reasoning agent (not the calibration persona `performance-reviewer`); Opus
   earns its cost here.

3. **`security-reviewer` and `security-lens` both `sonnet` confirmed.**
   Both are calibration/synthesis personas that layer on top of `security-sentinel` (Opus).
   The sentinel handles discovery at Opus depth; the calibration step does not need to
   duplicate that cost. Defense in depth is preserved by keeping `security-sentinel` on Opus.

4. **`debt-fixer` added to Phase 2 as `model: sonnet`.**
   The agent implements concrete code edits from an accepted debt-item spec in an isolated
   worktree. Real code editing from a structured spec is a Sonnet-ceiling task. Added to
   the Phase 2 table alongside the scanner tier.

5. **Validator severity: V1 and V2 are hard errors; V3 and V4 remain warnings.**
   V1 (`effort:` enum) and V2 (`model:` enum) validate values that are already present —
   a typo here is unambiguously wrong and should block CI. V3 (inheritance advisory for
   scanner/CI agents) and V4 (effort advisory for synthesizers) are inference-based nudges
   where external contributors shouldn't be blocked. No escalation path planned.

6. **5 Graphite-stackable PRs (option A') confirmed.** See staging structure in Key Decisions.
   Phase 3 split into 3a (yellow-review) and 3b (yellow-core + yellow-docs) for blast-radius
   scoping. Phase 4 (validator tooling) stands alone as a tooling-only PR.
