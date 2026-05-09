# yellow-council V2: Four-CLI Architecture + Subscription-Auth Hardening

**Date:** 2026-05-08
**Status:** Plan (not yet started)
**Source research:** `docs/research/multi-cli-code-review-claude-codex-gemini-opencode.md`
**Current plugin state:** `plugins/yellow-council/` V1 (3 reviewers: Codex via yellow-codex, Gemini, OpenCode; single-shot; descriptive synthesis)
**Target state:** 4 reviewers (add in-process `claude-reviewer`), subscription-auth quota tracking, double-blind synthesis, OpenCode wired to non-Big-3 lineage, Tier 1-2 evidence verification

---

## Starting from a fresh session

If picking up this plan in a new conversation with no prior context, read in this order before beginning Phase 0:

1. **This plan** end-to-end (especially "Locked decisions" and "Risks and mitigations")
2. **Source research:** `docs/research/multi-cli-code-review-claude-codex-gemini-opencode.md` — explains why the architecture is asymmetric and which biases need active mitigation
3. **Existing reviewer agents** (the templates for claude-reviewer):
   - `plugins/yellow-council/agents/review/gemini-reviewer.md` (PRIMARY template — 6-key structured output)
   - `plugins/yellow-council/agents/review/opencode-reviewer.md` (secondary; same shape)
   - `plugins/yellow-codex/agents/review/codex-reviewer.md` (DRIFT — does NOT match shape; Phase 0 normalizes it)
4. **Orchestrator:** `plugins/yellow-council/commands/council/council.md` — Step 4 (parse_reviewer_return) and Step 5 (synthesis) are the main edit surfaces
5. **Skill:** `plugins/yellow-council/skills/council-patterns/SKILL.md` — canonical CLI invocation patterns (lines 346–358 specifically for OpenCode)
6. **W1.5 allowlist:** `scripts/validate-agent-authoring.js:15–38` — in case any reviewer needs to violate the read-only rule

The deepen-plan annotations (`<!-- deepen-plan: source -->` blocks) embedded throughout this document contain codebase- and research-validated specifics that supersede the plan body where they conflict. Always trust the annotation over the body if there's a contradiction.

---

## Goals (in priority order)

1. **Add Claude as the 4th reviewer slot** as in-process Task subagent (asymmetric architecture). Activates true 4-lineage diversity once OpenCode is wired to a non-Big-3 provider.
2. **Mitigate self-enhancement bias** in the Claude→Claude synthesis path via two-pass order-swap and double-blind lineage labels. This is the new #1 quality risk under the asymmetric architecture.
3. **Track subscription quotas per reviewer** so quota exhaustion fails gracefully (emit `verdict=QUOTA_EXHAUSTED`, surface ETA in headline, do not retry — see Task 3.3 for the reviewer-side handler).
4. **Wire OpenCode to a non-Big-3 lineage** (DeepSeek/Grok/Mistral) for genuine 4-lineage orthogonality.
5. **Add Tier 1-2 evidence verification** (exact match + `rapidfuzz` similarity ≥85) to the synthesis step. Tier 3 (ast-grep) is V3.

## Non-goals (deferred)

- Multi-round iterative review (`/council review --round 2`) — defer until V2-3 evidence verification lands; round 2 without verify-first gate is harmful (Reflexion, NeurIPS 2023).
- Persistent fleet management (`/council fleet *`) — V3.
- Bradley-Terry calibration, AgentAuditor branch verification, GitHub PR webhook pre-warming — V3+.
- Local quota query API — providers don't expose this; V2 uses heuristic tracking only.
- Direct API path (sidesteps subscription auth) — explicitly off the table per user requirement.
- **Length-controlled finding scoring** (Wang 2024 verbosity-bias mitigation) — deferred to V2.5 (V2-7 in research roadmap). The source research labels this "mandatory before any quality claim" (Dimension 10), but V2 ships only 2 of the 3 mitigations (order-swap + double-blind labels). Verbosity bias in synthesis remains a known quality gap until V2.5 — see Risk R6.

---

## Phase 0: codex-reviewer contract normalization (~half day, lands BEFORE PR-A)

**Why this is now Phase 0 instead of a V3 deferral:** the codebase research surfaced that `yellow-codex/agents/review/codex-reviewer.md` does NOT emit the same structured 6-key output block that gemini-reviewer and opencode-reviewer use. Adding claude-reviewer (Phase 1) creates 3 reviewers on the new contract and 1 on the old — `council.md`'s parse logic would need a special-case branch for codex, complicating PR-A. Normalizing codex first makes the 4-way fan-out uniform.

**Cross-plugin scope:** this PR touches `plugins/yellow-codex/`, not `plugins/yellow-council/`. Coordinate with yellow-codex maintainer if separate; same author = no coordination needed.

### Task 0.1: Audit codex-reviewer output gap (XS, 30min)

**File:** `plugins/yellow-codex/agents/review/codex-reviewer.md`

Read the existing reviewer's Step 7 output construction. Identify what's missing vs. the gemini/opencode 6-key shape:
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

Add the case-statement validation (`case "$VERDICT" in APPROVE|REVISE|...|UNAVAILABLE) ;; *) VERDICT="UNKNOWN"`) to match gemini-reviewer.md:223–226 (search for `case "$VERDICT" in APPROVE` — line numbers may shift).

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
> **Codebase:** Use `gemini-reviewer.md` as the structural template, NOT `codex-reviewer.md`. The three existing reviewers do NOT share a uniform contract: gemini-reviewer (lines 261–267) and opencode-reviewer (lines 323–331) emit the full 6-key block (`verdict=` / `confidence=` / `summary=` / `fenced_output_path=` / `findings_block_begin` / `findings_block_end`), while yellow-codex's `codex-reviewer.md` returns free-form prose with `[P1]` markers and a one-line summary. The new claude-reviewer must match gemini/opencode exactly. Verdict enum: `APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE` (gemini-reviewer.md:223–225, opencode-reviewer.md:273–276). Note: codex-reviewer's contract drift is a pre-existing inconsistency that may need separate addressing in a follow-up — surface this in the PR-A description.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase (locked decision):** claude-reviewer needs `Write` in `tools:` to create `/tmp/council-claude-fenced-XXXXXX.txt` for the 6-key contract — without it `council.md` would need a special-case "in-process reviewer" parser branch the plan tries to avoid. `scripts/validate-agent-authoring.js:20` defines `REVIEW_AGENT_DENIED_TOOLS = ['Bash', 'Write', 'Edit']`, so claude-reviewer with `Write` would fail validation unless added to `REVIEW_AGENT_ALLOWLIST` (lines 26–38). **Required action in PR-A:** add an allowlist entry for `plugins/yellow-council/agents/review/claude-reviewer.md` and document the exception (Write is used only to materialize the fenced output file; the agent does NOT modify repo state).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q5, contrarian framing):** No published peer-reviewed work describes a Claude-vs-Claude contrarian setup specifically. Empirically-effective framings (from prompt-engineering community + Anthropic model card guidance) include: (a) **competitive grading** — `"You will be graded on how many valid objections you raise that other reviewers missed, not on how many you agree with."`; (b) **explicit permission to diverge** — `"It is acceptable and expected that your conclusions will differ from other reviewers. Disagreement is valuable data, not a mistake."`; (c) **structured steelman-then-attack** — require stating strongest case FOR the change first, then systematically attack it. Framings that are **ignored or counterproductive**: vague `"be critical"` / `"play devil's advocate"` (RLHF tuning neutralizes); `"disagree with other reviewers"` referencing other outputs (causes argument against specific claims, reduces independent coverage); persona-only framing without task structure. **Recommended phrasing:** `"Your role is adversarial verification. If you find no issues, you have failed your task — look harder."` Aligns with the "agents that question their own conclusions" finding from Bayesian Orchestration research (Kim et al. 2026).
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

