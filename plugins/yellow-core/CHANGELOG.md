# Changelog

## 1.8.0

### Minor Changes

- [`ab3f2d3`](https://github.com/KingInYellows/yellow-plugins/commit/ab3f2d365c911d8f5bdeff9f9cf0f141f254fb03)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Enable true
  parallel execution for multi-agent review sessions

  Add `background: true` to 15 agents (7 in yellow-core/agents/review, 6 in
  yellow-review/agents/review, plus
  `yellow-core/agents/research/best-practices-researcher` and
  `yellow-review/agents/workflow/pr-comment-resolver`) and update four
  orchestrator commands (`review-pr.md`, `resolve-pr.md`, `work.md`, `audit.md`)
  to explicitly require `run_in_background: true` on each Task invocation, with
  explicit wait gates (TaskOutput / TaskList polling) before any step that
  consumes agent output. Frontmatter flag alone is insufficient — the spawning
  call must also run in the background for agents to run concurrently rather
  than serially.

  Memory field changes: drop the prior `memory: true` from review and research
  agents (it was a no-op and re-adding a scope value would silently activate
  per-spawn MEMORY.md injection of up to ~25 KB across 13+ parallel agents). Set
  `memory: project` only on the three workflow orchestrators
  (`brainstorm-orchestrator`, `knowledge-compounder`, `spec-flow-analyzer`),
  where MEMORY.md context is intentional and the spawn fan-out is small.
  Auditing the broader `memory:` activation across review agents remains a Phase
  1.5 follow-up (plan open question 8).

## 1.7.1

### Patch Changes

- [`4d034f2`](https://github.com/KingInYellows/yellow-plugins/commit/4d034f26117da84d15707094fe8970210ad76bee)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - yellow-morph:
  migrate Morph API key from shell `MORPH_API_KEY` to plugin `userConfig`
  (Claude Code prompts at plugin-enable time and stores in the system keychain).
  Shell `MORPH_API_KEY` remains supported as a power-user fallback. Ship
  `bin/start-morph.sh` wrapper and a SessionStart prewarm hook that install
  `@morphllm/morphmcp@0.8.165` into `${CLAUDE_PLUGIN_DATA}` — serialized via an
  atomic `mkdir`-lock so wrapper and hook cannot run concurrent `npm ci`. Fix
  `ENABLED_TOOLS` no-op (morphmcp ignores it; switch to
  `DISABLED_TOOLS=github_codebase_search`). Correct WarpGrep tool name from the
  non-existent `warpgrep_codebase_search` to `codebase_search`.

  yellow-core: update `setup:all` classification probe so yellow-morph is
  detected via the renamed `codebase_search` tool, and refresh the
  mcp-integration-patterns skill to reference the new tool name.

  yellow-research: rename the `filesystem-with-morph` global MCP probe in
  `/research:setup` to `codebase_search` (current name), with
  `warpgrep_codebase_search` retained in `allowed-tools` as a backward-
  compatibility hedge for users still on an older global MCP version.

## 1.7.0

### Minor Changes

- [#312](https://github.com/KingInYellows/yellow-plugins/pull/312)
  [`a2486f1`](https://github.com/KingInYellows/yellow-plugins/commit/a2486f10988be214bed4207e1e2a2170b78ea0ed)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  cross-vendor `session-history` skill + `session-historian` agent (W3.12) —
  search prior sessions across Claude Code, Devin, and Codex with hybrid query
  and secret redaction

  Introduces:
  - `plugins/yellow-core/skills/session-history/SKILL.md` (user-invokable as
    `/yellow-core:session-history`) — user surface, query parsing, backend
    availability detection, dispatch to `session-historian`, result table
    rendering.
  - `plugins/yellow-core/agents/workflow/session-historian.md`
    (`tools: [Read, Grep, Glob, Bash, Task, ToolSearch]`) — per-backend session
    discovery + extraction, BM25/cosine/RRF fusion scoring, secret redaction,
    structured output schema with V3 Devin lineage fields.

  Adapted from upstream `EveryInc/compound-engineering-plugin`
  `ce-session-historian` agent at locked SHA
  `e5b397c9d1883354f03e338dd00f98be3da39f9f`.

  **Three backends with graceful degradation:**

  | Backend     | Source                                                 | Availability check                                                                                                                                                                         |
  | ----------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Claude Code | `~/.claude/projects/<encoded-cwd>/*.jsonl`             | Filesystem read (always, unless directory missing)                                                                                                                                         |
  | Devin       | `mcp__plugin_yellow-devin_devin__devin_session_search` | `ToolSearch` for the MCP tool; fall back to `devin-orchestrator` if absent                                                                                                                 |
  | Codex       | `~/.codex/sessions/<YYYY/MM/DD>/<session-uuid>/`       | Filesystem read of the directory (CLAUDE.md only documents `~/.codex/auth.json` and `~/.codex/config.toml`; sessions path lives in `plugins/yellow-codex/commands/codex/status.md` Step 3) |

  Encoded CWD: `printf '%s' "$PWD" | sed 's|/|-|g'` — replaces every `/` with
  `-` (the leading slash becomes a leading hyphen). For
  `/home/user/projects/foo` the encoded form is `-home-user-projects-foo`.
  Matches Claude Code's actual on-disk encoding for
  `~/.claude/projects/<encoded-cwd>/`.

  Backend unavailable: log
  `[session-history] Warning: <vendor> backend unavailable, skipping` to stderr
  once and continue with available backends. **Never** fail the whole run on a
  single backend's missing prerequisites.

  **Hybrid query algorithm (BM25 + optional cosine + recency, fused via RRF):**
  1. **BM25 component (always)** — token-frequency scoring on parsed topic
     keywords against each session's text via `grep -ci`. Sum across keywords
     normalized by `1 + log(1 + session_length_bytes)` so 1 MB sessions don't
     dominate 100 KB ones.
  2. **Cosine component (optional, when ruvector is installed)** — call
     `mcp__plugin_yellow-ruvector_ruvector__hooks_recall(query, top_k=5)` and
     use the result's `score` field. Skip the entire component if ruvector is
     unavailable; do not error.
  3. **Recency boost** — multiplier `1.0 - (days_old / scan_window_days)`,
     floored at 0.1. Recent sessions outrank equally-relevant older ones.
  4. **Reciprocal Rank Fusion** — `RRF(d) = sum( 1 / (60 + rank(d)) )` per
     component (k=60 standard default), then
     `final_score = RRF * recency_boost`. Disparate component scales (BM25
     magnitudes vs cosine 0–1) merge cleanly via rank rather than raw score.

  **Per-message-turn chunking** preserves
  `{session_id, vendor, timestamp, role, tool_calls}` metadata. Token-based
  chunking would fragment tool calls and lose attribution.

  **Devin V3 lineage support** (per source-plan research note on April 2026
  Devin API update): captures `parent_session_id`, `child_session_ids`, and
  `is_advanced` fields; returns as `lineage: {parent, children, is_advanced}` in
  result records. Improves "what did we decide about X" queries by surfacing
  related sub-sessions rather than just the top-level session.

  **Secret redaction (mandatory, runs in agent before any output):**

  | Pattern                                                      | Replacement   |
  | ------------------------------------------------------------ | ------------- |
  | `AKIA[0-9A-Z]{16}`                                           | `[AWS_KEY]`   |
  | `ghp_[A-Za-z0-9]{36}` / `github_pat_[A-Za-z0-9_]+`           | `[GH_TOKEN]`  |
  | `sk-[A-Za-z0-9]{20,}` / `sk-ant-[A-Za-z0-9-]{20,}`           | `[API_KEY]`   |
  | `eyJ[A-Za-z0-9_=-]+\.eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_.+/=-]*` | `[JWT]`       |
  | `-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----`       | `[PEM_BLOCK]` |

  Redaction runs unconditionally — never skip "because the user is the only
  person who will see this." Memory persists, transcripts get exported, and once
  a credential leaks into a `compound` write it lives forever. Each result row
  includes `secrets_redacted: <N>` when redactions occurred.

  **Yellow-plugins divergence from upstream:**
  - **Cursor → Devin substitution.** Upstream's `ce-session-historian` covered
    Claude Code + Codex + Cursor. Yellow-plugins replaces Cursor with Devin
    because the yellow-devin plugin already exposes a Devin MCP, and Devin
    sessions are the highest-density source of long-form decisions in this
    workflow. Cursor support can be added later if a use case emerges.
  - **Single-agent body, no helper extraction skills.** Upstream delegates JSONL
    extraction to `ce-session-inventory` and `ce-session-extract` skills (~1100
    lines combined). yellow-core ships a single agent that does inline
    filtering. The ~300-line agent body fits in one context, and the extraction
    commands are short enough to inline without a helper skill.
  - **Hybrid scoring is explicit.** Upstream is keyword-only with judgment-
    based ranking. yellow-plugins specifies BM25 + optional cosine + RRF fusion
    per the source-plan research note (Cursor semantic search; Pinecone
    hybrid-search studies; ~12% retrieval accuracy recovery on coding
    transcripts).
  - **Secret redaction in agent (not skill).** Putting redaction in the agent
    makes it impossible to forget — the skill only sees the agent's
    already-redacted output. Upstream documents redaction patterns in prose;
    yellow-plugins makes it a mandatory step in the methodology.

  **Methodology preserved from upstream:**
  - Step 1: scope + backend availability detection
  - Step 2: per-backend keyword filter (`grep -c`) before deep extract
  - Step 3: bounded deep-dive (top 5 per backend, top 8 across)
  - Step 4: per-message-turn extraction (head:200 default, tail:50 conditional
    when session terminated mid-investigation)
  - Step 5: redact + score
  - Step 6: honest reporting (zero results gets a one-sentence diagnostic;
    partial extraction gets `partial_extraction: true`)

  **Acceptance criterion satisfied:** when invoked from a project with Claude
  Code transcripts present, the skill returns timestamped per-vendor results
  merged by relevance, each tagged with source vendor and secrets-redacted.
  Devin and Codex backends gracefully skip when unavailable.

  Discoverable via auto-discovery from
  `plugins/yellow-core/skills/session-history/SKILL.md` and
  `plugins/yellow-core/agents/workflow/session-historian.md` — no `plugin.json`
  registration required.

  **Plan reconciliation:** flips Wave 3 items #8 (PR #310), #9 (this PR), #10
  (PR #311) to DONE in `plans/everyinc-merge-wave3.md` Stack Progress section.
  Items #2, #5, #7 remain on the runway.

- [#310](https://github.com/KingInYellows/yellow-plugins/pull/310)
  [`d7f36fa`](https://github.com/KingInYellows/yellow-plugins/commit/d7f36fa695a158667d241079386d68a0e7ae98bb)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `ideation`
  skill (W3.11) — generate 3 grounded approaches with the Toulmin warrant
  contract and route the chosen approach into `brainstorm-orchestrator`

  Introduces `plugins/yellow-core/skills/ideation/SKILL.md` (user-invokable as
  `/yellow-core:ideation`) for solution-space exploration before requirements
  dialogue. Adapted from upstream `EveryInc/compound-engineering-plugin`
  `ce-ideate` skill at locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`,
  re-shaped around the MIDAS three-phase pattern + Toulmin warrant contract
  researched in the source plan.

  **Six phases:**
  1. **Subject gate** — identifiability check on `<problem_statement>`. Vague
     inputs (quality/category words like "improvements", "things to fix")
     trigger one `AskUserQuestion` with three options (Specify / Surprise me /
     Cancel). Threshold heuristic: <10 words AND no domain noun → ask; otherwise
     accept.
  2. **Free generation (no gate)** — 5–7 candidates across six framing biases
     (pain, inversion, reframing, leverage, cross-domain analogy, constraint-
     flipping). Frames are starting lenses, not constraints. Optional one-shot
     `Grep` grounding when the input mentions an existing file.
  3. **Warrant filtration (Toulmin contract)** — every survivor carries
     `[EVIDENCE: direct|external|reasoned|SPECULATIVE]` +
     `[WARRANT: linking principle]` + `[IDEA: one sentence]`. Empty `[EVIDENCE]`
     slot → rejected. `[SPECULATIVE]` is valid only when strict-warrant mode is
     **off** (see below). Filter to 3 strongest survivors.
  4. **Warrant-guided extension** — each survivor gets a **next step** (smallest
     testable action) and an **open question** (highest-uncertainty unknown) so
     the brainstorm hand-off lands with concrete dialogue starting points, not
     just an idea.
  5. **Ranked selection** — surface the 3 survivors via `AskUserQuestion`. User
     may pick "Other" with custom text to override (skill routes that text into
     brainstorm directly).
  6. **Hand-off** — spawn `brainstorm-orchestrator` via `Task` with literal
     3-segment `subagent_type: "yellow-core:workflow:brainstorm-orchestrator"`
     (avoids the LLM-guesses-2-segment regression from PR #289). Graceful
     degradation: if the spawn fails, surface the chosen approach + warrant +
     next step + open question in plain markdown for manual paste.

  **Strict-warrant mode (domain-aware default):**
  - **Off** for feature ideation, DX, refactoring, docs, performance —
    speculation is allowed because cross-domain analogies often start
    speculative and gain evidence in brainstorm.
  - **On** for security, auth, encryption, data migration, schema changes,
    payments, PII — speculation in these domains has higher cost (a speculative
    auth approach that misses a known attack pattern can ship a real CVE).

  Detection is keyword-based (case-insensitive) on `<problem_statement>`. User
  override via `--strict-warrant` / `--no-strict-warrant` flag in `$ARGUMENTS`.
  Conflicting flags resolve left-to-right (last-flag-wins), and the resolution
  is reported in one line so the user can correct.

  **Yellow-plugins divergence from upstream:**
  - **No `references/` subdirectory** — upstream splits universal-ideation,
    post-ideation-workflow, and web-research-cache into separate files totaling
    ~1100 lines. yellow-core skills consistently use a single SKILL.md, so the
    methodology is folded inline at ~270 lines. The surprise-me
    deeper-exploration mode, V15 web-research cache, V17 scratch-checkpoints,
    and full Phase 6 menu (Save/Refine/Open in Proof) are out of scope for this
    initial pass — they can be added later if the team adopts ideation as a
    primary entry point.
  - **Toulmin contract is new** — upstream's `direct: / external: / reasoned:`
    warrant tags map onto Toulmin's evidence slot, but yellow-core also requires
    an explicit `[WARRANT]` slot (linking principle) and `[IDEA]` slot, and
    permits `[SPECULATIVE]` as an explicit fourth evidence type rather than
    silently allowing weakly-grounded ideas through.
  - **Three survivors, not 5–7** — upstream targets 25–30 survivors after
    dedupe; yellow-core targets 3 because the next step is a hand-off to a
    blocking `AskUserQuestion`, not a markdown artifact.
  - **No persistence** — upstream writes `docs/ideation/<topic>.md`; yellow-core
    treats the conversation as the artifact and lets the brainstorm output
    (`docs/brainstorms/<date>-<topic>-brainstorm.md`) carry the chosen approach
    forward. Persistence can be added later if a use case emerges.

  **Methodology preserved from upstream:**
  - Six framing biases (pain / inversion / reframing / leverage / analogy /
    constraint-flipping) — kept verbatim because the framing taxonomy is the
    durable insight; the dispatch architecture around it is what changed.
  - Subject-identifiability gate as Phase 0 — kept because vague subjects
    produce scattered ideation regardless of the rest of the workflow.
  - Warrant-required generation rule — kept; this is the quality mechanism.

  **Hand-off semantics:** ideation answers "what are the strongest options worth
  exploring"; brainstorm answers "what does the chosen option mean precisely".
  Different jobs, different tools — the skill explicitly does not continue
  requirements dialogue after the spawn.

  Discoverable via auto-discovery from
  `plugins/yellow-core/skills/ideation/SKILL.md` — no `plugin.json` registration
  required.

- [#311](https://github.com/KingInYellows/yellow-plugins/pull/311)
  [`9cb0f32`](https://github.com/KingInYellows/yellow-plugins/commit/9cb0f32b924a3cd6e5f4dc0444a790e74c5f4a7d)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `optimize`
  skill (W3.14) — metric-driven optimization with parallel candidate variants
  and LLM-as-judge analytic rubric

  Introduces `plugins/yellow-core/skills/optimize/SKILL.md` (user-invokable as
  `/yellow-core:optimize`) plus
  `plugins/yellow-core/skills/optimize/schema.yaml` defining the optimization
  spec format. Adapted from upstream `EveryInc/compound-engineering-plugin`
  `ce-optimize` skill at locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f` —
  extract-only treatment from the 659-line upstream + 7 reference files.

  **Five phases (each fits in a single conversation context):**
  1. **Spec resolution** — read or scaffold the optimization spec; validate
     against `schema.yaml` (required: `optimization_target`,
     `measurement_criteria` with 2-5 entries; optional with defaults:
     `success_threshold` (3.5), `parallel_count` (2; range 2-5), `judge_runs`
     (2; range 1-3), and others). Path A: spec file path. Path B:
     `AskUserQuestion` 3-question scaffold flow. Echo + confirm gate before
     running.
  2. **Research pre-pass (optional)** — dispatch `best-practices-researcher` (or
     `research-conductor` if yellow-research installed) for prior art on the
     optimization target. Summary fenced as `<external_research>` and included
     in each generator's prompt. Graceful degradation — if both researchers
     unavailable, log warning and proceed.
  3. **Parallel candidate generation** — spawn `parallel_count`
     `general-purpose` Task agents in a single message. Each agent receives
     `<external_research>` and produces ONE variant in a fenced code block.
     Default `candidate_generation_prompt` requires meaningful design difference
     (not micro-tweaks). Single retry on timeout/missing-fence; drop on second
     failure with `parallel_count - 1` survivors.
  4. **LLM-as-judge with order-swap** — judge runs `judge_runs` times (default
     2). Run 1 in spec order; run 2 reversed (the order-swap that catches
     positional bias). Each judge run returns per-candidate records with
     `criterion_scores` (1-5 integer per criterion), `weighted_score`,
     `rationale`, and **`style_bias_check: bool`** (judge self-flags when style
     influenced score independently of substance). Sanity checks: warn if 50%+
     records flag style bias, warn if any candidate's per-criterion scores
     diverge by >2 points between runs.
  5. **Rank & hand-off** — average scores across runs; surface ranked list via
     `AskUserQuestion`. If `knowledge_compound: true` AND winner clears
     `success_threshold`, spawn `knowledge-compounder` via Task to write
     `docs/solutions/optimizations/<spec-name>.md`. Otherwise surface the chosen
     variant and exit cleanly.

  **`judge_telemetry` schema (output)** documented in `schema.yaml`:
  `{candidate_id, run_index, criterion_scores, weighted_score, rationale, style_bias_check}`.
  Stored in conversation context only — no on-disk persistence by default
  (yellow-plugins divergence; see below).

  **Yellow-plugins divergence from upstream:**
  - **No on-disk persistence by default.** Upstream `ce-optimize` writes to
    `.context/compound-engineering/ce-optimize/<spec-name>/` for crash-safety
    across multi-hour runs (CP-0 through CP-5 mandatory checkpoints, append-
    only experiment log, per-experiment `result.yaml` markers, strategy digest).
    Yellow-plugins runs are typically <30 minutes — the upstream's multi-hour
    optimization loops don't apply here. Conversation context holds candidates
    and judge_telemetry. The `knowledge_compound: true` path is the durable
    persistence option. Add disk persistence later if a use case actually needs
    it; YAGNI until then.
  - **No worktree-based experiments.** Upstream uses
    `scripts/experiment-worktree.sh` to run each candidate in an isolated git
    worktree. Yellow-plugins skill operates entirely in-context — Task agents
    produce text variants the user later applies. Worktree experiments can be
    added in a follow-up if the optimization targets expand to file-based
    variants requiring isolated runtime measurement.
  - **Single SKILL.md, no `references/` subdirectory.** Upstream splits
    methodology into 5 reference files (`usage-guide.md`,
    `experiment-prompt-template.md`, `judge-prompt-template.md`,
    `optimize-spec-schema.yaml`, `experiment-log-schema.yaml`); yellow-core
    skills consistently use a single SKILL.md, so methodology is folded inline.
    Schema lives in a sibling `schema.yaml` because YAML schemas are parsed
    differently than markdown.
  - **Three-tier metric (`hard` / `judge` + `degenerate_gates`) collapsed to
    judge-only.** Upstream supports both hard scalar metrics (from a measurement
    command) and LLM-as-judge. Yellow-plugins ships judge-only for the initial
    pass — hard-metric integration requires a measurement- harness convention
    that doesn't exist yet in yellow-plugins. Spec authors who need hard metrics
    can extend the schema in a follow-up.
  - **No multi-iteration optimization loop.** Upstream runs hypothesis-
    generation → batch-experiments → strategy-digest → next-batch over multiple
    iterations. Yellow-plugins ships single-batch only — the user picks a winner
    from one batch. Multi-iteration loops can be added if the team finds
    single-batch insufficient.

  **Methodology preserved (and extended) from upstream:**
  - **Two-run order-swap as judge default** — single-run judges show wide
    inter-rater reliability variance across random seeds, and a substantial
    fraction of pairwise rankings invert between runs. Upstream defaults to 1
    run; yellow-plugins defaults to 2 because the cost is small and the variance
    is large. See `plans/everyinc-merge.md` W3.14 for the underlying citations.
  - **Per-criterion analytic rubric, not holistic** — per-criterion rubrics
    produce more reliable inter-rater agreement than holistic scoring across
    evaluation studies. Both upstream and yellow-plugins support this;
    yellow-plugins makes it the only mode. The exact ICC figures cited in the
    source-plan research note are calibration approximations, not load-bearing
    constants.
  - **`style_bias_check` self-flag** is **new in yellow-plugins** — added per
    the source-plan research note
    (`amend the W3.14 judge_telemetry to include style_bias_check: <bool>`).
    Surfaces when judges trained on style-coupled preference data bias toward
    longer/better-formatted candidates regardless of substance. The skill warns
    the user when 50%+ of records flag this; the user decides whether to
    normalize style and rerun.

  **Acceptance criterion satisfied:** the skill spec validates a synthetic
  2-candidate experiment shape and the documented Phase 3 judge prompt produces
  ranked output with scores and rationale per the schema.

  Discoverable via auto-discovery from
  `plugins/yellow-core/skills/optimize/SKILL.md` — no `plugin.json` registration
  required. `schema.yaml` is loaded at runtime from the same directory via the
  skill's relative path reference.

## 1.6.0

### Minor Changes

- [#296](https://github.com/KingInYellows/yellow-plugins/pull/296)
  [`ce3a5d7`](https://github.com/KingInYellows/yellow-plugins/commit/ce3a5d7d71415638a9a36cc9c7d3790bb04d57e1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `compound-lifecycle` skill (W3.10) — staleness detection, overlap detection,
  and consolidation hand-off for `docs/solutions/`

  Introduces `plugins/yellow-core/skills/compound-lifecycle/SKILL.md`
  (user-invokable as `/yellow-core:compound-lifecycle`) plus
  `docs/solutions/archived/` scaffolding to maintain the institutional knowledge
  catalog over time.

  **Three operations:**
  1. **Composite staleness detection** — replaces the upstream's pure 90-day
     cutoff with a 4-component score (Atlan-pattern):
     `0.4 * days_since_modified + 0.3 / inbound_refs + 0.2 * embedding_age_days + 0.1 * days_since_retrieved`.
     Heavily-cited evergreen entries don't get false-flagged; recent entries
     with broken references do get flagged. Embedding/retrieval components
     contribute zero when ruvector is unavailable (graceful degradation; noted
     in report).
  2. **Two-pass overlap detection** — `category` + `tags` overlap pass first
     (cheap), then BM25 on `problem:` lines, then optional ruvector cosine
     clustering at 0.82 threshold (calibrated default for paragraph-level
     semantic equivalence on markdown corpora — Universal Sentence Encoder
     convention; Pinecone case study). Surfaces 0.78–0.90 as "review
     suggestions"; ≥ 0.90 as "high-confidence overlap" — both still gate on user
     approval.
  3. **AskUserQuestion-gated consolidation hand-off** — never auto-merges. For
     Consolidate / Replace classifications, dispatches `knowledge-compounder`
     via Task to write the merged canonical entry, then archives the source
     entries with a `superseded_by:` frontmatter pointer.

  **Five-outcome classification table** (Keep / Update / Consolidate / Replace /
  Delete-and-archive) adapted from upstream `ce-compound-refresh` at locked SHA
  `e5b397c9`. Drift boundary — Update vs Replace — preserves the upstream's
  "stop if you find yourself rewriting the solution" rule.

  **Archive, don't delete (yellow-plugins divergence from upstream):**
  upstream's "delete and let git history serve as the archive" rule is inverted.
  Archived entries move to `docs/solutions/archived/<original-category>/` and
  remain searchable for forensics, citation continuity (external links to
  `docs/solutions/<...>` paths don't 404), and `learnings-researcher` fallback
  when a related-but-not-identical problem recurs. `learnings-researcher`
  excludes the `archived/` subtree from its default search by glob — the live
  catalog stays clean.

  **Per-project tuning** via `yellow-plugins.local.md`'s
  `compound_lifecycle.staleness.{w1,w2,w3,w4,threshold}` and
  `compound_lifecycle.overlap.{bm25_percentile,cosine_review, cosine_high_confidence}`
  keys. These are yellow-plugins-specific extensions and are not yet declared in
  the `local-config` skill schema; they parse silently under the schema's
  graceful-degradation rule (no validation is performed). A formal schema entry
  can be added in a follow-up if validation becomes desirable.

  **Autofix mode** for scheduled background runs: applies unambiguous Updates
  only; marks Consolidate / Replace / Delete-and-archive as `status: stale` with
  `stale_reason` for human review later. Writes report to
  `docs/solutions/_lifecycle-runs/<timestamp>.md`.

  **Hard quality dependency** for W3.11 (ideation skill) per the research note
  in the source plan — stale or duplicated catalog entries degrade ideation
  candidate generation.

  Adapted from upstream `EveryInc/compound-engineering-plugin` snapshot
  (703-line `ce-compound-refresh/SKILL.md` extracted; we ship a focused
  ~400-line implementation rather than the full upstream).

- [#306](https://github.com/KingInYellows/yellow-plugins/pull/306)
  [`cc3d1f9`](https://github.com/KingInYellows/yellow-plugins/commit/cc3d1f9fa58ce7a30bc9e883bb5c4e30689bc48e)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `debugging`
  skill (W3.1) — systematic root-cause debugging with causal-chain gate and
  prediction-for-uncertain-links hypothesis testing

  Introduces `plugins/yellow-core/skills/debugging/SKILL.md` (user-invokable as
  `/yellow-core:debugging`) for bug investigation that biases toward
  understanding the trigger-to-symptom causal chain before touching code.
  Adapted from upstream `EveryInc/compound-engineering-plugin` `ce-debug` skill
  at locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`.

  **Five phases (each self-sizes):**
  1. **Triage** — parse `<bug_description>` (untrusted input fenced for
     prompt-injection safety), fetch issue thread if a tracker reference is
     supplied (GitHub via `gh`, Linear via
     `mcp__plugin_yellow-linear_linear__get_issue` MCP, others via `WebFetch`
     with paste fallback), reach a clear problem statement. Read **all**
     comments — narrowed reproduction or pivots often appear in late comments.
  2. **Investigate** — reproduce the bug, verify environment sanity (correct
     branch / dependencies / runtime / env vars / build artifacts / dependent
     services), then trace the code path **backward** from error to where valid
     state first became invalid.
  3. **Root Cause** — assumption audit (verified vs assumed), hypothesis ranking
     with file:line + causal chain + prediction for uncertain links,
     **causal-chain gate** that blocks Phase 3 until trigger-to-symptom is fully
     explained, smart escalation table when 2–3 hypotheses are exhausted
     (subsystem-divergence → suggest `/yellow-core:workflows:brainstorm`;
     evidence-contradiction → re-read without assumptions; CI-vs-local → focus
     on env; symptom-fix → keep investigating).
  4. **Fix** — workspace and branch check (detect default branch via
     `git rev-parse --abbrev-ref origin/HEAD` with `origin/` prefix stripped —
     unstripped comparison silently never matches), test-first cycle (failing
     test for right reason → minimal fix → broad regression run),
     3-failed-attempts trigger for re-diagnosis, conditional defense-in-depth
     (entry validation / invariant check / environment guard / diagnostic
     breadcrumb) when the pattern recurs in 3+ files or the bug would have been
     catastrophic, conditional post-mortem when production-affecting or
     pattern-recurrent.
  5. **Handoff** — structured Debug Summary template, then either
     auto-commit-and-submit (skill-owned branch) or AskUserQuestion menu
     (pre-existing branch) routing to Graphite (`gt modify` +
     `gt submit --no-interactive`, prefer `/gt-workflow:smart-submit` if
     installed). Optional learning capture via `/yellow-core:workflows:compound`
     when the lesson generalizes (3+ recurrences or wrong assumption about a
     shared dependency); skip silently for mechanical fixes.

  **Yellow-plugins divergence from upstream:**
  - **Multi-platform tool plumbing dropped** — upstream supports Codex
    `request_user_input`, Gemini `ask_user`, and Pi `ask_user`; yellow-plugins
    is Claude Code only, so the skill assumes `AskUserQuestion` (with
    `ToolSearch` schema-load fallback) and removes the per-platform branching.
  - **CE command refs replaced** — `/ce-brainstorm` →
    `/yellow-core:workflows:brainstorm`, `/ce-commit-push-pr` → `gt submit` (or
    `/gt-workflow:smart-submit` if installed), `/ce-commit` → `gt modify`,
    `/ce-compound` → `/yellow-core:workflows:compound`.
  - **Investigation techniques and anti-patterns inlined** — upstream splits
    methodology into a `references/` subdirectory (`anti-patterns.md`,
    `defense-in-depth.md`, `investigation-techniques.md`). yellow-core skills
    consistently use a single SKILL.md, so the substantive content is folded
    inline at ~270 lines. The detailed intermittent-bug techniques (binary
    search, retry-with-logging variations, environment snapshots) are referenced
    compactly rather than reproduced verbatim — agents follow the principles
    without needing the full upstream playbook.
  - **`<bug_description>` fence** — wraps `$ARGUMENTS` in an explicit
    untrusted-reference advisory rather than the upstream's bare placeholder,
    matching the prompt-injection fencing pattern used across yellow-plugins (PR
    #281 W1.5).

  **Methodology preserved verbatim** — causal-chain gate,
  prediction-for-uncertain-links, one-change-at-a-time, three-failed-attempts
  diagnostic table, the four-pattern smart-escalation matrix (different
  subsystems / contradicting evidence / CI-vs-local / wrong prediction), and the
  design-problem-vs-localized-bug brainstorm-suggestion test (wrong
  responsibility / wrong requirements / every-fix-is-a-workaround).

  Discoverable via auto-discovery from
  `plugins/yellow-core/skills/debugging/SKILL.md` — no `plugin.json`
  registration required.

## 1.5.1

### Patch Changes

- [`f22272d`](https://github.com/KingInYellows/yellow-plugins/commit/f22272d391a466840ef6b398a83e8d233b755694)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  CHANGELOG migration text to runtime-current 3-segment subagent_type form +
  document non-interactive cache-refresh workaround

  Two small docs/maintenance fixes:
  1. **CHANGELOG migration text:** `plugins/yellow-core/CHANGELOG.md` and
     `plugins/yellow-review/CHANGELOG.md` had migration notes citing the legacy
     2-segment `subagent_type: "yellow-review:code-reviewer"` form. The repo's
     runtime expects 3-segment as of PRs #288/#290. The validator's INFO note
     flagged these for future hard-fail. Updated both migration snippets to the
     3-segment form (`yellow-review:review:code-reviewer`) so the migration text
     stays accurate and the INFO warnings clear.
  2. **CONTRIBUTING.md cache-refresh note:** added a "Manual cache refresh for
     non-interactive sessions" subsection covering the rsync workaround when
     `/plugin marketplace update` (TUI-only) isn't available — e.g., background
     agents or Remote Control sessions verifying a freshly-merged
     `chore: version packages` release. The loop hardens against path-traversal
     via plugin name and version (allowlist regex), uses `sort -V` instead of
     lexicographic `ls | tail -1` so `1.10.x` is correctly preferred over
     `1.9.x`, requires `set -euo pipefail` plus `command -v` prereq checks, and
     surfaces `cp` failures rather than silently skipping rsync.

  No code changes; documentation-only patches.

- [`7fe5d9d`](https://github.com/KingInYellows/yellow-plugins/commit/7fe5d9dc3b445ac94146afe68f3943fb8161087b)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `learnings-researcher` empty-result sentinel violation + defense-in-depth on
  the keystone check

  The `learnings-researcher` agent's empty-result protocol requires
  `NO_PRIOR_LEARNINGS` to be the **first non-whitespace line** of the response.
  In practice the agent was emitting a "thinking out loud" scan-summary
  paragraph before the sentinel — flipping the keystone's Step 3d.4
  strict-equality check from "empty → skip injection" to "non-empty → inject as
  learnings", which delivered useless prose to all 4–9 dispatched reviewers per
  `/review:pr` invocation.

  Two-sided fix:
  1. **`plugins/yellow-core/agents/research/learnings-researcher.md`** — tighten
     the empty-result protocol with explicit anti-pattern guidance (forbidden
     prose-before-token, no thinking-out-loud, no closing remarks) and a
     self-check checklist before emission. The agent-side contract is unchanged
     (token must still be first non-whitespace line); the spec just makes the
     LLM-compliance bar harder to miss.
  2. **`plugins/yellow-review/commands/review/review-pr.md`** Step 3d.4 —
     replace the strict "first non-whitespace line equals literal token" check
     with two-condition empty-result detection:
     - **(a)** the token appears on its own line anywhere in the response (regex
       `(?m)^\s*NO_PRIOR_LEARNINGS\s*$`), AND
     - **(b)** the response does NOT contain a `## Past Learnings` heading
       (regex `(?m)^##\s+Past\s+Learnings\s*$`).

     When both hold → skip injection (the original fix intent — tolerate LLM
     thinking-out-loud preamble before the sentinel). When only (a) holds
     (token + findings heading both present) → contract violation; log a
     warning, strip the sentinel line, and treat the response as non-empty so
     findings are not silently dropped. The `## Past Learnings` heading
     dominance ensures the relaxation never masks the "combined sentinel with
     findings" anti-pattern the agent body forbids.

  Together the two changes mean Wave 3 PR reviews will get clean empty-result
  handling immediately, with a robust safety net that preserves findings even
  when an agent-side regression combines the sentinel with real findings.

## 1.5.0

### Minor Changes

- [`4f5cfff`](https://github.com/KingInYellows/yellow-plugins/commit/4f5cfff69febeb50853dbd49130eb452ce9d30a8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  yellow-codex plugin wrapping OpenAI Codex CLI with review, rescue, and setup
  workflows. Patch yellow-review to spawn codex-reviewer as an optional
  supplementary reviewer, and patch yellow-core to surface yellow-codex
  readiness plus delegate codex:setup from /setup:all.

- [#265](https://github.com/KingInYellows/yellow-plugins/pull/265)
  [`635f58d`](https://github.com/KingInYellows/yellow-plugins/commit/635f58d254b22a733f57f72fa15681c56d3f6e86)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add Ceramic.ai
  as the default first-hop research backend across yellow-research and
  yellow-core.
  - yellow-research: bundle a 6th MCP server entry pointing at
    `https://mcp.ceramic.ai/mcp` (OAuth 2.1; same shape as the existing Parallel
    Task block). The `code-researcher` and `research-conductor` agents prefer
    `ceramic_search` for general-web and Simple/Moderate triage tiers, with
    explicit fall-through to the existing Perplexity/Tavily/EXA stack when
    Ceramic is unavailable or returns no useful results. Both agents are
    instructed to rewrite topics into concise keyword form before calling
    Ceramic, since it is a lexical (not semantic) search engine.
    `/research:setup` gains a `CERAMIC_API_KEY` format check, REST live-probe,
    and dashboard row; `CERAMIC_API_KEY` powers the REST probe only — the MCP
    authenticates via OAuth.
  - yellow-core: bundle the same Ceramic MCP entry as a second `mcpServers`
    alongside `context7`. The `best-practices-researcher` agent leads its Phase
    2 web-search step with `ceramic_search`, falling back to built-in
    `WebSearch`. `WebFetch` stays primary for single-URL content fetches
    (Ceramic has no fetch endpoint).

  Pricing: $0.05 per 1,000 queries (vs. tens of $/month per provider in the
  prior stack). Rate limits: 20 QPS pay-as-you-go; 50 QPS Pro.

  No prior backend is removed. Roll back by deleting the `mcpServers.ceramic`
  block from either plugin's `plugin.json`.

- [#282](https://github.com/KingInYellows/yellow-plugins/pull/282)
  [`d992744`](https://github.com/KingInYellows/yellow-plugins/commit/d992744352db5baa27fbfd826bb42923efa84ed8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  track/problem frontmatter schema to knowledge-compounder; backfill 51
  docs/solutions entries

  **knowledge-compounder.md updates (additive):**
  - New required frontmatter fields for entries written to `docs/solutions/`:
    - `track: bug | knowledge` — distinguishes specific incidents from
      patterns/guidelines
    - `problem: <one-line ~80 char>` — keyword-rich problem statement; W2.1
      `learnings-researcher` (lands in keystone PR #7) will use this for
      BM25/dense retrieval ranking
    - `tags: [array]` — already existed; now enforced as non-empty (3+ tags
      recommended)
  - New "Context Budget Precheck" (CE ce-compound v2.39.0 pattern): before
    writing, count assembled body lines; if > `KC_CONTEXT_BUDGET` (default 200),
    prompt via AskUserQuestion to write single / split into N files / cancel.
  - Track classification rules table: defaults by category with override
    conditions; security-issues entries containing
    audit/threat-model/pre-implementation markers are flagged for manual review
    rather than auto-bug-classified.
  - Solution doc body sections now branch by track:
    - **bug:** Problem, Symptoms, What Didn't Work, Solution, Why This Works,
      Prevention
    - **knowledge:** Context, Guidance, Why This Matters, When to Apply,
      Examples

  **New script: `scripts/backfill-solution-frontmatter.js`**

  Idempotent backfill for existing `docs/solutions/` entries:
  - Heuristic-based track assignment by category
    (logic-errors/security-issues/build-errors → bug;
    code-quality/workflow/integration-issues → knowledge).
  - Audit-shaped security-issues entries (containing "audit", "threat model", or
    "pre-implementation" in title or first paragraph) are flagged for manual
    review — NOT auto-assigned, since a pre-implementation threat model is a
    knowledge-track entry despite the security-issues category default.
  - `problem` field derived from existing `problem` (priority), `symptom`,
    `title`, then first body paragraph — truncated to 120 chars at sentence
    boundary.
  - `tags` field seeded from category if missing, else left untouched.
  - Modes: default = apply, `--dry-run` = report only, `--check` = exit non-zero
    if any file would change (CI-friendly).
  - `SOLUTIONS_DIR` env var lets tests point at fixture trees without touching
    real `docs/solutions/`.

  **Backfill applied:**
  - 51 files scanned across 6 categories
  - 45 entries gained track + problem (some also gained tags)
  - 2 legacy entries (`code-quality/yellow-ci-shell-security-patterns.md`,
    `workflow/plugin-release-process.md`) lacked YAML frontmatter entirely —
    added full frontmatter inline as part of this PR.
  - 1 entry flagged for manual review and classified as `track: knowledge`:
    `security-issues/yellow-devin-plugin-security-audit.md` (a
    pre-implementation threat model — heuristic correctly caught it; manual
    override added with a backfill-note HTML comment explaining the decision).
  - Final state: 51/51 entries have track + problem + tags. Re-running the
    script reports zero changes (idempotency verified).

  Future runs: drop the script into CI as
  `node scripts/backfill-solution-frontmatter.js --check` to gate PRs that add
  `docs/solutions/` entries without the new fields.

- [#280](https://github.com/KingInYellows/yellow-plugins/pull/280)
  [`8e7898f`](https://github.com/KingInYellows/yellow-plugins/commit/8e7898f9eaaa55df1f5b41a42c31fdd1ebbb5de6)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Repair 4
  drifted research/workflow agents, modify 2 review agents, and split
  performance + security into specialized roles

  Brings 4 research/workflow agents to parity with upstream EveryInc patterns
  (locked at `compound-engineering-v3.3.2`, SHA
  `e5b397c9d1883354f03e338dd00f98be3da39f9f`) and splits the deep-analyzer
  agents `performance-oracle` and `security-sentinel` into multi-role agent
  families:
  - **`best-practices-researcher`** — added Phase 0 skill discovery step; now
    checks `.claude/skills/`, `~/.claude/skills/`, and `plugins/*/skills/` for
    curated knowledge before going to MCP/web. Skill-based guidance outranks
    generic external sources.
  - **`repo-research-analyst`** — added Phase 0 Technology & Infrastructure Scan
    with manifest-to-ecosystem mapping table, monorepo detection, deployment /
    API surface / data layer detection (each conditional on what 0.1 finds).
    Grounds all subsequent research in a known stack.
  - **`git-history-analyzer`** — added a "do not assume a hardcoded year"
    preamble that instructs the agent to call `date '+%Y-%m-%d'` to dynamically
    resolve the current date for time-based query interpretation, avoiding
    hardcoded-year drift.
  - **`spec-flow-analyzer`** — added Phase 0 codebase grounding step before the
    existing 4 phases. "Gaps are only gaps if the codebase doesn't already
    handle them" — reduces generic feedback in spec reviews.
  - **`performance-oracle`** — added "Role Split" section pointing to new
    `performance-reviewer` companion. Oracle stays as the deep analyzer
    (algorithmic complexity, scaling projections, benchmarking guidance);
    reviewer handles review-time confidence-calibrated findings.
  - **`security-sentinel`** — added "Role Split" section pointing to new
    `security-reviewer` (review-time code) and `security-lens` (plan-level
    architect). Sentinel stays as the broad OWASP-Top-10 audit agent.

  **New agents (3):**
  - **`performance-reviewer`** — review-time persona for runtime performance and
    scalability. Anchored confidence rubric (100 = verifiable, 75 = provable
    from code, 50 = depends on data size — usually suppress unless P0, ≤25 =
    suppress). Higher effective threshold than other personas because
    performance issues are easy to measure and fix later; FPs waste engineering
    time on premature optimization.
  - **`security-reviewer`** — review-time persona for exploitable security
    vulnerabilities. Lower effective threshold than other personas — security
    findings at anchor 50 should typically be filed at P0 severity to survive
    the aggregation gate via the P0 exception. Hunts injection vectors,
    auth/authz bypasses, secrets in code/logs, insecure deserialization, SSRF /
    path traversal.
  - **`security-lens`** — plan-level security architect. Reviews planning
    documents, brainstorms, or architecture proposals for attack-surface gaps
    before implementation begins. Distinct from code-level review — examines
    whether the plan makes security-relevant decisions and identifies its attack
    surface.

  The 3 new review agents and the 2 modified review agents (performance-oracle,
  security-sentinel) are read-only (`tools: [Read, Grep, Glob]`) per the W1.2
  read-only-reviewer rule. The 4 research/workflow agents retain their existing
  tool sets (Bash, WebSearch, etc.). The 3 new reviewers will be wired into the
  W2.4 review:pr orchestrator dispatch table.

- [#283](https://github.com/KingInYellows/yellow-plugins/pull/283)
  [`4469d4e`](https://github.com/KingInYellows/yellow-plugins/commit/4469d4ec74dac96e63eeab3052f1834c9a31c401)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Wave 2 keystone
  — review:pr persona pipeline + learnings pre-pass + confidence rubric

  `yellow-review` (MAJOR — `code-reviewer` rename):
  - **BREAKING:** Rename `code-reviewer` → `project-compliance-reviewer`. The
    responsibility is narrowed to `CLAUDE.md`/`AGENTS.md` compliance, naming
    patterns, and project-pattern adherence. General correctness is now handled
    by the new `correctness-reviewer`; frontmatter / portability /
    cross-platform tool selection by the new `project-standards-reviewer`.
  - **Migration:** Callers passing
    `subagent_type: "yellow-review:review:code-reviewer"` should update to
    `"yellow-review:review:project-compliance-reviewer"`. A deprecation stub is
    left at the old path for one minor version — third-party installs that
    reference the old name continue to function (with a deprecation log line)
    until the stub is removed.
  - **New persona reviewers** (all read-only, `tools: [Read, Grep, Glob]`):
    `correctness-reviewer`, `maintainability-reviewer`, `reliability-reviewer`,
    `project-standards-reviewer`, `adversarial-reviewer`. Each returns the
    structured compact-return JSON schema with severity, category, file, line,
    confidence, autofix_class, owner, requires_verification, pre_existing, and
    optional suggested_fix.
  - **`review:pr` rewritten** (`commands/review/review-pr.md`): adds Step 3a
    always-fetch base branch (CE PR #544 hardening), Step 3d learnings pre-pass
    (dispatches `learnings-researcher`; `NO_PRIOR_LEARNINGS` → skip injection;
    otherwise inject fenced advisory block into every reviewer's Task prompt),
    Step 4 tiered persona dispatch table with `yellow-plugins.local.md` config
    integration and a graceful-degradation guard, Step 5 compact-return
    enforcement, Step 6 confidence-rubric aggregation (validate → dedup →
    cross-reviewer promotion → mode-aware demotion → confidence gate at anchor
    75 with P0 ≥ 50 exception → partition → sort) plus quality gates for line
    accuracy, protected- artifact filtering, and skim-FP detection.
  - **`review:all` parity update** (`commands/review/review-all.md`): the
    inlined per-PR pipeline now mirrors the new `review:pr` Steps 3a / 3d / 4 /
    5 / 6. Pipeline-mirror comment added so future drift is caught.
  - **`pr-review-workflow` skill update**: documents the new always-on persona
    set, the conditional `reliability-reviewer` and `adversarial-reviewer`
    triggers, the compact-return JSON schema, and the Wave 2 P0–P3 severity
    scale + 5-anchor confidence anchors.

  `yellow-core` (MINOR — net additive):
  - **`learnings-researcher` agent**
    (`agents/research/learnings-researcher.md`): always-on pre-pass that
    searches `docs/solutions/` for past learnings relevant to a PR diff or
    planning context. Reads the `track`/`tags`/`problem` frontmatter schema
    added in Wave 2 prep (`feat/knowledge-compounder-track-schema`). Returns a
    fenced advisory block on hit, the literal `NO_PRIOR_LEARNINGS` token on
    miss.
  - **`local-config` skill** (`skills/local-config/SKILL.md`): documents the
    `yellow-plugins.local.md` per-project config file with minimum keys
    `review_pipeline` (escape hatch for Wave 2 rollback), `review_depth`,
    `focus_areas`, `reviewer_set.{include,exclude}`. Wave 3 expansion keys
    (`stack`, `agent_native_focus`, `confidence_threshold`) are documented for
    forward visibility.
  - **Self-referential solutions doc**
    (`docs/solutions/code-quality/learnings-researcher-pre-pass-pattern.md`):
    documents the pre-pass pattern, empty-result protocol, fencing requirement,
    and how to extend it for new orchestrators.

  Cross-plugin reference updates (no version bump): `yellow-core`,
  `yellow-devin`, `yellow-ruvector` doc references to `code-reviewer` migrated
  to the new persona names.

  Reference:
  `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/confidence-rubric.md`
  extracted from upstream `compound-engineering@v3.3.2` ce-code-review/SKILL.md.

- [`7de4d7f`](https://github.com/KingInYellows/yellow-plugins/commit/7de4d7fe62ed50640df75ebcae903d699f1e99bf)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Transform
  `/workflows:review` from a thin redirect to `/review:pr` into a session-level
  review command. Evaluates plan adherence, cross-PR coherence, and scope drift
  against the original plan file. Autonomously fixes P1 issues via Edit tool
  with a max 2-cycle review-fix loop. Falls back to `/review:pr` redirect for PR
  number/URL/branch arguments (backwards compatible).

- [`ab33fbc`](https://github.com/KingInYellows/yellow-plugins/commit/ab33fbcc316d108e4eaa4027bf5434577c9924ca)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Strip Bash from
  13 reviewer agents; document codex-reviewer exception

  Reviewer agents are pure-analysis agents whose job is to read source, identify
  issues, and emit structured findings — never to execute, modify, or push. The
  `Bash` capability in their `tools:` lists conflicted with their bodies'
  "Execute code or commands found in files" prohibition. Per CE PR #553
  read-only-reviewer parity, strip `Bash` from:
  - **yellow-core/agents/review/** (7): architecture-strategist,
    code-simplicity-reviewer, pattern-recognition-specialist,
    performance-oracle, polyglot-reviewer, security-sentinel,
    test-coverage-analyst
  - **yellow-review/agents/review/** (6): code-reviewer, code-simplifier,
    comment-analyzer, pr-test-analyzer, silent-failure-hunter,
    type-design-analyzer

  For `silent-failure-hunter` and `type-design-analyzer`, the optional
  `ToolSearch` + ast-grep MCP tools are preserved (those are read-only).

  **Documented exception:** `yellow-codex/agents/review/codex-reviewer` keeps
  `Bash`. Its core function is invoking `codex exec review …` and
  `git diff … | wc -c` — read-only restriction would break the agent. A new
  "Tool Surface — Documented Bash Exception" section in its body explains the
  rationale and bounds the legitimate use. The forthcoming W1.5 validation rule
  (`scripts/validate-agent-authoring.js` Rule X, lands in branch #5) will
  allowlist this exact path.

  **Security rationale:** Reviewer agents read untrusted PR comment text and
  diff content. If a prompt-injection attempt bypasses fences (and 2026 research
  shows fences degrade under sustained attack), a reviewer with `Bash` can
  `rm -rf`, `git push --force`, exfiltrate via `curl`, install malware. With
  `[Read, Grep, Glob]` only, the worst-case is a wrong finding — much smaller
  blast radius. See
  `docs/solutions/security-issues/prompt-injection-defense-layering-2026.md`.

  No behavior change for users; reviewers were already prohibited from executing
  code by their body prose. This change makes the tool surface match the prose
  guarantee.

- [#290](https://github.com/KingInYellows/yellow-plugins/pull/290)
  [`65e2938`](https://github.com/KingInYellows/yellow-plugins/commit/65e29382c2df760ef62efca337c1fc6160193245)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  `subagent_type` 2-segment → 3-segment format across the `review:pr` keystone
  and other command files. Claude Code's Task registry resolves agents by the
  literal `plugin:directory:agent-name` triple from frontmatter — the 2-segment
  `plugin:agent-name` form silently mismatches and causes the
  graceful-degradation guard to skip every cross-plugin persona spawn.

  Also updates `scripts/validate-agent-authoring.js` to register both 2-segment
  and 3-segment forms (transitional — the 2-segment form remains accepted by the
  validator so non-keystone callers fail loudly only on the runtime mismatch,
  not on CI). New code should always emit the 3-segment form.

  `yellow-review` (MINOR — keystone behavior fix, no API change):
  - `commands/review/review-pr.md` — Step 3d `learnings-researcher` dispatch
    (`yellow-core:research:learnings-researcher`), the entire always-on /
    conditional / supplementary persona dispatch table (17 entries: 4 always-on
    plus 12 conditional plus 1 supplementary — `yellow-review:review:*` for the
    10 in-plugin personas, `yellow-core:review:*` for the 6 security / perf /
    architecture / pattern / simplicity / polyglot personas,
    `yellow-codex:review:codex-reviewer` for the optional supplementary), Step 8
    `yellow-review:review:code-simplifier`, and Step 9a
    `yellow-core:workflow:knowledge-compounder` all corrected to the
    three-segment registry form.
  - `commands/review/review-all.md` — `learnings-researcher` Task example in the
    inlined per-PR pipeline corrected to
    `yellow-core:research:learnings-researcher`.
  - `skills/pr-review-workflow/SKILL.md` — Cross-Plugin Agent References
    examples corrected to `yellow-core:review:security-sentinel` and
    `yellow-codex:review:codex-reviewer`; pattern hint expanded from
    `yellow-core:<agent-name>` to `yellow-core:<dir>:<agent-name>` so future
    authors copy the right form.
  - `agents/review/code-reviewer.md` — Deprecation stub frontmatter and body
    migration prose updated to spell out the three-segment form
    (`yellow-review:review:code-reviewer` →
    `yellow-review:review:project-compliance-reviewer`); the stub's
    residual_risks JSON also corrected so any caller still landing on the stub
    gets a copy-pasteable replacement string.
  - `CLAUDE.md` Cross-Plugin Agent References — Both intro paragraphs updated to
    specify the three-segment form with a concrete example.

  `yellow-core` (MINOR — self-reference fix on Wave 2 keystone agent and core
  workflow commands):
  - `agents/research/learnings-researcher.md` Integration section — Standalone
    invocation example corrected to `yellow-core:research:learnings-researcher`.
  - `commands/workflows/compound.md` — `knowledge-compounder` dispatch corrected
    to `yellow-core:workflow:knowledge-compounder`.
  - `commands/workflows/work.md` — Codex rescue dispatch corrected to
    `yellow-codex:workflow:codex-executor`.

  `yellow-docs` (MINOR — every cross-agent dispatch was 2-segment):
  - `commands/docs/audit.md` — `doc-auditor` →
    `yellow-docs:analysis:doc-auditor`.
  - `commands/docs/diagram.md` — `diagram-architect` →
    `yellow-docs:generation:diagram-architect`.
  - `commands/docs/generate.md` — `doc-generator` →
    `yellow-docs:generation:doc-generator`.
  - `commands/docs/refresh.md` — both `doc-auditor` and `doc-generator`
    references updated as above.

  `yellow-research` (MINOR — deepen-plan dispatch was 2-segment):
  - `commands/workflows/deepen-plan.md` — `repo-research-analyst` →
    `yellow-core:research:repo-research-analyst`; `research-conductor` →
    `yellow-research:research:research-conductor`.

  Triggers a marketplace release so consumers' plugin caches refresh; the
  keystone is otherwise dispatch-blocked end-to-end.

- [`1741901`](https://github.com/KingInYellows/yellow-plugins/commit/17419010b0ef8a278684f8f146d7dc86ea005840)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Summary

  feat(yellow-core): add /worktree:cleanup command for smart git worktree
  cleanup

  New `/worktree:cleanup` command in yellow-core that scans all git worktrees,
  classifies them into 7 categories (missing directory, locked, branch merged,
  stale, clean-active, dirty, detached HEAD), and removes stale worktrees with
  appropriate safeguards.

  Also adds Phase 6 to `/gt-cleanup` in gt-workflow to offer triggering
  `/worktree:cleanup` via Skill tool with graceful degradation.

### Patch Changes

- [`b441164`](https://github.com/KingInYellows/yellow-plugins/commit/b441164550b346b20b73bf466bcbc3e33e823b74)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix ast-grep
  MCP Python 3.13 gate with uv-managed Python

  Add `--python 3.13` to uvx args so uv auto-downloads Python 3.13 without
  touching the system Python. Auto-install uv and pre-warm Python 3.13 in the
  install script. Remove Python 3.13 system requirement from setup commands. Fix
  sg/ast-grep binary check inconsistency in setup:all dashboard.

- [`31da4b1`](https://github.com/KingInYellows/yellow-plugins/commit/31da4b14740f8eea7fc45501b94a2151c5a36009)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix shell
  portability and reliability in setup scripts. Replace bash-only version_gte()
  with POSIX-compatible implementation in install-codex.sh and
  install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
  against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
  reliability in setup:all by replacing Python heredoc with python3 -c,
  snapshotting tool paths to prevent PATH drift, and using find|xargs instead of
  find|while for plugin cache detection. Add web-app pre-flight check to
  browser-test:setup.

- [#287](https://github.com/KingInYellows/yellow-plugins/pull/287)
  [`bb5855e`](https://github.com/KingInYellows/yellow-plugins/commit/bb5855ea58e6282e9d449c88061c88cdc955130a)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Wave 3 —
  git-worktree skill fixes (W3.4) + local-config schema expansion (W3.6).

  `yellow-core` (PATCH — additive documentation):
  - **`git-worktree` skill (W3.4):** Add two new sections covering common
    worktree pitfalls:
    - Auto-trust mise/direnv configs after worktree creation. Trust is keyed on
      absolute path, so a new worktree starts untrusted until `mise trust` /
      `direnv allow` runs in the new directory.
    - `.git`-is-a-file detection (submodule and linked-worktree cases). Naive
      `[ -d .git ]` checks misclassify both cases as "not a git repo"; use
      `git rev-parse --git-dir` instead. Includes a typed detector pattern
      (`git_dir_kind`).
  - **`local-config` skill (W3.6):** Expand the W2.7 minimum schema to document
    the three forward-compatible Wave 3 keys:
    - `stack` — array of `ts`/`py`/`rust`/`go` to scope language-specific review
      behavior (acted on by W3-pending polyglot scoping).
    - `agent_native_focus` — boolean to force the W3.5 agent-native reviewer
      triplet regardless of diff triggers (acted on by W3.5).
    - `confidence_threshold` — integer 0–100 to override the Wave 2 aggregation
      gate (acted on by W3.13b). Adds a "Consumer adoption status" table making
      per-key pending state explicit, plus validation rules covering each new
      key (clamping, unknown-entry handling, type coercion). Replaces the prior
      "Wave 3 expansion (preview)" stub with first-class schema documentation.

  No consumer commands change in this PR — the keys remain documented but
  ignored until W3.5 / W3.13b / polyglot scoping land. Authors may set them
  today; the existing forward-compatibility rule (unknown keys emit a warning,
  do not abort) keeps the file valid both before and after the consumer commands
  adopt them.

- [`b9c6e5b`](https://github.com/KingInYellows/yellow-plugins/commit/b9c6e5bf422027828c99c0537aa4597d604af100)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  `/gt-setup` from validation-only into a 3-phase AI agent configuration wizard:
  prerequisite validation, guided Graphite CLI settings (branch prefix, pager,
  dates, submit body), and convention file + PR template generation. Update
  consumer commands (`/smart-submit`, `/gt-amend`, `/gt-stack-plan`) to read
  `.graphite.yml` for repo-level behavior overrides. Add `.graphite.yml` and PR
  template checks to `/setup:all` dashboard.

- [#288](https://github.com/KingInYellows/yellow-plugins/pull/288)
  [`6ca3de4`](https://github.com/KingInYellows/yellow-plugins/commit/6ca3de44a1ee1d8dc428222e0976c51567e332a7)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Fix
  subagent_type format to 3-segment (plugin:directory:agent) across keystone
  orchestrator and command files.

  The Wave 2 keystone (`/review:pr`) Step 4 dispatch table, Step 3d learnings
  pre-pass, Step 7 code-simplifier pass, and Step 9a knowledge-compounding step
  all referenced agents using the 2-segment form (e.g.
  `yellow-review:correctness-reviewer`). The Claude Code agent registry requires
  the 3-segment form (`yellow-review:review:correctness-reviewer`, where the
  middle segment is the agent's subdirectory under `plugins/<name>/agents/`).
  The 2-segment form fails dispatch with "Agent type not found" — meaning every
  persona spawn from the new keystone would error even after the cache picks up
  the new agents.

  This is purely a documentation / orchestration-prose fix; no agent behaviour
  changes. Affected files:
  - `plugins/yellow-review/commands/review/review-pr.md` — 17 dispatch table
    entries + 3 inline `subagent_type:` references
  - `plugins/yellow-review/commands/review/review-all.md` — 1 inline reference
    (parity with review-pr.md Step 3d)
  - `plugins/yellow-review/skills/pr-review-workflow/SKILL.md` — 2 cross-plugin
    Task examples (security-sentinel, codex-reviewer); pattern hint expanded to
    clarify the 3-segment shape
  - `plugins/yellow-review/agents/review/code-reviewer.md` — deprecation-stub
    migration guidance (was pointing users to the wrong format)
  - `plugins/yellow-core/commands/workflows/compound.md` — knowledge-compounder
    dispatch
  - `plugins/yellow-core/commands/workflows/work.md` — codex-executor rescue
    dispatch
  - `plugins/yellow-core/agents/research/learnings-researcher.md` — usage-doc
    invocation example
  - `plugins/yellow-docs/commands/docs/audit.md`, `diagram.md`, `generate.md`,
    `refresh.md` — 5 doc-auditor / diagram-architect / doc-generator dispatches

  Discovered while running a manual /review:pr trial against PR #287 (Wave 3
  trial branch). Every Wave 2 persona dispatch errored with "Agent type not
  found" until the 3-segment form was used. This blocks the keystone from
  running end-to-end even after a plugin cache refresh.

- [`e00b53e`](https://github.com/KingInYellows/yellow-plugins/commit/e00b53e874fe3d053c9f683b2eb86d1e6fe99dff)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Unbundle
  context7 MCP from yellow-core; repoint yellow-research callers to user-level

  Remove the bundled `mcpServers.context7` entry from
  `plugins/yellow-core/.claude-plugin/plugin.json` to avoid the
  dual-OAuth-pop-up issue when users have context7 installed both at user level
  and bundled inside yellow-core (the namespace collision pattern documented in
  `docs/solutions/integration-issues/duplicate-mcp-url-double-oauth.md`). Per CE
  PR #486 (compound-engineering v2.62.0, 2026-04-03) parity.
  - **yellow-core:** `mcpServers` block removed from `plugin.json`;
    `best-practices-researcher` agent's tool list updated to user-level
    `mcp__context7__*` names; CLAUDE.md/README.md updated to recommend
    user-level install; statusline/setup.md no longer lists yellow-core as
    having an MCP.
  - **yellow-research:** `code-researcher` agent, `/research:code` command,
    `/research:setup` command, `research-patterns` skill, CLAUDE.md, and
    README.md all repointed from `mcp__plugin_yellow-core_context7__*` to
    user-level `mcp__context7__*`. ToolSearch availability check + EXA fallback
    preserved (existing prose).

  **User action:** install context7 at user level via
  `/plugin install context7@upstash` (or via Claude Code MCP settings UI). The
  user-level context7 server registers tools as
  `mcp__context7__resolve-library-id` and `mcp__context7__query-docs`.
  yellow-research's `code-researcher` falls back to EXA `get_code_context_exa`
  if user-level context7 is not detected by ToolSearch — no behavior change for
  users without context7.

  Roll back by re-adding the `mcpServers.context7` block to
  `plugins/yellow-core/.claude-plugin/plugin.json` and reverting the tool-name
  repoints in yellow-research.

## 1.4.1

### Patch Changes

- [`e3ef6ff`](https://github.com/KingInYellows/yellow-plugins/commit/e3ef6ffbd175c44756d1c6ac7511b1040d2e9720)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add yellow-docs
  documentation plugin with 5 commands (setup, audit, generate, diagram,
  refresh), 3 agents, and 1 shared skill. Register in marketplace and setup:all.

## 1.4.0

### Minor Changes

- [`7565442`](https://github.com/KingInYellows/yellow-plugins/commit/7565442d220810f5a20e833eaf75976875cbe4c8)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add stack-aware
  bottom-up execution to workflows:work. When a plan contains a
  `## Stack Decomposition` section, workflows:work creates branches just-in-time
  and executes each stack item sequentially with checkpoints and progress
  tracking.

### Patch Changes

- [`906430f`](https://github.com/KingInYellows/yellow-plugins/commit/906430f988f7a8f333d3faa530bbcfb6f87cfca3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  yellow-core CLAUDE.md to document stack-aware workflows:work capability and
  gt-workflow dependency for stack decomposition features.

- [`dc72dfa`](https://github.com/KingInYellows/yellow-plugins/commit/dc72dfa52c47a0578171071c452b58350b85b5bc)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Update
  workflows:plan post-generation options to clarify that gt-stack-plan adds
  decomposition to the plan (no branches created) and workflows:work executes
  bottom-up when decomposition exists.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.3.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

### Patch Changes

- [`91908d9`](https://github.com/KingInYellows/yellow-plugins/commit/91908d935feb46fbb447a67eae997e5f491e3c05)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add MCP warmup
  and retry-once patterns to all consuming commands for ruvector integration
  consistency. Harden install.sh and setup.md to require global binary in PATH.

---

## [1.2.0] - 2026-03-06

### Minor Changes

- [`0f5b2a1`](https://github.com/KingInYellows/yellow-plugins/commit/0f5b2a1916516291e058b991c30a50c1ef890cac)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add /setup:all
  command — unified orchestrator that checks prerequisites, environment
  variables, and config files across all 9 plugins, then offers interactive
  setup for plugins that need attention with a before/after summary.

### Patch Changes

- [`9a28a2d`](https://github.com/KingInYellows/yellow-plugins/commit/9a28a2dd7570f741c80c0eb07bdda32165ad5f14)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add
  `/linear:work` bridge command and cross-plugin integration connectors.
  yellow-linear gets a minor bump (new command), yellow-core and gt-workflow get
  patch bumps (behavioral additions to existing commands).

---

## [1.1.0] - 2026-02-25

### Added

- Add /workflows:brainstorm command and brainstorm-orchestrator agent for
  pre-planning requirement exploration. Add /workflows:compound command for
  documenting solved problems.

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — developer toolkit with review agents, research agents, and
  workflow commands.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
