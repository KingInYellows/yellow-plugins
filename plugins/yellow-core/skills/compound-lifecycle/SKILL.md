---
name: compound-lifecycle
description: "Audit, refresh, and consolidate `docs/solutions/` to keep the institutional knowledge catalog from rotting. Runs three operations — staleness detection (composite-scored, not pure age), overlap detection (BM25 + optional ruvector cosine clustering on `problem:`), and consolidation hand-off (AskUserQuestion-gated, dispatches `knowledge-compounder` to write the merged entry, archives superseded entries to `docs/solutions/archived/`). Use when a `docs/solutions/` sweep is needed — phrases like \"refresh learnings\", \"audit solutions\", \"clean up stale docs\", \"consolidate overlapping entries\", or after `knowledge-compounder` flags an older entry as superseded by a newer write."
user-invokable: true
---

# compound-lifecycle

## What It Does

Maintains the long-term quality of the `docs/solutions/` catalog. Without
this skill, `knowledge-compounder` keeps writing entries (the catalog
grows ~50/month at current rate) but nothing ever marks an entry stale,
notices when two entries cover the same fix pattern, or consolidates
clusters into a single canonical doc. The result is silent drift: two
docs eventually say different things, the `learnings-researcher` returns
contradictory hits, and the catalog quality erodes faster than it grows.

Three operations:

1. **Staleness detection** — flag entries whose composite freshness score
   falls below threshold. Uses time-since-modified, inbound reference
   count, retrieval recency, and (when ruvector is available) embedding
   age. A heavily-cited entry ages more slowly (the citation discount
   reduces the effective age contribution), making false-flags unlikely
   in practice; a recent entry with a broken file reference is stale even
   if it was written yesterday.
2. **Overlap detection** — cluster entries by `category` + `tags` first
   (cheap), then run a BM25 pre-filter on `problem:` lines, then (when
   ruvector is available) run cosine similarity on the top BM25 hits and
   surface clusters with similarity ≥ 0.82.
3. **Consolidation hand-off** — for each detected cluster or stale
   entry, present the user with a one-question `AskUserQuestion` choice
   (Keep / Update / Consolidate / Replace / Delete-and-archive). On
   Consolidate or Replace approval, dispatch `knowledge-compounder` via
   `Task` to write the merged entry, then archive the superseded
   originals to `docs/solutions/archived/<original-category>/`.

The skill **never deletes**. Per yellow-plugins convention, superseded
entries move to `docs/solutions/archived/`. Git history alone is not
enough — archived entries remain searchable and citable, just out of
the live catalog.

## When to Use

User says any of:

- "refresh `docs/solutions/`"
- "audit learnings"
- "clean up stale docs"
- "consolidate overlapping entries"
- "compound lifecycle"
- "/yellow-core:compound-lifecycle"

Also auto-invoked by `knowledge-compounder` when a freshly-written entry
flags an older entry in the same `category` as superseded — passed via
`$ARGUMENTS` as a narrow scope hint (e.g., a single file path).

