# yellow-council V2 Revalidation: Four-CLI Architecture + Subscription-Auth Hardening

**Date:** 2026-05-08 (revision 2: 2026-08-01, re-enriched via `/yellow-research:workflows:deepen-plan`)
**Status:** RESEARCH RECORD — supersedes the retired plan `plans/yellow-council-v2-four-cli.md` (deleted 2026-08-01). Not an active plan: the feature is being re-scoped via `/workflows:brainstorm` → `/workflows:spec` → `/workflows:decompose`; this document is the validated input to that pipeline. Codebase-verified 2026-08-01: 0 of the original 27 tasks landed; yellow-council still at 0.2.9 with 2 reviewer agents. Exception: Phase G (Antigravity migration) is an urgent standalone bugfix that should ship regardless of re-scoping.
**Source research:** `docs/research/multi-cli-code-review-claude-codex-gemini-opencode.md`
**Current plugin state:** `plugins/yellow-council/` V1 (3 reviewers: Codex via yellow-codex, Gemini, OpenCode; single-shot; descriptive synthesis). **The Gemini slot is currently non-functional** — Google shut off Gemini CLI for consumer-subscription tiers on 2026-06-18 (see Phase G).
**Target state:** 4 reviewers (add in-process `claude-reviewer`), Gemini slot migrated to Antigravity CLI (`agy`), subscription-auth quota tracking (error-string driven), double-blind synthesis, OpenCode wired to non-Big-3 lineage, Tier 1-2 evidence verification

---

## Starting from a fresh session

If picking up this plan in a new conversation with no prior context, read in this order before beginning Phase G:

1. **This plan** end-to-end (especially "Locked decisions" and "Risks and mitigations")
2. **Source research:** `docs/research/multi-cli-code-review-claude-codex-gemini-opencode.md` — explains why the architecture is asymmetric and which biases need active mitigation. NOTE: written before the Gemini CLI shutdown; its Gemini sections describe the retired `gemini` binary.
3. **Existing reviewer agents** (the templates for claude-reviewer):
   - `plugins/yellow-council/agents/review/gemini-reviewer.md` (PRIMARY template — 6-key structured output; Phase G migrates its binary to `agy`)
   - `plugins/yellow-council/agents/review/opencode-reviewer.md` (secondary; same shape)
   - `plugins/yellow-codex/agents/review/codex-reviewer.md` (DRIFT — does NOT match shape; Phase 0 normalizes it)
4. **Orchestrator:** `plugins/yellow-council/commands/council/council.md` — Step 4 (parse_reviewer_return) and Step 5 (synthesis) are the main edit surfaces; the 3 Task spawns are at lines 197/200/201
5. **Skill:** `plugins/yellow-council/skills/council-patterns/SKILL.md` — canonical CLI invocation patterns (Gemini block at lines 346–358, OpenCode block at lines 366–380)
6. **W1.5 allowlist:** `scripts/validate-agent-authoring.js` — `REVIEW_AGENT_DENIED_TOOLS` at line 26, `REVIEW_AGENT_ALLOWLIST` at lines 76–88 — in case any reviewer needs to violate the read-only rule

The deepen-plan annotations (`<!-- deepen-plan: source -->` blocks) embedded throughout this document contain codebase- and research-validated specifics that supersede the plan body where they conflict. Always trust the annotation over the body if there's a contradiction. Annotations dated 2026-08-01 supersede any earlier statement in the body.

<!-- deepen-plan: codebase -->
> **Codebase (2026-08-01 revalidation):** 0 of the plan's tasks are already done. `plugins/yellow-council/agents/review/` contains only `gemini-reviewer.md` and `opencode-reviewer.md`; no `claude-reviewer.md` exists anywhere. `council.md:197,200,201` spawns exactly 3 reviewers. Grep for `QUOTA_EXHAUSTED|quota.json|COUNCIL_MIN_REVIEWERS|COUNCIL_DOUBLE_PASS_SYNTHESIS|COUNCIL_OPENCODE_MODEL|double-blind` across `plugins/yellow-council/` returns zero matches. Version is 0.2.9 in all three manifests (no drift). Post-plan commits (#575, #628, #666, #670, #676) are bug fixes/hardening only — the largest being the `PACK_BYTES` guard at `opencode-reviewer.md:157–167`, which now sits directly inside Task 4.1's edit surface.
<!-- /deepen-plan -->

---

## Goals (in priority order)

0. **Restore the Google reviewer slot** by migrating gemini-reviewer from the retired `gemini` CLI to Antigravity CLI (`agy`). This is urgent and independent of the rest of V2 — V1 is broken today for consumer-subscription accounts (Phase G).
1. **Add Claude as the 4th reviewer slot** as in-process Task subagent (asymmetric architecture). Activates true 4-lineage diversity once OpenCode is wired to a non-Big-3 provider.
2. **Mitigate self-enhancement bias** in the Claude→Claude synthesis path via two-pass order-swap, double-blind lineage labels, AND structured multi-dimensional rubric decomposition (2026 research: anonymization + order-swap alone are necessary but not sufficient). This is the new #1 quality risk under the asymmetric architecture.
3. **Track subscription quotas per reviewer** so quota exhaustion fails gracefully (emit `verdict=QUOTA_EXHAUSTED`, surface ETA in headline, do not retry — see Task 3.3 for the reviewer-side handler). Detection is error-string driven, not cap-counting — providers no longer publish reliable numeric caps.
4. **Wire OpenCode to a non-Big-3 lineage** (DeepSeek/Grok/Mistral) for genuine 4-lineage orthogonality.
5. **Add Tier 1-2 evidence verification** (exact match + `rapidfuzz` similarity ≥85) to the synthesis step. Tier 3 (ast-grep) is V3.

## Non-goals (deferred)

- Multi-round iterative review (`/council review --round 2`) — defer until V2-3 evidence verification lands; round 2 without verify-first gate is harmful (Reflexion, NeurIPS 2023).
- Persistent fleet management (`/council fleet *`) — V3.
- Bradley-Terry calibration, AgentAuditor branch verification, GitHub PR webhook pre-warming — V3+.
- Local quota query API — providers don't expose this; V2 uses heuristic tracking only.
- Direct API path (sidesteps subscription auth) — explicitly off the table per user requirement.
- **Length-controlled finding scoring** (Wang 2024 verbosity-bias mitigation) — deferred to V2.5 (V2-7 in research roadmap). The source research labels this "mandatory before any quality claim" (Dimension 10), but V2 ships only the order-swap + double-blind + rubric-decomposition mitigations. Verbosity bias in synthesis remains a known quality gap until V2.5 — see Risk R6.
- Renaming `gemini-reviewer.md` → `antigravity-reviewer.md` — deferred. The rename changes the `subagent_type` (`yellow-council:review:gemini-reviewer`), a plugin-contract break that deserves its own PR after Phase G's minimal binary swap ships. Phase G keeps the filename and agent name.

---

## Phase G: Gemini → Antigravity CLI migration (URGENT, ~half day, independent PR — ships first)

**Why this phase exists (new in revision 2):** Google officially announced (2026-05-19) and executed (2026-06-18) the shutdown of Gemini CLI for Google AI Pro, Ultra, and free-tier individual accounts. Only enterprise Gemini Code Assist Standard/Enterprise licenses and **paid API keys** retain access — exactly the auth tiers this plugin's "subscription auth, no API keys" constraint excludes. `gemini-reviewer.md:159` still invokes the retired binary (`gemini -p "..." --approval-mode plan --skip-trust -o text`), so the Google reviewer slot fails today on any consumer account. The replacement is the Antigravity CLI, binary `agy`, which supports headless invocation (`agy -p "..."`) and migrates existing session tokens into the OS keyring on first run.

<!-- deepen-plan: external -->
> **Research (Q1, Gemini CLI shutdown — CONFIRMED, plan-invalidating):** Google Developers Blog, 2026-05-19: *"On June 18, 2026, Gemini CLI and Gemini Code Assist IDE extensions will stop serving requests for Google AI Pro and Ultra, as well as those using it free of charge."* The cutoff is ~6 weeks in the past as of this revision. Enterprise licenses and paid API keys are exempt — the inverse of this plan's auth model. The open-source `google-gemini/gemini-cli` repo continues tagging releases (v0.49.0, 2026-06-25), but Google's hosted service no longer serves consumer-tier requests to it. Replacement binary is **`agy`** (confirmed at antigravity.google/docs/cli/gcli-migration — `agy plugin import gemini`; one blog claims `av`, contradicted by Google's own docs). Headless use is supported: a Google codelab documents `agy -p "..."` explicitly for CI/automation. Migration specifics: session tokens move to OS-native keyring (consistent with continued OAuth subscription auth, NOT a forced API-key switch — but this is the single most load-bearing unverified claim; see Task G.1); skills paths move `~/.gemini/skills/` → `~/.gemini/antigravity-cli/skills/` (global) and `.gemini/skills/` → `.agents/skills/` (workspace); MCP config moves to `~/.gemini/config/mcp_config.json` / `.agents/mcp_config.json` with `url`/`httpUrl` → `serverUrl` rename. Google's own wording: *"There won't be 1:1 feature parity right out"* — do not assume `--approval-mode`, `--skip-trust`, `-o text`, or Gemini CLI's exit codes (0/1/42/53) carry over. Antigravity-specific `--output-format` and exit-code semantics are UNVERIFIED — check `agy --help` in the Task G.1 spike.
<!-- /deepen-plan -->

### Task G.1: Spike — `agy` headless invocation + subscription-auth continuity (S, 2h)

**File (new):** `docs/spikes/antigravity-cli-headless-2026-08.md`

Procedure:
1. Install/launch `agy`; complete the first-run onboarding (token migration from `gemini`).
2. Confirm subscription auth: verify `agy` works on a Google AI Pro/Ultra login WITHOUT requesting an API key. If it demands an API key or per-token billing, STOP — the Google slot cannot be salvaged under the no-API-key constraint; escalate to the user (fallback options: drop to 3 reviewers, or route Google lineage through OpenCode/OpenRouter `google/gemini-*` slugs).
3. Capture `agy --help`: the headless prompt flag (expected `-p`), output-format flags (Gemini CLI had `--output-format json|jsonl`; `-o text` shorthand was never confirmed even for Gemini CLI), exit codes, and any approval/trust flags replacing `--approval-mode plan --skip-trust`.
4. Run a trivial headless review prompt; capture stdout/stderr shapes, and deliberately probe the quota/error surface if feasible.
5. Record everything in the spike doc — Task G.2 consumes it.

### Task G.2: Swap the binary in gemini-reviewer.md (S, 2h)

**File:** `plugins/yellow-council/agents/review/gemini-reviewer.md`

- Replace the invocation at line 159 (`gemini -p "$PROMPT" --approval-mode plan --skip-trust -o text`) with the spike-verified `agy` equivalent.
- Update the availability pre-flight (`command -v gemini` → `command -v agy`) and any UNAVAILABLE-path messaging ("install Gemini CLI" → Antigravity install/migration guidance, including `agy plugin import gemini` for users migrating).
- Keep `COUNCIL_TIMEOUT` (first use line 64, operative use line 158; default 600) unchanged unless the spike shows different latency characteristics.
- Update error-pattern handling: keep `RESOURCE_EXHAUSTED` as the quota floor; add any Antigravity-specific quota/auth strings the spike surfaced. Distinguish "consumer tier shut off / not migrated" (actionable: run `agy` onboarding) from transient errors.
- The 6-key output contract (lines 355–361) and verdict case-statement (lines 322–325) are unchanged — this is a binary swap, not a contract change.

### Task G.3: Docs + skill sync (S, 1h)

**Files:**
- `plugins/yellow-council/skills/council-patterns/SKILL.md:346–358` — the canonical Gemini invocation block must mirror Task G.2's new invocation (NOTE: revision 1 of this plan cited 346–358 as the OpenCode block; as of 2026-08-01 those lines are the **Gemini** block and OpenCode's block is at 366–380).
- `plugins/yellow-council/CLAUDE.md` + `README.md` — replace Gemini CLI references with Antigravity CLI (`agy`), including install/migration prerequisites.
- Changeset: minor bump (behavior change: new binary dependency).

