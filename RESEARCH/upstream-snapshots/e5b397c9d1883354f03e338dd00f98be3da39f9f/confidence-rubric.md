# Confidence Rubric — Extracted from `ce-code-review/SKILL.md`

**Source:** `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/skills/ce-code-review/SKILL.md`
**Locked SHA:** `e5b397c9d1883354f03e338dd00f98be3da39f9f` (compound-engineering-v3.3.2, released 2026-04-29)
**Resolves OQ-2.** Used by W2.4 to drive `review:pr` aggregation in the yellow-plugins keystone rewrite. Adapted, not copied verbatim.

## Severity scale

P0–P3:

| Level | Meaning | Action |
|-------|---------|--------|
| **P0** | Critical breakage, exploitable vulnerability, data loss/corruption | Must fix before merge |
| **P1** | High-impact defect likely hit in normal usage, breaking contract | Should fix |
| **P2** | Moderate issue with meaningful downside (edge case, perf regression, maintainability trap) | Fix if straightforward |
| **P3** | Low-impact, narrow scope, minor improvement | User's discretion |

## Confidence anchors

`confidence` is one of 5 discrete integer anchors: **0, 25, 50, 75, 100**. Synthesis treats anchors as integers; do not coerce to floats.

| Anchor | Meaning |
|--------|---------|
| **0** | Speculative — reviewer is unsure |
| **25** | Possible — reviewer can imagine the issue but lacks evidence |
| **50** | Probable — reviewer has partial evidence; could be a false positive |
| **75** | Confident — reviewer has strong evidence the issue is real |
| **100** | Certain — reviewer has full evidence, edge cases verified |

## Action routing

Severity answers **urgency**. Routing answers **who acts next** and **whether mutation is allowed**.

| `autofix_class` | Default owner | Meaning |
|-----------------|---------------|---------|
| `safe_auto` | `review-fixer` | Local, deterministic fix suitable for in-skill auto-apply when mode allows mutation |
| `gated_auto` | `downstream-resolver` or `human` | Concrete fix exists, but it changes behavior, contracts, permissions, or another sensitive boundary that should not auto-apply |
| `manual` | `downstream-resolver` or `human` | Actionable work that should be handed off rather than fixed in-skill |
| `advisory` | `human` or `release` | Report-only output — learnings, rollout notes, residual risk |

Routing rules:
- **Synthesis owns the final route.** Persona-provided routing metadata is input, not the last word.
- **Conservative on disagreement.** A merged finding may move from `safe_auto` → `gated_auto` → `manual`, never the other way without stronger evidence.
- **Only `safe_auto → review-fixer` enters the in-skill fixer queue automatically.**
- **`requires_verification: true` means a fix is not complete without targeted tests, focused re-review, or operational validation.**

## Compact-return schema (per-finding)

Each persona reviewer returns compact JSON with these merge-tier fields per finding:

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | Short actionable summary (no "consider"/"might want to") |
| `severity` | enum | `P0` \| `P1` \| `P2` \| `P3` |
| `file` | string | Path relative to repo root |
| `line` | int | Positive integer; cited line in the file |
| `confidence` | int | One of `{0, 25, 50, 75, 100}` |
| `autofix_class` | enum | `safe_auto` \| `gated_auto` \| `manual` \| `advisory` |
| `owner` | enum | `review-fixer` \| `downstream-resolver` \| `human` \| `release` |
| `requires_verification` | bool | True if the fix needs a focused re-test |
| `pre_existing` | bool | True if the issue predates this diff |
| `suggested_fix` | string \| null | Optional concrete fix prose; required for `safe_auto` |

Top-level required fields per reviewer return: `reviewer` (string), `findings` (array), `residual_risks` (array), `testing_gaps` (array). Drop the entire return if any are missing or wrong type.

Detail-tier fields (`why_it_matters`, `evidence[]`) are **not** in the compact return — they live in the per-agent run-artifact file on disk and are loaded only during Stage 6 detail enrichment.

## Aggregation pipeline (Stage 5 of CE; Step 6 of yellow-plugins review-pr)

Run in this order on the validated finding set:

1. **Validate.** Drop malformed returns/findings against the constraints above. Record drop count.
2. **Deduplicate.** Fingerprint = `normalize(file) + line_bucket(line, ±3) + normalize(title)`. On match, merge: keep highest severity, keep highest anchor, note all reviewers that flagged it.
3. **Cross-reviewer agreement promotion.** When 2+ independent reviewers flag the same fingerprint, promote anchor by one step: `50 → 75`, `75 → 100`, `100 → 100`. Cross-reviewer corroboration is a stronger signal than any single reviewer's anchor. Note the agreement in the Reviewer column (e.g., `security, correctness`).
4. **Separate pre-existing.** Pull out `pre_existing: true` into a separate report section.
5. **Resolve disagreements.** When reviewers flag the same code region but disagree on severity / autofix_class / owner, annotate the Reviewer column with the disagreement and keep the more conservative route.
6. **Normalize routing.** Keep most conservative `autofix_class` and `owner`. Synthesis may narrow `safe_auto → gated_auto → manual`; never widen without new evidence.
7. **Mode-aware demotion (testing/maintainability soft-bucket).** A finding qualifies for demotion when ALL hold:
   - severity is P2 or P3
   - `autofix_class` is `advisory`
   - ALL contributing reviewers are testing or maintainability
   When qualified: in interactive/report-only modes, move it out of primary findings into `testing_gaps` (if testing) or `residual_risks` (if maintainability). In headless/autofix, suppress entirely. Record the count.
