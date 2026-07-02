# Design rationale — optimize skill

Non-executed background for the `optimize` skill's design decisions.
Content moved verbatim from SKILL.md's "Persistence" rationale and
"Notes" sections (C6 progressive-disclosure split).

## Why no persistence by default (expanded)

This is a deliberate divergence from upstream `ce-optimize` (which uses
`.context/compound-engineering/ce-optimize/` for crash-safety across
multi-hour runs):

- Yellow-plugins runs are typically <30 minutes — the upstream's
  multi-hour optimization loops don't apply here.
- Avoiding scratch directories keeps the skill self-contained — no cleanup,
  no `.gitignore` collisions, no resume logic.
- The `knowledge_compound: true` path is the durable persistence option;
  use it when the optimization result deserves to be in the catalog.

If a run needs to span multiple sessions, capture the candidate bodies and
ranked report manually (copy to a temp note) and re-invoke. Add disk
persistence later if a use case emerges.

## Notes

- **Why analytic rubrics, not holistic.** Per-criterion rubrics produce
  more reliable inter-rater agreement than holistic scoring across
  evaluation studies; the rubric pattern also makes warrant inspectable
  because reviewers can audit each score independently. The exact ICC
  figures cited in the source-plan research note (`plans/everyinc-merge.md`
  W3.14) are calibration approximations, not load-bearing constants —
  treat the rule as "use per-criterion scoring," not "use it for X% gain."
- **Why two-run order-swap, not single-run.** Single-run judges show wide
  inter-rater reliability variance across random seeds, and a substantial
  fraction of pairwise rankings invert between runs. Two-run order-swap
  is the cost-effective minimum to recover most of the variance for
  roughly 2× the cost; a third run adds little. See the source-plan
  research note for the underlying citations.
- **Why style-bias self-check.** Judges trained on style-coupled
  preference data (e.g., "more verbose = better-explained") systematically
  bias toward longer or better-formatted candidates regardless of
  substance. The self-check is a low-cost flag that the user can act on
  by normalizing style before re-judging.
- **Why no persistence by default.** Yellow-plugins runs are typically
  short. The upstream's multi-hour worktree-based experiments don't fit
  the surface here. Add disk persistence when a use case actually needs
  it; YAGNI until then.
- **Why optional research pre-pass.** Codebase-internal targets (a
  yellow-plugins agent body, a project-specific config key) rarely
  benefit from external research and the noise can pollute generation.
  External-pattern targets (a public-facing prompt, a UX-pattern
  refactor) often do benefit. Default to on; spec authors flip to off
  when they know.
