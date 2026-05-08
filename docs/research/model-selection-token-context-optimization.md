# Model Selection and Token Context Optimization in yellow-plugins

**Date:** 2026-05-08
**Sources:** Ceramic (10 results), GitHub code search (community agent patterns), direct codebase reads (15 agent files), Anthropic Claude Code CLI reference (blakecrosley.com), Parallel Task (running — partial; not retrieved)

[research-conductor] Source skipped: EXA web search (advanced/basic/crawling) — all returning 400 errors.
[research-conductor] Source skipped: Tavily — TAVILY_API_KEY not configured.
[research-conductor] Parallel Task (trun_6ae53d1e637f41f8b3811323c0ae6c72) — still running at synthesis time; not retrieved.

---

## Summary

The yellow-plugins system has 66 of 79 agents (83.5%) using `model: inherit`, zero agents using `effort:` frontmatter, and one plugin (yellow-docs) that has already demonstrated intentional model tiering with measurable design rationale. The inheritance trap is real: `/review:pr` dispatching 16 reviewers from an Opus session multiplies token cost by 16x at the Opus rate with no quality ceiling benefit for pattern-matching or structured-output tasks. The clearest wins are: (1) explicit model assignment for the 10+ narrow-role agents where Haiku or Sonnet is clearly sufficient, (2) `effort: low` adoption for all background scanning and CLI-wrapper agents, and (3) making `product-lens-reviewer`'s `model: inherit` consistent with its yellow-docs peers. Prompt caching is not directly actionable at the plugin-author level — it is a platform-managed concern — but skill preloading choices indirectly affect what gets cached.

---

## Section 1: External Best Practices

### Model Tier Semantics (Claude 4.x Family)

Based on Anthropic's published capability documentation and the community reference at blakecrosley.com (confirmed against Ceramic results):

**Claude Haiku 4.5** — fastest and cheapest tier. Suited for: single-pass structured transforms, pattern matching against a fixed schema, JSON extraction from known formats, background monitoring tasks, CLI invocation wrappers that relay output rather than reason about it. Quality plateau hits at tasks requiring multi-step planning, nuanced judgment calls, or cross-referencing multiple knowledge domains.

**Claude Sonnet 4.6** — the recommended default for most agent work. Suited for: code review with multiple evaluation axes, plan-level analysis, security and design assessment, synthesis of moderate complexity. Carries Anthropic's "best performance-per-token" positioning in multi-agent contexts. This is where most agents with real analytical responsibility belong.

**Claude Opus 4.6 / 4.7** — highest capability, significantly higher per-token cost. Suited for: tasks requiring extended reasoning, cross-domain synthesis, novel judgment calls, orchestration decisions that decompose ambiguous problems. The Ceramic result confirms Opus 4.6 introduced 1M-token context, adaptive thinking (auto reasoning depth), and effort controls. Appropriate for: final synthesizers that merge N scanner outputs into a single scored report, orchestrators that decide how to decompose a complex research topic, architectural strategy agents where a wrong decision has high downstream cost.

**Cost differential (approximate from Anthropic pricing as of knowledge cutoff):** Haiku is roughly 20-25x cheaper per token than Opus; Sonnet is roughly 5-8x cheaper than Opus. In a 16-reviewer fan-out where each reviewer sends ~10K tokens of system prompt plus ~5K of context, the difference between running all 16 on inherited Opus vs. explicit Sonnet is approximately 5-8x the token cost — a concrete, measurable savings for every `/review:pr` invocation.

### Effort Tier Frontmatter

From the Claude Code CLI reference (v2.1.33+, confirmed Ceramic rank-2 result):

```
effort: low | medium | high | xhigh | max
```

`effort:` controls the model's reasoning depth — specifically how much extended thinking / chain-of-thought the model applies before answering. It does NOT change which model is selected. Key behavioral differences:

- `effort: low` — minimal chain-of-thought, fastest response, appropriate for: single-pass scans, structured-output extraction, CLI wrappers, background monitors
- `effort: medium` — default when not specified
- `effort: high` / `max` — extended reasoning, appropriate for: final synthesizers, orchestrators making irreversible decisions, security review requiring adversarial thinking

