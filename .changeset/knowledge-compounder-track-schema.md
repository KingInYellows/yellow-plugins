---
"yellow-core": minor
---

Add track/problem frontmatter schema to knowledge-compounder; backfill 51 docs/solutions entries

**knowledge-compounder.md updates (additive):**

- New required frontmatter fields for entries written to `docs/solutions/`:
  - `track: bug | knowledge` — distinguishes specific incidents from patterns/guidelines
  - `problem: <one-line ~80 char>` — keyword-rich problem statement; W2.1 `learnings-researcher` (lands in keystone PR #7) will use this for BM25/dense retrieval ranking
  - `tags: [array]` — already existed; now enforced as non-empty (3+ tags recommended)
- New "Context Budget Precheck" (CE ce-compound v2.39.0 pattern): before writing, count assembled body lines; if > `KC_CONTEXT_BUDGET` (default 200), prompt via AskUserQuestion to write single / split into N files / cancel.
- Track classification rules table: defaults by category with override conditions; security-issues entries containing audit/threat-model/pre-implementation markers are flagged for manual review rather than auto-bug-classified.
- Solution doc body sections now branch by track:
  - **bug:** Problem, Symptoms, What Didn't Work, Solution, Why This Works, Prevention
  - **knowledge:** Context, Guidance, Why This Matters, When to Apply, Examples

**New script: `scripts/backfill-solution-frontmatter.js`**

Idempotent backfill for existing `docs/solutions/` entries:

- Heuristic-based track assignment by category (logic-errors/security-issues/build-errors → bug; code-quality/workflow/integration-issues → knowledge).
- Audit-shaped security-issues entries (containing "audit", "threat model", or "pre-implementation" in title or first paragraph) are flagged for manual review — NOT auto-assigned, since a pre-implementation threat model is a knowledge-track entry despite the security-issues category default.
- `problem` field derived from existing `problem` (priority), `symptom`, `title`, then first body paragraph — truncated to 120 chars at sentence boundary.
- `tags` field seeded from category if missing, else left untouched.
- Modes: default = apply, `--dry-run` = report only, `--check` = exit non-zero if any file would change (CI-friendly).
- `SOLUTIONS_DIR` env var lets tests point at fixture trees without touching real `docs/solutions/`.

**Backfill applied:**

- 51 files scanned across 6 categories
- 45 entries gained track + problem (some also gained tags)
- 2 legacy entries (`code-quality/yellow-ci-shell-security-patterns.md`, `workflow/plugin-release-process.md`) lacked YAML frontmatter entirely — added full frontmatter inline as part of this PR.
- 1 entry flagged for manual review and classified as `track: knowledge`: `security-issues/yellow-devin-plugin-security-audit.md` (a pre-implementation threat model — heuristic correctly caught it; manual override added with a backfill-note HTML comment explaining the decision).
- Final state: 51/51 entries have track + problem + tags. Re-running the script reports zero changes (idempotency verified).

Future runs: drop the script into CI as `node scripts/backfill-solution-frontmatter.js --check` to gate PRs that add `docs/solutions/` entries without the new fields.