Do NOT use for: writing new entries (that's `knowledge-compounder`),
searching the catalog (that's `learnings-researcher`), or general
documentation refactor.

## Usage

Invoke as `/yellow-core:compound-lifecycle [scope-hint]`.

`scope-hint` (optional) narrows the audit: a category name
(`code-quality`), a file path (`docs/solutions/security-issues/foo.md`),
a tag, or a keyword. When omitted, the skill audits the entire catalog.

Append `mode:autofix` to `$ARGUMENTS` for non-interactive operation
(e.g., scheduled background runs). Autofix mode applies unambiguous
classifications (Keep / Update with file-rename evidence) and marks all
ambiguous cases (Consolidate / Replace / Delete-and-archive) as
`status: stale` with a `stale_reason` field for human review later. It
NEVER auto-merges — every consolidation requires human approval.

### Step 1 — Discover candidate set

Glob `docs/solutions/**/*.md`, excluding:

- `README.md` files
- `docs/solutions/archived/**` (already-archived entries)
- `docs/solutions/_lifecycle-runs/**` (autofix run reports — avoid self-ingestion)

Read frontmatter (`limit: 30`) of each candidate. Collect: `title`,
`track`, `tags`, `problem`, `category`, `severity`, `status` (when
present), `updated:` or file mtime fallback.

### Step 2 — Apply scope hint (if provided)

Filter the candidate set by the scope hint, in this order:

1. **Path match** — exact path or directory match
2. **Category match** — frontmatter `category:` equals hint
3. **Tag match** — hint appears in `tags:` array
4. **Keyword match** — `Grep` for the hint across remaining frontmatter
   and first paragraph of body

Stop at the first match form that produces results. If no candidates
remain, report "No matching entries; scope hint produced empty set" and
stop.

### Step 3 — Route by scope

Match the candidate count to one of three routing tiers:

| Tier | Count | Interaction |
|------|-------|-------------|
| **Focused** | 1–2 | Investigate directly, present one classification recommendation |
| **Batch** | 3–8 | Investigate all, present a single grouped recommendation table |
| **Broad** | 9+ | Triage first (Phase 0 below), then investigate in clusters |

#### Phase 0 (Broad scope only): Triage

For broad-scope runs, do a lightweight triage before deep
investigation:

1. Group candidates by `category` + dominant `tags` token (most-frequent
   tag across the candidate's `tags:` array)
2. Spot-check drift in each cluster: do the file paths in `problem:` /
   first body paragraph still exist? `Grep` the cited paths across the
   live tree
3. Surface the highest-impact cluster (most candidates × most missing
   references) with a one-sentence rationale, then `AskUserQuestion`:
   start there, pick another, or process everything in impact order
4. In autofix mode, skip the question and process clusters in
   impact-descending order

### Step 4 — Investigate candidates

For each candidate (within the chosen scope/cluster), gather evidence
along these dimensions:

- **References** — do the file paths and module names cited in
  `problem:` / body still exist? `Grep` for them in the live tree
- **Solution accuracy** — when the body cites concrete code (a
  `printf` pattern, a regex, a config snippet), does it still match
  what's in the codebase?
- **Cross-references** — are linked-to docs (`See …`) still present?
- **Inbound references** — `Grep` for the candidate's path across
  `docs/`, `plugins/`, and the rest of the catalog. Count incoming
  citations.
- **Retrieval recency** — when ruvector is available, query
  `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` with the entry's
  `problem:` line and check whether this entry surfaces in top-3
  results for its own problem statement (a self-recall failure is a
  drift signal)

### Step 5 — Compute staleness and overlap

#### 5a. Composite staleness score

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

#### 5b. Overlap detection

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

### Step 6 — Classify

For each stale or overlapping candidate (or cluster), classify into one
of five outcomes. The classification is a recommendation; the user has
final say in interactive mode.

| Outcome | When | Action |
|---------|------|--------|
| **Keep** | Still accurate, still useful, drift is cosmetic only | No file edit; report "reviewed, retained" |
| **Update** | References drifted (file moved / renamed) but the recommended fix still matches reality | Apply evidence-backed in-place edits to paths and metadata |
| **Consolidate** | Two or more entries cover the same fix pattern, all are correct, none subsumes the others | Hand off to `knowledge-compounder` to write a merged canonical entry; archive the originals |
| **Replace** | The recommended fix conflicts with current code; a better successor exists or has been freshly captured | Hand off to `knowledge-compounder` to write the successor (citing the original as historical context); archive the original |
| **Delete-and-archive** | The cited code no longer exists, no successor was found, and inbound citations are absent or decorative | Move to `docs/solutions/archived/<original-category>/`; do NOT git-rm |

**Drift boundary — Update vs Replace:** if you find yourself rewriting
the solution section or changing what the entry recommends, stop —
that is Replace, not Update. Update fixes paths and references; Replace
is a new write.

**Decorative vs substantive citations:** an inbound reference that
states the principle inline ("see also: X for context") is decorative;
a reference that depends on the cited content ("we use X's regex form
verbatim") is substantive. Substantive citations block
Delete-and-archive — surface them as a Replace requirement instead.

### Step 7 — Confirm and hand off

For each non-Keep classification, present the user with the
recommendation via `AskUserQuestion`:

- **Title:** the entry's `problem:` line, or for clusters, "N entries
  on \<shared problem\>"
- **Recommendation:** the classification (Update / Consolidate / Replace
  / Delete-and-archive)
- **Evidence:** one-line summary (the most concrete drift signal)
- **Options:** four buttons — Apply recommendation / Pick a different
  outcome / Skip this entry / Other (free-text override reason)

In autofix mode, skip the question. Apply Update unconditionally.
Mark Consolidate / Replace / Delete-and-archive candidates as
`status: stale` with `stale_reason: <classification rationale>` and
`stale_date: <today>` in their frontmatter, and surface them in the
Recommendations section of the final report.

### Step 8 — Execute

#### Update

In-place edits via `Edit` tool. Preserve frontmatter shape. Bump the
`updated:` field to today's date. Record the change in the run report
under "Applied".

#### Consolidate or Replace

1. Build a `<consolidation-context>` block containing:
   - the source entries' full bodies (sanitized: replace `&` with
     `&amp;`, then `<` with `&lt;`, then `>` with `&gt;`)
   - the user's stated rationale (if provided via the "Other" option)
   - target category and tags (union of the originals)
2. Dispatch `knowledge-compounder` via `Task`:

   ```text
   Task(
     subagent_type: "yellow-core:workflow:knowledge-compounder",
     description: "Consolidate <N> entries into one canonical doc",
     prompt: "<consolidation-context block>"
   )
   ```

3. Wait for the agent's return. The new entry's path is the agent's
   output. Verify it exists.
4. Archive each source entry: `mv` from
   `docs/solutions/<category>/<slug>.md` to
   `docs/solutions/archived/<category>/<slug>.md`. Preserve the
   directory structure — `archived/` mirrors the live tree's
   subdirectory layout.
5. Append a `superseded_by:` field to each archived entry's
   frontmatter pointing to the new canonical entry's path.
6. Record both the new entry creation and the archive moves in the run
   report.

#### Delete-and-archive

Same as the archive step in Consolidate (move + `superseded_by`
frontmatter), but skip the `knowledge-compounder` dispatch since
there's no successor entry.

### Step 9 — Report

Present a synthesized summary, regardless of mode:

```markdown
## compound-lifecycle Report — <date> <time>

### Scope
- Candidates discovered: <int>
- Scope hint applied: <hint or "none — full catalog">
- Routing tier: <focused | batch | broad>

### Staleness
- Stale (score > threshold): <int>
- Pre-existing `status: stale`: <int>

### Overlap
- Cluster pairs (BM25 > p90): <int>
- High-confidence pairs (ruvector cosine ≥ 0.90): <int>
- Review-suggestions (0.78–0.90): <int>

### Applied (interactive mode: with user approval; autofix: unambiguous Updates only)
- <category>/<slug>.md — <classification> — <one-line rationale>
- ...

### Recommended (interactive mode: skipped or rejected; autofix: ambiguous cases)
- <category>/<slug>.md — <classification> — <one-line rationale>
- ...

### Archive moves
- <category>/<slug>.md → archived/<category>/<slug>.md (superseded_by: <new-path>)
- ...

### Coverage
- ruvector available: <yes|no — degraded scoring>
- Run mode: <interactive | autofix>
- Total runtime: <sec>
```

In autofix mode, write the report to
`docs/solutions/_lifecycle-runs/<YYYY-MM-DD>-<HH-MM-SS>.md`. In
interactive mode, surface the report inline. (The `_lifecycle-runs/`
directory is excluded from candidate discovery by Step 1's explicit
exclusion list above; `learnings-researcher` itself does not currently
filter `_`-prefixed paths, so its broad search may still surface
report content. Updating `learnings-researcher` to add the same
exclusion is a separate follow-up.)

## Configuration

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

## Integration

- **Invoked by users** via `/yellow-core:compound-lifecycle`
- **Invoked by `knowledge-compounder`** when a freshly-written entry
  flags an older entry as superseded (passed as a path scope hint)
- **Reads** every entry in `docs/solutions/` (excluding
  `archived/` and `README.md`)
- **Writes** `docs/solutions/<category>/<slug>.md` (in-place Updates) and
  `docs/solutions/archived/<category>/<slug>.md` (archive moves)
- **Dispatches** `knowledge-compounder` via `Task` for Consolidate and
  Replace classifications

## Why "archive, don't delete"

The upstream `ce-compound-refresh` skill explicitly says delete and let
git history serve as the archive. yellow-plugins diverges deliberately:

- **Searchability** — archived entries remain `Grep`-able for
  `learnings-researcher` to find when a related-but-not-identical
  problem recurs
- **Citation continuity** — external references (Linear issues, Slack
  threads, PR descriptions) that link `docs/solutions/<...>.md` paths
  don't 404 when the entry moves to `archived/`
- **Drift forensics** — when a consolidated entry turns out to have
  been over-eager and a sub-entry's specific advice was lost, the
  archive is a single `Read` away, not a `git log --follow`
  excavation

The `archived/` subtree is intended to be out of `learnings-researcher`'s
default search path — matching the upstream's effective "don't surface
old advice" goal — but the agent does not currently filter
`docs/solutions/archived/**` automatically. Until that exclusion is
added (separate follow-up), archived entries may still surface in
search results; until then, the archive is functionally citable but
not yet operationally separated from live retrieval.
