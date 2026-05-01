---
"yellow-debt": minor
---

# Scanner output schema v2.0 — failure_scenario field, audit-synthesizer
confidence-rubric gate, dual-read v1.0/v2.0 transition window (W3.13b)

Bumps `debt-conventions/SKILL.md` from `schema_version: "1.0"` to `"2.0"` and
restructures the scanner output shape:

- `affected_files[]` (array) → `file` (single object); multi-file findings emit
  one finding per file instead of packing them into one entry
- `title` + `description` → flat `finding` string
- `suggested_remediation` → `fix`
- new required `failure_scenario` field (string or `null`) — one-to-two-sentence
  concrete production failure: trigger → execution path → user-visible or
  operational outcome. Borrowed from upstream
  `EveryInc/compound-engineering-plugin` `ce-adversarial-reviewer.agent.md` at
  locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`.

`audit-synthesizer` gains a category-specific confidence-rubric gate (Step 4):
security-debt/architecture ≥0.80, complexity/duplication ≥0.70, ai-pattern
≥0.60. Critical findings survive at ≥0.50 (mirrors the Wave 2 P0-at-anchor-50
exception). Migrated v1.0 inputs receive a +0.05 threshold bump to compensate
for the missing `failure_scenario` signal.

The synthesizer dual-reads `schema_version: "1.0"` and `"2.0"` artifacts during
the transition window, normalizing v1.0 inputs to the v2.0 in-memory shape so
existing `.debt/scanner-output/*.json` files do not break re-runs. Suppressed
findings are preserved in a `suppressed[]` array on the audit report (with the
gate that suppressed them) rather than silently dropped.

All 5 scanner agents (`ai-pattern`, `architecture`, `complexity`, `duplication`,
`security-debt`) updated with category-specific `failure_scenario` framing
guidance in their Output Requirements sections. The yellow-debt README todo
template gains a `## Failure Scenario` section so triage reviewers see the
production-impact framing alongside the debt description.

Schema evolution: scanner output is renamed v1.0 → v2.0 with field renames and
a new required failure_scenario field. The audit-synthesizer's dual-read
transition window normalizes v1.0 inputs in-memory, so existing scanner outputs
continue to work without modification during the transition window.
