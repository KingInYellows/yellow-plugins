---
"yellow-core": minor
---

Add `optimize` skill (W3.14) — metric-driven optimization with parallel
candidate variants and LLM-as-judge analytic rubric

Introduces `plugins/yellow-core/skills/optimize/SKILL.md` (user-invokable as
`/yellow-core:optimize`) plus `plugins/yellow-core/skills/optimize/schema.yaml`
defining the optimization spec format. Adapted from upstream
`EveryInc/compound-engineering-plugin` `ce-optimize` skill at locked SHA
`e5b397c9d1883354f03e338dd00f98be3da39f9f` — extract-only treatment from the
659-line upstream + 7 reference files.

**Five phases (each fits in a single conversation context):**

1. **Spec resolution** — read or scaffold the optimization spec; validate
   against `schema.yaml` (required: `optimization_target`,
   `measurement_criteria` with 2-5 entries; optional with defaults:
   `success_threshold` (3.5), `parallel_count` (2; range 2-5),
   `judge_runs` (2; range 1-3), and others). Path A: spec file path.
   Path B: `AskUserQuestion` 3-question scaffold flow. Echo + confirm
   gate before running.

2. **Research pre-pass (optional)** — dispatch `best-practices-researcher`
   (or `research-conductor` if yellow-research installed) for prior art on
   the optimization target. Summary fenced as `<external_research>` and
   included in each generator's prompt. Graceful degradation — if both
   researchers unavailable, log warning and proceed.

3. **Parallel candidate generation** — spawn `parallel_count` `general-purpose`
   Task agents in a single message. Each agent receives `<external_research>`
   and produces ONE variant in a fenced code block. Default
   `candidate_generation_prompt` requires meaningful design difference (not
   micro-tweaks). Single retry on timeout/missing-fence; drop on second
   failure with `parallel_count - 1` survivors.

4. **LLM-as-judge with order-swap** — judge runs `judge_runs` times
   (default 2). Run 1 in spec order; run 2 reversed (the order-swap that
   catches positional bias). Each judge run returns per-candidate records
   with `criterion_scores` (1-5 integer per criterion), `weighted_score`,
   `rationale`, and **`style_bias_check: bool`** (judge self-flags when
   style influenced score independently of substance). Sanity checks:
   warn if 50%+ records flag style bias, warn if any candidate's
   per-criterion scores diverge by >2 points between runs.

5. **Rank & hand-off** — average scores across runs; surface ranked list via
   `AskUserQuestion`. If `knowledge_compound: true` AND winner clears
   `success_threshold`, spawn `knowledge-compounder` via Task to write
   `docs/solutions/optimizations/<spec-name>.md`. Otherwise surface the
   chosen variant and exit cleanly.

**`judge_telemetry` schema (output)** documented in `schema.yaml`:
`{candidate_id, run_index, criterion_scores, weighted_score, rationale,
style_bias_check}`. Stored in conversation context only — no on-disk
persistence by default (yellow-plugins divergence; see below).

**Yellow-plugins divergence from upstream:**

- **No on-disk persistence by default.** Upstream `ce-optimize` writes to
  `.context/compound-engineering/ce-optimize/<spec-name>/` for crash-safety
  across multi-hour runs (CP-0 through CP-5 mandatory checkpoints, append-
  only experiment log, per-experiment `result.yaml` markers, strategy
  digest). Yellow-plugins runs are typically <30 minutes — the upstream's
  multi-hour optimization loops don't apply here. Conversation context
  holds candidates and judge_telemetry. The `knowledge_compound: true`
  path is the durable persistence option. Add disk persistence later if a
  use case actually needs it; YAGNI until then.
- **No worktree-based experiments.** Upstream uses
  `scripts/experiment-worktree.sh` to run each candidate in an isolated
  git worktree. Yellow-plugins skill operates entirely in-context — Task
  agents produce text variants the user later applies. Worktree
  experiments can be added in a follow-up if the optimization targets
  expand to file-based variants requiring isolated runtime measurement.
- **Single SKILL.md, no `references/` subdirectory.** Upstream splits
  methodology into 5 reference files (`usage-guide.md`,
  `experiment-prompt-template.md`, `judge-prompt-template.md`,
  `optimize-spec-schema.yaml`, `experiment-log-schema.yaml`); yellow-core
  skills consistently use a single SKILL.md, so methodology is folded
  inline. Schema lives in a sibling `schema.yaml` because YAML schemas are
  parsed differently than markdown.
- **Three-tier metric (`hard` / `judge` + `degenerate_gates`) collapsed to
  judge-only.** Upstream supports both hard scalar metrics (from a
  measurement command) and LLM-as-judge. Yellow-plugins ships judge-only
  for the initial pass — hard-metric integration requires a measurement-
  harness convention that doesn't exist yet in yellow-plugins. Spec
  authors who need hard metrics can extend the schema in a follow-up.
- **No multi-iteration optimization loop.** Upstream runs hypothesis-
  generation → batch-experiments → strategy-digest → next-batch over
  multiple iterations. Yellow-plugins ships single-batch only — the user
  picks a winner from one batch. Multi-iteration loops can be added if
  the team finds single-batch insufficient.

**Methodology preserved (and extended) from upstream:**

- **Two-run order-swap as judge default** — single-run judges show wide
  inter-rater reliability variance across random seeds, and a substantial
  fraction of pairwise rankings invert between runs. Upstream defaults to
  1 run; yellow-plugins defaults to 2 because the cost is small and the
  variance is large. See `plans/everyinc-merge.md` W3.14 for the
  underlying citations.
- **Per-criterion analytic rubric, not holistic** — per-criterion rubrics
  produce more reliable inter-rater agreement than holistic scoring across
  evaluation studies. Both upstream and yellow-plugins support this;
  yellow-plugins makes it the only mode. The exact ICC figures cited in
  the source-plan research note are calibration approximations, not
  load-bearing constants.
- **`style_bias_check` self-flag** is **new in yellow-plugins** — added per
  the source-plan research note (`amend the W3.14 judge_telemetry to
  include style_bias_check: <bool>`). Surfaces when judges trained on
  style-coupled preference data bias toward longer/better-formatted
  candidates regardless of substance. The skill warns the user when 50%+
  of records flag this; the user decides whether to normalize style and
  rerun.

**Acceptance criterion satisfied:** the skill spec validates a synthetic
2-candidate experiment shape and the documented Phase 3 judge prompt
produces ranked output with scores and rationale per the schema.

Discoverable via auto-discovery from
`plugins/yellow-core/skills/optimize/SKILL.md` — no `plugin.json`
registration required. `schema.yaml` is loaded at runtime from the same
directory via the skill's relative path reference.