### Task G.4: Lineage detection follow-through (XS, 30min)

Task 4.3's lineage detection reads `~/.gemini/settings.json` for the model field. Antigravity relocates config (see the Phase G annotation). Update the detection path per the spike findings; lineage remains `google`.

**PR-G test scenario:** on a consumer (AI Pro/Ultra) account, `/council review` on a clean diff returns a Gemini-slot verdict via `agy` instead of `verdict=UNAVAILABLE`/hang.

---

## Phase 0: codex-reviewer contract normalization (~half day, lands BEFORE PR-A)

**Why this is now Phase 0 instead of a V3 deferral:** the codebase research surfaced that `yellow-codex/agents/review/codex-reviewer.md` does NOT emit the same structured 6-key output block that gemini-reviewer and opencode-reviewer use. Adding claude-reviewer (Phase 1) creates 3 reviewers on the new contract and 1 on the old — `council.md`'s parse logic would need a special-case branch for codex, complicating PR-A. Normalizing codex first makes the 4-way fan-out uniform.

**Cross-plugin scope:** this PR touches `plugins/yellow-codex/`, not `plugins/yellow-council/`. Coordinate with yellow-codex maintainer if separate; same author = no coordination needed.

<!-- deepen-plan: codebase -->
> **Codebase (2026-08-01 revalidation):** Still true and still needed. `codex-reviewer.md` Step 7 (now lines 224–238) returns injection-fenced free-form P1/P2/P3 findings plus a prose summary line — no `verdict=`, `confidence=`, `fenced_output_path=`, or `findings_block_begin/end`. PR #676 did NOT fix this: it fixed the `PACK_BYTES` guard's early-exit envelope in `opencode-reviewer.md:157–167` (different plugin, different agent). `CODEX_MODEL` default `gpt-5.4` is now at `codex-reviewer.md:136`.
<!-- /deepen-plan -->

### Task 0.1: Audit codex-reviewer output gap (XS, 30min)

**File:** `plugins/yellow-codex/agents/review/codex-reviewer.md`

Read the existing reviewer's Step 7 output construction (lines 224–238). Identify what's missing vs. the gemini/opencode 6-key shape:
- `verdict=` line — present? what enum?
- `confidence=` line — present?
- `summary=` line — present?
- `fenced_output_path=` line — present?
- `findings_block_begin` / `findings_block_end` delimiters — present?

Document the gap in the PR-0 description.

### Task 0.2: Rewrite codex-reviewer Step 7 to emit the 6-key block (S, 2h)

**File:** `plugins/yellow-codex/agents/review/codex-reviewer.md`

Match gemini-reviewer's output exactly:

```text
verdict=<APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE>
confidence=<HIGH|MEDIUM|LOW|N/A>
summary=<single-line 500-char-capped>
fenced_output_path=<path to /tmp/council-codex-fenced-XXXXXX.txt>
findings_block_begin
<findings text>
findings_block_end
```

Preserve existing finding format (P1/P2/P3 markers) inside the `findings_block_*` delimiters — don't change Codex's review *content*, only its return-envelope shape.

Add the case-statement validation (`case "$VERDICT" in APPROVE|REVISE|...|UNAVAILABLE) ;; *) VERDICT="UNKNOWN"`) to match gemini-reviewer.md:322–325 (search for `case "$VERDICT" in APPROVE` — line numbers may shift).

### Task 0.3: Update yellow-council `council.md` to remove codex special-case (S, 1h)

**File:** `plugins/yellow-council/commands/council/council.md`

If Step 4's `parse_reviewer_return` had any codex-specific branch (re-verify by grepping `codex` in council.md), remove it. The parser becomes uniform across all 3 reviewers in V1, then 4 in V2.

### Task 0.4: Validation, changeset, commit, submit (S, 1h)

```bash
pnpm validate:schemas
pnpm validate:agents
pnpm changeset   # patch bump for yellow-codex (refactor, no behavior change for end users)
gt commit create -m "refactor(yellow-codex): normalize codex-reviewer output contract to 6-key block"
gt stack submit
```

**Test scenario:** run `/council review` on a clean diff with V1 yellow-council still installed (Phase 0 is purely yellow-codex). Confirm Codex's findings appear with verdict/confidence/summary lines instead of free-form prose.

**Risk:** if downstream consumers depend on codex-reviewer's free-form output (unlikely; only `council.md` reads it), this is a breaking change. Search marketplace: `grep -rn 'yellow-codex:review:codex-reviewer' plugins/`. If only yellow-council references it, safe.

---

## Phase 1: Foundation — Add Claude reviewer slot (~1 day)

### Task 1.1: Create `claude-reviewer` agent definition (S, 2h)

**File:** `plugins/yellow-council/agents/review/claude-reviewer.md` (new)

Match the shape of `gemini-reviewer.md` and `opencode-reviewer.md`, but:
- No CLI subprocess invocation — the agent answers the prompt directly using Claude's reasoning
- No `Bash` in `tools:` (this agent does not invoke a binary; pure reasoning + Read for evidence verification)
- Tools: `[Read, Grep, Glob, Write]` — read-only baseline plus `Write` so the agent can materialize the `fenced_output_path` temp file the 6-key contract requires. Requires a corresponding entry in `REVIEW_AGENT_ALLOWLIST` (see annotation below).
- Frontmatter `name: claude-reviewer`, `model: inherit`
- `skills: [council-patterns]`

Output contract: identical to existing reviewers — emit the 6-key block: `verdict=` / `confidence=` / `summary=` / `fenced_output_path=` / `findings_block_begin` / `<findings>` / `findings_block_end` lines.

<!-- deepen-plan: codebase -->
> **Codebase (2026-08-01):** Use `gemini-reviewer.md` as the structural template, NOT `codex-reviewer.md`. Current locations of the contract anchors: gemini-reviewer 6-key output block at lines 355–361, verdict case-statement at 322–325; opencode-reviewer 6-key block at 454–460, case-statement at 414–417. Verdict enum unchanged: `APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE`. codex-reviewer still returns free-form prose (Phase 0 fixes it).
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase (2026-08-01, locked decision — updated line refs + content):** claude-reviewer needs `Write` in `tools:` to create `/tmp/council-claude-fenced-XXXXXX.txt` for the 6-key contract. `scripts/validate-agent-authoring.js:26` now defines `REVIEW_AGENT_DENIED_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit']` (note: `MultiEdit` was added post-plan for the W1.5b closed-enumeration fix — revision 1 quoted a 3-element list). `REVIEW_AGENT_ALLOWLIST` is now at lines 76–88 with 3 entries (codex, gemini, opencode). **Required action in PR-A:** add an allowlist entry for `plugins/yellow-council/agents/review/claude-reviewer.md` and document the exception (Write is used only to materialize the fenced output file; the agent does NOT modify repo state).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q4/Q5, contrarian framing — 2026 update):** Empirically-effective framings remain: (a) **competitive grading** — "You will be graded on how many valid objections you raise that other reviewers missed, not on how many you agree with."; (b) **explicit permission to diverge**; (c) **structured steelman-then-attack**. Vague "be critical" / "play devil's advocate" framings are neutralized by RLHF tuning. New 2026 finding directly relevant to this slot: self-preference bias is model-specific and unpredictable in direction — one 2026 study (arXiv 2604.22891v4) measured Claude-Sonnet-4.5 with the strongest self-DISfavor (β = −0.229) among tested models. Do not assume the Claude reviewer will inflate Claude-friendly findings; the risk may invert (over-harsh self-assessment). The empirical guardrail in the body (REVISE-rate tracking vs. other reviewers) covers both directions — keep it symmetric: flag if Claude-reviewer's REVISE rate deviates from the other 3 reviewers' average by more than ±25%.
<!-- /deepen-plan -->

**Contrarian framing (DECIDED):** The agent's system prompt explicitly directs it to take a devil's-advocate stance. Rationale: Claude is both reviewer and synthesizer; without active divergence, the Claude reviewer's findings highly correlate with what the synthesizer would produce on its own, weakening the ensemble's anti-correlated-hallucination property. Contrarian framing pushes findings away from default orchestrator priors.