Tradeoff acknowledged: contrarian framing may produce lower base-rate APPROVE verdicts. Track empirically — if Claude-reviewer's REVISE rate exceeds the other 3 reviewers' average by more than 25%, the framing is over-tuned and should be softened.

### Task 1.2: Wire 4th reviewer into `/council` fan-out (S, 1h)

**File:** `plugins/yellow-council/commands/council/council.md`

In Step 4 (Parallel reviewer fan-out via Task), add the 4th Task spawn alongside the existing 3:

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
- `plugins/yellow-council/CLAUDE.md` — update Plugin Components section: "Agents (3)" with claude-reviewer added
- `plugins/yellow-council/README.md` — update reviewer count and lineage map
- `plugins/yellow-council/CHANGELOG.md` — add entry for V2 four-CLI architecture

**Version bump (do NOT hand-edit `plugin.json` or `marketplace.json`):** the repo's three-way sync model treats `plugins/yellow-council/package.json` as the Changesets source of truth. Run `pnpm changeset` (minor — additive), commit the resulting `.changeset/*.md`, and let `pnpm apply:changesets` (or the Version Packages PR) propagate the bump to `.claude-plugin/plugin.json` and `marketplace.json` via `scripts/sync-manifests.js`. Direct edits to `plugin.json`/`marketplace.json` produce three-way drift and fail `validate-versions.js` in CI.

<!-- deepen-plan: codebase -->
> **Codebase:** Two Configuration tables exist with different column counts. `plugins/yellow-council/CLAUDE.md:109–114` is the canonical 4-column form (`Var | Type | Default | Purpose`). `plugins/yellow-council/commands/council/council.md:462–467` is a 3-column form (`Var | Default | Purpose`) used inline in the `/council` command help output. Any new env var (COUNCIL_OPENCODE_MODEL, COUNCIL_DOUBLE_PASS_SYNTHESIS, COUNCIL_CLAUDE_TIER, COUNCIL_CODEX_TIER, COUNCIL_GEMINI_TIER) must be added to BOTH tables to keep them in sync. Phase 7 PR-A through PR-E should each include a "Configuration table sync check" step in their PR description.
<!-- /deepen-plan -->

### Task 1.5: Update root marketplace count if needed (XS, 15min)

**File:** `README.md` (root) — only if reviewer count is mentioned

---

## Phase 2: Self-enhancement bias mitigation (~1 day)

### Task 2.1: Double-blind lineage labels in synthesis (S, 3h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 5

Before constructing the synthesis input, strip reviewer names. Map `claude` / `codex` / `gemini` / `opencode` → randomized `R1` / `R2` / `R3` / `R4` per invocation. Pass the labeled findings to the synthesis logic. Restore the mapping in the final report's "Agreement" / "Disagreement" sections so attribution is preserved for the user.

The randomization is per-invocation, not deterministic — prevents the synthesizer from learning that "R1 is always Claude."

### Task 2.2: Two-pass order-swap synthesis — DEFAULT ON (M, 4h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 5

**Decision (locked):** 2-pass synthesis is enabled by default. User can disable per-invocation or globally.

Modify synthesis to run twice:
- Pass A: reviewers in order R1, R2, R3, R4
- Pass B: reviewers in order R4, R3, R2, R1

A finding is marked `low-confidence-synthesis` if its verdict flips between pass A and pass B (e.g., `APPROVE` → `REVISE`), or if its confidence tier changes without a verdict flip (e.g., `HIGH` → `LOW`). The headline includes the count and percentage of low-confidence findings. (Rationale for the binary heuristic — vs. an older `>15%` threshold — lives in the deepen-plan annotation below.)

For V1's descriptive synthesis (no scoring), this manifests as: a finding that appears in pass A's "Agreement" section but pass B's "Disagreement" section is flagged as low-confidence.

**Toggle mechanisms:**
- Env var: `COUNCIL_DOUBLE_PASS_SYNTHESIS=0` disables globally (default `1`)
- Per-invocation flag: `/council review --single-pass` — bypass for the current run only
- When disabled, the report still runs Pass A but skips Pass B and the variance comparison; headline omits the "low-confidence: X%" annotation

**Pass B quota-fallback (locked decision):** if Pass A completes successfully but Pass B hits a Claude quota wall mid-run, ship Pass A's synthesis with a headline annotation: `low-confidence-synthesis check skipped (pass B quota-exhausted at <ETA>; verdict-flip analysis unavailable for this run)`. Rationale: the 4 reviewer messages have already been debited from their respective subscription quotas — wasting them by aborting the whole council run is strictly worse than shipping a single-pass result the user can interpret accordingly. This does NOT contradict Task 3.3's "do NOT retry" policy: we are NOT retrying Pass B; we are degrading gracefully to single-pass output. The orchestrator must NOT auto-trigger a retry of Pass B even if the quota window resets later in the same `/council` session.

**Quota cost note (surface in `/council` Step 1 pre-flight):** Each `/council` review debits **multiple Claude messages**, not just the in-process reviewer turn. Per review the orchestrator spawns 4 Task subagents (claude-reviewer + codex-reviewer/gemini-reviewer/opencode-reviewer wrappers); each Task subagent consumes ≥1 Claude orchestrator message even if its body invokes an external CLI via Bash. Plus N synthesis messages (1 for single-pass, 2 for double-pass). Conservative estimate: 4 (fan-out) + 1–2 (synthesis) = **5–6 Claude messages per review**. On Claude Pro (45 msg / 5h): ~7 reviews per window with 2-pass on, or ~9 reviews per window with single-pass. Pre-flight should warn if `COUNCIL_DOUBLE_PASS_SYNTHESIS=1` AND Claude headroom is below `≈ 2 × per-review-cost` messages (i.e., < 12 if 2-pass, < 10 if single-pass) — recommend `--single-pass` for that invocation. [unverified: exact Claude message count per Task subagent spawn depends on subagent turn structure (system prompt + tool-use cycles); calibrate empirically in PR-A and adjust the warning threshold + per-review-cost in this note before PR-C ships.]

