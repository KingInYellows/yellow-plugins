---
"yellow-core": minor
---

Add `compound-lifecycle` skill (W3.10) — staleness detection, overlap
detection, and consolidation hand-off for `docs/solutions/`

Introduces `plugins/yellow-core/skills/compound-lifecycle/SKILL.md`
(user-invokable as `/yellow-core:compound-lifecycle`) plus
`docs/solutions/archived/` scaffolding to maintain the institutional
knowledge catalog over time.

**Three operations:**

1. **Composite staleness detection** — replaces the upstream's pure
   90-day cutoff with a 4-component score (Atlan-pattern):
   `0.4 * days_since_modified + 0.3 / inbound_refs + 0.2 *
   embedding_age_days + 0.1 * days_since_retrieved`. Heavily-cited
   evergreen entries don't get false-flagged; recent entries with
   broken references do get flagged. Embedding/retrieval components
   contribute zero when ruvector is unavailable (graceful degradation;
   noted in report).

2. **Two-pass overlap detection** — `category` + `tags` overlap pass
   first (cheap), then BM25 on `problem:` lines, then optional ruvector
   cosine clustering at 0.82 threshold (calibrated default for
   paragraph-level semantic equivalence on markdown corpora —
   Universal Sentence Encoder convention; Pinecone case study).
   Surfaces 0.78–0.90 as "review suggestions"; ≥ 0.90 as
   "high-confidence overlap" — both still gate on user approval.

3. **AskUserQuestion-gated consolidation hand-off** — never
   auto-merges. For Consolidate / Replace classifications, dispatches
   `knowledge-compounder` via Task to write the merged canonical
   entry, then archives the source entries with a `superseded_by:`
   frontmatter pointer.

**Five-outcome classification table** (Keep / Update / Consolidate /
Replace / Delete-and-archive) adapted from upstream
`ce-compound-refresh` at locked SHA `e5b397c9`. Drift boundary —
Update vs Replace — preserves the upstream's "stop if you find
yourself rewriting the solution" rule.

**Archive, don't delete (yellow-plugins divergence from upstream):**
upstream's "delete and let git history serve as the archive" rule is
inverted. Archived entries move to
`docs/solutions/archived/<original-category>/` and remain searchable
for forensics, citation continuity (external links to
`docs/solutions/<...>` paths don't 404), and `learnings-researcher`
fallback when a related-but-not-identical problem recurs.
`learnings-researcher` excludes the `archived/` subtree from its
default search by glob — the live catalog stays clean.

**Per-project tuning** via `yellow-plugins.local.md`'s
`compound_lifecycle.staleness.{w1,w2,w3,w4,threshold}` and
`compound_lifecycle.overlap.{bm25_percentile,cosine_review,
cosine_high_confidence}` keys (forward-declared in the `local-config`
skill schema; no schema migration needed).

**Autofix mode** for scheduled background runs: applies unambiguous
Updates only; marks Consolidate / Replace / Delete-and-archive as
`status: stale` with `stale_reason` for human review later. Writes
report to `docs/solutions/_lifecycle-runs/<timestamp>.md`.

**Hard quality dependency** for W3.11 (ideation skill) per the
research note in the source plan — stale or duplicated catalog
entries degrade ideation candidate generation.

Adapted from upstream `EveryInc/compound-engineering-plugin` snapshot
(703-line `ce-compound-refresh/SKILL.md` extracted; we ship a focused
~400-line implementation rather than the full upstream).