Specific prompt directives:
- Treat the pack as a code-review request
- Apply the same scoring rubric as the other reviewers
- NOT identify itself as Claude in the output (so synthesizer's double-blind labeling can't be defeated by self-naming)
- Cite findings using `<file>:<line>` syntax to support evidence verification
- Actively look for issues the other reviewers might miss; prefer surfacing borderline concerns over staying silent
- When the diff looks clean, default to `REVISE` if there's a defensible critique, not `APPROVE` by reflex
- Explicitly bias toward edge-cases, error paths, race conditions, and security boundaries — categories where Anthropic-trained models tend to be conservative

Tradeoff acknowledged: contrarian framing may produce lower base-rate APPROVE verdicts. Track empirically — if Claude-reviewer's REVISE rate deviates from the other 3 reviewers' average by more than ±25%, the framing is mis-tuned and should be adjusted.

### Task 1.2: Wire 4th reviewer into `/council` fan-out (S, 1h)

**File:** `plugins/yellow-council/commands/council/council.md`

In Step 4 (Parallel reviewer fan-out via Task — the existing 3 spawns are at lines 197, 200, 201), add the 4th Task spawn alongside the existing 3:

```text
Task(subagent_type="yellow-council:review:claude-reviewer", prompt=<pack with REVIEWER_NAME=Claude>)
```

Update the parse helpers, synthesis logic (Step 5), AND report assembly to handle 4 reviewers instead of 3:
- `REVIEWER_VERDICTS` etc. now indexed by `claude` / `codex` / `gemini` / `opencode`
- Headline counts: "All 4 reviewers APPROVE" / "Council ran with N of 4 reviewers (...)"
- Agreement bucket: "cited by 2+ reviewers" threshold unchanged
- Disagreement bucket: same logic, just 4 inputs
- **Report assembly (raw-output appendix and any per-reviewer iteration):** every loop that currently iterates over `codex gemini opencode` must be extended to include `claude` first. Grep `council.md` for the literal string `codex gemini opencode` (or any subset of those three reviewer slugs) and audit each match — missing the report-assembly loop ships PR-A with Claude's raw section silently absent from the saved report, breaking traceability for one quarter of the ensemble.

### Task 1.3: Update `council-patterns` SKILL.md (S, 1h)

**File:** `plugins/yellow-council/skills/council-patterns/SKILL.md`

- Add `claude` to the canonical reviewer list
- Add a note that `claude-reviewer` is the in-process exception (no CLI subprocess) — document the asymmetry
- Update any per-reviewer invocation tables to include the Claude row

### Task 1.4: Plugin manifest + docs update (S, 1h)

**Files:**
- `plugins/yellow-council/CLAUDE.md` — update Plugin Components section: "Agents (2)" (line 68) becomes "Agents (3)" with claude-reviewer added. ALSO fix the pre-existing drift at line 57: "Commands (1)" is wrong — `commands/council/` contains both `council.md` and `setup.md`; correct to "Commands (2)".
- `plugins/yellow-council/README.md` — update reviewer count and lineage map
- `plugins/yellow-council/CHANGELOG.md` — add entry for V2 four-CLI architecture

**Version bump (do NOT hand-edit `plugin.json` or `marketplace.json`):** the repo's three-way sync model treats `plugins/yellow-council/package.json` as the Changesets source of truth. Run `pnpm changeset` (minor — additive), commit the resulting `.changeset/*.md`, and let `pnpm apply:changesets` (or the Version Packages PR) propagate the bump to `.claude-plugin/plugin.json` and `marketplace.json` via `scripts/sync-manifests.js`. Direct edits to `plugin.json`/`marketplace.json` produce three-way drift and fail `validate-versions.js` in CI.

<!-- deepen-plan: codebase -->
> **Codebase (2026-08-01, updated line refs):** Two Configuration tables exist with different column counts. `plugins/yellow-council/CLAUDE.md:111–116` is the canonical 4-column form (`Var | Type | Default | Purpose`). `plugins/yellow-council/commands/council/council.md:507–512` is the 3-column form (`Var | Default | Purpose`) used inline in the `/council` command help output. Any new env var (COUNCIL_OPENCODE_MODEL, COUNCIL_DOUBLE_PASS_SYNTHESIS, COUNCIL_MIN_REVIEWERS, COUNCIL_CLAUDE_TIER, COUNCIL_CODEX_TIER) must be added to BOTH tables. Phase 7 PR-A through PR-E should each include a "Configuration table sync check" step in their PR description. Separately: `CLAUDE.md:57` "Commands (1)" is stale (actual: 2 — `council.md` + `setup.md`); fix in PR-A while touching the file.
<!-- /deepen-plan -->

### Task 1.5: Update root marketplace count if needed (XS, 15min)

**File:** `README.md` (root) — only if reviewer count is mentioned

---

## Phase 2: Self-enhancement bias mitigation (~1 day)

<!-- deepen-plan: external -->
> **Research (Q4, 2026 state of the art — supersedes revision 1's framing):** Double-blind anonymization + order-swap are confirmed **necessary but not sufficient**: (1) TrustJudge (arXiv 2509.21117) measures ~18.7% verdict non-transitivity even WITH order-swapping; (2) a 2026 self-preference study (arXiv 2604.22891v4) shows models implicitly recognize their own outputs via stylistic cues even when identity is hidden. The cheapest effective addition is **structured multi-dimensional rubric decomposition** (score correctness / completeness / style / constraint-adherence independently, then combine) — ~31.5% average self-preference reduction, no retraining (new Task 2.4). Meta-judge guidance (Wu et al.): treat swap-inconsistent outcomes as **ties**, never force a winner — Task 2.2's low-confidence flag already aligns; make the tie semantics explicit. New failure mode specific to this plan's architecture: *meta-judges favor judgments they perceive as more confident* — the synthesizer prompt must be told it is also a participant and must not over-weight confident-sounding findings (folded into Task 2.1). CARE (NeurIPS 2025) supports treating the synthesizer as one of several correlated judges — V3 candidate. Whether meta-judge bias is amplified when synthesizer and one reviewer share a model family (exactly this plan) is an explicitly open research question — the empirical REVISE-rate guardrail in Task 1.1 is the practical mitigation.
<!-- /deepen-plan -->

### Task 2.1: Double-blind lineage labels in synthesis (S, 3h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 5

Before constructing the synthesis input, strip reviewer names. Map `claude` / `codex` / `gemini` / `opencode` → randomized `R1` / `R2` / `R3` / `R4` per invocation. Pass the labeled findings to the synthesis logic. Restore the mapping in the final report's "Agreement" / "Disagreement" sections so attribution is preserved for the user.

The randomization is per-invocation, not deterministic — prevents the synthesizer from learning that "R1 is always Claude."

Additionally (2026 research, see the Phase 2 annotation): the synthesis prompt must include an explicit self-participant instruction — the synthesizer is told that one of the anonymized reviewers may share its model family, that meta-judges measurably over-weight confident-sounding judgments, and that it must weigh findings by cited evidence, not rhetorical confidence.

### Task 2.2: Two-pass order-swap synthesis — DEFAULT ON (M, 4h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 5

**Decision (locked):** 2-pass synthesis is enabled by default. User can disable per-invocation or globally.

Modify synthesis to run twice:
- Pass A: reviewers in order R1, R2, R3, R4
- Pass B: reviewers in order R4, R3, R2, R1

A finding is marked `low-confidence-synthesis` if its verdict flips between pass A and pass B (e.g., `APPROVE` → `REVISE`), or if its confidence tier changes without a verdict flip (e.g., `HIGH` → `LOW`). Swap-inconsistent findings are treated as **ties** — the report presents both readings and does not pick a winner (2026 meta-judge guidance; see the Phase 2 annotation). The headline includes the count and percentage of low-confidence findings.

For V1's descriptive synthesis (no scoring), this manifests as: a finding that appears in pass A's "Agreement" section but pass B's "Disagreement" section is flagged as low-confidence.

**Toggle mechanisms:**
- Env var: `COUNCIL_DOUBLE_PASS_SYNTHESIS=0` disables globally (default `1`)
- Per-invocation flag: `/council review --single-pass` — bypass for the current run only
- When disabled, the report still runs Pass A but skips Pass B and the variance comparison; headline omits the "low-confidence: X%" annotation

**Pass B quota-fallback (locked decision):** if Pass A completes successfully but Pass B hits a Claude quota wall mid-run, ship Pass A's synthesis with a headline annotation: `low-confidence-synthesis check skipped (pass B quota-exhausted at <ETA>; verdict-flip analysis unavailable for this run)`. Rationale: the 4 reviewer messages have already been debited from their respective subscription quotas — wasting them by aborting the whole council run is strictly worse than shipping a single-pass result the user can interpret accordingly. This does NOT contradict Task 3.3's "do NOT retry" policy: we are NOT retrying Pass B; we are degrading gracefully to single-pass output. The orchestrator must NOT auto-trigger a retry of Pass B even if the quota window resets later in the same `/council` session.

**Quota cost note (surface in `/council` Step 1 pre-flight):** Each `/council` review debits **multiple Claude messages**, not just the in-process reviewer turn. Per review the orchestrator spawns 4 Task subagents (claude-reviewer + codex-reviewer/gemini-reviewer/opencode-reviewer wrappers); each Task subagent consumes ≥1 Claude orchestrator message even if its body invokes an external CLI via Bash. Plus N synthesis messages (1 for single-pass, 2 for double-pass). Conservative estimate: 4 (fan-out) + 1–2 (synthesis) = **5–6 Claude messages per review**. Anthropic no longer publishes numeric per-tier caps (see the Phase 3 annotation), so express headroom in per-review units: pre-flight should warn when the tracker estimates fewer than ~2 reviews of Claude headroom remain in the current window and recommend `--single-pass` for that invocation. [unverified: exact Claude message count per Task subagent spawn depends on subagent turn structure; calibrate empirically in PR-A and adjust the warning threshold before PR-C ships.]

<!-- deepen-plan: external -->
> **Research (Q4, threshold validity — carried forward, still valid):** The old 15% verdict-variance threshold was a community convention derived from Zheng et al. 2023's 10–30% positional-bias measurements. The binary verdict-flip heuristic the body now uses is the defensible form; 2026 guidance strengthens it — flips are ties, not coin-flips to re-adjudicate. TrustJudge's distribution-sensitive scoring (4.4–5.6% residual non-transitivity vs. 18.7% for plain order-swap) is the V3-grade upgrade if flip rates stay high in practice.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q4, uncertainty-gated second pass — REVISED from revision 1):** Revision 1 recommended "Bayesian Orchestration (Kim et al. 2026)" as the V2.5 gate-pass-B-on-uncertainty candidate. Correction: the Bayesian-orchestration line of work (arXiv 2605.00742v2) is an explicitly self-described **position paper** with no production evidence — do NOT adopt it as a baseline. The better-supported V2.5 candidate for the same idea is **TH-Score-style uncertainty gating** (arXiv 2508.06225v2): accept high-confidence pass-A judgments as-is and run pass B only for low-confidence ones, saving ~50% of synthesizer messages on clean reviews. Same V2.5 sequencing as before: ship unconditional 2-pass first, measure, then gate.
<!-- /deepen-plan -->