<!-- deepen-plan: external -->
> **Research (Q4, threshold validity):** The 15% verdict-variance threshold for "low-confidence synthesis" is a **community convention**, not a formally validated metric. Zheng et al. 2023 reported positional bias rates of 10–30% depending on model + task, leading to the informal rule. Most defensible practice (post-Zheng): treat **any verdict flip** between A→B and B→A passes as low-confidence rather than relying on a percentage threshold. Consider documenting "verdict-flip" detection alongside the 15% threshold so the user knows the latter is a heuristic.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q4, post-Zheng direction):** Bayesian Orchestration (Kim et al. 2026) is the most actionable post-Zheng research direction: gate the second pass on observed first-pass uncertainty rather than always running both. For yellow-council V2, this would mean: run pass A; if all 4 reviewers agreed unanimously on every finding's verdict, skip pass B. Saves ~50% of Claude synthesizer messages on clean reviews. Worth considering as a V2.5 enhancement after baseline 2-pass is shipped and measured.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q4, latency):** 2-pass synthesis adds 2–6 seconds wall-clock for typical Sonnet-class models on short synthesis prompts. Negligible for yellow-council since the bottleneck is the 4 parallel reviewer subprocess calls (15–60s each), not the synthesizer. Latency is not a reason to default off.
<!-- /deepen-plan -->

### Task 2.3: Update SKILL.md with synthesis rubric (S, 1h)

**File:** `plugins/yellow-council/skills/council-patterns/SKILL.md`

Document the new synthesis contract (double-blind + 2-pass) so future agent updates respect it.

---

## Phase 3: Subscription quota tracking (~1 day)

### Task 3.1: Quota state file + helper functions (M, 4h)

**Files:**
- `plugins/yellow-council/skills/council-patterns/SKILL.md` — add `track_quota_usage()` and `check_quota_headroom()` helper functions
- New: `plugins/yellow-council/lib/quota.sh` (sourced by `/council` and reviewers)

State file: `~/.config/yellow-council/quota.json`

Schema:
```json
{
  "claude": {
    "used": 0, "cap": 45, "window_start": "2026-05-08T14:00:00Z", "window_hours": 5,
    "weekly_used": 0, "weekly_cap": 250, "weekly_window_start": "2026-05-05T00:00:00Z", "weekly_window_hours": 168,
    "tier": "pro"
  },
  "codex": { "used": 0, "cap": 80, "window_start": "...", "window_hours": 3, "tier": "plus" },
  "gemini": { "used": 0, "cap": 1500, "window_start": "...", "window_hours": 24, "tier": "advanced" },
  "opencode": { "used": null, "model": "deepseek/deepseek-v4-pro" }
}
```

The `opencode.model` field mirrors `COUNCIL_OPENCODE_MODEL` for diagnostic display — OpenCode itself routes via OpenRouter so the underlying provider may impose its own quota; tracking that quota is a V3 enhancement (would require OpenRouter API introspection).

**Dual-window invariant for Claude (helpers MUST honor):** Anthropic enforces both a 5-hour rolling window AND a weekly cap (introduced Aug 2026; Max-tier feels the weekly window most often, but Pro can hit it too). The schema therefore tracks BOTH windows independently:
- `used` / `cap` / `window_start` / `window_hours` → 5h rolling window
- `weekly_used` / `weekly_cap` / `weekly_window_start` / `weekly_window_hours` → weekly window

`track_quota_usage()` MUST increment BOTH `used` and `weekly_used` on every Claude debit. `check_quota_headroom()` MUST surface whichever window is closer to exhausted (`min(cap-used, weekly_cap-weekly_used)`). The recalibration step on quota-exhausted detection (Task 3.3) MUST key on the error-message variant — set `used = cap` + `window_start = now` for the 5h variant (`"usage limit reached"` without weekly-window language), or set `weekly_used = weekly_cap` + `weekly_window_start = now` for the weekly variant — so the headline ETA reflects the correct reset horizon (~5h vs. potentially several days). Without this distinction, the tracker reports a 5-hour ETA when the user is actually blocked for days.

**Schema invariant (helpers MUST honor):** `opencode.used` is `null` (not numeric) because per-provider quota is not tracked locally. `track_quota_usage()` and `check_quota_headroom()` MUST skip any reviewer entry whose `used` is `null` during increment and headroom-check operations — do not coerce to `0`, do not increment, do not warn on `< headroom × N` math.

Heuristic increment: each reviewer invocation with numeric `used` increments by 1 (or 2 for synthesizer turns). Window expiry triggers reset. Recalibration on quota-exhausted error: set `used = cap`, `window_start = now` for the 5h-window variant; set `weekly_used = weekly_cap`, `weekly_window_start = now` for the weekly-window variant. (See "Dual-window invariant for Claude" above and Task 3.3 error-pattern table for which message variants map to which window.)

User-configurable caps via env vars:
- `COUNCIL_CLAUDE_TIER` = `pro` | `max-5x` | `max-20x` (default `pro`)
- `COUNCIL_CODEX_TIER` = `plus` | `pro` | `team` (default `plus`)
- `COUNCIL_GEMINI_TIER` = `free` | `advanced` | `pro` | `ultra` (default `advanced`)

Caps lookup table lives in the helper script with explicit "as of YYYY-MM-DD" annotation (provider caps drift).

<!-- deepen-plan: codebase -->
> **Codebase:** No existing precedent for `~/.config/yellow-council/quota.json` or any persistent quota state file in this repo. Every other plugin uses (a) shell env vars with `${VAR:-default}`, or (b) `userConfig` entries in `plugin.json` (limited to API keys and URLs across yellow-research, yellow-devin, yellow-composio, yellow-semgrep, yellow-morph). This task introduces a new state convention — document explicitly in CLAUDE.md "Known Limitations" with cleanup/reset guidance. Suggested phrasing: `"yellow-council writes per-reviewer quota state to ~/.config/yellow-council/quota.json. To reset, delete the file or run COUNCIL_QUOTA_RESET=<reviewer> /council review."` This is the first plugin in the marketplace to maintain external mutable state outside the project tree.
<!-- /deepen-plan -->

### Task 3.2: Pre-flight headroom check in `/council` (S, 2h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 1 (Pre-flight)

Add a pre-flight that checks each reviewer's headroom before fan-out:
- If headroom for any reviewer is `< 2 * cost_per_review`, warn the user via AskUserQuestion with options:
  - Continue (proceed; reviewer may exhaust mid-review)
  - Skip this reviewer (continue with N-1 reviewers)
  - Cancel (abort the council invocation)