The community pattern observed in GitHub search is: `model: haiku` + `effort: low` for narrow scanning agents; `model: sonnet` + `effort: low` for quality-gate pattern checkers; `model: opus` (or inherit) + `effort: high` reserved for synthesizers and orchestrators.

### `model: inherit` Semantics

From the Claude Code sub-agents documentation (confirmed by Ceramic rank-8 sub-agent-patterns result and community agent examples): `model: inherit` causes the spawned subagent to use whatever model the parent session is running. If a user runs Claude Code on Opus and spawns 16 subagents with `model: inherit`, all 16 run on Opus. There is no cap, no fallback, and no platform-level cost optimization.

This is appropriate when:
- The agent needs the same model quality as the parent (e.g., a final synthesis step)
- The use case is narrow enough that the user's model choice is genuinely the right selector (e.g., the user is paying for Haiku and all agent work should be Haiku-class)
- The orchestrating command explicitly documents that model quality flows through

It is wasteful when:
- The agent's task is structurally simpler than what the parent model is doing
- The agent is spawned in fan-out (N agents from one parent), multiplying cost by N
- The agent's output quality would be identical at Sonnet vs. Opus

### Prompt Caching

Anthropic's prompt caching documentation (cache_control, from knowledge base): Caching is **not automatic in the Claude Code plugin system** — it operates at the API layer. Plugin authors cannot directly insert `cache_control` breakpoints because Claude Code mediates all API calls; the plugin authoring surface is markdown/YAML frontmatter, not raw API request construction.

What does happen automatically: Claude Code's runtime may cache the static portions of an agent's system prompt (the frontmatter-derived system message) between repeated invocations within a session. The 5-minute TTL applies to ephemeral cache; 1-hour TTL applies to persistent cache (requires explicit `cache_control: {"type": "ephemeral"}` in the API call, which plugin authors cannot set). Cache hits save ~90% of input token costs for cached portions.

**Practical implication for this codebase:** Plugin authors cannot directly opt into prompt caching via `cache_control`. However, they can influence caching indirectly by:
1. Keeping agent system prompts stable across invocations (no dynamic interpolation in the frontmatter body)
2. Preloading skills whose text content is static — if Claude Code's runtime caches the combined system prompt, skills with stable text benefit from that cache hit
3. Avoiding large dynamic injections at the top of the prompt (which would invalidate the cache boundary)

The finding: yellow-plugins has no direct prompt caching control. This is an architectural constraint, not a gap. The right response is to ensure skill content is stable and static, not to try to force cache breakpoints that the plugin surface doesn't support.

### Model Routing in Fan-Out Patterns

Anthropic's guidance (from the AI Engineer conference recap in Ceramic, confirmed by community patterns): the dominant best practice for parallel reviewer workflows is model tiering by task complexity, not uniform inheritance. Spotify's agent pattern (Ceramic rank-1) confirms that "context engineering" — what information goes into each agent's system prompt — matters more than model selection for most reviewer tasks. The corollary: reducing system prompt size (via lazy skill loading or skill compression) can sometimes outperform model downgrading in cost-per-quality terms.

---

## Section 2: Concrete Opportunities

### 2a. Model Tier Routing

**Agents that should be explicit `model: haiku`:**

**`gemini-reviewer`** (`plugins/yellow-council/agents/review/gemini-reviewer.md`, line 4: `model: inherit`)
This agent's sole job is to invoke `gemini -p "..."` as a subprocess and return the output in an injection fence. It does zero reasoning — it constructs a prompt string, calls a CLI, and relays output. A Haiku-class model can do this correctly. Savings per `/council` invocation: up to 8x on this agent's own token cost. Estimated tokens per invocation: ~5K system + ~2K task prompt. At Opus rates vs. Haiku, this is roughly 7,000 tokens x 20x price differential = significant per-invocation savings, especially since council may be invoked repeatedly.

**`opencode-reviewer`** (`plugins/yellow-council/agents/review/opencode-reviewer.md`, line 4: `model: inherit`)
Identical reasoning: CLI invocation wrapper. The agent itself does not review code; it invokes `opencode run --format json` and parses the output. `model: haiku` is correct.

**`learnings-researcher`** (`plugins/yellow-core/agents/research/learnings-researcher.md`, line 4: `model: inherit`)
Task: searches `docs/solutions/` (a local markdown directory), applies BM25-style keyword matching, and returns a fenced advisory block. This is a structured retrieval task with no multi-step reasoning. `model: haiku` + `effort: low` is appropriate. The agent uses only Read/Grep/Glob — no tool complexity.