### Task 2.3: Update SKILL.md with synthesis rubric (S, 1h)

**File:** `plugins/yellow-council/skills/council-patterns/SKILL.md`

Document the new synthesis contract (double-blind + 2-pass + rubric decomposition + tie semantics) so future agent updates respect it.

### Task 2.4: Structured multi-dimensional rubric decomposition (NEW in revision 2) (S, 3h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 5

Instead of asking the synthesizer for a single holistic judgment per finding, decompose each finding's assessment into independent dimensions — correctness of the cited evidence, completeness (does the finding describe the full failure path), severity calibration, and constraint-adherence (does it respect the repo's stated conventions) — scored separately and then combined mechanically. Per the 2026 self-preference study this cuts measured self-preference bias by ~31.5% with zero retraining, and it composes with (does not replace) the double-blind labels and order-swap.

Implementation shape: the synthesis prompt template gains a per-finding rubric block; the combination rule is a simple all-dimensions-summary (no weighting math in V2 — a finding is "well-supported" only if correctness AND completeness both hold). Document the rubric in Task 2.3's SKILL.md update.

---

## Phase 3: Subscription quota tracking (~1 day)

<!-- deepen-plan: external -->
> **Research (Q3, quota landscape — supersedes revision 1's numeric-cap framing):** Do NOT build the tracker around published numeric caps — they are unpublished or promo-distorted as of 2026-08: (a) **Anthropic no longer publishes exact per-tier numeric limits**; the structure is a rolling 5-hour session window PLUS live weekly caps measured in active-compute-hours (idle excluded; Max plans carry two weekly limits: all-models and Sonnet-only). The 5-hour limits were doubled 2026-05-06; a +50% weekly promo ran 2026-05-13→07-19 and has EXPIRED — any numbers from blog posts in that window are wrong now. Official Claude Code exhaustion strings (code.claude.com/docs/en/errors): `You've hit your session limit · resets 3:45pm`, `You've hit your weekly limit · resets Mon 12:00am`, `You've hit your Opus limit · resets 3:45pm`; community fallback variant `Claude AI usage limit reached, please try again after [time]`. HTTP 529 server errors do NOT consume quota — never treat as exhaustion. (b) **Codex is no longer message-metered**: since 2026-04-09 usage is metered as *minutes of reasoning* per 5-hour window. Exhaustion signals: HTTP 429 with `insufficient_quota` (billing/cap), `model_cap_exceeded` (model-specific cap), vs. transient generic 429. The Pro=10×Plus promo expired 2026-05-31. Exact minutes-per-tier are community-sourced only — treat as unverified. (c) **Google/Antigravity**: `RESOURCE_EXHAUSTED` remains the gRPC-convention floor; NO official Antigravity-CLI quota numbers or exhaustion strings are published anywhere — capture empirically in the Task G.1 spike; a single forum comment claims consumer Antigravity bills per-token (in tension with the keyring/session-token migration docs) — verify, do not assume. **Design consequence:** the tracker's primary mechanism is error-string recalibration (learn the wall when you hit it, extract the reset ETA from the error text); numeric pre-flight estimates are secondary, user-configured, and advisory.
<!-- /deepen-plan -->

### Task 3.1: Quota state file + helper functions (M, 4h)

**Files:**
- `plugins/yellow-council/skills/council-patterns/SKILL.md` — add `track_quota_usage()` and `check_quota_headroom()` helper functions
- New: `plugins/yellow-council/lib/quota.sh` (sourced by `/council` and reviewers)

State file: `~/.config/yellow-council/quota.json`

Schema (revision 2 — caps are user-configured estimates, not vendor-published facts):

```json
{
  "claude": {
    "used": 0, "cap": null, "window_start": "2026-08-01T14:00:00Z", "window_hours": 5,
    "weekly_used": 0, "weekly_cap": null, "weekly_window_start": "2026-07-28T00:00:00Z", "weekly_window_hours": 168,
    "tier": "pro"
  },
  "codex": { "used": 0, "cap": null, "window_start": "...", "window_hours": 5, "tier": "plus" },
  "gemini": { "used": null, "binary": "agy", "note": "Antigravity quota model unpublished; error-string detection only" },
  "opencode": { "used": null, "model": "deepseek/deepseek-v4-pro" }
}
```

`cap: null` means "unknown — pre-flight arithmetic disabled for this reviewer until the user sets a cap or the tracker observes an exhaustion event." Users who want numeric pre-flight warnings set caps explicitly via the tier env vars below; the helper treats vendor caps as unknowable by default because providers stopped publishing them (see the Phase 3 annotation). The `gemini` entry joins `opencode` as error-string-only: Antigravity's quota model is unpublished (Task G.1 spike may upgrade this).

**Dual-window invariant for Claude (helpers MUST honor):** Anthropic enforces both a 5-hour rolling window AND live weekly caps (weekly limits are in effect NOW — measured in active-compute-hours, with Max tiers carrying a second Sonnet-only weekly limit; revision 1's "announced for August 2026" framing is obsolete). The schema tracks BOTH windows independently:
- `used` / `cap` / `window_start` / `window_hours` → 5h rolling window
- `weekly_used` / `weekly_cap` / `weekly_window_start` / `weekly_window_hours` → weekly window

`track_quota_usage()` MUST increment BOTH `used` and `weekly_used` on every Claude debit. `check_quota_headroom()` MUST surface whichever window is closer to exhausted (`min(cap-used, weekly_cap-weekly_used)`, skipping null caps). The recalibration step on quota-exhausted detection (Task 3.3) MUST key on the error-message variant — `session limit` → set `used = cap` (or mark the 5h window exhausted if cap is null) + `window_start = now`; `weekly limit` → mark the weekly window exhausted — and MUST parse the reset time out of the error text (`resets 3:45pm` / `resets Mon 12:00am`) since that is the only authoritative ETA available. Without this distinction, the tracker reports a 5-hour ETA when the user is actually blocked for days.

**Schema invariant (helpers MUST honor):** entries whose `used` is `null` (`gemini`, `opencode`) are not tracked numerically. `track_quota_usage()` and `check_quota_headroom()` MUST skip them during increment and headroom-check operations — do not coerce to `0`, do not increment, do not warn on `< headroom × N` math. Same rule for numeric entries whose `cap` is `null`: increments still count (so an eventual exhaustion event can back-fill the cap estimate), but headroom warnings are suppressed.

Heuristic increment: each reviewer invocation with numeric `used` increments by 1 (or 2 for synthesizer turns). Window expiry triggers reset. Recalibration on quota-exhausted error: per the dual-window rules above, using the parsed reset time from the provider's error text as the ETA.

User-configurable tier labels via env vars (used for display and for optional user-supplied cap presets documented in CLAUDE.md — labels only, no hardcoded vendor numbers in code):
- `COUNCIL_CLAUDE_TIER` = `pro` | `max-5x` | `max-20x` (default `pro`)
- `COUNCIL_CODEX_TIER` = `plus` | `pro` | `team` (default `plus`)

(Revision 2 drops `COUNCIL_GEMINI_TIER` — Antigravity's quota model is unpublished; reinstate if the Task G.1 spike surfaces a usable structure.)

<!-- deepen-plan: codebase -->
> **Codebase (carried forward, still true 2026-08-01):** No existing precedent for `~/.config/yellow-council/quota.json` or any persistent quota state file in this repo. Every other plugin uses (a) shell env vars with `${VAR:-default}`, or (b) `userConfig` entries in `plugin.json` (limited to API keys and URLs). This task introduces a new state convention — document explicitly in CLAUDE.md "Known Limitations" with cleanup/reset guidance: `"yellow-council writes per-reviewer quota state to ~/.config/yellow-council/quota.json. To reset, delete the file or run COUNCIL_QUOTA_RESET=<reviewer> /council review."` This is the first plugin in the marketplace to maintain external mutable state outside the project tree.
<!-- /deepen-plan -->

### Task 3.2: Pre-flight headroom check in `/council` (S, 2h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 1 (Pre-flight)

Add a pre-flight that checks each reviewer's headroom before fan-out:
- If headroom for any numerically-tracked reviewer (non-null `used` AND non-null `cap`) is `< 2 * cost_per_review`, warn the user via AskUserQuestion with options:
  - Continue (proceed; reviewer may exhaust mid-review)
  - Skip this reviewer (continue with N-1 reviewers)
  - Cancel (abort the council invocation)
- If a reviewer's window is marked exhausted (from a prior recalibration event whose parsed reset time is still in the future), automatically emit `verdict=QUOTA_EXHAUSTED` (per Task 3.3) without spawning the reviewer — preflight and mid-review exhaustion converge on the same verdict so headline/ETA reporting is uniform regardless of detection point.
- **Minimum-quorum gate:** if the count of active reviewers (not exhausted, after any user-chosen "skip this reviewer" responses) falls below `COUNCIL_MIN_REVIEWERS` (default `2`), surface a final AskUserQuestion: "Continue with N active reviewer(s) — `Agreement (cited by 2+ reviewers)` bucket will be empty / synthesis signal degraded" or "Cancel." Document `COUNCIL_MIN_REVIEWERS` in BOTH Configuration tables (per the Task 1.4 codebase annotation). Rationale: the headline and synthesis sections were designed around quorum language; with <2 active reviewers the ensemble argument collapses and the user should consciously opt in.

### Task 3.3: Quota-exhausted handler (S, 2h)

**File:** `plugins/yellow-council/agents/review/*.md` (all 4 reviewers)

In each reviewer's CLI invocation step, detect quota-exhausted error patterns specific to that provider (per the Phase 3 annotation for exact strings and their vintage):
- Claude (via Task subagent return): match `/session limit.*resets/i`, `/weekly limit.*resets/i`, `/Opus limit.*resets/i` (official Claude Code error catalog), plus fallback `/usage limit reached.*try again/i`; do NOT match generic `"rate limit"` (transient) or HTTP 529 (server error, does not consume quota)
- Codex CLI: match `insufficient_quota` or `model_cap_exceeded` for cap exhaustion vs. plain `rate_limit_exceeded` / generic 429 for transient
- Antigravity CLI (`agy`): match `RESOURCE_EXHAUSTED` as the floor; add spike-verified Antigravity-specific strings from Task G.1 — do NOT assume Gemini CLI's old quota-metric message shapes carry over
- OpenCode: parse the `error` event in `opencode run --format json` SSE stream; match the underlying provider's quota text

On detection, return the **full 6-key block** (stub the 3 keys that don't apply to a quota-exhausted reviewer so `council.md`'s Step 4 parser stays uniform across all 4 reviewers — no special-case branch, per the locked decision in the codebase annotation below):

```text
verdict=QUOTA_EXHAUSTED
confidence=N/A
summary=<reviewer> subscription quota exhausted; window resets at <ETA parsed from provider error text>
fenced_output_path=/dev/null
findings_block_begin
findings_block_end
```

`fenced_output_path=/dev/null` keeps the parser's path-lookup happy without producing a real findings file (reading `/dev/null` returns empty, which the synthesis loop already handles for reviewers with zero findings). The empty `findings_block_begin`/`findings_block_end` pair satisfies the contract while carrying no findings. Together these mean the QUOTA_EXHAUSTED path uses the SAME parse helpers as APPROVE/REVISE/etc — the only difference is the verdict-case-statement entry routing it to the headline ETA section instead of the synthesis input.

Update `council.md` Step 4 parse logic AND add `QUOTA_EXHAUSTED` to the verdict case-statement allow-list in all four reviewer agent files (`plugins/yellow-codex/agents/review/codex-reviewer.md` after PR-0 normalization, `plugins/yellow-council/agents/review/gemini-reviewer.md` — case-statement now at lines 322–325, `plugins/yellow-council/agents/review/opencode-reviewer.md` — now at 414–417, and the new `plugins/yellow-council/agents/review/claude-reviewer.md`) to handle `QUOTA_EXHAUSTED` as a UNAVAILABLE-class verdict (excluded from synthesis count, surfaced in headline with ETA). Without all 5 file updates, the verdict will silently normalize to `UNKNOWN` per the `*) VERDICT="UNKNOWN"` fallback.

<!-- deepen-plan: codebase -->
> **Codebase (locked decision carried forward; line refs updated 2026-08-01):** `QUOTA_EXHAUSTED` cannot piggyback on UNAVAILABLE without code changes. Both `gemini-reviewer.md:322–325` and `opencode-reviewer.md:414–417` have `case "$VERDICT" in APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE) ;; *) VERDICT="UNKNOWN"` — any unrecognized verdict (including `QUOTA_EXHAUSTED`) is silently normalized to `UNKNOWN`. Two paths were considered: (a) add `QUOTA_EXHAUSTED` to the case-in list in all reviewers + headline exclusion logic in `council.md` Step 5 Rule 1; OR (b) reuse `verdict=ERROR` with a summary keyword and let synthesis grep the summary. **Decision (locked):** path (a) — the quota-vs-error distinction is too important to bury in a summary string, especially since the recovery path differs (wait vs. retry).
<!-- /deepen-plan -->

### Task 3.4: Documentation (S, 1h)

**File:** `plugins/yellow-council/CLAUDE.md`

Add new section "Subscription Quota Tracking" with:
- The error-string detection model and why numeric caps are user-supplied (providers stopped publishing them — with as-of date 2026-08-01)
- Env var overrides (`COUNCIL_CLAUDE_TIER`, `COUNCIL_CODEX_TIER`)
- Recovery procedure when quota is exhausted (wait for the reset time parsed from the provider's error text)
- Note on heuristic accuracy (best-effort; recalibrates on actual quota-exhausted errors)
- `COUNCIL_QUOTA_RESET` reset escape-hatch (see Task 3.5)
- `COUNCIL_MIN_REVIEWERS` quorum gate (default `2`; see Task 3.2)

### Task 3.5: COUNCIL_QUOTA_RESET reset handler (XS, 1h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 1 (Pre-flight, before the headroom check)

Implements the manual reset escape-hatch promised in Risk R2's mitigation. Pre-flight inspects `COUNCIL_QUOTA_RESET` and clears the matching `quota.json` entry before any headroom check runs:

```bash
if [ -n "${COUNCIL_QUOTA_RESET:-}" ]; then
  case "$COUNCIL_QUOTA_RESET" in
    all)
      # Reset claude/codex entries (used=0, window_start=now); for claude ALSO reset weekly_used=0 + weekly_window_start=now per the Task 3.1 dual-window invariant; preserve gemini.used=null and opencode.used=null per Task 3.1 invariant — those entries are sentinels, not numeric
      ;;
    claude)
      # Clear BOTH 5h-window fields (used=0, window_start=now) AND weekly-window fields (weekly_used=0, weekly_window_start=now); per Task 3.1 dual-window invariant, leaving weekly state stale would keep pre-flight in a false-exhausted state after the reset
      ;;
    codex)
      # Clear just codex's used/window_start
      ;;
    gemini|opencode)
      # No-op — these entries have no numeric `used` per the Task 3.1 schema. Reset is meaningless here; do nothing.
      ;;
    *)
      echo "[council] Unknown reviewer for COUNCIL_QUOTA_RESET: $COUNCIL_QUOTA_RESET (ignored)" >&2
      ;;
  esac
  echo "[council] Quota reset: $COUNCIL_QUOTA_RESET"
fi
```

Document the escape-hatch in CLAUDE.md (Task 3.4) so users encountering quota miscounts have a one-shot fix without manually editing `quota.json`. Without Task 3.5, the only recovery is `rm ~/.config/yellow-council/quota.json` — exactly the opaque workaround R2's mitigation aims to replace.

---

## Phase 4: OpenCode 4th-lineage routing (~half day)

<!-- deepen-plan: external -->
> **Research (Q2, OpenCode routing — REVISES revision 1's locked recipe):** Revision 1 locked "bare 2-segment slug + `defaultProvider: \"openrouter\"` in `opencode.json`." External verification (2026-08-01) shows **`defaultProvider` does not exist in OpenCode's documented `opencode.json` schema** — the config docs and v1→v2 migration guide list only `provider`, `model`, `small_model` (v1 only), and `default_agent`. A `defaultProvider`/`defaultModel` pair DOES exist but only inside the internal `auth.json` (OAuth/session data), defaulting to `"anthropic"` — not a supported user-facing routing knob. What IS confirmed: `opencode run --model provider/model` (2-segment form) per official CLI docs; `opencode models` lists accepted slugs; `opencode auth list` is a real subcommand (with a known cosmetic bug: it can display "undefined" instead of the provider name — treat its exact output as unreliable, its exit code as meaningful). The exact slug OpenCode expects for OpenRouter-routed DeepSeek is UNVERIFIED — it may be the bare `deepseek/deepseek-v4-pro` or may require an `openrouter/`-prefixed form. **Task 4.0's spike is therefore load-bearing, not confirmatory: run `opencode models | grep -i deepseek` first and use whatever slug it prints.** DeepSeek V4 Pro itself is CONFIRMED live on OpenRouter (released 2026-04-24; 1.6T/49B-active MoE, 1M context, $0.435/$0.87 per 1M in/out; SWE-Bench Verified 80.6% — near Claude Opus 4.6's 80.8%) and remains a sound non-Big-3 lineage choice.
<!-- /deepen-plan -->

### Task 4.0: Pre-PR-D spike — resolve the actual OpenCode→OpenRouter routing recipe (S, 1h; upgraded from XS in revision 2)

**Why this is a task, not a footnote:** revision 1 assumed a `defaultProvider` config key that external research now shows is undocumented (see the Phase 4 annotation). The spike no longer merely validates a locked recipe — it DETERMINES the recipe.

**Procedure:**
1. Run `opencode models` and grep for deepseek — record the exact slug format OpenCode accepts (bare `deepseek/deepseek-v4-pro` vs. `openrouter/deepseek-v4-pro` vs. a 3-segment form)
2. Check auth state: `opencode auth list` (exit code is meaningful; printed provider names may show a known "undefined" cosmetic bug). If OpenRouter is not connected: `opencode auth login openrouter`
3. Run: `opencode run --model <slug from step 1> --format json "say hello"`
4. Capture: command exit code, JSON event stream, any error text
5. Outcomes:
   - **Success**: use the verified slug form in Task 4.1; update `docs/spikes/opencode-cli-format-json-2026-05-04.md` with the working command
   - **"model not found"**: try the alternate slug forms from step 1's list; record which resolves
   - **Other failure**: investigate; update Task 4.1 with the actual working invocation before continuing
6. Commit the updated spike doc as part of PR-D

<!-- deepen-plan: codebase -->
> **Codebase (2026-08-01):** The only in-repo evidence remains `docs/spikes/opencode-cli-format-json-2026-05-04.md:34` — `opencode run --model anthropic/claude-sonnet-4-5 --variant high "..."` working with a 2-segment slug (no newer opencode spike exists; `docs/spikes/` holds only this file and the gemini one). The Task 4.1 edit surface has moved: the invocation block is now `opencode-reviewer.md:169–177`, immediately preceded by the post-plan `PACK_BYTES` guard at 157–167 (added by #670/#676) — any `--model` insertion must not disturb the guard's early-exit UNAVAILABLE envelope. `COUNCIL_OPENCODE_VARIANT` default `high` is now at line 172.
<!-- /deepen-plan -->

### Task 4.1: Add `COUNCIL_OPENCODE_MODEL` env var — defaults to the spike-verified DeepSeek slug (S, 2h)

**Decisions (revised 2026-08-01):**
- Env var name: `COUNCIL_OPENCODE_MODEL` (holds the exact slug `opencode models` accepts — expected 2-segment, but the authoritative form comes from Task 4.0)
- Default value: the Task 4.0-verified slug for DeepSeek V4 Pro (expected `deepseek/deepseek-v4-pro`; confirmed live on OpenRouter as of 2026-08-01)
- Provider routing: whatever mechanism Task 4.0 verifies. Do NOT rely on a `defaultProvider` key in `opencode.json` — it is not in the documented schema (see the Phase 4 annotation). Revision 1's "locked" `defaultProvider` recipe is rescinded.

**File:** `plugins/yellow-council/agents/review/opencode-reviewer.md` (invocation block at lines 169–177; do not disturb the `PACK_BYTES` guard at 157–167)

**Rationale for the DeepSeek default (unchanged):** genuine non-Big-3 lineage (distinct training corpus and RLHF), single-key OpenRouter routing, strong coding benchmarks at low cost.

<!-- deepen-plan: codebase -->
> **Codebase (carried forward, refs updated):** Three env-var-with-default precedents: (1) `CODEX_MODEL` at `codex-reviewer.md:136` — `-m "${CODEX_MODEL:-gpt-5.4}"`; (2) `COUNCIL_OPENCODE_VARIANT` at `opencode-reviewer.md:172` — `--variant "${COUNCIL_OPENCODE_VARIANT:-high}"`; (3) `COUNCIL_TIMEOUT` at `gemini-reviewer.md:158` (first mention line 64). None use `userConfig` for model selection — `userConfig` is reserved for API keys/URLs across the marketplace. The new `COUNCIL_OPENCODE_MODEL` follows established convention. The canonical OpenCode invocation block in `council-patterns/SKILL.md` is now at lines **366–380** (revision 1 cited 346–358, which is now the Gemini block) — any `--model` change in opencode-reviewer.md MUST be mirrored there.
<!-- /deepen-plan -->

Override examples (documented in CLAUDE.md, not enforced; slug forms subject to Task 4.0 verification):
- `COUNCIL_OPENCODE_MODEL=x-ai/grok-4` — independent training (via OpenRouter)
- `COUNCIL_OPENCODE_MODEL=mistralai/mistral-large` — European alignment (via OpenRouter)
- `COUNCIL_OPENCODE_MODEL=ollama/llama3.3` — local model (Ollama provider; $0 quota cost)
- `COUNCIL_OPENCODE_MODEL=` (empty) — defer to OpenCode's own config (V1 behavior)

**Pre-flight check at PR-D time:**
- Resolve the expected provider from `COUNCIL_OPENCODE_MODEL` using the Task 4.0-verified slug convention.
- Check availability via `opencode auth list` exit code (its printed output is unreliable — known "undefined" display bug); on non-zero, fall back to `opencode models` grep for the configured slug.
- If the slug doesn't resolve, surface a clear error: `[opencode-reviewer] Error: model <slug> not available. Run 'opencode auth login <provider>' or set COUNCIL_OPENCODE_MODEL to a listed model (see: opencode models).`
- Mark UNAVAILABLE rather than failing the whole council

Implementation: pass `--model "$COUNCIL_OPENCODE_MODEL"` to `opencode run` when the env var is set, using the Task 4.0-verified slug form.

### Task 4.2: Document OpenRouter/DeepSeek V4 Pro as default (S, 1h)

**File:** `plugins/yellow-council/CLAUDE.md`

Add a new "OpenCode Provider Routing" section. Lead with the default, then list overrides:

**Default:** DeepSeek V4 Pro via OpenRouter (slug per Task 4.0). Provides non-Big-3 lineage with a single subscription path (OpenRouter account used by OpenCode).

**Override candidates (set `COUNCIL_OPENCODE_MODEL`):** Grok, Mistral, local Ollama, or unset for V1 behavior (see Task 4.1 list).

Document `COUNCIL_OPENCODE_MODEL` in BOTH Configuration tables (per the Task 1.4 codebase annotation): the canonical 4-column table at `plugins/yellow-council/CLAUDE.md:111–116` AND the inline 3-column table at `plugins/yellow-council/commands/council/council.md:507–512`. Note in the Known Limitations section that OpenRouter routing requires `opencode auth login openrouter` before yellow-council is invoked.

### Task 4.3: Lineage diversity startup assertion (S, 1h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 1 (Pre-flight)

Add a best-effort lineage detection step:
- Claude reviewer: assume `anthropic`
- Codex CLI: read `~/.codex/config.toml` `model` field (default `gpt-5.3-codex` → `openai`); `codex --model` is not an introspection command
- Antigravity CLI: read the `agy` config location established in the Task G.1 spike (revision 1's `~/.gemini/settings.json` path predates the Antigravity migration — Antigravity relocated config; see the Phase G annotation); default lineage `google`
- OpenCode: read `COUNCIL_OPENCODE_MODEL` first; otherwise log "lineage unknown"

If two reviewers resolve to the same lineage, emit a non-blocking warning:

```text
[council] Warning: reviewers <X> and <Y> resolve to the same lineage (<lineage>).
Diversity argument is weakened. Consider configuring different models per slot.
```

Don't fail — the user might be running a homogeneous benchmark intentionally.

---

## Phase 5: Tier 1-2 evidence verification (~2.5 days, highest risk)

### Task 5.1: Add `verify_finding()` helper to SKILL (M, 1d)

**File:** `plugins/yellow-council/skills/council-patterns/SKILL.md`

Add a `verify_finding()` bash function that:
- Parses a finding's `<file>:<line>` reference
- Tier 1: source-aware exact match. The lookup target depends on `/council` mode: for `review` mode (the default, where the diff is against committed code) use `git show "HEAD:$file" | sed -n "${line}p"`; for `plan` / `debug` / `question` modes (where the input is the working tree) use `sed -n "${line}p" "$file"` if the file exists in the working tree, otherwise fall back to HEAD. When mode is unknown or `$file` is from a non-checkout context (URL, paste), skip Tier 1 and proceed directly to Tier 2.
- Tier 2: if exact fails, run `python3 -c "from rapidfuzz import fuzz; ..."` for fuzzy match (≥85% similarity → `fuzz.ratio(a, b) >= 85`; intuitive 0–100 scale, no inverted threshold)
- Returns `verified` / `fuzzy-verified` / `unverified`

**Library decision (locked, re-confirmed 2026-08-01):** `rapidfuzz` — yellow-council needs only similarity scoring, not the patch/apply semantics that motivate `diff-match-patch`. `rapidfuzz` is actively maintained, C++-backed (orders of magnitude faster on large inputs), and uses an intuitive 0–100 scale that avoids the inverted-threshold trap that `diff-match-patch`'s `Match_Threshold` exposes.

`rapidfuzz` Python availability:
- Check `python3 -c "import rapidfuzz"` at preflight
- Soft-skip Tier 2 if not installed (Tier 1 only); print a warning suggesting `pip install rapidfuzz`
- Document in CLAUDE.md as an optional dependency

<!-- deepen-plan: external -->
> **Research (Q3 revision-1 findings, carried forward — no 2026-08 contradiction found):** `rapidfuzz` remains the correct choice: `fuzz.ratio(a, b) >= 85` on the intuitive 0–100 scale is the plan-locked Tier 2 threshold; `python-Levenshtein` now delegates to rapidfuzz internally; both rapidfuzz and diff-match-patch are Python 3.12+-compatible with no reported distutils breakage. Helper invocation shape: `python3 -c "from rapidfuzz import fuzz; import sys; print(fuzz.ratio(open('/dev/stdin').read(), '<expected>'))"`. [unverified: Python 3.13+ compatibility reports remain sparse — re-verify if preflight allows newer Python]
<!-- /deepen-plan -->

### Task 5.2: Wire verification into synthesis (M, 1d)

**File:** `plugins/yellow-council/commands/council/council.md` Step 5

Before constructing the Agreement / Disagreement sections, run `verify_finding()` on each reviewer's findings. Reorganize the synthesis output:

```markdown
### Agreement (cited by 2+ reviewers, evidence verified)
<findings where ≥2 reviewers cited AND tier-1 or tier-2 verified>

### Agreement (cited by 2+ reviewers, evidence unverified)
<findings where ≥2 reviewers cited but no tier verifies>

### Disagreement
<≥2 reviewers cited but their verdicts are NOT unanimous (e.g., 2 APPROVE / 2 REVISE, or 3 REVISE / 1 APPROVE), regardless of verification tier>

### Single-Reviewer Findings (evidence verified)
<findings cited by exactly 1 reviewer AND tier-1 or tier-2 verified — kept because evidence holds even if quorum doesn't>

### Unverified Claims
<findings cited by exactly 1 reviewer with NO tier-1/2 verification — surfaced for manual review, not discarded>
```

Bucket-assignment rule (helpers MUST honor): every finding lands in exactly one bucket. Precedence: (1) `citation_count = 1` → Single-Reviewer Findings (evidence verified) OR Unverified Claims (split by verification pass/fail); (2) `citation_count ≥ 2` AND verdicts NOT unanimous across citing reviewers → Disagreement (verdict-split takes precedence over Agreement, so a 3:1 verdict split with majority verdict = REVISE routes to Disagreement, NOT Agreement); (3) `citation_count ≥ 2` AND verdicts unanimous across citing reviewers → Agreement (split by verification pass/fail). Do not silently discard unverified findings — surface them in the "Unverified Claims" section so the user can manually verify.

### Task 5.3: Update SKILL synthesis rubric documentation (S, 2h)

**File:** `plugins/yellow-council/skills/council-patterns/SKILL.md`

Document the new synthesis structure with verified/unverified buckets. Reference the research doc's tiered cascade.

---

## Phase 6: Final cross-cutting validation + e2e tests (~half day)

> **Note on validation cadence:** Tasks 6.1 (schema/plugin/agent validators) are also run BEFORE EACH PR submission as part of the per-PR checklist in Phase 7 — this is the standard CI baseline gate. Phase 6 is for the *final* end-to-end pass after PR-E lands, to catch integration issues that no individual PR's validation would surface (e.g., 4-way fan-out behavior, quota tracking accumulation, lineage assertion across all reviewers configured).

### Task 6.1: Final validation pass after PR-E lands (S, 1h)

```bash
pnpm validate:schemas
pnpm validate:plugins
pnpm validate:agents
pnpm test:unit
pnpm typecheck
```

Confirm W1.5 allowlist (`scripts/validate-agent-authoring.js` — allowlist now at lines 76–88) — claude-reviewer uses `Write` for the fenced-output file (per Task 1.1 locked decision), so its allowlist entry must be present.

### Task 6.2: Manual e2e test checklist (S, 2h)

**File:** `docs/testing/yellow-council-manual-tests.md`

Add 4-CLI test scenarios:
- Gemini slot responds via `agy` under consumer-subscription auth (Phase G regression check)
- All 4 reviewers APPROVE on a clean diff
- One reviewer QUOTA_EXHAUSTED (manual trigger by exhausting one quota); headline ETA matches the reset time in the provider's error text
- Lineage collision warning (configure 2 reviewers to same model)
- OpenCode routed to DeepSeek V4 Pro (verify the resolved slug appears in report header lineage map)
- Synthesis order-swap verdict-flip detected (manual injection of a flip-flop finding); flip presented as a tie, both readings shown
- 2-pass synthesis disabled via `--single-pass` flag
- Rubric decomposition present in synthesis output (per-finding dimension scores)
- Evidence verification — Tier 1 hit, Tier 2 hit (`rapidfuzz` ≥85), Tier 1+2 miss → finding lands in "Unverified Claims" bucket

### Task 6.3: Updated CHANGELOG (XS, 30min)

**File:** `plugins/yellow-council/CHANGELOG.md`

Document V2 changes:
- Changed: gemini-reviewer migrated from retired Gemini CLI to Antigravity CLI (`agy`)
- Added: claude-reviewer (4th lineage)
- Added: subscription quota tracking (error-string driven)
- Added: COUNCIL_OPENCODE_MODEL env var
- Added: lineage diversity startup assertion
- Added: double-blind labels + 2-pass order-swap + rubric-decomposition synthesis
- Added: Tier 1-2 evidence verification

---

## Phase 7: PR strategy (Graphite stack)

Single feature, but large enough to split into a stack of focused PRs to make review tractable. Recommended order:

```text
PR-G: Gemini → Antigravity migration (Phase G)              ← URGENT, independent PR, ships first (V1 is broken today)

PR-0: codex-reviewer contract normalization (Phase 0)       ← stack prerequisite (yellow-codex)
  └─ PR-A: claude-reviewer agent + 4-way fan-out (Phase 1)  ← foundation (yellow-council)
       └─ PR-B: double-blind + 2-pass + rubric synthesis     ← Phase 2 (depends on A)
            └─ PR-C: subscription quota tracking              ← Phase 3 (orthogonal*)
                 └─ PR-D: OpenCode 4th-lineage routing        ← Phase 4 (orthogonal*)
                      └─ PR-E: Tier 1-2 evidence verification ← Phase 5 (biggest)
```

PR-G is deliberately OUTSIDE the stack: it is a bugfix restoring V1 functionality, must not wait behind the V2 review pipeline, and touching gemini-reviewer.md first also stabilizes the line numbers the stack's later PRs reference.

\*PR-B/C/D are logically orthogonal — only PR-A's 4-way fan-out wiring is a hard prerequisite. The stack is linear for graphite-review tractability (one reviewer at a time per PR, smaller diffs). If schedule pressure makes parallel review desirable, PR-C and PR-D can be split into siblings of PR-B once PR-A merges.

Each PR includes:
- Code changes
- **CI baseline gate** (`pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`) — runs BEFORE submission
- **Configuration table sync check** — verify both `CLAUDE.md` (4-col, lines 111–116) and `council.md` (3-col, lines 507–512) tables are in lockstep
- Changeset entry (minor for PR-G behavior change; patch for PR-0 refactor; minor for PR-A through PR-E additive changes)
- Updated CLAUDE.md / README.md / CHANGELOG.md
- Manual test checklist additions in `docs/testing/yellow-council-manual-tests.md`

---

## Effort estimate

| Phase | Tasks | Effort |
|---|---|---|
| Phase G: Gemini → Antigravity migration | 4 tasks | ~half day + spike |
| Phase 0: codex-reviewer normalization | 4 tasks | ~half day |
| Phase 1: Foundation | 5 tasks | ~1 day |
| Phase 2: Bias mitigation | 4 tasks | ~1.25 days |
| Phase 3: Quota tracking | 5 tasks | ~1 day |
| Phase 4: OpenCode routing | 4 tasks | ~half day |
| Phase 5: Evidence verification | 3 tasks | ~2.5 days* |
| Phase 6: Final validation + e2e | 3 tasks | ~half day |
| **Total** | **32 tasks** | **~8 days** |

\*Phase 5 task sums = 1d (Task 5.1) + 1d (Task 5.2) + 2h (Task 5.3) ≈ 2.25 days. The ~2.5-day estimate adds a small buffer for the highest-risk phase (new Python dependency + new synthesis-output structure).

---

## Risks and mitigations

### R0 — Antigravity CLI unknowns (NEW in revision 2; blocks Phase G)

**Risk:** Three stacked unverified claims: (1) `agy` preserves consumer-subscription auth without an API key (docs' keyring/session-token migration language suggests yes; one forum comment claims per-token billing — direct contradiction); (2) `agy`'s headless output-format flags and exit codes are assumed by analogy to Gemini CLI, but Google says "no 1:1 feature parity at launch"; (3) Antigravity's quota model and exhaustion error strings are entirely unpublished.
**Mitigation:** Task G.1 spike resolves all three empirically before any code changes. Hard stop if (1) fails — escalate to the user with the fallback options (3-reviewer council, or Google lineage via OpenCode/OpenRouter `google/gemini-*` slugs).

### R1 — Claude reviewer's reasoning is too similar to orchestrator

**Risk:** Same model family, same Anthropic training. Even with separate conversation context, the Claude reviewer may produce findings highly correlated with what the orchestrator/synthesizer would produce, weakening the ensemble's anti-correlated-hallucination property. 2026 research adds nuance: self-preference bias is model-specific and can invert (measured self-DISfavor in some Claude models), and whether meta-judge bias amplifies when synthesizer and reviewer share a family is an open question.
**Mitigation (DECIDED, baked into Task 1.1):** Contrarian system prompt (edge-cases, error paths, race conditions, security boundaries; REVISE over APPROVE on borderline diffs). Empirical guardrail is now symmetric: flag if Claude-reviewer's REVISE rate deviates from the other 3 reviewers' average by more than ±25% in either direction. If correlation remains high after PR-A measurement, V3 should consider replacing the in-process Claude reviewer with a `claude -p` subprocess for true session isolation.

### R2 — Subscription quota tracking accuracy

**Risk:** Heuristic increment is approximate; providers no longer publish numeric caps at all (Anthropic), changed metering units (Codex: minutes of reasoning since 2026-04), or have unpublished quota models (Antigravity). Recalibration on quota-exhausted errors only happens after the user already hit the wall.
**Mitigation:** Make the tracker *advisory*, not *gating*, and error-string-driven rather than cap-arithmetic-driven (Task 3.1 revision-2 schema: `cap: null` disables numeric warnings until the user opts in or an exhaustion event calibrates). The pre-flight warns but doesn't block. Document explicitly in CLAUDE.md that the tracker is best-effort. Provide `COUNCIL_QUOTA_RESET=<reviewer> /council review` env-var escape-hatch (NOT a positional argument — Task 3.5 reads from the environment) to manually clear state.

### R3 — Evidence verification adds latency

**Risk:** Tier 2 fuzzy matching across all findings on a large diff could add seconds to synthesis. Tier 1 (exact match) is fast (`git show` + grep). Tier 2 (`rapidfuzz`) is per-finding sub-millisecond but could compound.
**Mitigation:** Run verification in parallel with synthesis prompt construction. Cap Tier 2 at top-N findings (e.g., 50) per reviewer. Skip Tier 2 entirely if `python3 -c "import rapidfuzz"` fails (per the Task 5.1 locked library decision).

### R4 — OpenCode provider configuration drift

**Risk:** User's OpenCode is configured to one provider via OpenCode's own auth/config; yellow-council overrides via `COUNCIL_OPENCODE_MODEL`. The two can drift, leading to confusion about which lineage is actually active — sharpened by the finding that the assumed `defaultProvider` config knob doesn't exist (Phase 4 annotation).
**Mitigation:** The lineage diversity startup assertion (Task 4.3) reports the *resolved* model name in the output report's metadata. The user sees "OpenCode → deepseek/deepseek-v4-pro" (or whatever the resolved slug is) in the report header. Task 4.0's spike pins the actual routing recipe before any code ships.

### R5 — Two-pass synthesis doubles synthesizer quota cost

**Risk:** 2-pass order-swap means 2 Claude synthesis messages per `/council` invocation instead of 1 — ≈6 messages per review double-pass vs. ≈5 single-pass (Task 2.2 accounting). Anthropic's caps are unpublished, so the relative cost matters more than absolute counts: double-pass reduces reviews-per-window by ~17%.
**Mitigation (DECIDED):** 2-pass is default ON for quality. User can disable per-invocation (`/council review --single-pass`) or globally (`COUNCIL_DOUBLE_PASS_SYNTHESIS=0`). Pre-flight warns when 2-pass is on AND estimated Claude headroom is below ~2 reviews (Task 2.2). V2.5 candidate: TH-Score-style uncertainty gating to run Pass B only on low-confidence verdicts (see the Task 2.2 annotation — NOT the Bayesian-orchestration position paper revision 1 cited).

### R6 — Verbosity bias remains unmitigated until V2.5

**Risk:** Source research (Dimension 10) labels three synthesizer-bias mitigations as "mandatory before any quality claim": (1) two-pass order-swap (Task 2.2), (2) double-blind lineage labels (Task 2.1), and (3) length-controlled scoring (Wang 2024, +22.9 pp win-rate inflation; length-controlled AlpacaEval raised human-preference correlation 0.94→0.98). V2 ships (1), (2), and the new rubric decomposition (Task 2.4) — but NOT (3). Until V2.5 lands, the synthesizer can systematically upweight more verbose findings.
**Mitigation:** Document the gap explicitly in CLAUDE.md "Known Limitations" so users interpret V2 synthesis output with this caveat in mind. PR-B's checklist includes a note about the deferred mitigation. When V2.5 lands, length-controlled scoring becomes the headline change.

---

## Open decisions to surface in PRs

**Locked by user 2026-05-08 (revision-2 status noted per item):**
- ✅ Env var: `COUNCIL_OPENCODE_MODEL` — still locked (name unchanged)
- ⚠️ REVISED: Default OpenCode routing recipe. `deepseek/deepseek-v4-pro` remains the intended default model (confirmed live on OpenRouter 2026-08-01), but the `defaultProvider: "openrouter"` `opencode.json` mechanism revision 1 locked is undocumented in OpenCode's schema and likely wrong — Task 4.0's spike now DETERMINES the routing recipe instead of validating it
- ✅ 2-pass synthesis: default ON; user toggle via `COUNCIL_DOUBLE_PASS_SYNTHESIS=0` or `--single-pass` flag
- ✅ Claude reviewer prompt: contrarian / devil's-advocate framing baked into Task 1.1 (guardrail now symmetric ±25%)
- ✅ Tier 2 fuzzy-match library: `rapidfuzz` (re-confirmed 2026-08-01)
- ✅ claude-reviewer tools: `[Read, Grep, Glob, Write]` — `Write` required for `fenced_output_path`; PR-A adds the matching `REVIEW_AGENT_ALLOWLIST` entry (allowlist now at `validate-agent-authoring.js:76–88`; denied list now includes `MultiEdit`)
- ✅ Minimum quorum: `COUNCIL_MIN_REVIEWERS=2` default; preflight surfaces AskUserQuestion when active reviewers drop below this threshold
- ✅ Length-controlled scoring deferred to V2.5 (V2-7); see Risk R6
- ✅ Pass B quota-fallback: degrade gracefully to Pass A's result with a headline annotation (no Pass B retry, no whole-run abort) — see Task 2.2

**New in revision 2 (not yet user-ratified):**
- Phase G ships as an independent urgent PR before the V2 stack (rationale: V1 broken today)
- `gemini-reviewer.md` keeps its filename/agent name through Phase G; rename to `antigravity-reviewer` deferred (subagent_type contract break)
- Quota tracker becomes error-string-driven with `cap: null` defaults (providers stopped publishing caps); `COUNCIL_GEMINI_TIER` dropped
- Task 2.4 rubric decomposition added to Phase 2 (~31.5% self-preference reduction, 2026 research)
- Swap-inconsistent synthesis verdicts are ties, not re-adjudicated

**Still open:**

1. **Synthesis as separate Task subagent vs. inline orchestrator logic?** Plan keeps inline (simpler). Pulling synthesis into a dedicated `synthesis-agent` Task gives cleaner double-blind boundary at the cost of an extra Claude message. Defer to V3 unless empirical bias measurements show inline synthesis is leaking lineage labels. (CARE-style correlated-judge aggregation is the V3-grade version of this.)

2. **Should the tier-1 evidence verification cover only diff lines, or full file?** Diff lines = exactly what was changed (high precision, may miss findings about pre-existing code). Full file = catches pre-existing-code findings (lower precision, more disk reads). Plan: diff lines for `review` mode; full file for `plan`/`debug`/`question` modes. Confirm in PR-E.

3. **Antigravity subscription-auth continuity (R0).** If the Task G.1 spike shows `agy` demands an API key or per-token billing for individual accounts, the Google slot cannot exist under the no-API-key constraint — decide between a 3-reviewer council or routing Google lineage through OpenCode/OpenRouter.

4. **OpenCode slug form for OpenRouter-routed DeepSeek.** Resolved by Task 4.0 (`opencode models` output is authoritative).

---

## Success criteria

The plan is successful when:

0. **The Gemini slot works again**: `/council review` on a consumer (Google AI Pro/Ultra) account returns a real verdict via `agy` (Phase G)
1. **codex-reviewer emits the structured 6-key block** (Phase 0) — `verdict=` / `confidence=` / `summary=` / `fenced_output_path=` / `findings_block_begin` / `findings_block_end`, matching gemini-reviewer's contract
2. `/council review` fans out to 4 reviewers (Claude in-process + Codex + Antigravity + OpenCode subprocess)
3. Synthesis output includes all five Task 5.2 buckets and per-finding rubric dimensions (Task 2.4)
4. Quota exhaustion in any single reviewer produces a clean `verdict=QUOTA_EXHAUSTED` with the provider-reported reset time in the headline, no retry
5. Lineage map in report header shows 4 distinct lineages (Anthropic / OpenAI / Google / Other — typically DeepSeek V4 Pro for Other)
6. 2-pass synthesis verdict-flip count is reported in the headline, flips presented as ties (or `--single-pass` cleanly bypasses)
7. Manual e2e tests pass on a fresh install with all 4 CLIs configured and OpenRouter wired into OpenCode

---

## Cross-references

- Source research: `docs/research/multi-cli-code-review-claude-codex-gemini-opencode.md` (pre-shutdown; Gemini sections describe the retired CLI)
- Plugin architecture: `plugins/yellow-council/CLAUDE.md`
- Existing reviewer agents: `plugins/yellow-council/agents/review/{gemini,opencode}-reviewer.md`
- Existing codex reviewer (Phase 0 normalization target): `plugins/yellow-codex/agents/review/codex-reviewer.md`
- Existing orchestrator: `plugins/yellow-council/commands/council/council.md`
- Existing skill: `plugins/yellow-council/skills/council-patterns/SKILL.md`
- OpenCode spike: `docs/spikes/opencode-cli-format-json-2026-05-04.md` (extend in Task 4.0)
- Antigravity spike (new, Task G.1): `docs/spikes/antigravity-cli-headless-2026-08.md`
- W1.5 allowlist (lineage of Bash exception): `scripts/validate-agent-authoring.js` (denied tools line 26, allowlist lines 76–88)
- Prior research (10-CLI version): `docs/research/yellow-council-multi-agent-code-review-p.md`

---

## References

External research sources used by `/yellow-research:workflows:deepen-plan` (revision 2, 2026-08-01; supersedes the May 2026 source list):

**Gemini CLI shutdown / Antigravity:**
- Google Developers Blog — "An important update: Transitioning Gemini CLI to Antigravity CLI" (2026-05-19) — official shutdown date (2026-06-18), enterprise/API-key exemption, `agy` replacement
- Antigravity docs — `antigravity.google/docs/cli/gcli-migration` — `agy` binary, keyring token migration, `agy plugin import gemini`, config relocations
- 9to5Google (2026-06-17) — independent shutdown-scope confirmation
- google-gemini/gemini-cli Discussion #27274 + release v0.49.0 (2026-06-25) — OSS repo continues; hosted consumer service does not
- Google codelab "Accelerating Development with Antigravity CLI" — headless `agy -p` for CI use

**OpenCode / DeepSeek:**
- OpenCode official docs (opencode.ai/docs/cli/, /docs/config/, /v2/docs/migrate-v1) — `provider/model` slug format; no `defaultProvider` in documented config schema
- OpenRouter DeepSeek V4 Pro model page — released 2026-04-24, pricing, benchmarks (SWE-Bench Verified 80.6%)
- OpenCode GitHub issue — `opencode auth list` "undefined" display bug (subcommand exists)

**Subscription quotas:**
- Anthropic Help Center + code.claude.com/docs/en/errors — 5h + weekly (active-compute-hours) structure, official exhaustion strings, 529 ≠ quota; numeric caps no longer published; 2026-05-06 limit doubling; +50% weekly promo expired 2026-07-19
- OpenAI forum/docs — Codex minutes-of-reasoning metering (since 2026-04-09), `insufficient_quota` / `model_cap_exceeded`; Pro=10×Plus promo expired 2026-05-31
- ai.google.dev — token-based API pricing, free-tier grounding limits; `RESOURCE_EXHAUSTED` gRPC convention

**LLM-as-judge bias (2026):**
- TrustJudge (arXiv 2509.21117) — 18.7% non-transitivity under plain order-swap; distribution-sensitive scoring
- Self-preference study (arXiv 2604.22891v4) — anonymization insufficient; model-specific β (Claude-Sonnet-4.5 self-disfavor −0.229); rubric decomposition −31.5% bias
- CARE (NeurIPS 2025) — confounder-aware correlated-judge aggregation
- TH-Score (arXiv 2508.06225v2) — uncertainty-gated second passes
- Length-controlled AlpacaEval (arXiv 2404.04475) — 0.94→0.98 human-preference correlation
- Bayesian orchestration (arXiv 2605.00742v2) — POSITION PAPER, not production-ready; downgraded from revision 1's V2.5 recommendation

**Skipped/unavailable sources in the 2026-08-01 session:** EXA deep-researcher (HTTP 410), Parallel Task Group (incomplete at window close, 2/4), Ceramic Q2 call (tool-side JSON parse error; fell back to Perplexity).