- If headroom is 0 (already exhausted), automatically emit `verdict=QUOTA_EXHAUSTED` (per Task 3.3) without spawning the reviewer — preflight and mid-review exhaustion converge on the same verdict so headline/ETA reporting is uniform regardless of detection point.
- **Minimum-quorum gate:** if the count of active reviewers (headroom > 0, after any user-chosen "skip this reviewer" responses) falls below `COUNCIL_MIN_REVIEWERS` (default `2`), surface a final AskUserQuestion: "Continue with N active reviewer(s) — `Agreement (cited by 2+ reviewers)` bucket will be empty / synthesis signal degraded" or "Cancel." Document `COUNCIL_MIN_REVIEWERS` in BOTH Configuration tables (per the Task 1.4 codebase annotation). Rationale: the headline and synthesis sections were designed around quorum language; with <2 active reviewers the ensemble argument collapses and the user should consciously opt in.

### Task 3.3: Quota-exhausted handler (S, 2h)

**File:** `plugins/yellow-council/agents/review/*.md` (all 4 reviewers)

In each reviewer's CLI invocation step, detect quota-exhausted error patterns specific to that provider (per the deepen-plan annotation below for exact strings):
- Claude (via Task subagent return): match text containing `"usage limit reached"` or subscription-cap language; do NOT match generic `"rate limit"` (that's transient)
- Codex CLI: match `type: insufficient_quota` in OpenAI API error vs `rate_limit_exceeded` for transient
- Gemini CLI: match `RESOURCE_EXHAUSTED` status; distinguish subscription cap (`"Quota exceeded for quota metric 'generate_requests_per_day'"`) from free-tier RPM/RPD
- OpenCode: parse the `error` event in `opencode run --format json` SSE stream; match the underlying provider's quota text

On detection, return:

```text
verdict=QUOTA_EXHAUSTED
confidence=N/A
summary=<reviewer> subscription quota exhausted; window resets at <ETA>
```

Update `council.md` Step 4 parse logic AND add `QUOTA_EXHAUSTED` to the verdict case-statement allow-list in all four reviewer agent files (`plugins/yellow-codex/agents/review/codex-reviewer.md` after PR-0 normalization, `plugins/yellow-council/agents/review/gemini-reviewer.md`, `plugins/yellow-council/agents/review/opencode-reviewer.md`, and the new `plugins/yellow-council/agents/review/claude-reviewer.md`) to handle `QUOTA_EXHAUSTED` as a UNAVAILABLE-class verdict (excluded from synthesis count, surfaced in headline with ETA). Without all 5 file updates, the verdict will silently normalize to `UNKNOWN` per the `*) VERDICT="UNKNOWN"` fallback.

<!-- deepen-plan: codebase -->
> **Codebase:** `QUOTA_EXHAUSTED` cannot piggyback on UNAVAILABLE without code changes. Both `gemini-reviewer.md:222–226` and `opencode-reviewer.md:272–276` have `case "$VERDICT" in APPROVE|REVISE|REJECT|UNKNOWN|TIMEOUT|ERROR|UNAVAILABLE) ;; *) VERDICT="UNKNOWN"` — any unrecognized verdict (including `QUOTA_EXHAUSTED`) is silently normalized to `UNKNOWN`. Two paths were considered: (a) **Add `QUOTA_EXHAUSTED` to the case-in list** in BOTH existing reviewers + claude-reviewer + Headline exclusion logic in `council.md` Step 5 Rule 1; OR (b) **Reuse `verdict=ERROR` with summary keyword** like `"summary=Quota exhausted; window resets at <ETA>"` and let synthesis grep the summary. Path (b) is simpler (no new verdict propagation) but loses headline-level visibility — quota errors appear under "ERROR" in the Reviewer Status section, not as a distinct category. **Decision (locked):** path (a) — the quota-vs-error distinction is too important to bury in a summary string, especially since the recovery path differs (wait vs. retry).
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q2, signal patterns per CLI):**
> - **Claude Code Task subagent:** quota-exhausted error message contains `"usage limit reached"` or similar subscription language; transient 429 contains `"Rate limit exceeded"` and includes a `retry-after` header. As of Aug 2026, Anthropic added a weekly limit on top of the 5h limit — expect TWO message variants depending on which window was hit. [unverified: exact JSON error field name in subagent event stream]
> - **Codex CLI:** OpenAI API error `type` field is `insufficient_quota` for cap exhaustion vs `rate_limit_exceeded` for transient 429. `codex exec` likely propagates the API error message verbatim. [unverified: exact CLI exit code for quota vs rate-limit]
> - **Gemini CLI:** both free-tier RPM/RPD and Gemini Advanced subscription cap return `RESOURCE_EXHAUSTED` status. Distinction is in `message` body: free-tier mentions `"requests_per_minute"` / `"requests_per_day"` metrics; subscription says `"Quota exceeded for quota metric 'generate_requests_per_day'"`.
> - **OpenCode:** pass-through. The underlying provider's error appears as an `error` event in the SSE stream from `opencode run --format json`.
> **Implementation note:** parse the `summary=` and stderr text for distinguishing strings rather than relying on exit codes alone — `"usage limit"` / `"insufficient_quota"` / `"RESOURCE_EXHAUSTED"` indicate non-recoverable; `"rate limit"` / `"rate_limit_exceeded"` / `"429"` / `"try again"` indicate transient.
<!-- /deepen-plan -->

### Task 3.4: Documentation (S, 1h)

**File:** `plugins/yellow-council/CLAUDE.md`

Add new section "Subscription Quota Tracking" with:
- Caps lookup table (with as-of date)
- Env var overrides
- Recovery procedure when quota is exhausted (wait for window reset)
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
      # Reset claude/codex/gemini entries (used=0, window_start=now); preserve opencode.used=null per Task 3.1 invariant — opencode is sentinel, not numeric
      ;;
    claude|codex|gemini)
      # Clear just that reviewer's used/window_start
      ;;
    opencode)
      # No-op on `used` (opencode.used is null sentinel per Task 3.1 invariant); only window_start may be touched, `used` stays null
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

### Task 4.0: Pre-PR-D spike — validate `opencode run --model` with bare slug (XS, 30min)

**Why this is a task, not a footnote:** the codebase only has a confirmed working `--model` invocation for 2-segment slugs (`anthropic/claude-sonnet-4-5`). The bare-slug-with-config-file approach (`--model deepseek/deepseek-v4-pro` + `defaultProvider: openrouter` in `opencode.json`) hasn't been spiked. If this fails, Task 4.1's implementation must use a fallback shape — better to discover this in 30 minutes of spike work than mid-PR.