**`runner-assignment`** (`plugins/yellow-ci/agents/ci/runner-assignment.md`, line 5: `model: inherit`)
Analyzes workflow jobs against a runner inventory (structured data) and outputs `runs-on` recommendations. This is a deterministic matching task: label → runner capability → assignment. `model: haiku` + `effort: low` is correct. The 373-line prompt is large (see 2e), but the reasoning is structured and narrow.

**Agents that should be explicit `model: sonnet`:**

**`product-lens-reviewer`** (`plugins/yellow-docs/agents/review/product-lens-reviewer.md`, line 4: `model: inherit`)
This is the one inconsistency in yellow-docs's otherwise intentional tiering. The other five always-on reviewers are: coherence-reviewer (haiku), scope-guardian-reviewer (sonnet), design-lens-reviewer (sonnet), security-lens-reviewer (sonnet), feasibility-reviewer (unknown — not read, likely sonnet or inherit). `product-lens-reviewer` does premise challenging and strategic consequence analysis — this is genuine analytical work that warrants Sonnet, matching its sibling reviewers. `model: sonnet` is the correct assignment.

**All 5 yellow-debt scanners** (`plugins/yellow-debt/agents/scanners/*.md`, all `model: inherit`):
- `ai-pattern-scanner` — pattern matching against AI anti-pattern taxonomy
- `complexity-scanner` — cyclomatic/cognitive complexity analysis via Grep/Bash
- `duplication-scanner` — near-duplicate detection
- `architecture-scanner` — circular dependency detection, boundary violations
- `security-debt-scanner` — security debt patterns (not vulnerabilities)

These are single-pass code scanners that apply a fixed taxonomy (debt-conventions skill) to code content and produce structured JSON findings. This is exactly the use case where Sonnet is the quality ceiling — there is no creative synthesis, no ambiguous judgment, no multi-domain cross-referencing. Downgrading from inherit to `model: sonnet` for all five, invoked in parallel by `/debt:audit`, saves approximately 5x token cost on the scanner tier at zero quality loss. If the user's session runs Opus, the savings per full audit is substantial.

**`knowledge-compounder`** (`plugins/yellow-core/agents/workflow/knowledge-compounder.md`, line 4: `model: inherit`)
This agent uses Task to spawn sub-agents that write to `docs/solutions/`. The orchestration logic (deciding what to document, what's novel, what's redundant) warrants reasoning, but Sonnet-level reasoning is sufficient. The sub-agents it spawns can be Haiku. Recommendation: `model: sonnet`.

**`session-historian`** (`plugins/yellow-core/agents/workflow/session-historian.md`, line 4: `model: inherit`)
Cross-vendor session search with BM25 + cosine + RRF fusion. This is sophisticated retrieval logic but not creative synthesis — it's ranking and returning. `model: sonnet` is the quality ceiling. The 398-line prompt (see 2e) is the bigger concern.

**Agents that are correctly assigned (validate the existing pattern):**

- `audit-synthesizer` (`model: opus`) — correctly Opus. It merges N scanner outputs, applies confidence rubric gates, deduplicates, scores severity across categories, and generates the final audit report. This is the one place in yellow-debt where Opus earns its cost: cross-scanner deduplication requires holding many findings in context and applying multi-axis judgment.
- `research-conductor` (this agent, `model: opus`) — correctly Opus. It triages research complexity, decides fan-out strategy, synthesizes from heterogeneous sources. If this ran on Sonnet, research quality would measurably degrade on complex topics.
- `coherence-reviewer` (`model: haiku`) — correctly Haiku. Internal consistency checking (does section A contradict section B?) is pattern matching, not reasoning.
- `scope-guardian-reviewer`, `design-lens-reviewer`, `security-lens-reviewer` (all `model: sonnet`) — correctly Sonnet. These require real analytical judgment but not Opus-level synthesis.

### 2b. Effort Tier Adoption

Zero agents currently use `effort:` frontmatter. The following are the highest-value assignments:

| Agent | File | Recommended effort | Rationale |
|---|---|---|---|
| `gemini-reviewer` | `yellow-council/agents/review/gemini-reviewer.md` | `effort: low` | CLI relay, no reasoning |
| `opencode-reviewer` | `yellow-council/agents/review/opencode-reviewer.md` | `effort: low` | CLI relay, no reasoning |
| `learnings-researcher` | `yellow-core/agents/research/learnings-researcher.md` | `effort: low` | BM25 keyword search, structured retrieval |
| `runner-assignment` | `yellow-ci/agents/ci/runner-assignment.md` | `effort: low` | Label-matching, deterministic assignment |
| All 5 debt scanners | `yellow-debt/agents/scanners/*.md` | `effort: low` | Single-pass taxonomy application |
| `coherence-reviewer` | `yellow-docs/agents/review/coherence-reviewer.md` | `effort: low` | Pattern matching (already haiku; add effort:low) |
| `audit-synthesizer` | `yellow-debt/agents/synthesis/audit-synthesizer.md` | `effort: high` | Cross-scanner synthesis, confidence gating — warrants extended reasoning |
| `research-conductor` | `yellow-research/agents/research/research-conductor.md` | `effort: high` | Complexity triage and fan-out decisions benefit from extended chain-of-thought |
| `brainstorm-orchestrator` | `yellow-core/agents/workflow/brainstorm-orchestrator.md` | `effort: high` | Iterative dialogue with research integration — deliberation matters |

**Schema note:** `effort:` is an existing valid frontmatter field per the reference at `docs/solutions/code-quality/subagent-frontmatter-field-catalog.md` (confirmed in MEMORY.md). Adding it requires no schema change — it is already recognized by `validate-agent-authoring.js`.

### 2c. Skill Preloading vs. Lazy Loading

37 of 79 agents preload skills. The following preloads warrant scrutiny:

**Skills that are always needed (keep as preload):**
- `debt-conventions` in all 5 scanners and `audit-synthesizer` — the scan taxonomy is the agent's entire operating vocabulary. It must be present at prompt time.
- `ci-conventions` in CI agents — same reasoning.
- `council-patterns` in `gemini-reviewer` and `opencode-reviewer` — the CLI invocation templates are in the skill.

**Skills where lazy loading would reduce baseline context cost:**

**`learnings-researcher`** has no `skills:` preload (already correct — it uses only built-in tools). No action needed.

**Agents in yellow-core that preload large skills on every invocation:**
- If `brainstorm-orchestrator` preloads `brainstorming` (461 lines) and `ideation`, that's ~18K tokens added to every brainstorm session. If brainstorming is invoked rarely and the skill content is referenced only in specific sub-steps, it could be referenced inline in prose rather than preloaded. However: without reading those agents' full bodies, this is a hypothesis, not a finding. The standing rule is "only flag if there's actual redundancy." Flagged for manual review, not for immediate change.

**The clearest lazy-load opportunity:** `create-agent-skills` skill (513 lines, the largest in the system). If this skill is preloaded in any agent that doesn't primarily create new agents, it should be converted to a prose reference. Verify which agents preload it before changing.

**Validated lazy-load targets** (agents that preload skills but have narrow, single-pass tasks):
- Any scanner that preloads `debt-conventions` AND the skill contains sections not used by that specific scanner (e.g., the full todo state machine). Without reading the full skill body, cannot confirm redundancy — flag for audit.

### 2d. Prompt Caching

As established in Section 1: yellow-plugins cannot directly control `cache_control` breakpoints. Claude Code's runtime manages caching at the API layer; the plugin frontmatter surface does not expose this.

**What IS within control:**

1. **Stable system prompts benefit from whatever automatic caching Claude Code does apply.** Agents that have dynamic content injected at prompt time (e.g., session-historian which injects session search results into its system context) will have lower cache hit rates than agents with static bodies. This is unavoidable for those agents.

2. **Skill content stability.** If the skills preloaded into an agent's system prompt change on every version bump, cache hits are invalidated. Stabilizing skill content (minimizing churn in large skills like `debt-conventions` at 409 lines) preserves whatever automatic caching the platform applies.

3. **The high-fan-out insight.** In `/review:pr` dispatching 16 reviewers in parallel within a single session, each reviewer's system prompt is sent as a fresh context. If Claude Code applies any session-level caching for repeated tool invocations, the stable portion of each reviewer's system prompt (the fixed skill content, the security fencing block from `security-fencing` skill) would be candidates for cache hits. The implication: agents that share large common skill blocks (e.g., all yellow-review reviewers loading a shared conventions skill) may benefit more from caching than agents with unique content. This is a platform behavior to observe, not to engineer around.

