# Staleness scoring and overlap clustering — formulas and thresholds

Loaded by `compound-lifecycle` SKILL.md Step 5. Content moved verbatim
from SKILL.md (C6 progressive-disclosure split); the formula, gate, and
thresholds here are the single source of truth — never score from memory.

## 5a. Composite staleness score

Single time-thresholds (the upstream's 90-day cutoff) over-flag
heavily-cited evergreen entries and under-flag recent entries with
broken references. Use the composite score:

```text
staleness_score = w1 * days_since_modified
                * (w2 / max(inbound_refs, 1) + (1 - w2))  # citation discount
                + w3 * embedding_age_days   # 0 when ruvector unavailable
                + w4 * days_since_retrieved # 0 when ruvector unavailable

defaults: w1=0.4, w2=0.3, w3=0.2, w4=0.1
threshold: stale when staleness_score > 100
```

The citation discount makes the refs term multiplicative on the age
component: when `inbound_refs` is high the effective age contribution
shrinks. With 10 refs the discount factor is `0.3/10 + 0.7 = 0.73`,
reducing the age contribution by 27%. The factor is asymptotic to
`1 - w2 = 0.7`, so the discount alone is bounded at a ~30% maximum
reduction — meaningful for moderate ages, but it cannot protect a
multi-year-old entry from crossing the threshold purely on age (a
3-year-old entry at 1095 days still scores `0.4 * 1095 * 0.73 ≈ 320`).

**Citation gate (mandatory pre-check before scoring):** If
`inbound_refs >= 5`, classify the entry as **Keep** and skip the
staleness score entirely. Heavily-cited entries are protected by
usage frequency, not by the score — the discount is a smoothing
correction for low-to-moderate citation cases (1–4 refs). Configure
the gate threshold via `compound_lifecycle.staleness.citation_gate`
(default `5`); set to `0` to disable the gate and rely on the score
alone (not recommended).

When ruvector is available but an entry has never been retrieved (e.g.,
it was added before ruvector was installed), treat `days_since_retrieved`
as equal to `days_since_modified` as a conservative fallback.

Weights are configurable via `yellow-plugins.local.md` keys
`compound_lifecycle.staleness.{w1,w2,w3,w4,threshold}`. The defaults
are anchored on Atlan's KB freshness scoring; tune empirically per
project.

When ruvector is unavailable, w3 and w4 contribute zero — staleness
collapses to `0.4 * days_since_modified * (0.3 / max(inbound_refs, 1) + 0.7)`. This is
weaker but still beats pure age. Note the degradation in the report.

## 5b. Overlap detection

Two-pass clustering:

1. **Cheap pass — `category` + `tags` overlap.** Group candidates whose
   `category` is identical AND whose `tags` arrays share ≥ 2 elements.
   Surface groups with > 2 members.
2. **Refined pass — BM25 on `problem:`.** Within each group from pass 1
   (and across pass-1 singletons that share at least one tag), tokenize
   `problem:` lines and rank pairwise BM25 scores. Surface pairs with
   BM25 score above the 90th percentile of the candidate set.
3. **Optional precision pass — ruvector cosine.** When
   `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` is available,
   query each pass-2 candidate's `problem:` line and check whether the
   paired candidate appears in top-3 with cosine ≥ 0.82. Drop pairs
   below 0.82; keep pairs ≥ 0.82.

Threshold rationale: 0.82 is the calibrated default for paragraph-level
semantic equivalence on markdown corpora (Universal Sentence Encoder
convention; Pinecone case study). Surface 0.78–0.90 as "review
suggestions"; mark ≥ 0.90 as "high-confidence overlap" but still gate
on user approval.

## Configuration keys

Per-project tuning lives in `.claude/yellow-plugins.local.md` per the
`local-config` skill schema. Recognized keys:

```yaml
compound_lifecycle:
  staleness:
    w1: 0.4   # days_since_modified weight
    w2: 0.3   # 1/inbound_refs weight
    w3: 0.2   # embedding_age_days weight (ruvector-only)
    w4: 0.1   # days_since_retrieved weight (ruvector-only)
    threshold: 100  # composite score above this is stale
  overlap:
    bm25_percentile: 90      # surface pairs above this rank percentile
    cosine_review: 0.78      # ruvector cosine — review-suggestion floor
    cosine_high_confidence: 0.90  # ruvector cosine — high-confidence overlap floor
```

All keys are optional; defaults apply when absent. The
`yellow-plugins.local.md` file itself is gitignored so per-project
tuning never lands in the catalog.