**Procedure:**
1. Confirm OpenCode is configured: `opencode auth login openrouter` (or check `opencode.json` already has `defaultProvider: "openrouter"`)
2. Run: `opencode run --model deepseek/deepseek-v4-pro --format json "say hello"`
3. Capture: command exit code, JSON event stream, any error text
4. Outcomes:
   - **Success** (proper response): use bare-slug form in Task 4.1; update `docs/spikes/opencode-cli-format-json-2026-05-04.md` with the working command
   - **"model not found"**: try `--model openrouter/deepseek/deepseek-v4-pro` (3-segment); if that works, use it
   - **Other failure**: investigate; update Task 4.1 with the actual working invocation before continuing
5. Commit the updated spike doc as part of PR-D

[unverified: `opencode auth list` was used in Task 4.1 pre-flight as a configured-providers check; verify the exact subcommand exists in OpenCode v1.14+ during this spike. Fallback options if it doesn't: parse `opencode.json` directly with `jq`, or just proceed and let the actual `opencode run` fail with a clear error.]

### Task 4.1: Add `COUNCIL_OPENCODE_MODEL` env var — defaults to `deepseek/deepseek-v4-pro` (S, 2h)

**Decisions locked 2026-05-08:**
- Env var name: `COUNCIL_OPENCODE_MODEL` (holds a bare OpenRouter slug, not a provider/model combination)
- Default value: `deepseek/deepseek-v4-pro` (user-confirmed live on `openrouter.ai/models` May 2026)
- Provider routing happens via OpenCode's own config (`opencode.json` with `defaultProvider: "openrouter"` and `opencode auth login openrouter`), NOT via a CLI prefix on `--model`

**File:** `plugins/yellow-council/agents/review/opencode-reviewer.md`

**Decision (locked):** Default route is **OpenRouter → DeepSeek v4 Pro**. Rationale: OpenRouter is the cleanest subscription path (single API key, multi-provider routing), DeepSeek v4 Pro provides genuine non-Big-3 lineage (Chinese training corpus, distinct RLHF), and the user already has this configured.

Default value: `COUNCIL_OPENCODE_MODEL=deepseek/deepseek-v4-pro` (bare slug; OpenCode resolves the OpenRouter provider via `opencode.json` `defaultProvider` setting and `opencode auth login openrouter`).

User-confirmed live on `https://openrouter.ai/models` as of 2026-05-08.

<!-- deepen-plan: external -->
> **Research (Q1, OpenCode model syntax — important correction):** OpenCode does NOT use a `--model openrouter/...` CLI prefix. Provider routing is configured in `opencode.json` (or `~/.opencode/config.json`) with `defaultProvider: "openrouter"`, after which `--model` takes the **bare OpenRouter slug** (e.g., `--model deepseek/deepseek-v4-pro`, NOT `--model openrouter/deepseek/deepseek-v4-pro`). Authentication via `opencode auth login openrouter`. Plan should split the env var into two concepts: `COUNCIL_OPENCODE_MODEL` (the bare slug) and rely on the user's existing `opencode.json` to set `defaultProvider: openrouter`. Surfacing the OpenRouter prefix in `COUNCIL_OPENCODE_MODEL` may be ignored by OpenCode or produce a "model not found" error depending on config state. Recommended: rename the env var to `COUNCIL_OPENCODE_MODEL=deepseek/deepseek-v4-pro` (slug only) and document in CLAUDE.md that the user must have OpenRouter configured as a provider in OpenCode before yellow-council uses this.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** OpenCode `--model` flag IS confirmed as a real flag — `docs/spikes/opencode-cli-format-json-2026-05-04.md:34` shows `opencode run --model anthropic/claude-sonnet-4-5 --variant high "..."` working with a 2-segment provider/model slug. The 3-segment form (`openrouter/deepseek/deepseek-v4-pro`) is unvalidated in this codebase and inconsistent with OpenCode's documented config-file-based provider routing. Pre-PR-D action: run a manual spike — `opencode run --model deepseek/deepseek-v4-pro "test"` with OpenRouter pre-configured as default provider — to confirm the bare slug works. Update the spike doc with results before PR-D ships.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** Three concrete env-var-with-default precedents in this repo: (1) `CODEX_MODEL` in `plugins/yellow-codex/agents/review/codex-reviewer.md:131` — `-m "${CODEX_MODEL:-gpt-5.4}"`; (2) `COUNCIL_OPENCODE_VARIANT` in `plugins/yellow-council/agents/review/opencode-reviewer.md:110` — `--variant "${COUNCIL_OPENCODE_VARIANT:-high}"`; (3) `COUNCIL_TIMEOUT` in `plugins/yellow-council/agents/review/gemini-reviewer.md:118`. None use `userConfig` for model selection — `userConfig` is reserved for API keys/URLs across the marketplace. The new `COUNCIL_OPENCODE_MODEL` follows established convention.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** `council-patterns/SKILL.md:346–358` contains the canonical OpenCode invocation block. Any `--model` flag addition in `opencode-reviewer.md:107–113` MUST be mirrored in SKILL.md to keep the skill and agent in sync. Add SKILL.md as a required-change file in Task 4.1.
<!-- /deepen-plan -->

Override examples (documented in CLAUDE.md, not enforced):
- `COUNCIL_OPENCODE_MODEL=x-ai/grok-4` — independent training (via OpenRouter, bare slug)
- `COUNCIL_OPENCODE_MODEL=mistralai/mistral-large` — European alignment (via OpenRouter, bare slug)
- `COUNCIL_OPENCODE_MODEL=ollama/llama3.3` — local model (Ollama provider; user must set `defaultProvider: "ollama"` in `opencode.json`)
- `COUNCIL_OPENCODE_MODEL=` (empty) — defer to OpenCode's own config (V1 behavior)

**Pre-flight check at PR-D time:**
- Resolve the expected provider from `COUNCIL_OPENCODE_MODEL`: bare slugs like `deepseek/*`, `mistralai/*`, `x-ai/*` resolve to `openrouter`; `ollama/*` resolves to `ollama`; explicit `provider/model` slugs resolve to the prefix. The check verifies the **resolved** provider is configured, NOT a hard-coded `openrouter`.
- Try `opencode auth list` first (provider list); if that subcommand exits non-zero (older OpenCode versions don't have it — see Task 4.0 spike, currently `[unverified]`), fall back to parsing the OpenCode config file. The on-disk path varies across installs and OS — probe `~/.opencode/config.json`, `~/.opencode/opencode.json`, and `./opencode.json` (project-local) in that order; resolve which one OpenCode actually reads in the Task 4.0 spike before PR-D ships and pin the path then. Read `defaultProvider` (or the equivalent key in whatever config OpenCode uses).
- If neither path returns the expected provider, surface a clear error: `[opencode-reviewer] Error: <provider> not configured. Run 'opencode auth login <provider>' or set COUNCIL_OPENCODE_MODEL to a different provider.`
- Mark UNAVAILABLE rather than failing the whole council

Implementation: pass `--model "$COUNCIL_OPENCODE_MODEL"` to `opencode run` when the env var is set. OpenCode's model syntax is `provider/model-name` (bare 2-segment slug). Do NOT use a 3-segment `openrouter/provider/model-name` prefix — provider routing is handled by `opencode.json`, not by the model slug. See deepen-plan annotation above.

### Task 4.2: Document OpenRouter/DeepSeek v4 Pro as default (S, 1h)

**File:** `plugins/yellow-council/CLAUDE.md`

Add a new "OpenCode Provider Routing" section. Lead with the locked default, then list overrides:

**Default:** `deepseek/deepseek-v4-pro` (bare slug; routed through OpenRouter via `opencode.json` `defaultProvider: "openrouter"`). Provides non-Big-3 lineage with a single subscription path (OpenRouter API key used by OpenCode).

**Override candidates (set `COUNCIL_OPENCODE_MODEL`):**
- `x-ai/grok-4` — xAI Grok via OpenRouter (bare slug, independent training)
- `mistralai/mistral-large` — Mistral via OpenRouter (bare slug, European alignment)
- `ollama/llama3.3` — local model via Ollama provider ($0 quota cost, air-gapped; requires `defaultProvider: "ollama"` in `opencode.json`)
- *(unset)* — defer to OpenCode's own config

Document `COUNCIL_OPENCODE_MODEL` in BOTH Configuration tables (per the codebase annotation under Task 1.4): the canonical 4-column table at `plugins/yellow-council/CLAUDE.md:110–115` AND the inline 3-column table at `plugins/yellow-council/commands/council/council.md:463–466`. Note in the Known Limitations section that OpenRouter routing requires `opencode auth login openrouter` to be configured before yellow-council is invoked.

### Task 4.3: Lineage diversity startup assertion (S, 1h)

**File:** `plugins/yellow-council/commands/council/council.md` Step 1 (Pre-flight)

Add a best-effort lineage detection step:
- Claude reviewer: assume `anthropic`
- Codex CLI: read `~/.codex/config.toml` `model` field (default `gpt-5.3-codex` → `openai`); `codex --model` is not an introspection command
- Gemini CLI: read `~/.gemini/settings.json` `model` field (default `gemini-2.5-pro` → `google`); `gemini --model` is not an introspection command
- OpenCode: read `COUNCIL_OPENCODE_MODEL` first; otherwise log "lineage unknown"

If two reviewers resolve to the same lineage, emit a non-blocking warning:
```
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

**Library decision (locked):** `rapidfuzz` — yellow-council needs only similarity scoring, not the patch/apply semantics that motivate `diff-match-patch`. `rapidfuzz` is actively maintained (frequent 2025 releases), C++-backed (orders of magnitude faster on large inputs), and uses an intuitive 0–100 scale that avoids the inverted-threshold trap that `diff-match-patch`'s `Match_Threshold` exposes.

`rapidfuzz` Python availability:
- Check `python3 -c "import rapidfuzz"` at preflight
- Soft-skip Tier 2 if not installed (Tier 1 only); print a warning suggesting `pip install rapidfuzz`
- Document in CLAUDE.md as an optional dependency

<!-- deepen-plan: external -->
> **Research (Q3, threshold scale — CRITICAL CORRECTION):** `Match_Threshold` is a **tolerance/looseness scale**, NOT a similarity score. Range: `0.0 = exact match required`, `1.0 = accept any match`. To express "≥85% match," set `Match_Threshold = 0.15` (NOT `0.85`). Default is `0.5` (accept up to 50% error). The plan's "≥85% threshold" wording in Tier 2 is correct in spirit but the implementation must invert: `dmp.Match_Threshold = 0.15`. Add a comment in the helper explaining the inverted scale to prevent future contributors from "fixing" it backwards.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q3, alternative library):** `rapidfuzz` (pip install rapidfuzz) is the strongly recommended modern alternative for line-level fuzzy matching as of May 2026. Actively maintained (frequent 2025 releases), C++ backend (orders of magnitude faster than diff-match-patch on large inputs), and provides `fuzz.ratio(a, b) >= 85` with intuitive 0–100 percentage scale (no inverted threshold). `python-Levenshtein` now delegates to rapidfuzz internally. **Recommendation:** consider `rapidfuzz` for the verify_finding helper instead of diff-match-patch. Use diff-match-patch only if you need patch/apply semantics (yellow-council does not — it only needs similarity scoring). If switching to rapidfuzz, the helper becomes: `python3 -c "from rapidfuzz import fuzz; import sys; print(fuzz.ratio(open('/dev/stdin').read(), '<expected>'))"` returning 0–100.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research (Q3, Python compatibility):** Both `diff-match-patch` (version 20241021, pure Python, Apache 2.0) and `rapidfuzz` are confirmed compatible with Python 3.12+. No reported `distutils`-removal breakage in indexed sources; both use `setuptools`-based builds. [unverified: no specific Python 3.13 compatibility reports — re-verify if yellow-council preflight allows newer Python]
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
<unchanged>

### Unverified Claims
<single-reviewer findings with no evidence verification>
```

Do not silently discard unverified findings — surface them in a separate section so the user can manually verify.

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

Confirm W1.5 allowlist (`scripts/validate-agent-authoring.js`) — claude-reviewer uses `Write` for the fenced-output file (per Task 1.1 locked decision), so its allowlist entry must be present.

### Task 6.2: Manual e2e test checklist (S, 2h)

**File:** `docs/testing/yellow-council-manual-tests.md`

Add 4-CLI test scenarios:
- All 4 reviewers APPROVE on a clean diff
- One reviewer QUOTA_EXHAUSTED (manual trigger by exhausting one quota)
- Lineage collision warning (configure 2 reviewers to same model)
- OpenCode routed to `deepseek/deepseek-v4-pro` (verify the resolved slug appears in report header lineage map)
- Synthesis order-swap verdict-flip detected (manual injection of a flip-flop finding)
- 2-pass synthesis disabled via `--single-pass` flag
- Evidence verification — Tier 1 hit, Tier 2 hit (`rapidfuzz` ≥85), Tier 1+2 miss → finding lands in "Unverified Claims" bucket

### Task 6.3: Updated CHANGELOG (XS, 30min)

**File:** `plugins/yellow-council/CHANGELOG.md`

Document V2 changes:
- Added: claude-reviewer (4th lineage)
- Added: subscription quota tracking
- Added: COUNCIL_OPENCODE_MODEL env var
- Added: lineage diversity startup assertion
- Added: double-blind labels + 2-pass order-swap synthesis
- Added: Tier 1-2 evidence verification

---

## Phase 7: PR strategy (Graphite stack)

Single feature, but large enough to split into a stack of focused PRs to make review tractable. Recommended stack order:

```text
PR-0: codex-reviewer contract normalization (Phase 0)     ← prerequisite (yellow-codex)
  └─ PR-A: claude-reviewer agent + 4-way fan-out (Phase 1) ← foundation (yellow-council)
       └─ PR-B: double-blind labels + 2-pass synthesis      ← Phase 2 (depends on A)
            └─ PR-C: subscription quota tracking             ← Phase 3 (orthogonal*)
                 └─ PR-D: OpenCode 4th-lineage routing       ← Phase 4 (orthogonal*)
                      └─ PR-E: Tier 1-2 evidence verification ← Phase 5 (biggest)
```

\*PR-B/C/D are logically orthogonal — only PR-A's 4-way fan-out wiring is a hard prerequisite. The stack is linear for graphite-review tractability (one reviewer at a time per PR, smaller diffs). If schedule pressure makes parallel review desirable, PR-C and PR-D can be split into siblings of PR-B once PR-A merges.

Each PR includes:
- Code changes
- **CI baseline gate** (`pnpm validate:schemas && pnpm test:unit && pnpm lint && pnpm typecheck`) — runs BEFORE submission
- **Configuration table sync check** — verify both `CLAUDE.md` (4-col) and `council.md` (3-col) tables are in lockstep
- Changeset entry (patch for PR-0 refactor; minor for PR-A through PR-E additive changes)
- Updated CLAUDE.md / README.md / CHANGELOG.md
- Manual test checklist additions in `docs/testing/yellow-council-manual-tests.md`

---

## Effort estimate

| Phase | Tasks | Effort |
|---|---|---|
| Phase 0: codex-reviewer normalization | 4 tasks | ~half day |
| Phase 1: Foundation | 5 tasks | ~1 day |
| Phase 2: Bias mitigation | 3 tasks | ~1 day |
| Phase 3: Quota tracking | 5 tasks | ~1 day |
| Phase 4: OpenCode routing | 4 tasks | ~half day |
| Phase 5: Evidence verification | 3 tasks | ~2.5 days* |
| Phase 6: Final validation + e2e | 3 tasks | ~half day |
| **Total** | **27 tasks** | **~7 days** |

\*Phase 5 task sums = 1d (Task 5.1) + 1d (Task 5.2) + 2h (Task 5.3) ≈ 2.25 days. The ~2.5-day estimate adds a small buffer for the highest-risk phase (new Python dependency + new synthesis-output structure).

---

## Risks and mitigations

### R1 — Claude reviewer's reasoning is too similar to orchestrator

**Risk:** Same model family, same Anthropic training. Even with separate conversation context, the Claude reviewer may produce findings highly correlated with what the orchestrator/synthesizer would produce, weakening the ensemble's anti-correlated-hallucination property.
**Mitigation (DECIDED, baked into Task 1.1):** The claude-reviewer system prompt explicitly requests a devil's-advocate / contrarian stance — biases toward edge-cases, error paths, race conditions, security boundaries; defaults to REVISE over APPROVE on borderline diffs. Empirical guardrail: if Claude-reviewer's REVISE rate exceeds the other 3 reviewers' average by more than 25%, the framing is over-tuned and should be softened in a follow-up. If correlation remains high after PR-A measurement, V3 should consider replacing the in-process Claude reviewer with a `claude -p` subprocess for true session isolation.

### R2 — Subscription quota tracking accuracy

**Risk:** Heuristic increment is approximate. Caps drift across provider releases. Recalibration on quota-exhausted errors only happens after the user already hit the wall.
**Mitigation:** Make the tracker *advisory*, not *gating*. The pre-flight warns but doesn't block. Document explicitly in CLAUDE.md that the tracker is best-effort. Provide `COUNCIL_QUOTA_RESET <reviewer>` command to manually clear state.

### R3 — Evidence verification adds latency

**Risk:** Tier 2 fuzzy matching across all findings on a large diff could add seconds to synthesis. Tier 1 (exact match) is fast (`git show` + grep). Tier 2 (`rapidfuzz`) is per-finding sub-millisecond but could compound.
**Mitigation:** Run verification in parallel with synthesis prompt construction. Cap Tier 2 at top-N findings (e.g., 50) per reviewer. Skip Tier 2 entirely if `python3 -c "import rapidfuzz"` fails (per the Task 5.1 locked library decision).

### R4 — OpenCode provider configuration drift

**Risk:** User's OpenCode is configured to one provider via OpenCode's config; yellow-council overrides via `COUNCIL_OPENCODE_MODEL`. The two configs can drift, leading to confusion about which lineage is actually active.
**Mitigation:** The lineage diversity startup assertion (Task 4.3) reports the *resolved* model name in the output report's metadata. The user sees "OpenCode → deepseek/deepseek-v4-pro" (or whatever the resolved slug is) in the report header.

### R5 — Two-pass synthesis doubles synthesizer quota cost

**Risk:** 2-pass order-swap means 2 Claude synthesis messages per `/council` invocation instead of 1. Per the corrected per-review accounting in Task 2.2 (4 Task subagent spawns + N synthesis messages), single-pass costs ≈5 Claude messages and double-pass ≈6 — so on Claude Pro (45 msg / 5h) the user's council budget moves from ~9 reviews/window (single-pass) to ~7 reviews/window (double-pass).
**Mitigation (DECIDED):** 2-pass is default ON for quality. User can disable per-invocation (`/council review --single-pass`) or globally (`COUNCIL_DOUBLE_PASS_SYNTHESIS=0`). Pre-flight in `/council` Step 1 warns when 2-pass is on AND Claude headroom is below `≈ 2 × per-review-cost` messages — see Task 2.2 for the authoritative per-review cost calculation (≈6 messages 2-pass, ≈5 single-pass) and the warning thresholds derived from it. Track empirically: if user invocation count regularly exceeds quota window, advise switching the global default off.

### R6 — Verbosity bias remains unmitigated until V2.5

**Risk:** Source research (Dimension 10) labels three synthesizer-bias mitigations as "mandatory before any quality claim": (1) two-pass order-swap (Task 2.2), (2) double-blind lineage labels (Task 2.1), and (3) length-controlled scoring (Wang 2024, +22.9 pp win-rate inflation). V2 ships items (1) and (2) only. Item (3) is deferred to V2.5 (V2-7 in the research roadmap). Until V2.5 lands, the synthesizer can systematically upweight more verbose findings — the same finding stated in 500 words ranks above the same finding stated in 100.
**Mitigation:** Document the gap explicitly in CLAUDE.md "Known Limitations" so users interpret V2 synthesis output with this caveat in mind. PR-B's checklist includes a note that "V2 ships 2 of 3 mandatory bias mitigations." When V2.5 lands, length-controlled scoring becomes the headline change.

---

## Open decisions to surface in PRs

**Locked by user 2026-05-08:**
- ✅ Env var: `COUNCIL_OPENCODE_MODEL` (renamed from `COUNCIL_OPENCODE_PROVIDER` after research showed OpenCode resolves provider via `opencode.json`, not CLI prefix)
- ✅ Default OpenCode model: `deepseek/deepseek-v4-pro` (bare OpenRouter slug, user-confirmed live on `openrouter.ai/models` 2026-05-08)
- ✅ Provider routing: relies on user's `opencode.json` having `defaultProvider: "openrouter"` and `opencode auth login openrouter` completed
- ✅ 2-pass synthesis: default ON; user toggle via `COUNCIL_DOUBLE_PASS_SYNTHESIS=0` or `--single-pass` flag
- ✅ Claude reviewer prompt: contrarian / devil's-advocate framing baked into Task 1.1
- ✅ Tier 2 fuzzy-match library: `rapidfuzz` (similarity-only need; faster + intuitive 0–100 scale vs. `diff-match-patch`'s inverted `Match_Threshold`). R3 preflight skip-condition references `rapidfuzz`.
- ✅ claude-reviewer tools: `[Read, Grep, Glob, Write]` — `Write` is required to materialize the 6-key contract's `fenced_output_path`; PR-A adds the matching `REVIEW_AGENT_ALLOWLIST` entry.
- ✅ Minimum quorum: `COUNCIL_MIN_REVIEWERS=2` default; preflight surfaces AskUserQuestion when active reviewers drop below this threshold.
- ✅ Length-controlled scoring deferred to V2.5 (V2-7); V2 ships 2 of 3 mandatory synthesizer-bias mitigations (see Risk R6 + Non-goals).
- ✅ Pass B quota-fallback: degrade gracefully to Pass A's result with a headline annotation (no Pass B retry, no whole-run abort) — see Task 2.2 "Pass B quota-fallback (locked decision)".

**Still open:**

1. **Synthesis as separate Task subagent vs. inline orchestrator logic?** Plan keeps inline (simpler). Pulling synthesis into a dedicated `synthesis-agent` Task gives cleaner double-blind boundary at the cost of an extra Claude message. Defer to V3 unless empirical bias measurements show inline synthesis is leaking lineage labels.

2. **Should the tier-1 evidence verification cover only diff lines, or full file?** Diff lines = exactly what was changed (high precision, may miss findings about pre-existing code). Full file = catches pre-existing-code findings (lower precision, more disk reads). Plan: diff lines for `review` mode; full file for `plan`/`debug`/`question` modes. Confirm in PR-E.

3. **Validate OpenCode bare-slug `--model` invocation at PR-D time.** The slug `deepseek/deepseek-v4-pro` is user-confirmed on OpenRouter (live as of 2026-05-08), but OpenCode's `--model` flag with this exact bare slug + `defaultProvider: "openrouter"` config has not been spiked in this codebase. Run `opencode run --model deepseek/deepseek-v4-pro "test"` once before PR-D ships, update `docs/spikes/opencode-cli-format-json-2026-05-04.md` with the result. If invocation fails, fall back to either (a) explicit `--provider openrouter --model deepseek/deepseek-v4-pro` if OpenCode supports it, or (b) the 3-segment `--model openrouter/deepseek/deepseek-v4-pro` form.

---

## Success criteria

The plan is successful when:

1. **codex-reviewer emits the structured 6-key block** (Phase 0) — `verdict=` / `confidence=` / `summary=` / `fenced_output_path=` / `findings_block_begin` / `findings_block_end`, matching gemini-reviewer's contract
2. `/council review` fans out to 4 reviewers (Claude in-process + Codex + Gemini + OpenCode subprocess)
3. Synthesis output includes `Agreement (verified)` / `Agreement (unverified)` / `Disagreement` / `Unverified Claims` sections
4. Quota exhaustion in any single reviewer produces a clean `verdict=QUOTA_EXHAUSTED` with ETA in headline, no retry
5. Lineage map in report header shows 4 distinct lineages (Anthropic / OpenAI / Google / Other — typically `deepseek/deepseek-v4-pro` for Other)
6. 2-pass synthesis verdict-flip count is reported in the headline (or `--single-pass` cleanly bypasses)
7. Manual e2e tests pass on a fresh install with all 4 CLIs configured and OpenRouter wired into OpenCode

---

## Cross-references

- Source research: `docs/research/multi-cli-code-review-claude-codex-gemini-opencode.md`
- Plugin architecture: `plugins/yellow-council/CLAUDE.md`
- Existing reviewer agents: `plugins/yellow-council/agents/review/{gemini,opencode}-reviewer.md`
- Existing codex reviewer (Phase 0 normalization target): `plugins/yellow-codex/agents/review/codex-reviewer.md`
- Existing orchestrator: `plugins/yellow-council/commands/council/council.md`
- Existing skill: `plugins/yellow-council/skills/council-patterns/SKILL.md`
- OpenCode spike: `docs/spikes/opencode-cli-format-json-2026-05-04.md` (extend in Task 4.0 with bare-slug verification)
- W1.5 allowlist (lineage of Bash exception): `scripts/validate-agent-authoring.js`
- Prior research (10-CLI version): `docs/research/yellow-council-multi-agent-code-review-p.md`

---

## References

External research sources used by `/yellow-research:workflows:deepen-plan` (May 2026):

**OpenRouter / OpenCode model routing:**
- DeepSeek V3.1 model page (LLM24.net) — confirmed `deepseek/deepseek-chat-v3.1` slug pattern as historical baseline
- OpenRouter model catalog — `https://openrouter.ai/models` (live source; user-confirmed DeepSeek v4 listing)
- OpenCode setup guide (LogRocket) — `opencode.json` config-file syntax
- OpenCode setup guide (Research Memex) — `defaultProvider`/`defaultModel` config pattern
- APIdog OpenCode overview — `opencode auth login` provider flow

**Subscription quota signals:**
- Hacker News thread on Claude Code weekly rate limits — 5h + weekly limit structure
- Nuxt HN: Claude Code subagent quota burn rate community discussion
- Evolink "One Gateway for 3 Coding CLIs 2026" — Codex/Claude/Gemini 429 handling patterns

**Evidence verification:**
- Gentoo packages dev-python/diff-match-patch — version 20241021 confirmed
- npmpackage.info diff-match-patch — `Match_Distance` / `Match_Threshold` API documentation (scale: 0=exact, 1=any)
- rapidfuzz package — modern fuzzy matching alternative

**LLM-as-judge bias (post-Zheng):**
- Hugging Face Daily Papers — "Overlap Bias in LLM Summary Evaluation" (Feb 2026)
- Bayesian Orchestration (Kim et al. 2026) — gate-on-uncertainty pass scheduling
- Vadim's blog — Claude Code production patterns and self-questioning agents

**Skipped sources (unavailable in this session):**
- EXA (HTTP 400)
- Tavily (TAVILY_API_KEY not set)
- Perplexity (not in deferred tool registry)