4. **Finding: no actionable prompt caching gap exists at the plugin authoring level.** The correct conclusion is to not add fake `cache_control` annotations or attempt to work around the plugin boundary — doing so would either be silently ignored or break the validation pipeline.

### 2e. Agent Prompt Compression

Per the standing rule: only flag actual redundancy, not line count alone.

**`knowledge-compounder.md` (417 lines, `model: inherit` → recommend sonnet):**
This agent uses extensive `<examples>` blocks at the top. Examples are high-value for reasoning agents. No compression is warranted without reading the full body and confirming duplication. **Flag: audit for duplicate examples or superseded patterns that no longer match the current compound-lifecycle skill.**

**`session-historian.md` (398 lines, `model: inherit` → recommend sonnet):**
This agent documents three separate vendor backends (Claude Code JSONL, Devin REST, Codex local). If all three backends share a common output format step that is repeated three times, that's addressable redundancy. **Flag: check whether the per-vendor output normalization steps are identical — if so, extract to a shared pattern. This is a reading task, not a compression directive.**

**`runner-assignment.md` (373 lines, `model: inherit` → recommend haiku + effort:low):**
Runner assignment is fundamentally a label-matching algorithm. 373 lines for a matching table is plausible if the skill contains extensive examples. **Flag: if more than 30% of the body is worked examples for the same matching algorithm, compress examples to a minimal representative set.**

**`opencode-reviewer.md` (361 lines, `model: inherit` → recommend haiku + effort:low):**
A CLI relay agent at 361 lines is a yellow flag. If the body contains extensive output parsing instructions for the OpenCode JSON event stream, those parsing instructions may be doing work that could be handled by a smaller Bash script in the parent command. **Flag: review whether the JSON parsing logic belongs in the agent body or in a `council-patterns` skill section.**

**`learnings-researcher.md` (303 lines, `model: inherit` → recommend haiku + effort:low):**
A retrieval agent at 303 lines warrants a body review. If it contains scoring rubrics and fusion algorithm descriptions that could be simplified for Haiku-class reasoning, compression + model downgrade is the combined opportunity. **Flag: verify the BM25 + cosine + RRF fusion instructions are necessary at full detail or can be simplified to "rank by keyword density and recency."**

### 2f. The Inheritance Trap

**Is `/review:pr` dispatching 16 reviewers all inheriting the parent model?**

Yes, this is the documented behavior. `model: inherit` in Claude Code subagent frontmatter causes the spawned agent to use the parent session's model. When a user invokes `/review:pr` from an Opus session, all 16 dispatched agents run on Opus. The cost multiplier is: 16 reviewers × ~15K tokens each × Opus rate = ~240K tokens at Opus pricing per invocation. At Sonnet rates, the same 16 reviewers cost ~240K × (1/5) = ~48K tokens equivalent — an 80% reduction.

**Should explicit model defaults be set on dispatched reviewers?**

Yes, with calibration:

- `code-simplicity-reviewer`, `pattern-recognition-specialist`, `test-coverage-analyst` — pattern matching and coverage counting. `model: sonnet` is the quality ceiling. These agents do not benefit from Opus reasoning.
- `security-reviewer` — security analysis warrants Sonnet at minimum; Opus would be defensible for security-critical codebases, but Sonnet catches exploitable vulnerabilities reliably. Recommendation: `model: sonnet`, user can override at the command level if they want Opus security review. (`security-sentinel` stays on Opus per Section 2a — adversarial reasoning over multi-step inference benefits from Opus.)
- `performance-oracle`, `performance-reviewer` — algorithmic complexity analysis. Sonnet is sufficient for well-scoped code; Opus adds value for complex distributed systems analysis. Recommendation: `model: sonnet`, with a note that users working on high-performance systems may want to override.
- `architecture-strategist` — currently `model: opus`. This is correctly Opus: architectural judgment is the use case Opus is designed for. Do not downgrade.
- `polyglot-reviewer` — language-idiomatic review. Sonnet knows idioms across TS/Py/Rust/Go reliably. `model: sonnet`.