8. **Confidence gate.** Suppress findings below anchor 75. **Exception:** P0 findings at anchor 50+ survive. Record suppressed counts.
9. **Partition the work.** Build three sets: in-skill fixer queue (`safe_auto → review-fixer`), residual actionable queue (`gated_auto`/`manual` owned by `downstream-resolver`), report-only queue (`advisory` + `human`/`release`).
10. **Sort.** severity (P0 first) → anchor descending → file path → line number.

The gate runs **after** dedup/promotion/demotion deliberately: anchor-50 findings deserve a chance at promotion (step 3) or rerouting (step 7) before any drop decision.

## Intent verification

Before reporting any P1, the orchestrator verifies the persona's claim against the diff and intent summary. CE uses an optional Stage 5b validator pass (one sub-agent per surviving finding); yellow-plugins is starting with a lighter-weight intent check inline at Step 6 (file existence, line accuracy, no protected-artifact violations). Stage 5b validators may be added in a follow-up wave when the false-positive rate becomes the dominant cost.

## Comparable benchmarks

For cross-reference. These are NOT what yellow-plugins is adopting; CE's exact rubric (above) takes precedence for upstream consistency. Documented for future calibration:

| Source | Threshold | Result |
|--------|-----------|--------|
| Premasundera 2025 (Tampere) | 0.7 across all categories | 28% FP reduction, 92% recall |
| Rasheed et al. (arXiv 2404.18496) | ≥0.75 | 42% fewer FPs at 8% TP loss |
| Diffray (industry) | category-specific: security/perf ≥0.8, logic/correctness ≥0.7, style ≥0.6 | n/a |
| OpenAI Codex CLI | N-of-M voting: ≥2 agents OR single ≥0.8 | n/a |

**Calibration caveat (April 2026):** Raw LLM self-reported confidence is systematically over-confident across all frontier models. Without temperature/Platt scaling against a labelled corpus, the chosen thresholds will produce more noise than the source studies report. Defer calibration to a follow-up pass once the pipeline produces enough labelled review data to fit a calibration map.

## Failure-mode glossary (CE-specific)

| Class | Description |
|-------|-------------|
| `applied` | Fix was attempted and applied cleanly |
| `failed` | Evidence-match failed, fix did not apply, verification failed, or persona produced no `suggested_fix` for a non-advisory finding |
| `advisory` | Acknowledged; no action |

## Adapted shape for yellow-plugins keystone (W2.4)

The yellow-plugins keystone preserves the rubric above with these adaptations:

- **Modes are simplified.** yellow-plugins ships interactive only in this wave; autofix/headless/report-only are out of scope until a later wave establishes the run-artifact directory and downstream-resolver tooling. The pipeline treats every invocation as interactive.
- **No Stage 5b validator pass yet.** The optional independent-validator pass is deferred. Step 6 of `review-pr.md` does inline intent verification (file existence, line check, protected-artifact filter) per CE Quality Gates.
- **No `/tmp` run-artifact directory.** yellow-plugins does not yet have downstream consumers (ce-polish-beta analog) that read run artifacts. Compact-return-only is sufficient for the keystone wave; per-agent JSON artifact files become a follow-up requirement when artifact consumers exist.
- **`reviewer_set` honors `yellow-plugins.local.md`.** The dispatch table in Step 4 reads `review_pipeline`, `review_depth`, `focus_areas`, and `reviewer_set.{include,exclude}` per W2.7 schema.
- **Graceful degradation.** Missing-agent dispatch errors log to stderr (`[review:pr] Warning: agent X not available, skipping`) and continue. The pipeline never aborts on a missing persona.

## Adopted vs deferred (summary)

**Adopted in this keystone (W2.4):**
- P0–P3 severity scale
- 5-anchor confidence (0/25/50/75/100)
- 4-class autofix_class routing
- Compact-return schema (10 fields)
- Stage 5 aggregation steps 1–10 (including cross-reviewer promotion, mode-aware demotion, confidence gate with P0 exception)
- Quality Gates (actionability, no skim FPs, severity calibration, line accuracy, protected-artifact filter)

**Deferred to a future wave:**
- Mode tokens (`mode:autofix`, `mode:report-only`, `mode:headless`) — interactive only for now
- Stage 5b independent-validator dispatch
- `/tmp/...` run-artifact directory + per-agent JSON
- Tracker-defer (`references/tracker-defer.md`) externalization to Linear/GitHub Issues
- Walk-through per-finding interactive option
- Best-judgment auto-resolve dispatch
- Bulk-preview confirmation gate
- `metadata.json` + downstream-skill consumption protocol

The deferred items will land as a Wave 4+ effort once the keystone has been dogfooded and the run-artifact consumer pattern is concrete.
