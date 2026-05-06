---
"yellow-docs": minor
---

Add `/docs:review` command and 7 new persona reviewer agents for
multi-perspective review of planning documents (PRDs, brainstorms, specs,
ADRs, plans, design docs).

**New command:**

- `/docs:review <path>` — orchestrates parallel persona review with
  confidence-rubric aggregation. Mirrors yellow-review's Wave 2 pattern:
  optional learnings pre-pass, parallel persona dispatch, suppress
  findings with `confidence < 75` (except safe-auto and P0 escapes),
  optional safe-auto application, optional compound hand-off.

**New review/ agents directory** (auto-discovered; no plugin.json edit needed):

- `coherence-reviewer` (haiku) — Internal consistency, contradictions,
  terminology drift, broken cross-references. Safe-auto patterns:
  header/body count mismatch, stale cross-reference, terminology drift
  between two interchangeable synonyms.
- `design-lens-reviewer` (sonnet) — Information architecture, interaction
  states, user flows, accessibility, AI-slop check. Dimensional 0–10
  rating; only emit findings for 7/10 or below.
- `feasibility-reviewer` — Architecture reality, shadow path tracing
  (happy/nil/empty/error), dependencies, performance feasibility,
  migration safety, implementability.
- `product-lens-reviewer` — Premise challenge (always first), strategic
  consequences (trajectory, identity, adoption, opportunity cost,
  compounding direction), implementation alternatives, goal-requirement
  alignment, prioritization coherence. Internal vs. external product
  context calibration.
- `scope-guardian-reviewer` (sonnet) — "What already exists?",
  scope-goal alignment, complexity challenge, priority dependency
  analysis, completeness principle.
- `security-lens-reviewer` (sonnet) — Plan-level threat model: attack
  surface inventory, auth/authz gaps, data exposure, third-party trust
  boundaries, secrets management.
- `adversarial-document-reviewer` — CONDITIONAL persona, invoked when
  document has more than 5 requirements OR risk-domain keywords (auth,
  payments, migration, compliance, PII, cryptography). Depth-calibrated
  (quick/standard/deep). Five techniques: premise challenging,
  assumption surfacing, decision stress-testing, simplification
  pressure, alternative blindness.

All 7 personas are read-only (`tools: [Read, Grep, Glob]`), 3-segment
`subagent_type` compliant, and emit the standard yellow-docs compact-return
JSON schema with category-appropriate fields. Adapted from upstream
compound-engineering v3.3.2 at locked SHA
`e5b397c9d1883354f03e338dd00f98be3da39f9f`. Bash stripped from tools per
review-agent read-only contract.

CLAUDE.md and README.md updated: agent count 3 → 10, command count 5 → 6,
new Review agent table, new "When to Use" row for `/docs:review`.

Closes Wave 3 #2 from the EveryInc merge plan.