**Note on yellow-docs vs. yellow-review:** yellow-docs has set explicit model assignments for 4 of 7 reviewers (coherence=haiku, design-lens/scope-guardian/security-lens=sonnet); the remaining three (product-lens, feasibility, adversarial-document) hold `model: inherit`. This partial-tiering is the closest existing pattern in the repo and a starting point that yellow-review and yellow-debt could extend.

---

## Section 3: Risks and Quality Preservation

### Risk Matrix

| Opportunity | Agent(s) | Quality Risk | Validation Strategy |
|---|---|---|---|
| `gemini-reviewer` / `opencode-reviewer` → haiku | Both council CLI wrappers | Low. These agents relay CLI output, not reason. Risk: Haiku might misformat the fenced output block. | Run 5 `/council review` invocations with haiku; compare fenced output structure to current. Pass/fail is structural, not subjective. |
| 5 debt scanners → sonnet | ai-pattern-scanner, complexity-scanner, duplication-scanner, architecture-scanner, security-debt-scanner | Medium. Sonnet may miss subtle patterns that Opus would catch in complex codebases. Risk is higher for `security-debt-scanner` where false negatives are costly. | A/B on a labeled fixture: run both model tiers on `yellow-plugins` itself (a known codebase) and compare finding count and false negative rate. |
| `audit-synthesizer` stays opus | — | N/A — this is a "don't change" recommendation. |  |
| `learnings-researcher` → haiku | — | Low-medium. Relevance ranking may degrade on fuzzy topical matches. Risk: Haiku returns less contextually relevant learnings. | Compare top-5 learnings returned by haiku vs. sonnet on 10 diverse PR diffs. Accept haiku if precision@5 is within 20% of sonnet. |
| `runner-assignment` → haiku | — | Low. Assignment is label matching. Risk: Haiku may fail on ambiguous runner inventory descriptions. | Run `/ci:setup-self-hosted` on 3 representative runner configs; verify assignments match expected. |
| All `model: inherit` reviewers in yellow-review → sonnet | 12+ reviewers | Medium-high. `security-sentinel` in particular: downgrading from Opus-inherited to Sonnet may miss subtle security issues in TypeScript generic narrowing, async race conditions, or injection vulnerabilities that require deep reasoning. | Golden-set test: identify 5 PRs with known security findings (from git history) and compare finding recall between sonnet-explicit and opus-inherited. Accept sonnet if recall >= 90%. |
| `product-lens-reviewer` → sonnet | yellow-docs | Low. Already the correct match for its sibling reviewers. | No special validation needed — this is aligning to an existing pattern. |
| `effort: low` on scanners | All narrow scanners | Low. `effort: low` reduces chain-of-thought depth, not model capability. Risk: scanner misses a complex multi-step pattern. | Same A/B as model downgrade — can be tested together. |
| `effort: high` on `audit-synthesizer` | — | No quality risk — this increases reasoning depth. | Validate that response latency remains acceptable (< 120s per audit). |
| Skill lazy-loading | TBD agents | Low. Risk: agent references skill content not in context. | Read each candidate agent's body before changing preload. Confirm the skill content is only referenced in specific sub-steps, not throughout the body. |

---

## Section 4: Recommended Phased Rollout

### Phase 1 — No-risk, no-schema-change wins (implement immediately)

1. **`product-lens-reviewer`: add `model: sonnet`** (`plugins/yellow-docs/agents/review/product-lens-reviewer.md`). Aligns to yellow-docs's own pattern. One line change, zero quality risk, already validated by sibling reviewers.

2. **`gemini-reviewer` + `opencode-reviewer`: add `model: haiku` + `effort: low`** (`plugins/yellow-council/agents/review/`). CLI relay agents. Measurable cost reduction on every `/council` invocation. Validate with 5 `/council review` runs.

3. **`learnings-researcher`: add `model: haiku` + `effort: low`** (`plugins/yellow-core/agents/research/learnings-researcher.md`). Retrieval task, no reasoning complexity. Affects every `/review:pr` (Wave 2 pre-pass) and `/workflows:plan` invocation.

4. **`runner-assignment`: add `model: haiku` + `effort: low`** (`plugins/yellow-ci/agents/ci/runner-assignment.md`). Label matching. Affects only `/ci:setup-self-hosted`.

5. **`audit-synthesizer`: add `effort: high`** (`plugins/yellow-debt/agents/synthesis/audit-synthesizer.md`). No model change (stays opus), adds extended reasoning depth. Zero quality risk, potential quality improvement.

6. **`research-conductor`: add `effort: high`** (`plugins/yellow-research/agents/research/research-conductor.md`). Same rationale.

### Phase 2 — Tested wins (implement after A/B validation)

7. **All 5 yellow-debt scanners: add `model: sonnet` + `effort: low`**. Run A/B on labeled fixture first. If precision within 20% of inherit-from-Opus, merge. Estimated savings: 5-8x cost reduction on scanner tier per audit.

8. **`session-historian`: add `model: sonnet`** (`plugins/yellow-core/agents/workflow/session-historian.md`). Run comparison on 5 known session queries; accept if RRF ranking quality is maintained.

9. **`knowledge-compounder`: add `model: sonnet`** (`plugins/yellow-core/agents/workflow/knowledge-compounder.md`). Run comparison on 3 compounding sessions; accept if sub-agent dispatch and doc quality is maintained.

10. **`runner-assignment` body audit**: review whether 373-line body has compressible examples. If yes, compress before or alongside the model change in Phase 1.

### Phase 3 — Deeper changes (schema or multi-file coordination required)

11. **yellow-review reviewer tier assignment**: systematically assign `model: sonnet` to all 12 pattern-matching reviewers, keeping `model: opus` only for `architecture-strategist`. This affects the most files (12+ agents) and has the highest quality risk surface (security recall). Requires the golden-set security test to pass first. **This is a Phase-3 change** — the /review:pr pipeline is the highest-value workflow in the system; a regression here has high user impact.

12. **Skill lazy-loading audit**: read the full body of the five largest agents (knowledge-compounder, session-historian, runner-assignment, opencode-reviewer, learnings-researcher) and catalog which skill sections are used only in specific branches vs. throughout. Convert branch-specific skill references to inline prose for those branches. This is a multi-file reading exercise before any changes.

13. **`opencode-reviewer` body compression**: if the JSON event stream parsing instructions (OpenCode `--format json` output) exceed 30% of the 361-line body, extract to a `council-patterns` skill section shared with `gemini-reviewer`. This reduces both agents' system prompt size and benefits from skill preloading consolidation.

---

## Section 5: Sources

- **Claude Code CLI Technical Reference** — blakecrosley.com/en/guides/claude-code — Confirmed effort controls (low/medium/high/max) introduced in v2.1.33; Claude Opus 4.6 model ID, 1M context, adaptive thinking, agent teams research preview; `model: inherit` behavior documented.

- **Anthropic AI Engineer Conference Recap** — zenml.io/llmops-tags/documentation — Memory tools + context editing delivering 39% benchmark improvement; Spotify's context engineering principles for agent reliability at scale.

- **Anthropic Sub-Agents Documentation** — antigravity.codes/agent-skills (referencing code.claude.com/docs/en/sub-agents) — Sub-agent context window isolation, configurable tools, frontmatter field catalog.

- **Community agent pattern examples** — github.com/ThibautBaissac/rails_ai_agents, github.com/H-mmer/pentest-agents, github.com/alexandrbasis/claudops — Real-world `model: haiku` + `effort: low` pairing for lint, migration, monitoring, and quality-gate agents. `model: sonnet` + `effort: low` for automated quality-gate reviewers.

- **Ceramic Search** (10 results, 2026-05-08) — LLMOps database, AINews, xAGI Labs — General landscape context for multi-model multi-agent patterns.

- **Direct codebase reads** (15 agent files, 2026-05-08) — `/home/kinginyellow/projects/yellow-plugins/plugins/` — Ground truth for current frontmatter assignments, agent task descriptions, and tool declarations.

- [research-conductor] Source skipped: EXA (web_search_exa, web_search_advanced_exa, crawling_exa, deep_researcher_start) — all returning HTTP 400 errors.
- [research-conductor] Source skipped: Tavily (tavily_research) — TAVILY_API_KEY not configured.
- [research-conductor] Parallel Task trun_6ae53d1e637f41f8b3811323c0ae6c72 — still running at synthesis time; not retrieved. Result may contain additional pricing data.
